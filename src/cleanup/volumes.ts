/**
 * Module: Cleanup Volumes
 *
 * Responsibility:
 * - Identify unused Docker volume candidates.
 * - Protect mounted, inactive-stack, and data-like volumes from deletion.
 *
 * Notes:
 * - Part of LENSINFRA oclif CLI.
 * - Do not change runtime behavior.
 */

import { Logger } from "winston"
import { clDockerGatewayClient } from "../docker-gateway-client.js"
import { fnFormatAxiosError } from "../portainer-client.js"
import { AppConfig, Candidate, CleanupReport, DockerVolume, ResourceRecord } from "../types.js"
import { fnHasProtectedLabels, fnIsVolumeSafeToDelete, fnMatchesProtectedName } from "../safety/validator.js"

// ===================================================
// UTILITY HELPERS
// ===================================================

// ---------------------------------------------------
// fnToRecord
// Converts a raw Docker volume metadata object into the
// shared ResourceRecord shape used across all cleanup
// reports and candidate lists in the system.
// Volumes do not have a separate ID field - their Name
// is used as both the id and name fields in the record.
// Parameters:
//   iVolume        - the raw Docker volume metadata object
//   iLsStackName   - optional stack name this volume belongs to,
//                    resolved by fnGetVolumeStackName before calling
//   iLsReason      - optional human-readable explanation of why
//                    this volume was flagged or skipped
// Returns: ResourceRecord - normalised report row object
// ---------------------------------------------------

function fnToRecord(
  iVolume: DockerVolume,
  iLsStackName?: string,
  iLsReason?: string
): ResourceRecord {

  // Assemble and return the normalised record object
  // Docker volumes use Name as their unique identifier
  // so both id and name fields are populated from it
  return {
    id: iVolume.Name,
    name: iVolume.Name,
    reason: iLsReason,
    stackNamespace: iLsStackName,
    labels: iVolume.Labels,
  }
}

// ---------------------------------------------------
// fnGetVolumeStackName
// Resolves which stack a given volume belongs to by
// checking two sources in priority order:
//   1. Docker labels on the volume itself - the most
//      reliable source when labels are present, as they
//      are set explicitly at deployment time by Docker
//      Swarm, Docker Compose, or Portainer.
//   2. Volume name prefix matching - a fallback for
//      volumes created by older stacks or tooling that
//      did not attach labels. Docker Compose and Swarm
//      conventionally name volumes as "{stackName}_{volumeName}".
//      The active stack names list is sorted by length descending
//      so that longer stack names are matched before shorter ones,
//      preventing a short name from partially matching a longer one.
// Parameters:
//   iVolume              - the raw Docker volume metadata object
//   iLaActiveStackNames  - set of currently active stack names
// Returns: string | undefined - the resolved stack name,
//          or undefined if the volume has no stack identity
// ---------------------------------------------------

function fnGetVolumeStackName(
  iVolume: DockerVolume,
  iLaActiveStackNames: Set<string>
): string | undefined {

  // Extract the full labels map from the volume metadata
  // Fall back to an empty object if no labels are present
  const LdLabels = iVolume.Labels ?? {}

  // ---------------------------------------------------
  // PRIORITY 1: Label-based stack name resolution
  // Check the three label keys used by Docker Swarm,
  // Docker Compose, and Portainer in priority order.
  // Return immediately if any label key is present.
  // ---------------------------------------------------

  const LsLabelStackName =
    LdLabels["com.docker.stack.namespace"] ??
    LdLabels["com.docker.compose.project"] ??
    LdLabels["io.portainer.stack.name"]

  // If a label-based stack name was found, return it immediately
  // without needing to fall back to name prefix matching
  if (LsLabelStackName) {
    return LsLabelStackName
  }

  // ---------------------------------------------------
  // PRIORITY 2: Volume name prefix matching fallback
  // No label was found, so attempt to match the volume name
  // against the known active stack names using prefix rules.
  // Sort stack names by descending length first to ensure
  // longer names are tested before shorter overlapping ones.
  // A volume matches if its name equals the stack name exactly
  // or if it starts with "{stackName}_" as a prefix.
  // ---------------------------------------------------

  return [...iLaActiveStackNames]
    .sort(
      (LsLeftStackName, LsRightStackName) =>
        LsRightStackName.length - LsLeftStackName.length
    )
    .find(
      (LsStackName) =>
        iVolume.Name === LsStackName ||
        iVolume.Name.startsWith(`${LsStackName}_`)
    )
}

// ===================================================
// USED VOLUME COLLECTION
// ===================================================

// ---------------------------------------------------
// fnGetUsedVolumeNames
// Queries all containers currently on the Docker host
// including stopped and dead ones, and collects the names
// of every volume that is actively mounted by at least
// one container via a named volume mount.
// Only mounts of type "volume" with a defined Name are
// included - bind mounts and tmpfs mounts are ignored.
// This set is used as a safety guard during volume scanning
// to ensure that volumes still mounted by any container
// are never flagged as deletion candidates.
// Parameters: clDockerGatewayClient - client used to query Docker API
// Returns: Promise<Set<string>> - set of volume names currently in use
// ---------------------------------------------------

export async function fnGetUsedVolumeNames(
  clDockerGatewayClient: clDockerGatewayClient
): Promise<Set<string>> {

  // Fetch all containers including stopped and dead ones
  // Passing true ensures we catch volumes mounted by non-running containers
  const LaContainers = await clDockerGatewayClient.fnGetContainers(true)

  // Initialise the empty set that will hold all in-use volume names
  const LaUsedVolumeNames = new Set<string>()

  // Iterate over every container and inspect its mount list
  for (const LdContainer of LaContainers) {

    // Iterate over every mount entry attached to this container
    // Fall back to an empty array if the container has no mounts
    for (const LdMount of LdContainer.Mounts ?? []) {

      // Only collect named volume mounts - ignore bind mounts and tmpfs
      // Bind mounts have no Name and are not managed as Docker volumes
      if (LdMount.Type === "volume" && LdMount.Name) {
        LaUsedVolumeNames.add(LdMount.Name)
      }
    }
  }

  // Return the complete set of volume names that are mounted by containers
  return LaUsedVolumeNames
}

// ===================================================
// PROTECTED VOLUME GUARD
// ===================================================

// ---------------------------------------------------
// fnIsProtectedVolume
// Checks whether a given volume is protected from deletion
// by evaluating two independent protection criteria:
//   1. The volume carries one or more protected labels
//      that explicitly mark it as off-limits for cleanup
//   2. The volume name matches a known protected name
//      pattern defined in the safety validator rules
// Either condition alone is sufficient to mark a volume
// as protected. This function is exported so that future
// pipeline stages and external callers can reuse the same
// protection check without duplicating the logic.
// Parameters: iVolume - the raw Docker volume metadata object
// Returns: boolean - true if the volume is protected, false if safe to evaluate
// ---------------------------------------------------

export function fnIsProtectedVolume(iVolume: DockerVolume): boolean {

  // Return true if the volume has protected labels OR a protected name
  // Both checks are delegated to the shared safety validator module
  return (
    fnHasProtectedLabels(iVolume.Labels) ||
    fnMatchesProtectedName(iVolume.Name)
  )
}

// ===================================================
// VOLUME SCANNING
// ===================================================

// ---------------------------------------------------
// fnScanVolumes
// Scans all Docker volumes on the host and identifies
// cleanup candidates based on stack membership and
// safety validator rules. The scanning logic applies
// two layers of filtering before a volume is confirmed:
//   1. Stack filter - if the volume belongs to a stack
//      that is NOT in the active stacks list, skip it.
//      Volumes with no stack identity are not skipped
//      by this filter and proceed to safety evaluation.
//   2. Safety evaluation - the safety validator checks
//      whether the volume is currently mounted, protected,
//      or excluded by the configured cleanup mode rules.
// Volumes that pass both layers are added to the candidate
// list and the shared cleanup report for user confirmation.
// Volumes that fail either layer are skipped with a log message.
// Parameters:
//   clDockerGatewayClient - client used to query Docker API
//   iConfig               - application config with cleanup mode setting
//   iLaActiveStackNames   - set of currently active stack names
//   iLdReport             - shared report object to populate with candidates
//   clLogger              - winston logger for structured terminal output
// Returns: Promise<Candidate<DockerVolume>[]> - list of volumes
//          confirmed as eligible for deletion
// ---------------------------------------------------

export async function fnScanVolumes(
  clDockerGatewayClient: clDockerGatewayClient,
  iConfig: AppConfig,
  iLaActiveStackNames: Set<string>,
  iLdReport: CleanupReport,
  clLogger: Logger
): Promise<Candidate<DockerVolume>[]> {

  // Log the start of the volume scan for visibility in output
  clLogger.info("Scanning volumes")

  // Fetch the full volume list and the in-use volume name set in parallel
  // Running both requests concurrently reduces total scan time
  const [LdVolumeList, LaUsedVolumeNames] = await Promise.all([
    clDockerGatewayClient.fnGetVolumes(),
    fnGetUsedVolumeNames(clDockerGatewayClient),
  ])

  // Initialise the empty array that will hold confirmed candidates
  const LaCandidates: Candidate<DockerVolume>[] = []

  // Iterate over every volume in the list returned by the Docker API
  // Fall back to an empty array if the Volumes field is undefined
  for (const LdVolume of LdVolumeList.Volumes ?? []) {

    // Attempt to resolve which stack this volume belongs to
    // using both label-based and name prefix-based resolution
    const LsStackName = fnGetVolumeStackName(LdVolume, iLaActiveStackNames)

    // ---------------------------------------------------
    // FILTER 1: Inactive stack membership check
    // If the volume belongs to a stack that is identified
    // but NOT present in the active stacks list, skip it.
    // We do not clean up volumes from inactive or retired stacks
    // as they may still hold data needed for stack recovery.
    // Volumes with no resolved stack name are NOT skipped here
    // and proceed to safety evaluation in the next step.
    // ---------------------------------------------------

    if (LsStackName && !iLaActiveStackNames.has(LsStackName)) {
      continue
    }

    // ---------------------------------------------------
    // FILTER 2: Safety evaluation
    // Run each volume through the safety validator to determine
    // whether it is eligible for deletion under the current
    // cleanup mode configured in the application settings.
    // The validator checks mount status, protected labels,
    // protected name patterns, and cleanup mode rules.
    // ---------------------------------------------------

    // Evaluate whether this volume is safe to delete
    // The cleanup mode from config controls how aggressively volumes are selected
    const LdSafety = fnIsVolumeSafeToDelete(
      LdVolume,
      LaUsedVolumeNames,
      iConfig.volumeCleanupMode
    )

    // Convert the raw volume metadata to a normalised report record
    // Attach the resolved stack name and reason string from the safety result
    const LdRecord = fnToRecord(LdVolume, LsStackName, LdSafety.reason)

    // ---------------------------------------------------
    // CANDIDATE DECISION
    // If the safety validator marked this volume as safe to delete,
    // add it to the candidate list and the shared cleanup report.
    // If not safe, log the reason and skip without further action.
    // ---------------------------------------------------

    if (LdSafety.safe) {

      // Add the confirmed candidate to the working candidates array
      LaCandidates.push({ resource: LdVolume, record: LdRecord })

      // Also record the candidate in the shared cleanup report
      // so it appears in the final summary output shown to the user
      iLdReport.volumes.candidates.push(LdRecord)

      // Log the candidate details for traceability during the scan run
      clLogger.info(
        `Volume candidate: ${LdVolume.Name} ${LdRecord.reason}`
      )

    } else {

      // Log that this volume was evaluated and deliberately skipped
      // The reason string from the validator explains the decision
      clLogger.info(
        `Ignoring volume ${LdVolume.Name}: ${LdRecord.reason}`
      )
    }
  }

  // Return the full list of confirmed candidates for deletion
  return LaCandidates
}

// ===================================================
// VOLUME DELETION
// ===================================================

// ---------------------------------------------------
// fnDeleteVolumeCandidates
// Iterates through the confirmed volume candidate list and
// attempts to delete each volume via the Docker API.
// Each deletion is attempted individually so that a failure
// on one volume does not block the remaining volumes from
// being processed in the same run.
// Successfully deleted volumes are added to the report's
// deleted list. Volumes that fail to delete are added to
// the failed list with the formatted error message attached
// so the user can investigate the cause after the run ends.
// Parameters:
//   clDockerGatewayClient - client used to call Docker API
//   iLaCandidates         - list of confirmed candidate volumes
//   iLdReport             - shared report object to populate
//   clLogger              - winston logger for structured output
// Returns: Promise<void>
// ---------------------------------------------------

export async function fnDeleteVolumeCandidates(
  clDockerGatewayClient: clDockerGatewayClient,
  iLaCandidates: Candidate<DockerVolume>[],
  iLdReport: CleanupReport,
  clLogger: Logger
): Promise<void> {

  // Process each confirmed candidate volume one at a time
  for (const LdCandidate of iLaCandidates) {

    try {

      // Attempt to remove the volume from the Docker host
      // This calls the Docker API DELETE /volumes/{name} endpoint
      // Volumes are identified by Name rather than an ID field
      await clDockerGatewayClient.fnRemoveVolume(LdCandidate.resource.Name)

      // Record the successfully deleted volume in the report
      iLdReport.volumes.deleted.push(LdCandidate.record)

      // Log confirmation that this specific volume was removed
      clLogger.info(`Deleted volume ${LdCandidate.resource.Name}`)

    } catch (iLdError) {

      // ---------------------------------------------------
      // DELETION FAILURE HANDLING
      // If the Docker API call throws for any reason, capture
      // the error and attach it to the existing volume record.
      // Add the failed record to the report's failed list.
      // Execution continues to the next candidate regardless
      // so one failure does not abort the entire deletion run.
      // ---------------------------------------------------

      // Build the failure record by spreading the existing record
      // and attaching the formatted Axios error message string
      const LdFailed = {
        ...LdCandidate.record,
        error: fnFormatAxiosError(iLdError),
      }

      // Add the failed record to the report for user visibility
      iLdReport.volumes.failed.push(LdFailed)

      // Log the failure with the volume name and the error detail
      clLogger.error(
        `Failed deleting volume ${LdCandidate.resource.Name}: ${LdFailed.error}`
      )
    }
  }
}
