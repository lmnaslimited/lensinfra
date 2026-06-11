/**
 * Module: Stack Health Docker Gateway Client
 *
 * Responsibility:
 * - Read Docker information through the Portainer Docker gateway only.
 * - Keep stack-health read-only by exposing only GET operations.
 *
 * Notes:
 * - Part of LENSINFRA oclif CLI.
 * - Do not change runtime behavior.
 */

import https from "node:https";
import axios, { AxiosError, AxiosInstance } from "axios";
import { fnPortainerAuthHeaders } from "./auth.js";
import { IAppConfig, IDockerContainerInspect, IDockerContainerSummary, IDockerService, IDockerTask } from "./types.js";

/**
 * Read-only Docker gateway client scoped to one Portainer endpoint.
 */
export class clDockerGatewayClient {
  // Class instance: Axios client configured for /api/endpoints/{id}/docker.
  private readonly clHttp: AxiosInstance;

  // Object: App config used for auth, TLS, and error messaging.
  private readonly LdConfig: IAppConfig;

  // Number: Portainer endpoint ID used by all Docker gateway requests.
  private readonly LEndpointId: number;

  /**
   * Builds a gateway client for one resolved Portainer endpoint.
   */
  constructor(iConfig: IAppConfig, iEndpointId: number) {
    // Assignment: Store config for diagnostics and future request behavior.
    this.LdConfig = iConfig;

    // Assignment: Store endpoint ID for request paths and error messages.
    this.LEndpointId = iEndpointId;

    // Assignment: Create Axios client with proxy bypass so local Portainer is reached directly.
    this.clHttp = axios.create({
      baseURL: `${iConfig.portainerUrl}/api/endpoints/${iEndpointId}/docker`,
      timeout: 20000,
      proxy: false,
      headers: fnPortainerAuthHeaders(iConfig),
      httpsAgent: new https.Agent({
        rejectUnauthorized: !iConfig.allowSelfSignedCert
      })
    });
  }

  /**
   * Validates Docker gateway availability with GET /version.
   */
  async fnVersion(): Promise<Record<string, unknown>> {
    // Output: Docker version payload from the gateway.
    return this.fnRequest<Record<string, unknown>>("/version", "Docker gateway version check failed");
  }

  /**
   * Reads Docker Swarm services.
   */
  async fnGetServices(): Promise<IDockerService[]> {
    // Output: Service list from Docker gateway.
    return this.fnRequest<IDockerService[]>("/services", "Docker service listing failed");
  }

  /**
   * Reads Docker Swarm tasks.
   */
  async fnGetTasks(): Promise<IDockerTask[]> {
    // Output: Task list from Docker gateway.
    return this.fnRequest<IDockerTask[]>("/tasks", "Docker task listing failed");
  }

  /**
   * Reads all containers, including stopped containers.
   */
  async fnGetContainers(): Promise<IDockerContainerSummary[]> {
    // Output: Container summaries with all=true.
    return this.fnRequest<IDockerContainerSummary[]>("/containers/json?all=true", "Docker container listing failed");
  }

  /**
   * Inspects one container for health-check details.
   */
  async fnInspectContainer(iContainerId: string): Promise<IDockerContainerInspect> {
    // Output: Full container inspect payload.
    return this.fnRequest<IDockerContainerInspect>(`/containers/${iContainerId}/json`, `Docker container inspect failed for ${iContainerId}`);
  }

  /**
   * Executes a read-only Docker gateway GET request.
   */
  private async fnRequest<T>(iPath: string, iContext: string): Promise<T> {
    // Guard: Convert technical Axios failures into operator-friendly messages.
    try {
      // Object: Raw gateway response.
      const LdResponse = await this.clHttp.get<T>(iPath);
      // Output: Response body typed by caller.
      return LdResponse.data;
    } catch (iError) {
      // Error: Add context while preserving the useful low-level reason.
      throw new Error(`${iContext}: ${this.fnDescribeAxiosError(iError)}`);
    }
  }

  /**
   * Explains Docker gateway failures.
   */
  private fnDescribeAxiosError(iError: unknown): string {
    // Guard: Non-Axios errors still need to be readable.
    if (!axios.isAxiosError(iError)) {
      // Output: Native Error message or stringified thrown value.
      return iError instanceof Error ? iError.message : String(iError);
    }

    // Object: Axios-specific error with HTTP and network fields.
    const LdError = iError as AxiosError;

    // Guard: PAT permissions can fail at the gateway even when Portainer auth succeeds.
    if (LdError.response?.status === 401 || LdError.response?.status === 403) {
      // Output: Permission-focused auth message.
      return `authentication failed (${LdError.response.status}). Check PORTAINER_PAT_TOKEN permissions.`;
    }

    // Guard: 404 usually means the endpoint ID is wrong or the gateway route is unavailable.
    if (LdError.response?.status === 404) {
      // Output: Include endpoint ID so the user can fix .env.
      return `HTTP 404. Check PORTAINER_ENDPOINT_ID (${this.LEndpointId}).`;
    }

    // Guard: Any other HTTP response should still be shown clearly.
    if (LdError.response) {
      // Output: HTTP status summary.
      return `HTTP ${LdError.response.status} ${LdError.response.statusText}`;
    }

    // Guard: Local self-signed certificates need a clear .env switch.
    if (LdError.code === "DEPTH_ZERO_SELF_SIGNED_CERT" || LdError.code === "SELF_SIGNED_CERT_IN_CHAIN") {
      // Output: Exact TLS remediation.
      return "TLS certificate validation failed. Set ALLOW_SELF_SIGNED_CERT=true for local self-signed Portainer certificates.";
    }

    // Guard: Connection errors indicate Portainer or endpoint gateway availability issues.
    if (LdError.code === "ECONNREFUSED" || LdError.code === "ENOTFOUND" || LdError.code === "ETIMEDOUT") {
      // Output: Connection guidance.
      return `connection failed (${LdError.code}). Check Portainer and Docker gateway availability.`;
    }

    // Output: Fallback Axios message.
    return LdError.message;
  }
}
