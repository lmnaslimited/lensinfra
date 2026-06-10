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

export type CleanupScope = "containers" | "volumes" | "images" | "all";
export type ImageCleanupMode = "dangling" | "unused";
export type VolumeCleanupMode = "anonymous" | "all-unused";

export interface AppConfig {
  portainerUrl: string;
  patToken: string;
  endpointId?: string;
  tlsVerify: boolean;
  imageCleanupMode: ImageCleanupMode;
  volumeCleanupMode: VolumeCleanupMode;
  maxDeleteCount: number;
}

export type AuthHeaders = Record<"X-API-Key", string>;

export interface PortainerEndpoint {
  Id: number;
  Name: string;
  Type?: number;
  Status?: number;
  URL?: string;
}

export interface PortainerStack {
  Id: number;
  Name: string;
  EndpointId?: number;
  Status?: number | string;
}

export interface DockerContainer {
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

export interface DockerVersion {
  Version?: string;
  ApiVersion?: string;
  Os?: string;
  Arch?: string;
}

export interface DockerVolume {
  Name: string;
  Driver?: string;
  Mountpoint?: string;
  CreatedAt?: string;
  Labels?: Record<string, string>;
  Scope?: string;
}

export interface DockerVolumeList {
  Volumes?: DockerVolume[];
  Warnings?: string[];
}

export interface DockerImage {
  Id: string;
  RepoTags?: string[];
  RepoDigests?: string[];
  Created?: number;
  Size?: number;
  SharedSize?: number;
  VirtualSize?: number;
  Labels?: Record<string, string>;
}

export interface ResourceRecord {
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

export interface ResourceReport {
  candidates: ResourceRecord[];
  deleted: ResourceRecord[];
  skipped: ResourceRecord[];
  failed: ResourceRecord[];
}

export interface CleanupReport {
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
  containers: ResourceReport;
  volumes: ResourceReport;
  images: ResourceReport;
}

export interface Candidate<T> {
  resource: T;
  record: ResourceRecord;
}
