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
import { IAppConfig, TAuthHeaders, IPortainerEndpoint, IPortainerStack } from "./types.js";

/**
 * Portainer API client used by the cleanup module.
 */
export class clPortainerClient {
  private readonly clHttp: AxiosInstance;

  /**
   * Creates a PAT-authenticated Portainer API client.
   */
  constructor(private readonly iConfig: IAppConfig) {
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
    } catch (idError) {
      throw new Error(`Endpoint ${this.iConfig.endpointId} is unavailable or inaccessible: ${fnFormatAxiosError(idError)}`);
    }
  }

  /**
   * Reads every Portainer endpoint before auto-selection.
   */
  async fnListEndpoints(): Promise<IPortainerEndpoint[]> {
    try {
      const LdResponse = await this.clHttp.get<IPortainerEndpoint[]>("/api/endpoints", {
        headers: this.fnAuthHeaders()
      });
      return LdResponse.data;
    } catch (idError) {
      throw new Error(`Unable to list Portainer endpoints: ${fnFormatAxiosError(idError)}`);
    }
  }

  /**
   * Reads stacks for the selected endpoint so active-stack filters can work.
   */
  async fnListStacks(iEndpointId: string): Promise<IPortainerStack[]> {
    try {
      const LdResponse = await this.clHttp.get<IPortainerStack[]>("/api/stacks", {
        headers: this.fnAuthHeaders(),
        params: { endpointId: iEndpointId }
      });
      return LdResponse.data;
    } catch (idError) {
      throw new Error(`Unable to list Portainer stacks: ${fnFormatAxiosError(idError)}`);
    }
  }

  /**
   * Probes Docker gateway access as the source of truth for endpoint auto-selection.
   */
  async fnCanUseDockerGateway(iEndpointId: string): Promise<boolean> {
    try {
      await this.clHttp.get(`/api/endpoints/${iEndpointId}/docker/version`, {
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
    const LaDockerGatewayEndpoints: IPortainerEndpoint[] = [];

    for (const LdEndpoint of LaActiveEndpoints) {
      if (await this.fnCanUseDockerGateway(String(LdEndpoint.Id))) {
        LaDockerGatewayEndpoints.push(LdEndpoint);
      }
    }

    if (LaDockerGatewayEndpoints.length !== 1) {
      const LAvailable = LaEndpoints.map((iEndpoint) => `${iEndpoint.Id}:${iEndpoint.Name}:type=${iEndpoint.Type}:status=${iEndpoint.Status}`).join(", ");
      const LWorking = LaDockerGatewayEndpoints.map((iEndpoint) => `${iEndpoint.Id}:${iEndpoint.Name}`).join(", ");

      if (LaDockerGatewayEndpoints.length > 1) {
        throw new Error(
          `Auto endpoint selection found multiple active endpoints with Docker gateway access: ${LWorking}. Set PORTAINER_ENDPOINT_ID manually. Available endpoints: ${LAvailable || "none"}`
        );
      }

      throw new Error(
        `Auto endpoint selection found no active endpoints with Docker gateway access. Set PORTAINER_ENDPOINT_ID manually after checking Portainer. Available endpoints: ${LAvailable || "none"}`
      );
    }

    this.iConfig.endpointId = String(LaDockerGatewayEndpoints[0].Id);
    return this.iConfig.endpointId;
  }

  /**
   * Reads the chosen endpoint metadata for validation and display.
   */
  async fnGetEndpoint(iEndpointId: string): Promise<IPortainerEndpoint> {
    try {
      const LdResponse = await this.clHttp.get<IPortainerEndpoint>(`/api/endpoints/${iEndpointId}`, {
        headers: this.fnAuthHeaders()
      });
      return LdResponse.data;
    } catch (idError) {
      throw new Error(`Endpoint ${iEndpointId} is unavailable or inaccessible: ${fnFormatAxiosError(idError)}`);
    }
  }

  /**
   * Returns the single supported authentication header: Portainer PAT token.
   */
  fnAuthHeaders(): TAuthHeaders {
    return {
      "X-API-Key": this.iConfig.patToken
    };
  }
}

/**
 * Converts Axios failures into compact messages for reports and CLI errors.
 */
export function fnFormatAxiosError(idError: unknown): string {
  if (axios.isAxiosError(idError)) {
    const LdAxiosError = idError as AxiosError<unknown>;
    const LStatus = LdAxiosError.response?.status;
    const LStatusText = LdAxiosError.response?.statusText;
    const LdBody = LdAxiosError.response?.data;
    const LBodyText = typeof LdBody === "string" ? LdBody : JSON.stringify(LdBody);
    return [LStatus, LStatusText, LBodyText || LdAxiosError.message].filter(Boolean).join(" ");
  }

  return idError instanceof Error ? idError.message : String(idError);
}
