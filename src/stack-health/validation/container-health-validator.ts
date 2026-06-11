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
  TContainerHealthStatus,
  IDockerContainerInspect,
  IDockerContainerSummary,
  IReportContainer
} from "../types.js";

// Function: Validate all containers for one service.
export async function fnValidateContainers(
  clDockerGatewayClient: clDockerGatewayClient,
  iContainers: IDockerContainerSummary[],
  clLogger: Logger
): Promise<IReportContainer[]> {
  // Array: Report container rows returned to the service validator.
  const LaResults: IReportContainer[] = [];

  // Loop: Inspect each container individually so one failure does not stop the full ACK.
  for (const LdContainer of iContainers) {
    // Object: Full inspect payload, available only when Docker inspect succeeds.
    let LdContainerInspect: IDockerContainerInspect | undefined;

    // String: Inspect failure reason, left empty when inspect succeeds.
    let LMessage = "";

    // Guard: A container can disappear while the scan is running.
    try {
      // Action: Inspect container for health status details.
      LdContainerInspect = await clDockerGatewayClient.fnInspectContainer(LdContainer.Id);
    } catch (iError) {
      // String: Convert unknown inspect failure into readable text.
      LMessage = iError instanceof Error ? iError.message : String(iError);

      // Log: Mark one container inspect as failed but continue the scan.
      clLogger.warn({ containerId: LdContainer.Id, error: LMessage }, "container scan: inspect failed");
    }

    // String: Docker health classification for this container.
    const LStatus = fnClassifyHealth(LdContainerInspect);

    // String: IRuntime state from inspect when possible, otherwise from summary.
    const LContainerState = LdContainerInspect?.State?.Status ?? LdContainer.State ?? "unknown";

    // Action: Add the normalized container row to the report.
    LaResults.push({
      containerId: LdContainer.Id,
      containerName: fnNormalizeContainerName(LdContainerInspect?.Name ?? LdContainer.Names?.[0] ?? LdContainer.Id),
      state: LContainerState,
      status: LdContainer.Status ?? "",
      health: LStatus,
      reason: fnHealthReason(LStatus, LdContainerInspect, LMessage)
    });
  }

  // Output: Validated container rows.
  return LaResults;
}

// Function: Convert Docker inspect health status into the report enum.
export function fnClassifyHealth(iContainerInspect: IDockerContainerInspect | undefined): TContainerHealthStatus {
  // String: Lowercase Docker health status.
  const LStatus = iContainerInspect?.State?.Health?.Status?.toLowerCase();

  // Branch: Docker health states accepted as-is.
  if (LStatus === "healthy" || LStatus === "unhealthy" || LStatus === "starting") {
    // Output: Known health status.
    return LStatus;
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
  iHealth: TContainerHealthStatus,
  iContainerInspect: IDockerContainerInspect | undefined,
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
  const LMessage = iContainerInspect?.State?.Health?.Log?.at(-1)?.Output?.trim();

  // Output: Latest health-check text or empty string.
  return LMessage ?? "";
}
