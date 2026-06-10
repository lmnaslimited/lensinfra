/**
 * Module: Stack Health Portainer Client
 *
 * Responsibility:
 * - Provide read-only access to Portainer API endpoints.
 * - Convert low-level Axios failures into clear operator messages.
 *
 * Notes:
 * - Part of LENSINFRA oclif CLI.
 * - Do not change runtime behavior.
 */

import https from "node:https";
import axios, { AxiosError, AxiosInstance } from "axios";
import { fnPortainerAuthHeaders } from "./auth.js";
import { AppConfig, PortainerEndpoint, PortainerStack } from "./types.js";

/**
 * Read-only Portainer API client for stack-health checks.
 */
export class clPortainerClient {
  // Class instance: Axios client configured for Portainer API calls.
  private readonly clHttp: AxiosInstance;

  // Object: App config held for TLS and error details.
  private readonly LdConfig: AppConfig;

  /**
   * Configures Axios once so every request uses the same auth and TLS behavior.
   */
  constructor(iConfig: AppConfig) {
    // Assignment: Store config for later error handling.
    this.LdConfig = iConfig;

    // Assignment: Build the Portainer HTTP client with proxy bypass for local Docker hostnames.
    this.clHttp = axios.create({
      baseURL: iConfig.portainerUrl,
      timeout: 15000,
      proxy: false,
      headers: fnPortainerAuthHeaders(iConfig),
      httpsAgent: new https.Agent({
        rejectUnauthorized: !iConfig.allowSelfSignedCert
      })
    });
  }

  /**
   * Validates that the Portainer API is reachable with the configured token.
   */
  async fnPing(): Promise<void> {
    // Action: Endpoints are a lightweight authenticated Portainer API read.
    await this.fnGetEndpoints();
  }

  /**
   * Reads all Portainer endpoints/environments.
   */
  async fnGetEndpoints(): Promise<PortainerEndpoint[]> {
    // Output: Authenticated endpoint list.
    return this.fnRequest<PortainerEndpoint[]>("/api/endpoints", "Portainer API access failed");
  }

  /**
   * Reads all Portainer stacks.
   */
  async fnGetStacks(): Promise<PortainerStack[]> {
    // Output: Authenticated stack list.
    return this.fnRequest<PortainerStack[]>("/api/stacks", "Portainer stack listing failed");
  }

  /**
   * Executes a GET request and wraps any failure with CLI-friendly context.
   */
  private async fnRequest<T>(iPath: string, iContext: string): Promise<T> {
    // Guard: Axios errors are translated into messages that mention the likely fix.
    try {
      // Object: Raw Axios response from Portainer.
      const LdResponse = await this.clHttp.get<T>(iPath);
      // Output: Response body typed by the caller.
      return LdResponse.data;
    } catch (iError) {
      // Error: Preserve high-level context and append detailed network/auth reason.
      throw new Error(`${iContext}: ${this.fnDescribeAxiosError(iError)}`);
    }
  }

  /**
   * Converts Axios/network/TLS failures into actionable text.
   */
  private fnDescribeAxiosError(iError: unknown): string {
    // Guard: Non-Axios errors still need a readable message.
    if (!axios.isAxiosError(iError)) {
      // Output: Native Error message or stringified thrown value.
      return iError instanceof Error ? iError.message : String(iError);
    }

    // Object: Axios-specific error with HTTP status and network code.
    const LdError = iError as AxiosError;

    // Guard: 401/403 means the PAT/JWT is not accepted.
    if (LdError.response?.status === 401 || LdError.response?.status === 403) {
      // Output: Authentication failure without leaking the token.
      return `authentication failed (${LdError.response.status}). Check PORTAINER_PAT_TOKEN.`;
    }

    // Guard: HTTP response exists but is not an auth error.
    if (LdError.response) {
      // Output: Include status code and status text for reverse proxy/API troubleshooting.
      return `HTTP ${LdError.response.status} ${LdError.response.statusText}`;
    }

    // Guard: Local self-signed certificates need the .env switch.
    if (LdError.code === "DEPTH_ZERO_SELF_SIGNED_CERT" || LdError.code === "SELF_SIGNED_CERT_IN_CHAIN") {
      // Output: Exact remediation for self-signed local Portainer.
      return "TLS certificate validation failed. Set ALLOW_SELF_SIGNED_CERT=true for local self-signed Portainer certificates.";
    }

    // Guard: Connection errors point to URL, DNS, port, or service availability.
    if (LdError.code === "ECONNREFUSED" || LdError.code === "ENOTFOUND" || LdError.code === "ETIMEDOUT") {
      // Output: Endpoint-level connection guidance.
      return `connection failed (${LdError.code}). Check PORTAINER_URL.`;
    }

    // Output: Fallback Axios message.
    return LdError.message;
  }
}
