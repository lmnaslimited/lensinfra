/**
 * Module: Docker Gateway Client
 *
 * Responsibility:
 * - Route Docker API requests through the selected Portainer endpoint.
 * - Expose the cleanup operations used by the cleanup module.
 *
 * Notes:
 * - Part of LENSINFRA oclif CLI.
 * - Do not change runtime behavior.
 */

import axios, { AxiosInstance } from "axios";
import https from "node:https";
import { IAppConfig, TAuthHeaders, IDockerContainer, IDockerImage, IDockerVersion, IDockerVolumeList } from "./types.js";

/**
 * Docker gateway client scoped to one resolved Portainer endpoint.
 */
export class clDockerGatewayClient {
  private readonly clHttp: AxiosInstance;

  /**
   * Builds a Docker API client routed through the selected Portainer endpoint.
   */
  constructor(iConfig: IAppConfig, iAuthHeaders: TAuthHeaders) {
    if (!iConfig.endpointId) {
      throw new Error("Docker gateway client requires a resolved endpoint ID");
    }

    this.clHttp = axios.create({
      baseURL: `${iConfig.portainerUrl}/api/endpoints/${iConfig.endpointId}/docker`,
      timeout: 60000,
      headers: iAuthHeaders,
      httpsAgent: iConfig.tlsVerify ? undefined : new https.Agent({ rejectUnauthorized: false })
    });
  }

  /**
   * Fetches containers with all states so cleanup can inspect exited/dead resources.
   */
  async fnGetContainers(iAll = true): Promise<IDockerContainer[]> {
    const LdResponse = await this.clHttp.get<IDockerContainer[]>("/containers/json", {
      params: { all: iAll }
    });
    return LdResponse.data;
  }

  /**
   * Validates Docker gateway access without mutating any Docker resource.
   */
  async fnGetVersion(): Promise<IDockerVersion> {
    const LdResponse = await this.clHttp.get<IDockerVersion>("/version");
    return LdResponse.data;
  }

  /**
   * Inspects a single container when future stages need detailed metadata.
   */
  async fnInspectContainer(iContainerId: string): Promise<IDockerContainer> {
    const LdResponse = await this.clHttp.get<IDockerContainer>(`/containers/${encodeURIComponent(iContainerId)}/json`);
    return LdResponse.data;
  }

  /**
   * Deletes only the selected container without forcing or deleting volumes.
   */
  async fnRemoveContainer(iContainerId: string): Promise<void> {
    await this.clHttp.delete(`/containers/${encodeURIComponent(iContainerId)}`, {
      params: { v: false, force: false }
    });
  }

  /**
   * Fetches Docker volumes before filtering unused candidates.
   */
  async fnGetVolumes(): Promise<IDockerVolumeList> {
    const LdResponse = await this.clHttp.get<IDockerVolumeList>("/volumes");
    return LdResponse.data;
  }

  /**
   * Deletes a selected volume after the CLI confirmation flow.
   */
  async fnRemoveVolume(iVolumeName: string): Promise<void> {
    await this.clHttp.delete(`/volumes/${encodeURIComponent(iVolumeName)}`);
  }

  /**
   * Fetches all images so the image stage can find unused images.
   */
  async fnGetImages(): Promise<IDockerImage[]> {
    const LdResponse = await this.clHttp.get<IDockerImage[]>("/images/json", {
      params: { all: true }
    });
    return LdResponse.data;
  }

  /**
   * Deletes a selected image without force-pruning related resources.
   */
  async fnRemoveImage(iImageId: string): Promise<void> {
    await this.clHttp.delete(`/images/${encodeURIComponent(iImageId)}`, {
      params: { force: false, noprune: false }
    });
  }
}
