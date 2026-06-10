/**
 * Module: Cleanup Types
 *
 * Responsibility:
 * - Define cleanup configuration, Docker payload, and report shapes.
 * - Preserve external API and JSON report property contracts.
 *
 * Notes:
 * - Part of LENSINFRA oclif CLI.
 * - Do not change runtime behavior.
 */

export type TCleanupScope = "containers" | "volumes" | "images" | "all";
export type TImageCleanupMode = "dangling" | "unused";
export type TVolumeCleanupMode = "anonymous" | "all-unused";

export interface IAppConfig {
  portainerUrl: string;
  patToken: string;
  endpointId?: string;
  tlsVerify: boolean;
  imageCleanupMode: TImageCleanupMode;
  volumeCleanupMode: TVolumeCleanupMode;
  maxDeleteCount: number;
}

export type TAuthHeaders = Record<"X-API-Key", string>;

export interface IPortainerEndpoint {
  Id: number;
  Name: string;
  Type?: number;
  Status?: number;
  URL?: string;
}

export interface IPortainerStack {
  Id: number;
  Name: string;
  EndpointId?: number;
  Status?: number | string;
}

export interface IDockerContainer {
  Id: string;
  Names?: string[];
  Image?: string;
  ImageID?: string;
  State?: string;
  Status?: string;
  Labels?: Record<string, string>;
  Mounts?: Array<{
    Type?: string;
    Name?: string;
    Source?: string;
    Destination?: string;
  }>;
}

export interface IDockerVersion {
  Version?: string;
  ApiVersion?: string;
  Os?: string;
  Arch?: string;
}

export interface IDockerVolume {
  Name: string;
  Driver?: string;
  Mountpoint?: string;
  CreatedAt?: string;
  Labels?: Record<string, string>;
  Scope?: string;
}

export interface IDockerVolumeList {
  Volumes?: IDockerVolume[];
  Warnings?: string[];
}

export interface IDockerImage {
  Id: string;
  RepoTags?: string[];
  RepoDigests?: string[];
  Created?: number;
  Size?: number;
  SharedSize?: number;
  VirtualSize?: number;
  Labels?: Record<string, string>;
}

export interface IResourceRecord {
  id?: string;
  name?: string;
  image?: string;
  repoTags?: string;
  size?: number;
  created?: number | string;
  state?: string;
  status?: string;
  reason?: string;
  error?: string;
  labels?: Record<string, string>;
  serviceName?: string;
  stackNamespace?: string;
  taskName?: string;
  desiredState?: string;
}

export interface IResourceReport {
  candidates: IResourceRecord[];
  deleted: IResourceRecord[];
  skipped: IResourceRecord[];
  failed: IResourceRecord[];
}

export interface ICleanupReport {
  startedAt: string;
  finishedAt: string;
  endpointId: string;
  dryRun: boolean;
  summary: {
    deleted: number;
    candidates: number;
    skipped: number;
    failed: number;
  };
  containers: IResourceReport;
  volumes: IResourceReport;
  images: IResourceReport;
}

export interface ICandidate<T> {
  resource: T;
  record: IResourceRecord;
}
