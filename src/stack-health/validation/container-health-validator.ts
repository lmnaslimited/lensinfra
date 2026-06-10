/**
 * Module: Stack Health Container Validator
 *
 * Responsibility:
 * - Inspect containers and classify Docker health status.
 * - Continue scanning even if one container inspect call fails.
 *
 * Notes:
 * - Part of LENSINFRA oclif CLI.
 * - Do not change runtime behavior.
 */

import { Logger } from "pino";
import { clDockerGatewayClient } from "../docker-gateway-client.js";
import {
  ContainerHealthStatus,
  DockerContainerInspect,
  DockerContainerSummary,
  ReportContainer
} from "../types.js";

// Function: Validate all containers for one service.
export async function fnValidateContainers(
  clDockerGatewayClient: clDockerGatewayClient,
  iContainers: DockerContainerSummary[],
  clLogger: Logger
): Promise<ReportContainer[]> {
  // Array: Report container rows returned to the service validator.
  const LaResults: ReportContainer[] = [];

  // Loop: Inspect each container individually so one failure does not stop the full ACK.
  for (const LdContainer of iContainers) {
    // Object: Full inspect payload, available only when Docker inspect succeeds.
    let LdContainerInspect: DockerContainerInspect | undefined;

    // String: Inspect failure reason, left empty when inspect succeeds.
    let LsMessage = "";

    // Guard: A container can disappear while the scan is running.
    try {
      // Action: Inspect container for health status details.
      LdContainerInspect = await clDockerGatewayClient.fnInspectContainer(LdContainer.Id);
    } catch (iError) {
      // String: Convert unknown inspect failure into readable text.
      LsMessage = iError instanceof Error ? iError.message : String(iError);

      // Log: Mark one container inspect as failed but continue the scan.
      clLogger.warn({ containerId: LdContainer.Id, error: LsMessage }, "container scan: inspect failed");
    }

    // String: Docker health classification for this container.
    const LsStatus = fnClassifyHealth(LdContainerInspect);

    // String: Runtime state from inspect when possible, otherwise from summary.
    const LsContainerState = LdContainerInspect?.State?.Status ?? LdContainer.State ?? "unknown";

    // Action: Add the normalized container row to the report.
    LaResults.push({
      containerId: LdContainer.Id,
      containerName: fnNormalizeContainerName(LdContainerInspect?.Name ?? LdContainer.Names?.[0] ?? LdContainer.Id),
      state: LsContainerState,
      status: LdContainer.Status ?? "",
      health: LsStatus,
      reason: fnHealthReason(LsStatus, LdContainerInspect, LsMessage)
    });
  }

  // Output: Validated container rows.
  return LaResults;
}

// Function: Convert Docker inspect health status into the report enum.
export function fnClassifyHealth(iContainerInspect: DockerContainerInspect | undefined): ContainerHealthStatus {
  // String: Lowercase Docker health status.
  const LsStatus = iContainerInspect?.State?.Health?.Status?.toLowerCase();

  // Branch: Docker health states accepted as-is.
  if (LsStatus === "healthy" || LsStatus === "unhealthy" || LsStatus === "starting") {
    // Output: Known health status.
    return LsStatus;
  }

  // Output: No health check or missing health payload.
  return "unknown";
}

// Function: Remove Docker's leading slash from inspect container names.
function fnNormalizeContainerName(iName: string): string {
  // Output: Clean container name for console and reports.
  return iName.replace(/^\/+/, "");
}

// Function: Explain why a container received its health classification.
function fnHealthReason(
  iHealth: ContainerHealthStatus,
  iContainerInspect: DockerContainerInspect | undefined,
  iInspectMessage: string
): string {
  // Guard: Inspect failures are the most actionable reason.
  if (iInspectMessage) {
    // Output: Explain inspect failure.
    return `inspect failed: ${iInspectMessage}`;
  }

  // Guard: Unknown health commonly means no Docker health check exists.
  if (iHealth === "unknown") {
    // Output: Explain unknown health without treating it as a failure.
    return "no health check or health data unavailable";
  }

  // String: Latest health-check output when Docker provides it.
  const LsMessage = iContainerInspect?.State?.Health?.Log?.at(-1)?.Output?.trim();

  // Output: Latest health-check text or empty string.
  return LsMessage ?? "";
}
