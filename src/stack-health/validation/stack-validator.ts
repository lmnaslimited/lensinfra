/**
 * Module: Stack Health Stack Validator
 *
 * Responsibility:
 * - Decide which Portainer stacks should be included in the ACK scan.
 * - Detect Bench/Frappe stacks by name, labels, or common service names.
 *
 * Notes:
 * - Part of LENSINFRA oclif CLI.
 * - Do not change runtime behavior.
 */

import { IAppConfig, IDockerContainerSummary, IDockerService, IPortainerStack } from "../types.js";

// Constant: Common Bench/Frappe service suffixes used when labels are incomplete.
const GaBenchServiceNames = new Set([
  "backend",
  "frontend",
  "websocket",
  "scheduler",
  "queue-default",
  "queue-short",
  "queue-long",
  "redis-cache",
  "redis-queue",
  "redis-socketio",
  "db",
  "config",
  "configure",
  "configurator",
  "site",
  "create-site",
  "install-app",
  "migrate",
  "migration"
]);

// Constant: Bench setup stack suffixes that contain one-shot configurator/site jobs.
const GaBenchStackSuffixes = [
  "-config",
  "-configure",
  "-site",
  "-db"
];

// Function: Read Docker stack namespace from service labels.
export function fnGetStackNamespaceFromService(iService: IDockerService): string | undefined {
  // Output: Docker Swarm stack namespace label.
  return iService.Spec?.Labels?.["com.docker.stack.namespace"];
}

// Function: Read Docker stack namespace from container labels.
export function fnGetStackNamespaceFromContainer(iContainer: IDockerContainerSummary): string | undefined {
  // Output: Docker Swarm stack namespace label.
  return iContainer.Labels?.["com.docker.stack.namespace"];
}

// Function: Decide whether a Portainer stack should be treated as active.
export function fnIsStackActive(iStack: IPortainerStack): boolean {
  // Guard: Older Portainer payloads may omit status; treat those stacks as active.
  if (iStack.Status === undefined || iStack.Status === null) {
    // Output: Missing status should not hide a stack.
    return true;
  }

  // Branch: Numeric Status 1 is Portainer active.
  if (typeof iStack.Status === "number") {
    // Output: True only for active numeric status.
    return iStack.Status === 1;
  }

  // String: Normalize text status from Portainer variants.
  const LStatus = String(iStack.Status).toLowerCase();

  // Output: Exclude obvious inactive states.
  return !["inactive", "stopped", "down", "removed"].includes(LStatus);
}

// Function: Filter stacks to active stacks that match the Bench selection rules.
export function fnFilterBenchStacks(
  iStacks: IPortainerStack[],
  iServices: IDockerService[],
  iContainers: IDockerContainerSummary[],
  iConfig: IAppConfig,
  iEndpointId: number
): IPortainerStack[] {
  // Array: Active stacks for the selected endpoint.
  const LaCandidates = iStacks.filter((iStack) => fnIsStackActive(iStack) && (iStack.EndpointId === undefined || iStack.EndpointId === iEndpointId));

  // Boolean: When no filter exists, every active stack is intentionally checked.
  const LIsEnabled = Boolean(iConfig.stackNameFilter || iConfig.stackLabelFilter);

  // Branch: No filters means validate all active stacks.
  if (!LIsEnabled) {
    // Output: All active stacks.
    return LaCandidates;
  }

  // Output: Active stacks that look like Bench/Frappe stacks.
  return LaCandidates.filter((iStack) => fnIsBenchStack(iStack, iServices, iContainers, iConfig));
}

// Function: Check one stack against all Bench detection rules.
function fnIsBenchStack(
  iStack: IPortainerStack,
  iServices: IDockerService[],
  iContainers: IDockerContainerSummary[],
  iConfig: IAppConfig
): boolean {
  // String: Lowercase stack name for case-insensitive matching.
  const LName = iStack.Name.toLowerCase();

  // String: Optional stack-name filter from .env.
  const LNameFilter = iConfig.stackNameFilter?.toLowerCase();

  // String: Optional label filter from .env.
  const LLabelFilter = iConfig.stackLabelFilter?.toLowerCase();

  // Branch: Stack names containing bench are always selected.
  if (LName.includes("bench")) {
    // Output: Bench stack by name.
    return true;
  }

  // Branch: Bench deployments often create sibling setup stacks like app-config, app-configure, app-site, and app-db.
  if (GaBenchStackSuffixes.some((LMessage) => LName.endsWith(LMessage))) {
    // Output: Bench setup/IRuntime sibling stack by suffix.
    return true;
  }

  // Branch: User supplied stack name filter.
  if (LNameFilter && LName.includes(LNameFilter)) {
    // Output: Stack matched configured name filter.
    return true;
  }

  // Array: Services belonging to this stack.
  const LaStackServices = iServices.filter((iService) => fnGetStackNamespaceFromService(iService) === iStack.Name);

  // Array: Containers belonging to this stack.
  const LaContainers = iContainers.filter((iContainer) => fnGetStackNamespaceFromContainer(iContainer) === iStack.Name);

  // Branch: Service labels can identify Bench stacks.
  if (LLabelFilter && LaStackServices.some((iService) => fnLabelsContain(iService.Spec?.Labels, LLabelFilter))) {
    // Output: Stack matched configured service label filter.
    return true;
  }

  // Branch: Container labels can identify Bench stacks.
  if (LLabelFilter && LaContainers.some((iContainer) => fnLabelsContain(iContainer.Labels, LLabelFilter))) {
    // Output: Stack matched configured container label filter.
    return true;
  }

  // Output: Match common Bench service names such as backend, scheduler, queues, redis, and db.
  return LaStackServices.some((iService) => {
    // String: Service suffix after stack prefix.
    const LName = iService.Spec?.Name?.split("_").pop()?.toLowerCase();

    // Output: True when suffix is a known Bench service name.
    return LName ? GaBenchServiceNames.has(LName) : false;
  });
}

// Function: Search label keys and values for a configured text filter.
function fnLabelsContain(idLabels: Record<string, string> | undefined, iFilter: string): boolean {
  // Guard: Missing labels cannot match.
  if (!idLabels) {
    // Output: No labels, no match.
    return false;
  }

  // Output: True when any label key=value contains the filter text.
  return Object.entries(idLabels).some(([LName, LMessage]) => `${LName}=${LMessage}`.toLowerCase().includes(iFilter));
}
