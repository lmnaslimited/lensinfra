/**
 * Module: Portainer Cleanup
 *
 * Responsibility:
 * - Orchestrate cleanup scans, confirmations, deletions, and reporting.
 * - Keep cleanup stages separated from stack-health validation.
 *
 * Notes:
 * - Part of LENSINFRA oclif CLI.
 * - Do not change runtime behavior.
 */

export {run} from '@oclif/core'
import inquirer from "inquirer";
import { Logger } from "winston";
import { fnDeleteContainerCandidates, fnScanContainers } from "./cleanup/containers.js";
import { fnDeleteImageCandidates, fnScanImages } from "./cleanup/images.js";
import { fnDeleteVolumeCandidates, fnScanVolumes } from "./cleanup/volumes.js";
import { fnLoadConfig } from "./config.js";
import { clDockerGatewayClient } from "./docker-gateway-client.js";
import { fnCreateLogger } from "./logger.js";
import { clPortainerClient } from "./portainer-client.js";
import { fnCreateInitialReport, fnFinalizeReport, fnWriteReport } from "./reports/report-writer.js";
import {
  Candidate,
  CleanupReport,
  DockerContainer,
  DockerImage,
  DockerVolume,
  PortainerEndpoint,
  PortainerStack,
  ResourceRecord
} from "./types.js";

interface CleanupOptions {
  dryRun?: boolean;
}

interface Runtime {
  clLogger: Logger;
  LdReport: CleanupReport;
  clDockerGatewayClient: clDockerGatewayClient;
  LdEndpoint: PortainerEndpoint;
  LaActiveStackNames: Set<string>;
}

type CleanupKind = "containers" | "volumes" | "images";
type CleanupResource = DockerContainer | DockerVolume | DockerImage;

/**
 * Prints stage headings with spacing that keeps the CLI easy to scan.
 */
function fnPrintHeader(iLsTitle: string): void {
  console.log(`\n${iLsTitle}`);
}

/**
 * Trims long table fields without hiding empty values.
 */
function fnClip(iPayload: unknown, iLnLength: number): string {
  const LsText = iPayload === undefined || iPayload === null || iPayload === "" ? "-" : String(iPayload);
  return LsText.length <= iLnLength ? LsText : `${LsText.slice(0, iLnLength - 3)}...`;
}

/**
 * Renders byte counts in a compact human-readable format.
 */
function fnFormatBytes(iLnSize?: number): string {
  if (!iLnSize) {
    return "-";
  }

  const LaUnits = ["B", "KB", "MB", "GB", "TB"];
  let LnSize = iLnSize;
  let LnUnitIndex = 0;
  while (LnSize >= 1024 && LnUnitIndex < LaUnits.length - 1) {
    LnSize /= 1024;
    LnUnitIndex += 1;
  }

  return `${LnSize.toFixed(LnSize >= 10 || LnUnitIndex === 0 ? 0 : 1)} ${LaUnits[LnUnitIndex]}`;
}

/**
 * Shows actionable container candidates with stable 1-based indexes.
 */
function fnPrintContainerTable(iLaRecords: ResourceRecord[]): void {
  if (iLaRecords.length === 0) {
    console.log("No matching containers found.");
    return;
  }

  console.table(
    iLaRecords.map((LdRecord, LnIndex) => ({
      index: LnIndex + 1,
      id: LdRecord.id,
      name: fnClip(LdRecord.name, 34),
      image: fnClip(LdRecord.image, 36),
      state: LdRecord.state,
      stack: fnClip(LdRecord.stackNamespace, 24),
      status: fnClip(LdRecord.status, 38)
    }))
  );
}

/**
 * Shows actionable volume candidates with stack or "-" context.
 */
function fnPrintVolumeTable(iLaRecords: ResourceRecord[]): void {
  if (iLaRecords.length === 0) {
    console.log("No eligible unused volumes found.");
    return;
  }

  console.table(
    iLaRecords.map((LdRecord, LnIndex) => ({
      index: LnIndex + 1,
      name: fnClip(LdRecord.name, 42),
      stack: fnClip(LdRecord.stackNamespace, 24),
      reason: fnClip(LdRecord.reason, 44)
    }))
  );
}

/**
 * Shows actionable image candidates with readable size information.
 */
function fnPrintImageTable(iLaRecords: ResourceRecord[]): void {
  if (iLaRecords.length === 0) {
    console.log("No unused images found.");
    return;
  }

  console.table(
    iLaRecords.map((LdRecord, LnIndex) => ({
      index: LnIndex + 1,
      id: LdRecord.id,
      image: fnClip(LdRecord.repoTags || LdRecord.name, 46),
      size: fnFormatBytes(LdRecord.size),
      reason: fnClip(LdRecord.reason, 44)
    }))
  );
}

/**
 * Treats undefined stack status as active because older Portainer versions omit it.
 */
function fnIsStackActive(iEndpoint: PortainerStack): boolean {
  return iEndpoint.Status === undefined || iEndpoint.Status === 1 || String(iEndpoint.Status).toLowerCase() === "active";
}

/**
 * Records user-skipped or dry-run-skipped resources in the matching report section.
 */
function fnSkipCandidates<T extends CleanupResource>(
  iLdReport: CleanupReport,
  iLsKind: CleanupKind,
  iLaCandidates: Candidate<T>[],
  iLsReason: string
): void {
  iLdReport[iLsKind].skipped.push(...iLaCandidates.map(({ record: LdRecord }) => ({ ...LdRecord, reason: iLsReason })));
}

/**
 * Stops a stage before deletion when the selected count exceeds the configured safety cap.
 */
function fnEnforceMaxDeleteCount<T>(iLaCandidates: Candidate<T>[], iLnMaxDeleteCount: number): void {
  if (iLaCandidates.length > iLnMaxDeleteCount) {
    throw new Error(`Refusing to delete ${iLaCandidates.length} resources because MAX_DELETE_COUNT is ${iLnMaxDeleteCount}`);
  }
}

/**
 * Parses comma-separated 1-based indexes from the skip prompt.
 */
function fnParseIndexList(iLsValue: string, iLnMaxIndex: number): number[] {
  if (iLsValue.trim() === "") {
    return [];
  }

  const LaSeenIndexes = new Set<number>();
  const LaIndexes: number[] = [];

  for (const LsPart of iLsValue.split(",")) {
    const LnParsed = Number.parseInt(LsPart.trim(), 10);
    if (!Number.isInteger(LnParsed) || LnParsed < 1 || LnParsed > iLnMaxIndex) {
      throw new Error(`Use comma-separated indexes between 1 and ${iLnMaxIndex}`);
    }

    if (!LaSeenIndexes.has(LnParsed)) {
      LaSeenIndexes.add(LnParsed);
      LaIndexes.push(LnParsed);
    }
  }

  return LaIndexes;
}

/**
 * Asks skip indexes first, then requires DEL before returning selected resources.
 */
async function fnAskResourcesToDelete<T extends CleanupResource>(
  iLsLabel: string,
  iLaCandidates: Candidate<T>[]
): Promise<{
  LaSelected: Candidate<T>[];
  LaSkipped: Candidate<T>[];
  LsSkippedReason: string;
}> {
  if (iLaCandidates.length === 0) {
    return { LaSelected: [], LaSkipped: [], LsSkippedReason: "no candidates" };
  }

  const LdSkipAnswer = await inquirer.prompt<{ LbShouldSkip: boolean }>([
    {
      type: "confirm",
      name: "LbShouldSkip",
      message: `Do you want to skip any ${iLsLabel} for deletion?`,
      default: false
    }
  ]);

  const LaSkipIndexes = new Set<number>();
  if (LdSkipAnswer.LbShouldSkip) {
    const LdIndexAnswer = await inquirer.prompt<{ LsIndexes: string }>([
      {
        type: "input",
        name: "LsIndexes",
        message: `Enter ${iLsLabel} indexes to skip in comma format:`,
        validate: (iLsValue: string) => {
          try {
            fnParseIndexList(iLsValue, iLaCandidates.length);
            return true;
          } catch (iLdError) {
            return iLdError instanceof Error ? iLdError.message : String(iLdError);
          }
        }
      }
    ]);

    for (const LnIndex of fnParseIndexList(LdIndexAnswer.LsIndexes, iLaCandidates.length)) {
      LaSkipIndexes.add(LnIndex);
    }
  }

  const LaSelected = iLaCandidates.filter((LdCandidate, LnIndex) => !LaSkipIndexes.has(LnIndex + 1));
  const LaSkipped = iLaCandidates.filter((LdCandidate, LnIndex) => LaSkipIndexes.has(LnIndex + 1));

  if (LaSelected.length === 0) {
    return { LaSelected, LaSkipped, LsSkippedReason: "user skipped deletion" };
  }

  console.log(`${iLsLabel} selected for deletion: ${LaSelected.length}`);
  const LdDeleteAnswer = await inquirer.prompt<{ LsConfirmation: string }>([
    {
      type: "input",
      name: "LsConfirmation",
      message: `Type DEL to delete selected ${iLsLabel}:`
    }
  ]);

  if (LdDeleteAnswer.LsConfirmation !== "DEL") {
    return { LaSelected: [], LaSkipped: iLaCandidates, LsSkippedReason: "DEL not confirmed" };
  }

  return { LaSelected, LaSkipped, LsSkippedReason: "user skipped deletion" };
}

/**
 * Builds all clients and endpoint context needed by cleanup or validation.
 */
async function fnCreateRuntime(iLbIsDryRun: boolean): Promise<Runtime> {
  const clLogger = fnCreateLogger();
  const LdConfig = fnLoadConfig();
  const LdReport = fnCreateInitialReport(LdConfig.endpointId ?? "auto", iLbIsDryRun);

  clLogger.info(`Starting cleanup endpoint=${LdConfig.endpointId ?? "auto"} dryRun=${iLbIsDryRun}`);

  if (!LdConfig.tlsVerify) {
    console.log("Warning: Self-signed certificates are allowed. Use only for local testing.");
  }

  const clPortainerApiClient = new clPortainerClient(LdConfig);
  await clPortainerApiClient.fnValidatePatToken();

  const LsEndpointId = await clPortainerApiClient.fnResolveEndpointId();
  LdConfig.endpointId = LsEndpointId;
  LdReport.endpointId = LsEndpointId;

  const LdEndpoint = await clPortainerApiClient.fnGetEndpoint(LsEndpointId);
  fnValidateEndpoint(LdEndpoint);
  console.log(`Using Portainer endpoint ${LdEndpoint.Id} (${LdEndpoint.Name})`);

  const LaActiveStacks = (await clPortainerApiClient.fnListStacks(LsEndpointId)).filter(fnIsStackActive);
  const LaActiveStackNames = new Set(LaActiveStacks.map((LdStack) => LdStack.Name));

  const clDockerGatewayApiClient = new clDockerGatewayClient(LdConfig, clPortainerApiClient.fnAuthHeaders());
  await clDockerGatewayApiClient.fnGetVersion();

  return { clLogger, LdReport, clDockerGatewayClient: clDockerGatewayApiClient, LdEndpoint, LaActiveStackNames };
}

/**
 * Runs containers, volumes, and images in the requested single cleanup flow.
 */
export async function fnRunCleanup(iOptions: CleanupOptions): Promise<void> {
  const LbIsDryRun = Boolean(iOptions.dryRun);
  let LdRuntime: Runtime | undefined;
  let LdReport = fnCreateInitialReport("unknown", LbIsDryRun);
  const clLogger = fnCreateLogger();

  try {
    fnPrintHeader("Portainer Stack Container Cleanup");
    LdRuntime = await fnCreateRuntime(LbIsDryRun);
    LdReport = LdRuntime.LdReport;
    const LdConfig = fnLoadConfig();
    LdConfig.endpointId = LdReport.endpointId;

    console.log("PAT authentication: OK");
    console.log(`Active stacks: ${LdRuntime.LaActiveStackNames.size}`);

    const LaContainerCandidates = await fnScanContainers(
      LdRuntime.clDockerGatewayClient,
      LdRuntime.LaActiveStackNames,
      LdReport,
      LdRuntime.clLogger
    );

    fnPrintHeader("Exited/Dead Containers In Active Stacks");
    console.log(`Found ${LaContainerCandidates.length} exited/dead containers from active stacks.`);
    fnPrintContainerTable(LdReport.containers.candidates);

    if (LbIsDryRun) {
      console.log("Dry-run: container deletion skipped.");
      fnSkipCandidates(LdReport, "containers", LaContainerCandidates, "dry-run");
    } else {
      const { LaSelected, LaSkipped, LsSkippedReason } = await fnAskResourcesToDelete("containers", LaContainerCandidates);
      fnEnforceMaxDeleteCount(LaSelected, LdConfig.maxDeleteCount);
      fnSkipCandidates(LdReport, "containers", LaSkipped, LsSkippedReason);
      await fnDeleteContainerCandidates(LdRuntime.clDockerGatewayClient, LaSelected, LdReport, LdRuntime.clLogger);
    }

    const LaVolumeCandidates = await fnScanVolumes(
      LdRuntime.clDockerGatewayClient,
      LdConfig,
      LdRuntime.LaActiveStackNames,
      LdReport,
      LdRuntime.clLogger
    );
    fnPrintHeader("Unused Volumes");
    console.log(`Found ${LaVolumeCandidates.length} unused volumes from active stacks or no stack.`);
    fnPrintVolumeTable(LdReport.volumes.candidates);

    if (LbIsDryRun) {
      console.log("Dry-run: volume deletion skipped.");
      fnSkipCandidates(LdReport, "volumes", LaVolumeCandidates, "dry-run");
    } else {
      const { LaSelected, LaSkipped, LsSkippedReason } = await fnAskResourcesToDelete("volumes", LaVolumeCandidates);
      fnEnforceMaxDeleteCount(LaSelected, LdConfig.maxDeleteCount);
      fnSkipCandidates(LdReport, "volumes", LaSkipped, LsSkippedReason);
      await fnDeleteVolumeCandidates(LdRuntime.clDockerGatewayClient, LaSelected, LdReport, LdRuntime.clLogger);
    }

    const LaImageCandidates = await fnScanImages(LdRuntime.clDockerGatewayClient, LdConfig, LdReport, LdRuntime.clLogger);
    fnPrintHeader("Unused Images");
    console.log(`Found ${LaImageCandidates.length} unused images.`);
    fnPrintImageTable(LdReport.images.candidates);

    if (LbIsDryRun) {
      console.log("Dry-run: image deletion skipped.");
      fnSkipCandidates(LdReport, "images", LaImageCandidates, "dry-run");
    } else {
      const { LaSelected, LaSkipped, LsSkippedReason } = await fnAskResourcesToDelete("images", LaImageCandidates);
      fnEnforceMaxDeleteCount(LaSelected, LdConfig.maxDeleteCount);
      fnSkipCandidates(LdReport, "images", LaSkipped, LsSkippedReason);
      await fnDeleteImageCandidates(LdRuntime.clDockerGatewayClient, LaSelected, LdReport, LdRuntime.clLogger);
    }
  } catch (iLdError) {
    const LsMessage = iLdError instanceof Error ? iLdError.message : String(iLdError);
    LdReport.containers.failed.push({ id: "startup", error: LsMessage });
    clLogger.error(LsMessage);
    console.error(`Error: ${LsMessage}`);
    process.exitCode = 1;
  } finally {
    const clActiveLogger = LdRuntime?.clLogger ?? clLogger;
    const LsReportPath = await fnWriteFinalReport(LdReport, clActiveLogger);
    fnPrintSummary(LdReport, LsReportPath);
  }
}

/**
 * Validates Portainer access and Docker gateway access without deleting anything.
 */
export async function fnRunValidate(): Promise<void> {
  const clLogger = fnCreateLogger();
  let LdReport = fnCreateInitialReport("unknown", true);

  try {
    fnPrintHeader("Portainer Cleanup Validation");
    const LdRuntime = await fnCreateRuntime(true);
    LdReport = LdRuntime.LdReport;

    console.log("PAT authentication: OK");
    console.log("Docker gateway: OK");
    console.log(`Active stacks: ${LdRuntime.LaActiveStackNames.size}`);
    console.log("Validation complete. No resources were deleted.");
  } catch (iLdError) {
    const LsMessage = iLdError instanceof Error ? iLdError.message : String(iLdError);
    LdReport.containers.failed.push({ id: "validate", error: LsMessage });
    clLogger.error(LsMessage);
    console.error(`Validation failed: ${LsMessage}`);
    process.exitCode = 1;
  } finally {
    const LsReportPath = await fnWriteFinalReport(LdReport, clLogger);
    console.log(`Report: ${LsReportPath}`);
  }
}

/**
 * Finalizes and persists the report after every command path.
 */
async function fnWriteFinalReport(iLdReport: CleanupReport, clLogger: Logger): Promise<string> {
  fnFinalizeReport(iLdReport);
  const LsReportPath = fnWriteReport(iLdReport);
  clLogger.info(`Cleanup report written to ${LsReportPath}`);
  return LsReportPath;
}

/**
 * Validates only endpoint active status; Docker type is intentionally not trusted.
 */
function fnValidateEndpoint(iEndpoint: PortainerEndpoint): void {
  if (iEndpoint.Status !== undefined && iEndpoint.Status !== 1) {
    throw new Error(`Selected endpoint ${iEndpoint.Name} (ID: ${iEndpoint.Id}) is not active. Status: ${iEndpoint.Status}`);
  }
}

/**
 * Prints final per-resource counts after reports are finalized.
 */
function fnPrintSummary(iLdReport: CleanupReport, iLsReportPath: string): void {
  fnPrintHeader("Final Summary");
  console.table([
    fnSummaryRow("containers", iLdReport.containers),
    fnSummaryRow("volumes", iLdReport.volumes),
    fnSummaryRow("images", iLdReport.images)
  ]);
  console.log(`Report: ${iLsReportPath}`);
}

/**
 * Converts one report section into a summary table row.
 */
function fnSummaryRow(iLsName: string, iLdSection: CleanupReport["containers"]): Record<string, number | string> {
  return {
    resource: iLsName,
    candidates: iLdSection.candidates.length,
    deleted: iLdSection.deleted.length,
    skipped: iLdSection.skipped.length,
    failed: iLdSection.failed.length
  };
}
