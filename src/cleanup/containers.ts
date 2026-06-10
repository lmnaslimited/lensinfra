/**
 * Module: Cleanup Containers
 *
 * Responsibility:
 * - Identify exited or dead containers from active stacks.
 * - Delete only confirmed container candidates and report failures.
 *
 * Notes:
 * - Part of LENSINFRA oclif CLI.
 * - Do not change runtime behavior.
 */

import { Logger } from "winston"
import { clDockerGatewayClient } from "../docker-gateway-client.js"
import { fnFormatAxiosError } from "../portainer-client.js"
import { Candidate, CleanupReport, DockerContainer, ResourceRecord } from "../types.js"

// ===================================================
// CLEANABLE STATE REGISTRY
// ===================================================

// Define the set of Docker container states that are
// considered safe and eligible for automated cleanup.
// Only containers in "exited" or "dead" state will be
// picked up by the scanner as cleanup candidates.
const GaCleanableStates = new Set(["exited", "dead"])

// ===================================================
// UTILITY HELPERS
// ===================================================

// ---------------------------------------------------
// fnContainerName
// Extracts the human-readable display name of a container
// Docker prefixes all container names with a leading slash.
// This function strips that slash to produce a clean name.
// Parameters: iContainer - the raw Docker container object
// Returns: string - cleaned container name without leading slash
// ---------------------------------------------------

function fnContainerName(iContainer: DockerContainer): string {

  // Read the first name from the Names array and strip the leading slash
  // Docker always prefixes names with "/" so we remove it for display
  return iContainer.Names?.[0]?.replace(/^\//, "") ?? ""
}

// ---------------------------------------------------
// fnShortId
// Shortens a full Docker ID or image digest to 12 characters
// Full Docker IDs and sha256 digests are too long for readable
// log output and report tables. This trims them to a short form
// that is still unique enough for human identification.
// Parameters: iLsId - optional full Docker ID or sha256 digest string
// Returns: string - 12-character shortened ID, or empty string if undefined
// ---------------------------------------------------

function fnShortId(iLsId?: string): string {

  // Remove the "sha256:" prefix if present, then take the first 12 characters
  // This produces a compact ID that matches what the Docker CLI displays
  return iLsId?.replace(/^sha256:/, "").slice(0, 12) ?? ""
}

// ---------------------------------------------------
// fnToRecord
// Converts a raw Docker container object into a
// standardised ResourceRecord shape used across all
// cleanup reports and candidate lists in the system.
// This normalises the varying Docker metadata fields
// into one consistent structure for logging and output.
// Parameters:
//   iContainer  - the raw Docker container metadata object
//   iLsReason   - optional human-readable explanation of why
//                 this container was flagged as a candidate
// Returns: ResourceRecord - normalised report row object
// ---------------------------------------------------

function fnToRecord(iContainer: DockerContainer, iLsReason?: string): ResourceRecord {

  // Extract the full labels map from the container metadata
  // Fall back to an empty object if no labels are present
  const LdLabels = iContainer.Labels ?? {}

  // Resolve the stack name this container belongs to
  // using the shared label-reading utility function
  const LsStackName = fnGetContainerStackName(iContainer)

  // Assemble and return the normalised record object
  // Each field is pulled from the Docker metadata or derived labels
  return {
    id: fnShortId(iContainer.Id),
    name: fnContainerName(iContainer),
    image: iContainer.Image,
    state: iContainer.State,
    status: iContainer.Status,
    reason: iLsReason,
    labels: LdLabels,

    // Swarm service name assigned to this container by Docker Swarm
    serviceName: LdLabels["com.docker.swarm.service.name"],

    // Stack namespace this container was deployed under
    stackNamespace: LsStackName,

    // Swarm task name for this specific container replica
    taskName: LdLabels["com.docker.swarm.task.name"],

    // The intended desired state set by the Swarm orchestrator
    desiredState: LdLabels["com.docker.swarm.task.desired-state"]
  }
}

// ===================================================
// STACK NAME RESOLUTION
// ===================================================

// ---------------------------------------------------
// fnGetContainerStackName
// Reads the stack or project name this container belongs to
// by inspecting its Docker labels in priority order.
// Docker Swarm, Docker Compose, and Portainer each use
// different label keys to store the stack or project name.
// This function checks all three in order and returns the
// first match it finds, ensuring compatibility across
// all three deployment environments.
// Parameters: iContainer - the raw Docker container object
// Returns: string | undefined - the stack name if found,
//          or undefined if the container has no stack identity
// ---------------------------------------------------

export function fnGetContainerStackName(iContainer: DockerContainer): string | undefined {

  // Extract the full labels map from the container metadata
  // Fall back to an empty object if no labels exist on the container
  const LdLabels = iContainer.Labels ?? {}

  // Check label keys in priority order:
  // 1. Docker Swarm stack namespace label
  // 2. Docker Compose project label
  // 3. Portainer stack name label
  // Return the first one that is defined and non-empty
  return (
    LdLabels["com.docker.stack.namespace"] ??
    LdLabels["com.docker.compose.project"] ??
    LdLabels["io.portainer.stack.name"]
  )
}

// ===================================================
// CONTAINER SCANNING
// ===================================================

// ---------------------------------------------------
// fnScanContainers
// Scans all Docker containers on the host and identifies
// cleanup candidates. A container qualifies as a candidate
// if ALL three of the following conditions are true:
//   1. Its state is "exited" or "dead"
//   2. It has a recognised stack label (belongs to a stack)
//   3. Its stack name is present in the active stacks list
// Containers that fail any condition are skipped with a
// log message explaining why they were ignored.
// The matching candidates are added to both the returned
// array and the shared cleanup report for later processing.
// Parameters:
//   clDockerGatewayClient  - client used to query Docker API
//   iLaActiveStackNames    - set of currently active stack names
//   iLdReport              - shared report object to populate
//   clLogger               - winston logger for structured output
// Returns: Promise<Candidate<DockerContainer>[]> - list of
//          containers confirmed as eligible for deletion
// ---------------------------------------------------

export async function fnScanContainers(
  clDockerGatewayClient: clDockerGatewayClient,
  iLaActiveStackNames: Set<string>,
  iLdReport: CleanupReport,
  clLogger: Logger
): Promise<Candidate<DockerContainer>[]> {

  // Log the start of the container scan for visibility in output
  clLogger.info("Scanning containers")

  // Fetch the full list of all containers from the Docker host
  // Passing true includes stopped and dead containers in the result
  const LaContainers = await clDockerGatewayClient.fnGetContainers(true)

  // Initialise the empty array that will hold confirmed candidates
  const LaCandidates: Candidate<DockerContainer>[] = []

  // Iterate over every container returned by the Docker API
  for (const LdContainer of LaContainers) {

    // Normalise the state string to lowercase for consistent comparison
    const LsState = (LdContainer.State ?? "").toLowerCase()

    // Attempt to resolve which stack this container belongs to
    // using the label-based stack name resolution utility
    const LsStackName = fnGetContainerStackName(LdContainer)

    // ---------------------------------------------------
    // FILTER 1: State check
    // Skip containers that are still running or in any other
    // state that is not safe or appropriate for cleanup.
    // Only "exited" and "dead" containers proceed past this point.
    // ---------------------------------------------------

    if (!GaCleanableStates.has(LsState)) {
      continue
    }

    // ---------------------------------------------------
    // FILTER 2: Stack membership check
    // Skip containers with no recognisable stack label.
    // Containers without a stack identity are unmanaged or
    // standalone, and should not be touched by this cleanup tool.
    // ---------------------------------------------------

    if (!LsStackName) {
      clLogger.info(
        `Ignoring container ${LdContainer.Id}: container does not belong to a Portainer stack`
      )
      continue
    }

    // ---------------------------------------------------
    // FILTER 3: Active stack check
    // Skip containers whose stack is not in the active list.
    // We only clean up containers from stacks that are currently
    // active and managed, to avoid touching orphaned or retired stacks.
    // ---------------------------------------------------

    if (!iLaActiveStackNames.has(LsStackName)) {
      clLogger.info(
        `Ignoring container ${LdContainer.Id}: stack is not active: ${LsStackName}`
      )
      continue
    }

    // ---------------------------------------------------
    // CANDIDATE CONFIRMED
    // The container passed all three filters.
    // Convert it to a normalised report record, attach a
    // human-readable reason describing why it was selected,
    // and add it to both the candidate list and the report.
    // ---------------------------------------------------

    // Build the normalised record with a descriptive reason string
    const LdRecord = fnToRecord(
      LdContainer,
      `exited/dead container from active stack: ${LsStackName}`
    )

    // Add the confirmed candidate to the working candidates array
    LaCandidates.push({ resource: LdContainer, record: LdRecord })

    // Also record the candidate in the shared cleanup report
    // so it appears in the final summary output
    iLdReport.containers.candidates.push(LdRecord)

    // Log the candidate details for traceability during the scan run
    clLogger.info(
      `Container candidate: ${LdRecord.id} ${LdRecord.name} ` +
      `${LdRecord.image} ${LdRecord.state} ${LdRecord.reason}`
    )
  }

  // Return the full list of confirmed candidates for deletion
  return LaCandidates
}

// ===================================================
// CONTAINER DELETION
// ===================================================

// ---------------------------------------------------
// fnDeleteContainerCandidates
// Iterates through the confirmed candidate list and
// attempts to delete each container via the Docker API.
// Each deletion is attempted individually so that a
// failure on one container does not block the others.
// Successfully deleted containers are recorded in the
// report's deleted list. Containers that fail to delete
// are recorded in the failed list with the error message
// attached so the user can investigate after the run.
// Parameters:
//   clDockerGatewayClient - client used to call Docker API
//   iLaCandidates         - list of confirmed candidate containers
//   iLdReport             - shared report object to populate
//   clLogger              - winston logger for structured output
// Returns: Promise<void>
// ---------------------------------------------------

export async function fnDeleteContainerCandidates(
  clDockerGatewayClient: clDockerGatewayClient,
  iLaCandidates: Candidate<DockerContainer>[],
  iLdReport: CleanupReport,
  clLogger: Logger
): Promise<void> {

  // Process each confirmed candidate container one at a time
  for (const LdCandidate of iLaCandidates) {

    try {

      // Attempt to remove the container from the Docker host
      // This calls the Docker API DELETE /containers/{id} endpoint
      await clDockerGatewayClient.fnRemoveContainer(LdCandidate.resource.Id)

      // Record the successfully deleted container in the report
      iLdReport.containers.deleted.push(LdCandidate.record)

      // Log confirmation that this specific container was removed
      clLogger.info(`Deleted container ${LdCandidate.resource.Id}`)

    } catch (iLdError) {

      // ---------------------------------------------------
      // DELETION FAILURE HANDLING
      // If the Docker API call throws for any reason,
      // capture the error, attach it to the container record,
      // and add it to the failed list in the report.
      // Execution continues to the next candidate regardless.
      // ---------------------------------------------------

      // Build the failure record by spreading the existing record
      // and attaching the formatted error message from Axios
      const LdFailed = {
        ...LdCandidate.record,
        error: fnFormatAxiosError(iLdError)
      }

      // Add the failed record to the report for user visibility
      iLdReport.containers.failed.push(LdFailed)

      // Log the failure with the container ID and error detail
      clLogger.error(
        `Failed deleting container ${LdCandidate.resource.Id}: ${LdFailed.error}`
      )
    }
  }
}
