/**
 * Module: Cleanup Images
 *
 * Responsibility:
 * - Identify unused or dangling Docker image candidates.
 * - Delete only confirmed image candidates and report failures.
 *
 * Notes:
 * - Part of LENSINFRA oclif CLI.
 * - Do not change runtime behavior.
 */

import { Logger } from "winston"
import { clDockerGatewayClient } from "../docker-gateway-client.js"
import { fnFormatAxiosError } from "../portainer-client.js"
import { IAppConfig, ICandidate, ICleanupReport, IDockerImage, IResourceRecord } from "../types.js"
import { fnIsDanglingImage, fnIsImageSafeToDelete, fnNormalizeImageId } from "../safety/validator.js"

// ===================================================
// UTILITY HELPERS
// ===================================================

// ---------------------------------------------------
// fnShortId
// Shortens a full Docker image ID or sha256 digest
// down to 12 characters for readable log output and
// report tables. Full Docker IDs are too long to display
// cleanly in tabular or terminal output formats.
// Parameters: iId - optional full Docker ID or sha256 digest string
// Returns: string - 12-character shortened ID, or empty string if undefined
// ---------------------------------------------------

function fnShortId(iId?: string): string {

  // Strip the "sha256:" prefix if present, then slice to 12 characters
  // This matches the short ID format the Docker CLI uses natively
  return iId?.replace(/^sha256:/, "").slice(0, 12) ?? ""
}

// ---------------------------------------------------
// fnToRecord
// Converts a raw Docker image metadata object into the
// shared IResourceRecord shape used across all cleanup
// reports and ICandidate lists in the system.
// Normalises the varying Docker image fields into one
// consistent flat structure for display and reporting.
// Parameters:
//   iImage      - the raw Docker image metadata object
//   iReason   - optional human-readable explanation of
//                 why this image was flagged or ignored
// Returns: IResourceRecord - normalised report row object
// ---------------------------------------------------

function fnToRecord(iImage: IDockerImage, iReason?: string): IResourceRecord {

  // Assemble and return the normalised record object
  // RepoTags is joined as a comma-separated string for display
  // Falls back to "<none>" for untagged or dangling images
  return {
    id: fnShortId(iImage.Id),
    name: iImage.RepoTags?.join(", ") || "<none>",
    repoTags: iImage.RepoTags?.join(", ") || "<none>",
    size: iImage.Size,
    created: iImage.Created,
    reason: iReason,
    labels: iImage.Labels,
  }
}

// ===================================================
// USED IMAGE COLLECTION
// ===================================================

// ---------------------------------------------------
// fnGetUsedImageIds
// Queries all containers currently on the Docker host
// (including stopped ones) and collects the IDs of every
// image that is actively referenced by at least one container.
// This set is used as a safety guard during image scanning
// to ensure that images still in use by any container are
// never flagged as deletion candidates, even if they appear
// to be dangling or untagged by other criteria.
// Parameters: clDockerGatewayClient - client used to query Docker API
// Returns: Promise<Set<string>> - set of normalised image IDs in use
// ---------------------------------------------------

export async function fnGetUsedImageIds(
  clDockerGatewayClient: clDockerGatewayClient
): Promise<Set<string>> {

  // Fetch all containers including stopped and dead ones
  // Passing true ensures we catch images referenced by non-running containers
  const LaContainers = await clDockerGatewayClient.fnGetContainers(true)

  // Initialise the empty set that will hold all in-use image IDs
  const LaUsedImageIds = new Set<string>()

  // Iterate over every container and collect its referenced image ID
  for (const LdContainer of LaContainers) {

    // Only add the image ID if the container has one defined
    // Normalise the ID to strip any sha256: prefix for consistent comparison
    if (LdContainer.ImageID) {
      LaUsedImageIds.add(fnNormalizeImageId(LdContainer.ImageID))
    }
  }

  // Return the complete set of image IDs that are in use by containers
  return LaUsedImageIds
}

// ===================================================
// DANGLING IMAGE RE-EXPORT
// ===================================================

// Re-export fnIsDanglingImage from the safety validator
// so callers can import it directly from this module
// without needing to reference the validator path
export { fnIsDanglingImage }

// ===================================================
// IMAGE SCANNING
// ===================================================

// ---------------------------------------------------
// fnScanImages
// Scans all Docker images on the host and identifies
// cleanup candidates regardless of stack membership.
// Unlike container scanning, image scanning is not
// restricted to active stacks - it evaluates every
// image on the host against the safety validator rules.
// For each image the safety validator returns a result
// indicating whether the image is safe to delete and
// a reason string explaining the decision either way.
// Safe images are added to the ICandidate list and report.
// Unsafe images are skipped with a log message explaining why.
// Parameters:
//   clDockerGatewayClient - client used to query Docker API
//   iConfig               - application config containing cleanup mode setting
//   idReport             - shared report object to populate with candidates
//   clLogger              - winston logger for structured terminal output
// Returns: Promise<ICandidate<IDockerImage>[]> - list of images
//          confirmed as eligible for deletion
// ---------------------------------------------------

export async function fnScanImages(
  clDockerGatewayClient: clDockerGatewayClient,
  iConfig: IAppConfig,
  idReport: ICleanupReport,
  clLogger: Logger
): Promise<ICandidate<IDockerImage>[]> {

  // Log the start of the image scan for visibility in output
  clLogger.info("Scanning images")

  // Fetch the full image list and the in-use image ID set in parallel
  // Running both requests concurrently reduces total scan time
  const [LaImages, LaUsedImageIds] = await Promise.all([
    clDockerGatewayClient.fnGetImages(),
    fnGetUsedImageIds(clDockerGatewayClient),
  ])

  // Initialise the empty array that will hold confirmed candidates
  const LaCandidates: ICandidate<IDockerImage>[] = []

  // Iterate over every image returned by the Docker API
  for (const LdImage of LaImages) {

    // ---------------------------------------------------
    // SAFETY EVALUATION
    // Run each image through the safety validator to determine
    // whether it is eligible for deletion under the current
    // cleanup mode configured in the application settings.
    // The validator checks usage, tags, and cleanup mode rules
    // and returns a result with a safe flag and reason string.
    // ---------------------------------------------------

    // Evaluate whether this image is safe to delete
    // The cleanup mode from config controls how aggressively images are selected
    const LdSafety = fnIsImageSafeToDelete(
      LdImage,
      LaUsedImageIds,
      iConfig.imageCleanupMode
    )

    // Convert the raw image metadata to a normalised report record
    // Attach the reason string from the safety evaluation result
    const LdRecord = fnToRecord(LdImage, LdSafety.reason)

    // ---------------------------------------------------
    // ICandidate DECISION
    // If the safety validator marked this image as safe to delete,
    // add it to the ICandidate list and the shared cleanup report.
    // If not safe, log the reason and skip it without further action.
    // ---------------------------------------------------

    if (LdSafety.safe) {

      // Add the confirmed ICandidate to the working candidates array
      LaCandidates.push({ resource: LdImage, record: LdRecord })

      // Also record the ICandidate in the shared cleanup report
      // so it appears in the final summary output shown to the user
      idReport.images.candidates.push(LdRecord)

      // Log the ICandidate details for traceability during the scan run
      clLogger.info(
        `Image ICandidate: ${LdRecord.id} ${LdRecord.name} ${LdRecord.reason}`
      )

    } else {

      // Log that this image was evaluated and deliberately skipped
      // The reason string from the validator explains the decision
      clLogger.info(
        `Ignoring image ${LdRecord.id}: ${LdRecord.reason}`
      )
    }
  }

  // Return the full list of confirmed candidates for deletion
  return LaCandidates
}

// ===================================================
// IMAGE DELETION
// ===================================================

// ---------------------------------------------------
// fnDeleteImageCandidates
// Iterates through the confirmed image ICandidate list and
// attempts to delete each image via the Docker API.
// Each deletion is attempted individually so that a failure
// on one image does not block the remaining images from
// being processed in the same run.
// Successfully deleted images are added to the report's
// deleted list. Images that fail to delete are added to
// the failed list with the formatted error message attached
// so the user can investigate the cause after the run ends.
// Parameters:
//   clDockerGatewayClient - client used to call Docker API
//   iaCandidates         - list of confirmed ICandidate images
//   idReport             - shared report object to populate
//   clLogger              - winston logger for structured output
// Returns: Promise<void>
// ---------------------------------------------------

export async function fnDeleteImageCandidates(
  clDockerGatewayClient: clDockerGatewayClient,
  iaCandidates: ICandidate<IDockerImage>[],
  idReport: ICleanupReport,
  clLogger: Logger
): Promise<void> {

  // Process each confirmed ICandidate image one at a time
  for (const LdCandidate of iaCandidates) {

    try {

      // Attempt to remove the image from the Docker host
      // This calls the Docker API DELETE /images/{id} endpoint
      await clDockerGatewayClient.fnRemoveImage(LdCandidate.resource.Id)

      // Record the successfully deleted image in the report
      idReport.images.deleted.push(LdCandidate.record)

      // Log confirmation that this specific image was removed
      clLogger.info(`Deleted image ${LdCandidate.resource.Id}`)

    } catch (idError) {

      // ---------------------------------------------------
      // DELETION FAILURE HANDLING
      // If the Docker API call throws for any reason, capture
      // the error and attach it to the existing image record.
      // Add the failed record to the report's failed list.
      // Execution continues to the next ICandidate regardless
      // so one failure does not abort the entire deletion run.
      // ---------------------------------------------------

      // Build the failure record by spreading the existing record
      // and attaching the formatted Axios error message string
      const LdFailed = {
        ...LdCandidate.record,
        error: fnFormatAxiosError(idError),
      }

      // Add the failed record to the report for user visibility
      idReport.images.failed.push(LdFailed)

      // Log the failure with the image ID and the error detail
      clLogger.error(
        `Failed deleting image ${LdCandidate.resource.Id}: ${LdFailed.error}`
      )
    }
  }
}
