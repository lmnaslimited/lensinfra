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
  ICandidate,
  IDockerContainer,
  IDockerImage,
  IDockerVolume,
  TImageCleanupMode,
  TVolumeCleanupMode
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

export interface ISafetyResult {
  safe: boolean;
  reason: string;
}

/**
 * Keeps the older container safety helper available for future cleanup stages.
 */
export function fnIsContainerSafeToDelete(iContainer: IDockerContainer): ISafetyResult {
  const LState = (iContainer.State ?? "").toLowerCase();
  if (iContainer.Labels?.["com.docker.swarm.service.name"] && LState === "running") {
    return { safe: false, reason: "running Swarm task container" };
  }

  if (GaUnsafeContainerStates.has(LState)) {
    return { safe: false, reason: `container state is unsafe: ${LState}` };
  }

  if (!GaSafeContainerStates.has(LState)) {
    return { safe: false, reason: `container state is not explicitly safe: ${LState || "unknown"}` };
  }

  return { safe: true, reason: `container state is safe: ${LState}` };
}

/**
 * Confirms a volume is unused and does not look like protected data.
 */
export function fnIsVolumeSafeToDelete(
  iVolume: IDockerVolume,
  iaUsedVolumeNames: Set<string>,
  iMode: TVolumeCleanupMode
): ISafetyResult {
  if (iaUsedVolumeNames.has(iVolume.Name)) {
    return { safe: false, reason: "volume is mounted by at least one container" };
  }

  if (fnHasProtectedLabels(iVolume.Labels)) {
    return { safe: false, reason: "volume has protected labels" };
  }

  if (fnMatchesProtectedName(iVolume.Name)) {
    return { safe: false, reason: "volume name matches protected data pattern" };
  }

  if (iMode === "anonymous" && !fnLooksAnonymousVolume(iVolume)) {
    return { safe: false, reason: "volume is unused but does not look anonymous" };
  }

  return {
    safe: true,
    reason: iMode === "anonymous" ? "unused anonymous-looking volume" : "unused volume"
  };
}

/**
 * Confirms an image is unused and not protected by labels.
 */
export function fnIsImageSafeToDelete(
  iImage: IDockerImage,
  iaUsedImageIds: Set<string>,
  iMode: TImageCleanupMode
): ISafetyResult {
  if (iaUsedImageIds.has(fnNormalizeImageId(iImage.Id))) {
    return { safe: false, reason: "image is used by at least one container" };
  }

  if (fnHasProtectedLabels(iImage.Labels)) {
    return { safe: false, reason: "image has protected labels" };
  }

  if (iMode === "dangling" && !fnIsDanglingImage(iImage)) {
    return { safe: false, reason: "image is not dangling" };
  }

  return {
    safe: true,
    reason: iMode === "dangling" ? "dangling image not used by any container" : "unused image"
  };
}

/**
 * Detects explicit labels that should keep resources out of deletion candidates.
 */
export function fnHasProtectedLabels(idLabels?: Record<string, string>): boolean {
  if (!idLabels) {
    return false;
  }

  return Object.entries(idLabels).some(([LKey, LValue]) => {
    const LormalizedKey = LKey.toLowerCase();
    const LormalizedValue = String(LValue).toLowerCase();
    if ((LormalizedKey === "keep" || LormalizedKey === "protected") && LormalizedValue === "true") {
      return true;
    }

    return GaProtectedLabelKeys.some(
      (LFragment) => LormalizedKey.includes(LFragment) || LormalizedValue.includes(LFragment)
    );
  });
}

/**
 * Detects data-like volume names that should be protected.
 */
export function fnMatchesProtectedName(iName: string): boolean {
  const Lormalized = iName.toLowerCase();
  return GaProtectedNamePatterns.some((LFragment) => Lormalized.includes(LFragment));
}

/**
 * Keeps max-delete enforcement available for future stages.
 */
export function fnEnforceMaxDeleteCount<T>(iaCandidates: ICandidate<T>[], iMax: number): void {
  if (iaCandidates.length > iMax) {
    throw new Error(
      `Refusing to delete ${iaCandidates.length} resources because MAX_DELETE_COUNT is ${iMax}. Increase MAX_DELETE_COUNT after reviewing the preview.`
    );
  }
}

/**
 * Normalizes Docker image IDs before comparing them.
 */
export function fnNormalizeImageId(iImageId?: string): string {
  return (iImageId ?? "").replace(/^sha256:/, "");
}

/**
 * Detects dangling images reported with no repo tags or <none>:<none>.
 */
export function fnIsDanglingImage(iImage: IDockerImage): boolean {
  if (!iImage.RepoTags || iImage.RepoTags.length === 0) {
    return true;
  }

  return iImage.RepoTags.includes("<none>:<none>");
}

/**
 * Decides whether a volume name/labels look anonymous.
 */
function fnLooksAnonymousVolume(iVolume: IDockerVolume): boolean {
  const LName = iVolume.Name;
  const LHashLike = /^[a-f0-9]{32,}$/i.test(LName);
  const LHasMeaningfulLabels = iVolume.Labels && Object.keys(iVolume.Labels).length > 0;
  return LHashLike || !LHasMeaningfulLabels;
}
