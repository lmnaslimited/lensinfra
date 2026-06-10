/**
 * Module: Stack Health Service Validator
 *
 * Responsibility:
 * - Classify service availability, replica status, task states, and migrations.
 * - Build report rows that explain current action items and old Docker task history.
 *
 * Notes:
 * - Part of LENSINFRA oclif CLI.
 * - Do not change runtime behavior.
 */

import { Logger } from "pino";
import { clDockerGatewayClient } from "../docker-gateway-client.js";
import {
  DockerContainerSummary,
  DockerService,
  DockerTask,
  MigrationStatus,
  ReportContainer,
  ReportService,
  ServiceHealthStatus
} from "../types.js";
import { fnValidateContainers } from "./container-health-validator.js";

// Function: Validate every Docker service that belongs to one stack.
export async function fnValidateServicesForStack(
  iStackName: string,
  iServices: DockerService[],
  iTasks: DockerTask[],
  iContainers: DockerContainerSummary[],
  clDockerGatewayClient: clDockerGatewayClient,
  clLogger: Logger
): Promise<ReportService[]> {
  // Array: Services whose Docker stack namespace matches this stack.
  const LaStackServices = iServices.filter((iService) => iService.Spec?.Labels?.["com.docker.stack.namespace"] === iStackName);

  // Array: Report service rows returned to the command.
  const LaResults: ReportService[] = [];

  // Loop: Validate one service at a time to keep notes and container checks scoped.
  for (const LdService of LaStackServices) {
    // String: Docker service name or service ID fallback.
    const LsName = LdService.Spec?.Name ?? LdService.ID;

    // Array: Docker tasks belonging to this service.
    const LaServiceTasks = iTasks.filter((iTask) => iTask.ServiceID === LdService.ID);

    // Array: Docker containers belonging to this service.
    const LaContainers = iContainers.filter((iContainer) => iContainer.Labels?.["com.docker.swarm.service.name"] === LsName);

    // Array: Validated containers with health classification.
    const LaResultsForContainers = await fnValidateContainers(clDockerGatewayClient, LaContainers, clLogger);

    // Number: Desired replica count from service spec or task fallback.
    const LnCount = fnGetDesiredReplicas(LdService, LaServiceTasks);

    // Number: Current running replica count from running tasks or containers.
    const LnRunningCount = fnCountRunningReplicas(LaServiceTasks, LaResultsForContainers);

    // String: Migration state for migration-like services.
    const LsMigrationStatus = fnClassifyMigration(LsName, LaServiceTasks, LaResultsForContainers);

    // Branch: Add synthetic missing rows only when this is not a completed migration job.
    if (LsMigrationStatus === "not-migration" && LnCount > LnRunningCount) {
      // Number: Missing replica count.
      const LnThreshold = LnCount - LnRunningCount;

      // Loop: Add one missing container marker per missing replica.
      for (let LnIndex = 0; LnIndex < LnThreshold; LnIndex += 1) {
        // Action: Make missing replicas visible in JSON and console output.
        LaResultsForContainers.push({
          containerId: "",
          containerName: `${LsName}#missing-${LnIndex + 1}`,
          state: "missing",
          status: "desired replica has no running container",
          health: "unknown",
          reason: `${LnRunningCount}/${LnCount} replicas running`
        });
      }
    }

    // String: Current service status used by the ACK.
    const LsStatus: ServiceHealthStatus = fnServiceStatusFromMigration(LsMigrationStatus)
      ?? fnClassifyService(LdService, LaServiceTasks, LaResultsForContainers, LnCount, LnRunningCount);

    // Array: Human-readable service notes for console output.
    const LaItems = fnBuildServiceNotes(LsName, LsStatus, LsMigrationStatus, LaServiceTasks, LaResultsForContainers, LnCount, LnRunningCount);

    // Branch: Log only current action-worthy services, not historical failed tasks.
    if (LsStatus !== "running" || LsMigrationStatus === "failed" || LsMigrationStatus === "pending") {
      // Log: Service issue detected.
      clLogger.warn({ stackName: iStackName, serviceName: LsName, status: LsStatus, migrationStatus: LsMigrationStatus, desiredReplicas: LnCount, runningReplicas: LnRunningCount }, "service scan: issue detected");
    }

    // Action: Add service report row.
    LaResults.push({
      serviceName: LsName,
      desiredReplicas: LnCount,
      runningReplicas: LnRunningCount,
      status: LsStatus,
      migrationStatus: LsMigrationStatus,
      notes: LaItems,
      tasks: LaServiceTasks.map((iTask) => ({
        taskId: iTask.ID,
        desiredState: iTask.DesiredState ?? "",
        currentState: iTask.Status?.State ?? "",
        error: iTask.Status?.Err ?? "",
        message: iTask.Status?.Message ?? ""
      })),
      containers: LaResultsForContainers
    });
  }

  // Output: Validated services for the stack.
  return LaResults;
}

// Function: Determine desired replica count for replicated and global services.
function fnGetDesiredReplicas(iService: DockerService, iTasks: DockerTask[]): number {
  // Number: Replicated service desired count when available.
  const LnCount = iService.Spec?.Mode?.Replicated?.Replicas;

  // Branch: Replicated mode gives the clearest desired count.
  if (typeof LnCount === "number") {
    // Output: Desired replicated count.
    return LnCount;
  }

  // Branch: Global mode desired count is inferred from desired running tasks.
  if (iService.Spec?.Mode?.Global) {
    // Output: Desired global task count.
    return iTasks.filter((iTask) => iTask.DesiredState === "running").length;
  }

  // Output: Fallback to running-desired tasks or one expected replica.
  return iTasks.length > 0 ? iTasks.filter((iTask) => iTask.DesiredState === "running").length : 1;
}

// Function: Count currently running replicas using both task and container evidence.
function fnCountRunningReplicas(iTasks: DockerTask[], iContainers: ReportContainer[]): number {
  // Number: Tasks desired and currently running.
  const LnTaskCount = iTasks.filter((iTask) => iTask.DesiredState === "running" && iTask.Status?.State === "running").length;

  // Number: Containers currently running.
  const LnContainerCount = iContainers.filter((iContainer) => iContainer.state === "running").length;

  // Output: Use the stronger current signal.
  return Math.max(LnTaskCount, LnContainerCount);
}

// Function: Classify current service status for ACK output.
function fnClassifyService(
  iService: DockerService,
  iTasks: DockerTask[],
  iContainers: ReportContainer[],
  iDesiredReplicas: number,
  iRunningReplicas: number
): ServiceHealthStatus {
  // Array: All task states, including history, used only for complete-job detection.
  const LaTaskStates = iTasks.map((iTask) => iTask.Status?.State?.toLowerCase() ?? "");

  // Array: Current desired running tasks.
  const LaActiveTasks = iTasks.filter((iTask) => iTask.DesiredState === "running");

  // Array: Current active task states.
  const LaActiveTaskStates = LaActiveTasks.map((iTask) => iTask.Status?.State?.toLowerCase() ?? "");

  // Array: Current and historical container states.
  const LaContainerStates = iContainers.map((iContainer) => iContainer.state.toLowerCase());

  // Branch: Current desired task errors are real failures.
  if (LaActiveTasks.some((iTask) => iTask.Status?.Err) || LaActiveTaskStates.some((LsMessage) => LsMessage === "failed" || LsMessage === "rejected")) {
    // Output: Current service failure.
    return "failed";
  }

  // Branch: Restarting or starting states indicate recovery in progress.
  if (LaContainerStates.some((LsMessage) => LsMessage === "restarting") || LaActiveTaskStates.some((LsMessage) => LsMessage === "starting")) {
    // Output: Restarting status.
    return "restarting";
  }

  // Branch: Preparing states are shown explicitly.
  if (LaActiveTaskStates.some((LsMessage) => LsMessage === "preparing" || LsMessage === "prepare")) {
    // Output: Preparing status.
    return "preparing";
  }

  // Branch: Ready is not yet running and should be visible.
  if (LaActiveTaskStates.some((LsMessage) => LsMessage === "ready")) {
    // Output: Ready status.
    return "ready";
  }

  // Branch: Exited/dead containers matter when desired replicas are not currently satisfied.
  if (iDesiredReplicas > iRunningReplicas && LaContainerStates.some((LsMessage) => LsMessage === "exited" || LsMessage === "dead")) {
    // Output: Failed because desired replicas are missing and dead/exited evidence exists.
    return "failed";
  }

  // Branch: Completed one-shot jobs have no desired replicas and complete/shutdown task history.
  if (iDesiredReplicas === 0 && LaTaskStates.length > 0 && LaTaskStates.every((LsMessage) => LsMessage === "complete" || LsMessage === "shutdown")) {
    // Output: Completed job.
    return "complete";
  }

  // Branch: Desired service has no tasks and no containers.
  if (iDesiredReplicas > 0 && iTasks.length === 0 && iContainers.length === 0) {
    // Output: Unavailable service.
    return "unavailable";
  }

  // Branch: Desired replicas exist but none are running.
  if (iDesiredReplicas > 0 && iRunningReplicas === 0) {
    // Output: Stopped when service evidence exists, otherwise unavailable.
    return iContainers.length > 0 || iTasks.length > 0 ? "stopped" : "unavailable";
  }

  // Branch: Some, but not all, desired replicas are running.
  if (iDesiredReplicas > iRunningReplicas) {
    // Output: Partial service availability.
    return "partial";
  }

  // Branch: Docker update pause is a failure condition.
  if (iService.UpdateStatus?.State && iService.UpdateStatus.State.toLowerCase() === "paused") {
    // Output: Failed update state.
    return "failed";
  }

  // Branch: Zero desired replicas for non-complete service is stopped.
  if (iDesiredReplicas === 0) {
    // Output: Stopped service.
    return "stopped";
  }

  // Branch: Desired replicas are satisfied.
  if (iRunningReplicas >= iDesiredReplicas) {
    // Output: Running service.
    return "running";
  }

  // Output: Fallback when Docker payload is insufficient.
  return "unknown";
}

// Function: Classify migration-like services separately from long-running services.
function fnClassifyMigration(
  iServiceName: string,
  iTasks: DockerTask[],
  iContainers: ReportContainer[]
): MigrationStatus {
  // Guard: Only migration-like service names receive migration status.
  if (!fnIsMigrationService(iServiceName)) {
    // Output: Not a migration service.
    return "not-migration";
  }

  // Array: Task states for this migration service.
  const LaTaskStates = iTasks.map((iTask) => iTask.Status?.State?.toLowerCase() ?? "");

  // Array: Container states for this migration service.
  const LaContainerStates = iContainers.map((iContainer) => iContainer.state.toLowerCase());

  // Branch: Running/preparing/ready migration is incomplete.
  if (LaTaskStates.some((LsMessage) => ["running", "starting", "preparing", "prepare", "ready"].includes(LsMessage)) || LaContainerStates.includes("running")) {
    // Output: Migration still running.
    return "running";
  }

  // Object: Latest task by CreatedAt, used because Docker keeps old failed history.
  const LdTask = fnLatestTask(iTasks);

  // String: Latest task state.
  const LsStatus = LdTask?.Status?.State?.toLowerCase() ?? "";

  // Branch: Latest one-shot task completed successfully.
  if (LsStatus === "complete") {
    // Output: Migration complete.
    return "complete";
  }

  // Branch: Latest one-shot task failed.
  if (LdTask?.Status?.Err || ["failed", "rejected"].includes(LsStatus)) {
    // Output: Failed migration.
    return "failed";
  }

  // Branch: Migration service exists but has no evidence yet.
  if (LaTaskStates.length === 0 && LaContainerStates.length === 0) {
    // Output: Migration pending.
    return "pending";
  }

  // Output: Migration status is unclear.
  return "unknown";
}

// Function: Convert migration status into service status when the migration result is final/actionable.
function fnServiceStatusFromMigration(iMigrationStatus: MigrationStatus): ServiceHealthStatus | undefined {
  // Branch: Completed migrations should show as complete, not stopped.
  if (iMigrationStatus === "complete") {
    // Output: Completed one-shot service.
    return "complete";
  }

  // Branch: Failed migrations should show as failed.
  if (iMigrationStatus === "failed") {
    // Output: Failed one-shot service.
    return "failed";
  }

  // Branch: Running migration is not complete yet and should warn as preparing.
  if (iMigrationStatus === "running") {
    // Output: In-progress one-shot service.
    return "preparing";
  }

  // Output: Non-migration or unclear states should use normal service classification.
  return undefined;
}

// Function: Find the newest Docker task for one-shot job classification.
function fnLatestTask(iTasks: DockerTask[]): DockerTask | undefined {
  // Array: Copy tasks before sorting so caller order is preserved.
  const LaItems = [...iTasks];

  // Action: Sort newest CreatedAt first; missing dates fall back to oldest.
  LaItems.sort((iLeftTask, iRightTask) => Date.parse(iRightTask.CreatedAt ?? "0") - Date.parse(iLeftTask.CreatedAt ?? "0"));

  // Output: Latest task or undefined when no task exists.
  return LaItems[0];
}

// Function: Decide whether a service name looks like a migration or setup job.
function fnIsMigrationService(iServiceName: string): boolean {
  // String: Lowercase service name for pattern matching.
  const LsName = iServiceName.toLowerCase();

  // Output: True when the name contains a common Bench migration/setup marker.
  return [
    "migrate",
    "migration",
    "configurator",
    "create-site",
    "install-app",
    "patch",
    "bench-worker",
    "bench-migrate"
  ].some((LsMessage) => LsName.includes(LsMessage));
}

// Function: Build readable console notes for a service.
function fnBuildServiceNotes(
  iServiceName: string,
  iStatus: ServiceHealthStatus,
  iMigrationStatus: MigrationStatus,
  iTasks: DockerTask[],
  iContainers: ReportContainer[],
  iDesiredReplicas: number,
  iRunningReplicas: number
): string[] {
  // Array: Human-readable service notes.
  const LaItems: string[] = [];

  // Object: Task states that deserve mention in current notes or history notes.
  const LdInterestingTaskStates = new Set(["ready", "prepare", "preparing", "starting", "failed", "rejected"]);

  // Object: Historical task-state counts.
  const LdResult = new Map<string, number>();

  // Branch: Non-running/non-complete services need replica detail.
  if (iStatus !== "running" && iStatus !== "complete") {
    // Action: Add replica status note.
    LaItems.push(`${iRunningReplicas}/${iDesiredReplicas} replicas running`);
  }

  // Loop: Summarize current action-worthy tasks and historical failed/rejected tasks.
  for (const LdTask of iTasks) {
    // String: Lowercase task state.
    const LsMessage = LdTask.Status?.State?.toLowerCase() ?? "";

    // Branch: Only interesting task states are shown.
    if (LdInterestingTaskStates.has(LsMessage) || LdTask.Status?.Err) {
      // Branch: Current desired running task is action-worthy.
      if (LdTask.DesiredState === "running") {
        // Action: Add current task detail.
        LaItems.push(`current task ${LdTask.ID}: ${LdTask.Status?.State ?? "unknown"}${LdTask.Status?.Err ? ` - ${LdTask.Status.Err}` : ""}`);
      } else {
        // String: Historical task state key.
        const LsName = LdTask.Status?.State ?? "unknown";

        // Action: Increment history count for this state.
        LdResult.set(LsName, (LdResult.get(LsName) ?? 0) + 1);
      }
    }
  }

  // Branch: Historical task failures are useful context but not current failures.
  if (LdResult.size > 0) {
    // String: Compact task history summary.
    const LsMessage = Array.from(LdResult.entries())
      .map(([LsName, LnCount]) => `${LnCount} ${LsName}`)
      .join(", ");

    // Action: Add task history note.
    LaItems.push(`task history only, current service is OK: ${LsMessage}`);
  }

  // Loop: Add container-level notes for current action-worthy container states.
  for (const LdContainer of iContainers) {
    // Boolean: Old exited containers should not fail an otherwise running service.
    const LbIsProtected = LdContainer.state === "exited" && (iStatus === "running" || iStatus === "complete");

    // Branch: Include unhealthy/missing/dead/restarting/exited container details.
    if (!LbIsProtected && (LdContainer.health === "unhealthy" || ["missing", "exited", "dead", "restarting"].includes(LdContainer.state))) {
      // Action: Add container note.
      LaItems.push(`${LdContainer.containerName}: ${LdContainer.state}${LdContainer.health !== "unknown" ? `/${LdContainer.health}` : ""}`);
    }
  }

  // Branch: Migration services should always state migration result.
  if (iMigrationStatus !== "not-migration") {
    // Action: Add migration note.
    LaItems.push(`migration check: ${iServiceName} is ${iMigrationStatus}`);
  }

  // Output: Unique notes in original order.
  return Array.from(new Set(LaItems));
}
