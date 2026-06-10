/**
 * Module: Stack Health Endpoint Validator
 *
 * Responsibility:
 * - Resolve the Portainer endpoint that has a working Docker gateway.
 * - Keep endpoint auto-selection conservative and operator-safe.
 *
 * Notes:
 * - Part of LENSINFRA oclif CLI.
 * - Do not change runtime behavior.
 */

import { Logger } from "pino";
import { clDockerGatewayClient } from "../docker-gateway-client.js";
import { clPortainerClient } from "../portainer-client.js";
import { AppConfig, PortainerEndpoint } from "../types.js";

// Type: Resolved endpoint shape used by reports and console output.
export interface ResolvedEndpoint {
  id: number;
  name: string;
}

// Function: Resolve a configured endpoint ID or auto-select exactly one working endpoint.
export async function fnResolveEndpoint(
  iConfig: AppConfig,
  clPortainerClient: clPortainerClient,
  clLogger: Logger
): Promise<ResolvedEndpoint> {
  // Array: All endpoints returned by Portainer.
  const LaEndpoints = await clPortainerClient.fnGetEndpoints();

  // Array: Portainer endpoints marked active.
  const LaActiveEndpoints = LaEndpoints.filter((iEndpoint) => iEndpoint.Status === 1);

  // Log: Record how many active endpoints were discovered.
  clLogger.info({ activeEndpointCount: LaActiveEndpoints.length }, "endpoint validation: active endpoints discovered");

  // Branch: Manual endpoint ID should be validated directly.
  if (iConfig.portainerEndpointId.toLowerCase() !== "auto") {
    // Number: Parse the configured endpoint ID.
    const LnEndpointId = Number(iConfig.portainerEndpointId);

    // Guard: Manual endpoint must be a positive integer.
    if (!Number.isInteger(LnEndpointId) || LnEndpointId <= 0) {
      // Error: Tell the user how to fix the endpoint setting.
      throw new Error("PORTAINER_ENDPOINT_ID must be auto or a positive numeric endpoint ID.");
    }

    // Object: Matching Portainer endpoint for the configured ID.
    const LdEndpoint = LaEndpoints.find((iEndpoint) => iEndpoint.Id === LnEndpointId);

    // Guard: Stop if the configured endpoint does not exist.
    if (!LdEndpoint) {
      // Error: Include the endpoint ID that failed.
      throw new Error(`Endpoint ID ${LnEndpointId} was not found in Portainer.`);
    }

    // Action: Confirm Docker gateway works before accepting manual endpoint.
    await fnValidateEndpointGateway(iConfig, LdEndpoint, clLogger);

    // Output: Resolved endpoint metadata.
    return { id: LdEndpoint.Id, name: LdEndpoint.Name };
  }

  // Array: Active endpoints that pass the Docker gateway version check.
  const LaCandidates: PortainerEndpoint[] = [];

  // Loop: Test each active endpoint because Type can vary across Portainer versions.
  for (const LdEndpoint of LaActiveEndpoints) {
    // Boolean: Whether this endpoint has a reachable Docker gateway.
    const LbSuccess = await fnCanUseDockerGateway(iConfig, LdEndpoint, clLogger);

    // Branch: Keep only endpoints with a working Docker gateway.
    if (LbSuccess) {
      // Action: Add the endpoint as an auto-selection candidate.
      LaCandidates.push(LdEndpoint);
    }
  }

  // Branch: Exactly one working endpoint is safe to auto-select.
  if (LaCandidates.length === 1) {
    // Object: The only working endpoint.
    const LdEndpoint = LaCandidates[0];

    // Log: Record auto-selected endpoint.
    clLogger.info({ endpointId: LdEndpoint.Id, endpointName: LdEndpoint.Name }, "endpoint validation: auto-selected endpoint");

    // Output: Resolved endpoint metadata.
    return { id: LdEndpoint.Id, name: LdEndpoint.Name };
  }

  // Branch: Multiple working endpoints require explicit user choice.
  if (LaCandidates.length > 1) {
    // String: User-readable endpoint list.
    const LsMessage = LaCandidates.map((iEndpoint) => `${iEndpoint.Name} (ID: ${iEndpoint.Id})`).join(", ");

    // Error: Stop rather than guessing the wrong Docker environment.
    throw new Error(`Multiple active Docker gateways are available: ${LsMessage}. Set PORTAINER_ENDPOINT_ID manually.`);
  }

  // Error: No active endpoint could be validated through the Docker gateway.
  throw new Error("No active endpoint has a working Docker gateway. Check endpoint health in Portainer.");
}

// Function: Validate one endpoint by calling Docker gateway GET /version.
async function fnValidateEndpointGateway(iConfig: AppConfig, iEndpoint: PortainerEndpoint, clLogger: Logger): Promise<void> {
  // Class instance: Docker gateway client scoped to this endpoint.
  const clDockerGatewayApiClient = new clDockerGatewayClient(iConfig, iEndpoint.Id);

  // Action: Gateway version call proves the endpoint is usable.
  await clDockerGatewayApiClient.fnVersion();

  // Log: Gateway validation succeeded.
  clLogger.info({ endpointId: iEndpoint.Id, endpointName: iEndpoint.Name }, "endpoint validation: Docker gateway reachable");
}

// Function: Test one endpoint and return true instead of throwing.
async function fnCanUseDockerGateway(iConfig: AppConfig, iEndpoint: PortainerEndpoint, clLogger: Logger): Promise<boolean> {
  // Guard: Endpoint probing should continue even if one endpoint fails.
  try {
    // Action: Validate gateway for this endpoint.
    await fnValidateEndpointGateway(iConfig, iEndpoint, clLogger);

    // Output: Endpoint works.
    return true;
  } catch (iError) {
    // String: Safe error message for logs.
    const LsMessage = iError instanceof Error ? iError.message : String(iError);

    // Log: Endpoint failed gateway validation.
    clLogger.warn(
      { endpointId: iEndpoint.Id, endpointName: iEndpoint.Name, error: LsMessage },
      "endpoint validation: Docker gateway unavailable"
    );

    // Output: Endpoint does not work.
    return false;
  }
}
