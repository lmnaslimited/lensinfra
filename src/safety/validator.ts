/**
 * Module: Cleanup Safety Validator
 *
 * Responsibility:
 * - Centralize resource safety checks for cleanup candidates.
 * - Protect running, in-use, and data-like Docker resources from deletion.
 *
 * Notes:
 * - Part of LENSINFRA oclif CLI.
 * - Do not change runtime behavior.
 */

import {
  Candidate,
  DockerContainer,
  DockerImage,
  DockerVolume,
  ImageCleanupMode,
  VolumeCleanupMode
} from "../types.js";

const GaSafeContainerStates = new Set(["exited", "created", "dead"]);
const GaUnsafeContainerStates = new Set(["running", "restarting", "paused"]);
const GaProtectedLabelKeys = [
  "backup",
  "database",
  "db",
  "keep",
  "persistent",
  "portainer",
  "prod",
  "production",
  "protected"
];
const GaProtectedNamePatterns = [
  "db",
  "database",
  "mysql",
  "postgres",
  "mongo",
  "redis",
  "portainer",
  "backup",
  "prod",
  "production"
];

export interface SafetyResult {
  safe: boolean;
  reason: string;
}

/**
 * Keeps the older container safety helper available for future cleanup stages.
 */
export function fnIsContainerSafeToDelete(iContainer: DockerContainer): SafetyResult {
  const LsState = (iContainer.State ?? "").toLowerCase();
  if (iContainer.Labels?.["com.docker.swarm.service.name"] && LsState === "running") {
    return { safe: false, reason: "running Swarm task container" };
  }

  if (GaUnsafeContainerStates.has(LsState)) {
    return { safe: false, reason: `container state is unsafe: ${LsState}` };
  }

  if (!GaSafeContainerStates.has(LsState)) {
    return { safe: false, reason: `container state is not explicitly safe: ${LsState || "unknown"}` };
  }

  return { safe: true, reason: `container state is safe: ${LsState}` };
}

/**
 * Confirms a volume is unused and does not look like protected data.
 */
export function fnIsVolumeSafeToDelete(
  iVolume: DockerVolume,
  iLaUsedVolumeNames: Set<string>,
  iLsMode: VolumeCleanupMode
): SafetyResult {
  if (iLaUsedVolumeNames.has(iVolume.Name)) {
    return { safe: false, reason: "volume is mounted by at least one container" };
  }

  if (fnHasProtectedLabels(iVolume.Labels)) {
    return { safe: false, reason: "volume has protected labels" };
  }

  if (fnMatchesProtectedName(iVolume.Name)) {
    return { safe: false, reason: "volume name matches protected data pattern" };
  }

  if (iLsMode === "anonymous" && !fnLooksAnonymousVolume(iVolume)) {
    return { safe: false, reason: "volume is unused but does not look anonymous" };
  }

  return {
    safe: true,
    reason: iLsMode === "anonymous" ? "unused anonymous-looking volume" : "unused volume"
  };
}

/**
 * Confirms an image is unused and not protected by labels.
 */
export function fnIsImageSafeToDelete(
  iImage: DockerImage,
  iLaUsedImageIds: Set<string>,
  iLsMode: ImageCleanupMode
): SafetyResult {
  if (iLaUsedImageIds.has(fnNormalizeImageId(iImage.Id))) {
    return { safe: false, reason: "image is used by at least one container" };
  }

  if (fnHasProtectedLabels(iImage.Labels)) {
    return { safe: false, reason: "image has protected labels" };
  }

  if (iLsMode === "dangling" && !fnIsDanglingImage(iImage)) {
    return { safe: false, reason: "image is not dangling" };
  }

  return {
    safe: true,
    reason: iLsMode === "dangling" ? "dangling image not used by any container" : "unused image"
  };
}

/**
 * Detects explicit labels that should keep resources out of deletion candidates.
 */
export function fnHasProtectedLabels(iLdLabels?: Record<string, string>): boolean {
  if (!iLdLabels) {
    return false;
  }

  return Object.entries(iLdLabels).some(([LsKey, LsValue]) => {
    const LsNormalizedKey = LsKey.toLowerCase();
    const LsNormalizedValue = String(LsValue).toLowerCase();
    if ((LsNormalizedKey === "keep" || LsNormalizedKey === "protected") && LsNormalizedValue === "true") {
      return true;
    }

    return GaProtectedLabelKeys.some(
      (LsFragment) => LsNormalizedKey.includes(LsFragment) || LsNormalizedValue.includes(LsFragment)
    );
  });
}

/**
 * Detects data-like volume names that should be protected.
 */
export function fnMatchesProtectedName(iLsName: string): boolean {
  const LsNormalized = iLsName.toLowerCase();
  return GaProtectedNamePatterns.some((LsFragment) => LsNormalized.includes(LsFragment));
}

/**
 * Keeps max-delete enforcement available for future stages.
 */
export function fnEnforceMaxDeleteCount<T>(iLaCandidates: Candidate<T>[], iLnMax: number): void {
  if (iLaCandidates.length > iLnMax) {
    throw new Error(
      `Refusing to delete ${iLaCandidates.length} resources because MAX_DELETE_COUNT is ${iLnMax}. Increase MAX_DELETE_COUNT after reviewing the preview.`
    );
  }
}

/**
 * Normalizes Docker image IDs before comparing them.
 */
export function fnNormalizeImageId(iLsImageId?: string): string {
  return (iLsImageId ?? "").replace(/^sha256:/, "");
}

/**
 * Detects dangling images reported with no repo tags or <none>:<none>.
 */
export function fnIsDanglingImage(iImage: DockerImage): boolean {
  if (!iImage.RepoTags || iImage.RepoTags.length === 0) {
    return true;
  }

  return iImage.RepoTags.includes("<none>:<none>");
}

/**
 * Decides whether a volume name/labels look anonymous.
 */
function fnLooksAnonymousVolume(iVolume: DockerVolume): boolean {
  const LsName = iVolume.Name;
  const LbHashLike = /^[a-f0-9]{32,}$/i.test(LsName);
  const LbHasMeaningfulLabels = iVolume.Labels && Object.keys(iVolume.Labels).length > 0;
  return LbHashLike || !LbHasMeaningfulLabels;
}
