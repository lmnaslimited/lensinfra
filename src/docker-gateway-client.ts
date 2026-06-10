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
import { AppConfig, AuthHeaders, DockerContainer, DockerImage, DockerVersion, DockerVolumeList } from "./types.js";

/**
 * Docker gateway client scoped to one resolved Portainer endpoint.
 */
export class clDockerGatewayClient {
  private readonly clHttp: AxiosInstance;

  /**
   * Builds a Docker API client routed through the selected Portainer endpoint.
   */
  constructor(iConfig: AppConfig, iAuthHeaders: AuthHeaders) {
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
  async fnGetContainers(iLbAll = true): Promise<DockerContainer[]> {
    const LdResponse = await this.clHttp.get<DockerContainer[]>("/containers/json", {
      params: { all: iLbAll }
    });
    return LdResponse.data;
  }

  /**
   * Validates Docker gateway access without mutating any Docker resource.
   */
  async fnGetVersion(): Promise<DockerVersion> {
    const LdResponse = await this.clHttp.get<DockerVersion>("/version");
    return LdResponse.data;
  }

  /**
   * Inspects a single container when future stages need detailed metadata.
   */
  async fnInspectContainer(iLsContainerId: string): Promise<DockerContainer> {
    const LdResponse = await this.clHttp.get<DockerContainer>(`/containers/${encodeURIComponent(iLsContainerId)}/json`);
    return LdResponse.data;
  }

  /**
   * Deletes only the selected container without forcing or deleting volumes.
   */
  async fnRemoveContainer(iLsContainerId: string): Promise<void> {
    await this.clHttp.delete(`/containers/${encodeURIComponent(iLsContainerId)}`, {
      params: { v: false, force: false }
    });
  }

  /**
   * Fetches Docker volumes before filtering unused candidates.
   */
  async fnGetVolumes(): Promise<DockerVolumeList> {
    const LdResponse = await this.clHttp.get<DockerVolumeList>("/volumes");
    return LdResponse.data;
  }

  /**
   * Deletes a selected volume after the CLI confirmation flow.
   */
  async fnRemoveVolume(iLsVolumeName: string): Promise<void> {
    await this.clHttp.delete(`/volumes/${encodeURIComponent(iLsVolumeName)}`);
  }

  /**
   * Fetches all images so the image stage can find unused images.
   */
  async fnGetImages(): Promise<DockerImage[]> {
    const LdResponse = await this.clHttp.get<DockerImage[]>("/images/json", {
      params: { all: true }
    });
    return LdResponse.data;
  }

  /**
   * Deletes a selected image without force-pruning related resources.
   */
  async fnRemoveImage(iLsImageId: string): Promise<void> {
    await this.clHttp.delete(`/images/${encodeURIComponent(iLsImageId)}`, {
      params: { force: false, noprune: false }
    });
  }
}
