/**
 * Module: Portainer Client
 *
 * Responsibility:
 * - Provide authenticated access to Portainer cleanup endpoints.
 * - Resolve and validate the Docker endpoint used by cleanup.
 *
 * Notes:
 * - Part of LENSINFRA oclif CLI.
 * - Do not change runtime behavior.
 */

import axios, { AxiosError, AxiosInstance } from "axios";
import https from "node:https";
import { AppConfig, AuthHeaders, PortainerEndpoint, PortainerStack } from "./types.js";

/**
 * Portainer API client used by the cleanup module.
 */
export class clPortainerClient {
  private readonly clHttp: AxiosInstance;

  /**
   * Creates a PAT-authenticated Portainer API client.
   */
  constructor(private readonly iConfig: AppConfig) {
    this.clHttp = axios.create({
      baseURL: iConfig.portainerUrl,
      timeout: 30000,
      httpsAgent: iConfig.tlsVerify ? undefined : new https.Agent({ rejectUnauthorized: false })
    });
  }

  /**
   * Validates PAT access by performing a harmless endpoint list request.
   */
  async fnValidatePatToken(): Promise<void> {
    await this.fnListEndpoints();
  }

  /**
   * Validates endpoint metadata access without deleting or changing resources.
   */
  async fnValidateEndpointAccess(): Promise<void> {
    if (!this.iConfig.endpointId) {
      throw new Error("Cannot validate endpoint access before endpoint ID is resolved");
    }

    try {
      await this.clHttp.get(`/api/endpoints/${this.iConfig.endpointId}`, {
        headers: this.fnAuthHeaders()
      });
    } catch (iLdError) {
      throw new Error(`Endpoint ${this.iConfig.endpointId} is unavailable or inaccessible: ${fnFormatAxiosError(iLdError)}`);
    }
  }

  /**
   * Reads every Portainer endpoint before auto-selection.
   */
  async fnListEndpoints(): Promise<PortainerEndpoint[]> {
    try {
      const LdResponse = await this.clHttp.get<PortainerEndpoint[]>("/api/endpoints", {
        headers: this.fnAuthHeaders()
      });
      return LdResponse.data;
    } catch (iLdError) {
      throw new Error(`Unable to list Portainer endpoints: ${fnFormatAxiosError(iLdError)}`);
    }
  }

  /**
   * Reads stacks for the selected endpoint so active-stack filters can work.
   */
  async fnListStacks(iLsEndpointId: string): Promise<PortainerStack[]> {
    try {
      const LdResponse = await this.clHttp.get<PortainerStack[]>("/api/stacks", {
        headers: this.fnAuthHeaders(),
        params: { endpointId: iLsEndpointId }
      });
      return LdResponse.data;
    } catch (iLdError) {
      throw new Error(`Unable to list Portainer stacks: ${fnFormatAxiosError(iLdError)}`);
    }
  }

  /**
   * Probes Docker gateway access as the source of truth for endpoint auto-selection.
   */
  async fnCanUseDockerGateway(iLsEndpointId: string): Promise<boolean> {
    try {
      await this.clHttp.get(`/api/endpoints/${iLsEndpointId}/docker/version`, {
        headers: this.fnAuthHeaders()
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Resolves manual endpoint IDs directly or auto-selects the one usable Docker gateway.
   */
  async fnResolveEndpointId(): Promise<string> {
    if (this.iConfig.endpointId && this.iConfig.endpointId.toLowerCase() !== "auto") {
      return this.iConfig.endpointId;
    }

    const LaEndpoints = await this.fnListEndpoints();
    const LaActiveEndpoints = LaEndpoints.filter((iEndpoint) => iEndpoint.Status === undefined || iEndpoint.Status === 1);
    const LaDockerGatewayEndpoints: PortainerEndpoint[] = [];

    for (const LdEndpoint of LaActiveEndpoints) {
      if (await this.fnCanUseDockerGateway(String(LdEndpoint.Id))) {
        LaDockerGatewayEndpoints.push(LdEndpoint);
      }
    }

    if (LaDockerGatewayEndpoints.length !== 1) {
      const LsAvailable = LaEndpoints.map((iEndpoint) => `${iEndpoint.Id}:${iEndpoint.Name}:type=${iEndpoint.Type}:status=${iEndpoint.Status}`).join(", ");
      const LsWorking = LaDockerGatewayEndpoints.map((iEndpoint) => `${iEndpoint.Id}:${iEndpoint.Name}`).join(", ");

      if (LaDockerGatewayEndpoints.length > 1) {
        throw new Error(
          `Auto endpoint selection found multiple active endpoints with Docker gateway access: ${LsWorking}. Set PORTAINER_ENDPOINT_ID manually. Available endpoints: ${LsAvailable || "none"}`
        );
      }

      throw new Error(
        `Auto endpoint selection found no active endpoints with Docker gateway access. Set PORTAINER_ENDPOINT_ID manually after checking Portainer. Available endpoints: ${LsAvailable || "none"}`
      );
    }

    this.iConfig.endpointId = String(LaDockerGatewayEndpoints[0].Id);
    return this.iConfig.endpointId;
  }

  /**
   * Reads the chosen endpoint metadata for validation and display.
   */
  async fnGetEndpoint(iLsEndpointId: string): Promise<PortainerEndpoint> {
    try {
      const LdResponse = await this.clHttp.get<PortainerEndpoint>(`/api/endpoints/${iLsEndpointId}`, {
        headers: this.fnAuthHeaders()
      });
      return LdResponse.data;
    } catch (iLdError) {
      throw new Error(`Endpoint ${iLsEndpointId} is unavailable or inaccessible: ${fnFormatAxiosError(iLdError)}`);
    }
  }

  /**
   * Returns the single supported authentication header: Portainer PAT token.
   */
  fnAuthHeaders(): AuthHeaders {
    return {
      "X-API-Key": this.iConfig.patToken
    };
  }
}

/**
 * Converts Axios failures into compact messages for reports and CLI errors.
 */
export function fnFormatAxiosError(iLdError: unknown): string {
  if (axios.isAxiosError(iLdError)) {
    const LdAxiosError = iLdError as AxiosError<unknown>;
    const LnStatus = LdAxiosError.response?.status;
    const LsStatusText = LdAxiosError.response?.statusText;
    const LdBody = LdAxiosError.response?.data;
    const LsBodyText = typeof LdBody === "string" ? LdBody : JSON.stringify(LdBody);
    return [LnStatus, LsStatusText, LsBodyText || LdAxiosError.message].filter(Boolean).join(" ");
  }

  return iLdError instanceof Error ? iLdError.message : String(iLdError);
}
