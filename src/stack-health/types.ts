/**
 * Module: Stack Health Types
 *
 * Responsibility:
 * - Define shared TypeScript shapes for config, Docker payloads, and reports.
 * - Preserve Portainer, Docker, and JSON report property contracts.
 *
 * Notes:
 * - Part of LENSINFRA oclif CLI.
 * - Do not change runtime behavior.
 */

// Type: App configuration loaded from .env.
export interface IAppConfig {
  portainerUrl: string;
  portainerPatToken: string;
  portainerAuthMode: "api-key" | "bearer";
  portainerEndpointId: string;
  allowSelfSignedCert: boolean;
  stackNameFilter?: string;
  stackLabelFilter?: string;
  reportDir: string;
  logDir: string;
}

// Type: Minimal Portainer endpoint payload used by endpoint auto-selection.
export interface IPortainerEndpoint {
  Id: number;
  Name: string;
  Status?: number;
  [key: string]: unknown;
}

// Type: Minimal Portainer stack payload used by stack filtering.
export interface IPortainerStack {
  Id: number;
  Name: string;
  Status?: number | string;
  EndpointId?: number;
  [key: string]: unknown;
}

// Type: Minimal Docker service payload read through the Portainer Docker gateway.
export interface IDockerService {
  ID: string;
  Spec?: {
    Name?: string;
    Labels?: Record<string, string>;
    Mode?: {
      Replicated?: {
        Replicas?: number;
      };
      Global?: Record<string, unknown>;
    };
  };
  UpdateStatus?: {
    State?: string;
    Message?: string;
  };
}

// Type: Minimal Docker task payload used to classify service state.
export interface IDockerTask {
  ID: string;
  ServiceID?: string;
  DesiredState?: string;
  CreatedAt?: string;
  Status?: {
    State?: string;
    Err?: string;
    Message?: string;
    ContainerStatus?: {
      ContainerID?: string;
    };
  };
}

// Type: Docker container summary returned by /containers/json?all=true.
export interface IDockerContainerSummary {
  Id: string;
  Names?: string[];
  Image?: string;
  State?: string;
  Status?: string;
  Labels?: Record<string, string>;
}

// Type: Docker container inspect payload fields needed for health checks.
export interface IDockerContainerInspect {
  Id: string;
  Name?: string;
  State?: {
    Status?: string;
    Health?: {
      Status?: string;
      FailingStreak?: number;
      Log?: Array<{
        Output?: string;
      }>;
    };
  };
}

// Type: Service statuses printed in the ACK and written to reports.
export type TServiceHealthStatus =
  | "running"
  | "partial"
  | "ready"
  | "preparing"
  | "complete"
  | "stopped"
  | "failed"
  | "restarting"
  | "unavailable"
  | "unknown";

// Type: Migration statuses for migration-like Bench services.
export type TMigrationStatus = "complete" | "running" | "failed" | "pending" | "unknown" | "not-migration";

// Type: Docker container health states.
export type TContainerHealthStatus = "healthy" | "unhealthy" | "starting" | "unknown";

// Type: Stack rollup health states.
export type TStackHealthStatus = "healthy" | "warning" | "critical";

// Type: Report row for one Docker task.
export interface IReportTask {
  taskId: string;
  desiredState: string;
  currentState: string;
  error: string;
  message: string;
}

// Type: Report row for one Docker container.
export interface IReportContainer {
  containerId: string;
  containerName: string;
  state: string;
  status: string;
  health: TContainerHealthStatus;
  reason: string;
}

// Type: Report row for one Docker service.
export interface IReportService {
  serviceName: string;
  desiredReplicas: number;
  runningReplicas: number;
  status: TServiceHealthStatus;
  migrationStatus: TMigrationStatus;
  notes: string[];
  tasks: IReportTask[];
  containers: IReportContainer[];
}

// Type: Report row for one Portainer stack.
export interface IReportStack {
  stackName: string;
  status: TStackHealthStatus;
  services: IReportService[];
}

// Type: Full health report written to reports/bench-health-report-*.json.
export interface IHealthReport {
  startedAt: string;
  finishedAt: string;
  endpoint: {
    id: number;
    name: string;
  };
  summary: {
    totalStacks: number;
    healthyStacks: number;
    warningStacks: number;
    criticalStacks: number;
    totalServices: number;
    runningServices: number;
    partialServices: number;
    readyServices: number;
    preparingServices: number;
    completedServices: number;
    failedServices: number;
    unavailableServices: number;
    migrationServices: number;
    completedMigrations: number;
    failedMigrations: number;
    pendingMigrations: number;
    totalContainers: number;
    healthyContainers: number;
    unhealthyContainers: number;
    unknownHealthContainers: number;
  };
  stacks: IReportStack[];
}
