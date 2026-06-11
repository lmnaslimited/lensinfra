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
  ICandidate,
  ICleanupReport,
  IDockerContainer,
  IDockerImage,
  IDockerVolume,
  IPortainerEndpoint,
  IPortainerStack,
  IResourceRecord
} from "./types.js";

interface ICleanupOptions {
  dryRun?: boolean;
}

interface IRuntime {
  clLogger: Logger;
  LdReport: ICleanupReport;
  clDockerGatewayClient: clDockerGatewayClient;
  LdEndpoint: IPortainerEndpoint;
  LaActiveStackNames: Set<string>;
}

type TCleanupKind = "containers" | "volumes" | "images";
type TCleanupResource = IDockerContainer | IDockerVolume | IDockerImage;

interface ILimitedDeletionPlan<T> {
  LaLimited: ICandidate<T>[];
  LaOverflow: ICandidate<T>[];
  LDeleteOverflow: boolean;
}

/**
 * Prints stage headings with spacing that keeps the CLI easy to scan.
 */
function fnPrintHeader(iTitle: string): void {
  console.log(`\n${iTitle}`);
}

/**
 * Trims long table fields without hiding empty values.
 */
function fnClip(iPayload: unknown, iLength: number): string {
  const LText = iPayload === undefined || iPayload === null || iPayload === "" ? "-" : String(iPayload);
  return LText.length <= iLength ? LText : `${LText.slice(0, iLength - 3)}...`;
}

/**
 * Renders byte counts in a compact human-readable format.
 */
function fnFormatBytes(iSize?: number): string {
  if (!iSize) {
    return "-";
  }

  const LaUnits = ["B", "KB", "MB", "GB", "TB"];
  let LSize = iSize;
  let LUnitIndex = 0;
  while (LSize >= 1024 && LUnitIndex < LaUnits.length - 1) {
    LSize /= 1024;
    LUnitIndex += 1;
  }

  return `${LSize.toFixed(LSize >= 10 || LUnitIndex === 0 ? 0 : 1)} ${LaUnits[LUnitIndex]}`;
}

/**
 * Shows actionable container candidates with stable 1-based indexes.
 */
function fnPrintContainerTable(iaRecords: IResourceRecord[]): void {
  if (iaRecords.length === 0) {
    console.log("No matching containers found.");
    return;
  }

  console.table(
    iaRecords.map((LdRecord, LIndex) => ({
      index: LIndex + 1,
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
function fnPrintVolumeTable(iaRecords: IResourceRecord[]): void {
  if (iaRecords.length === 0) {
    console.log("No eligible unused volumes found.");
    return;
  }

  console.table(
    iaRecords.map((LdRecord, LIndex) => ({
      index: LIndex + 1,
      name: fnClip(LdRecord.name, 42),
      stack: fnClip(LdRecord.stackNamespace, 24),
      reason: fnClip(LdRecord.reason, 44)
    }))
  );
}

/**
 * Shows actionable image candidates with readable size information.
 */
function fnPrintImageTable(iaRecords: IResourceRecord[]): void {
  if (iaRecords.length === 0) {
    console.log("No unused images found.");
    return;
  }

  console.table(
    iaRecords.map((LdRecord, LIndex) => ({
      index: LIndex + 1,
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
function fnIsStackActive(iEndpoint: IPortainerStack): boolean {
  return iEndpoint.Status === undefined || iEndpoint.Status === 1 || String(iEndpoint.Status).toLowerCase() === "active";
}

/**
 * Records user-skipped or dry-run-skipped resources in the matching report section.
 */
function fnSkipCandidates<T extends TCleanupResource>(
  idReport: ICleanupReport,
  iKind: TCleanupKind,
  iaCandidates: ICandidate<T>[],
  iReason: string
): void {
  idReport[iKind].skipped.push(...iaCandidates.map(({ record: LdRecord }) => ({ ...LdRecord, reason: iReason })));
}

/**
 * Parses comma-separated 1-based indexes from the skip prompt.
 */
function fnParseIndexList(iValue: string, iMaxIndex: number): number[] {
  if (iValue.trim() === "") {
    return [];
  }

  const LaSeenIndexes = new Set<number>();
  const LaIndexes: number[] = [];

  for (const LPart of iValue.split(",")) {
    const LParsed = Number.parseInt(LPart.trim(), 10);
    if (!Number.isInteger(LParsed) || LParsed < 1 || LParsed > iMaxIndex) {
      throw new Error(`Use comma-separated indexes between 1 and ${iMaxIndex}`);
    }

    if (!LaSeenIndexes.has(LParsed)) {
      LaSeenIndexes.add(LParsed);
      LaIndexes.push(LParsed);
    }
  }

  return LaIndexes;
}

/**
 * Asks skip indexes first, then requires DEL before returning selected resources.
 */
async function fnAskResourcesToDelete<T extends TCleanupResource>(
  iLabel: string,
  iaCandidates: ICandidate<T>[]
): Promise<{
  LaSelected: ICandidate<T>[];
  LaSkipped: ICandidate<T>[];
  LSkippedReason: string;
}> {
  if (iaCandidates.length === 0) {
    return { LaSelected: [], LaSkipped: [], LSkippedReason: "no candidates" };
  }

  const LdSkipAnswer = await inquirer.prompt<{ LShouldSkip: boolean }>([
    {
      type: "confirm",
      name: "LShouldSkip",
      message: `Do you want to skip any ${iLabel} for deletion?`,
      default: false
    }
  ]);

  const LaSkipIndexes = new Set<number>();
  if (LdSkipAnswer.LShouldSkip) {
    const LdIndexAnswer = await inquirer.prompt<{ LIndexes: string }>([
      {
        type: "input",
        name: "LIndexes",
        message: `Enter ${iLabel} indexes to skip in comma format:`,
        validate: (iValue: string) => {
          try {
            fnParseIndexList(iValue, iaCandidates.length);
            return true;
          } catch (idError) {
            return idError instanceof Error ? idError.message : String(idError);
          }
        }
      }
    ]);

    for (const LIndex of fnParseIndexList(LdIndexAnswer.LIndexes, iaCandidates.length)) {
      LaSkipIndexes.add(LIndex);
    }
  }

  const LaSelected = iaCandidates.filter((LdCandidate, LIndex) => !LaSkipIndexes.has(LIndex + 1));
  const LaSkipped = iaCandidates.filter((LdCandidate, LIndex) => LaSkipIndexes.has(LIndex + 1));

  if (LaSelected.length === 0) {
    return { LaSelected, LaSkipped, LSkippedReason: "user skipped deletion" };
  }

  console.log(`${iLabel} selected for deletion: ${LaSelected.length}`);
  const LdDeleteAnswer = await inquirer.prompt<{ LConfirmation: string }>([
    {
      type: "input",
      name: "LConfirmation",
      message: `Type DEL to delete selected ${iLabel}:`
    }
  ]);

  if (LdDeleteAnswer.LConfirmation !== "DEL") {
    return { LaSelected: [], LaSkipped: iaCandidates, LSkippedReason: "DEL not confirmed" };
  }

  return { LaSelected, LaSkipped, LSkippedReason: "user skipped deletion" };
}

/**
 * Splits confirmed candidates by MAX_DELETE_COUNT and gates overflow with DEL ALL.
 */
async function fnPlanLimitedDeletion<T extends TCleanupResource>(
  iLabel: string,
  iaCandidates: ICandidate<T>[],
  iMaxDeleteCount: number
): Promise<ILimitedDeletionPlan<T>> {
  if (iaCandidates.length <= iMaxDeleteCount) {
    return { LaLimited: iaCandidates, LaOverflow: [], LDeleteOverflow: false };
  }

  const LaLimited = iaCandidates.slice(0, iMaxDeleteCount);
  const LaOverflow = iaCandidates.slice(iMaxDeleteCount);

  console.log(
    `${iLabel} selected for deletion exceeds MAX_DELETE_COUNT=${iMaxDeleteCount}. ` +
      `Only the first ${LaLimited.length} ${iLabel} will be deleted now.`
  );
  console.log(`Remaining ${LaOverflow.length} ${iLabel} require DEL ALL confirmation.`);

  const LdDeleteAllAnswer = await inquirer.prompt<{ LConfirmation: string }>([
    {
      type: "input",
      name: "LConfirmation",
      message: `Type DEL ALL to delete the remaining ${LaOverflow.length} ${iLabel}:`
    }
  ]);

  return {
    LaLimited,
    LaOverflow,
    LDeleteOverflow: LdDeleteAllAnswer.LConfirmation === "DEL ALL"
  };
}

/**
 * Builds all clients and endpoint context needed by cleanup or validation.
 */
async function fnCreateRuntime(iIsDryRun: boolean): Promise<IRuntime> {
  const clLogger = fnCreateLogger();
  const LdConfig = fnLoadConfig();
  const LdReport = fnCreateInitialReport(LdConfig.endpointId ?? "auto", iIsDryRun);

  clLogger.info(`Starting cleanup endpoint=${LdConfig.endpointId ?? "auto"} dryRun=${iIsDryRun}`);

  if (!LdConfig.tlsVerify) {
    console.log("Warning: Self-signed certificates are allowed. Use only for local testing.");
  }

  const clPortainerApiClient = new clPortainerClient(LdConfig);
  await clPortainerApiClient.fnValidatePatToken();

  const LEndpointId = await clPortainerApiClient.fnResolveEndpointId();
  LdConfig.endpointId = LEndpointId;
  LdReport.endpointId = LEndpointId;

  const LdEndpoint = await clPortainerApiClient.fnGetEndpoint(LEndpointId);
  fnValidateEndpoint(LdEndpoint);
  console.log(`Using Portainer endpoint ${LdEndpoint.Id} (${LdEndpoint.Name})`);

  const LaActiveStacks = (await clPortainerApiClient.fnListStacks(LEndpointId)).filter(fnIsStackActive);
  const LaActiveStackNames = new Set(LaActiveStacks.map((LdStack) => LdStack.Name));

  const clDockerGatewayApiClient = new clDockerGatewayClient(LdConfig, clPortainerApiClient.fnAuthHeaders());
  await clDockerGatewayApiClient.fnGetVersion();

  return { clLogger, LdReport, clDockerGatewayClient: clDockerGatewayApiClient, LdEndpoint, LaActiveStackNames };
}

/**
 * Runs containers, volumes, and images in the requested single cleanup flow.
 */
export async function fnRunCleanup(iOptions: ICleanupOptions): Promise<void> {
  const LIsDryRun = Boolean(iOptions.dryRun);
  let LdRuntime: IRuntime | undefined;
  let LdReport = fnCreateInitialReport("unknown", LIsDryRun);
  const clLogger = fnCreateLogger();

  try {
    fnPrintHeader("Portainer Stack Container Cleanup");
    LdRuntime = await fnCreateRuntime(LIsDryRun);
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

    if (LIsDryRun) {
      console.log("Dry-run: container deletion skipped.");
      fnSkipCandidates(LdReport, "containers", LaContainerCandidates, "dry-run");
    } else {
      const { LaSelected, LaSkipped, LSkippedReason } = await fnAskResourcesToDelete("containers", LaContainerCandidates);
      const { LaLimited, LaOverflow, LDeleteOverflow } = await fnPlanLimitedDeletion("containers", LaSelected, LdConfig.maxDeleteCount);
      fnSkipCandidates(LdReport, "containers", LaSkipped, LSkippedReason);
      await fnDeleteContainerCandidates(LdRuntime.clDockerGatewayClient, LaLimited, LdReport, LdRuntime.clLogger);

      if (LaOverflow.length > 0 && LDeleteOverflow) {
        await fnDeleteContainerCandidates(LdRuntime.clDockerGatewayClient, LaOverflow, LdReport, LdRuntime.clLogger);
      } else if (LaOverflow.length > 0) {
        fnSkipCandidates(LdReport, "containers", LaOverflow, "MAX_DELETE_COUNT exceeded; DEL ALL not confirmed");
      }
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

    if (LIsDryRun) {
      console.log("Dry-run: volume deletion skipped.");
      fnSkipCandidates(LdReport, "volumes", LaVolumeCandidates, "dry-run");
    } else {
      const { LaSelected, LaSkipped, LSkippedReason } = await fnAskResourcesToDelete("volumes", LaVolumeCandidates);
      const { LaLimited, LaOverflow, LDeleteOverflow } = await fnPlanLimitedDeletion("volumes", LaSelected, LdConfig.maxDeleteCount);
      fnSkipCandidates(LdReport, "volumes", LaSkipped, LSkippedReason);
      await fnDeleteVolumeCandidates(LdRuntime.clDockerGatewayClient, LaLimited, LdReport, LdRuntime.clLogger);

      if (LaOverflow.length > 0 && LDeleteOverflow) {
        await fnDeleteVolumeCandidates(LdRuntime.clDockerGatewayClient, LaOverflow, LdReport, LdRuntime.clLogger);
      } else if (LaOverflow.length > 0) {
        fnSkipCandidates(LdReport, "volumes", LaOverflow, "MAX_DELETE_COUNT exceeded; DEL ALL not confirmed");
      }
    }

    const LaImageCandidates = await fnScanImages(LdRuntime.clDockerGatewayClient, LdConfig, LdReport, LdRuntime.clLogger);
    fnPrintHeader("Unused Images");
    console.log(`Found ${LaImageCandidates.length} unused images.`);
    fnPrintImageTable(LdReport.images.candidates);

    if (LIsDryRun) {
      console.log("Dry-run: image deletion skipped.");
      fnSkipCandidates(LdReport, "images", LaImageCandidates, "dry-run");
    } else {
      const { LaSelected, LaSkipped, LSkippedReason } = await fnAskResourcesToDelete("images", LaImageCandidates);
      const { LaLimited, LaOverflow, LDeleteOverflow } = await fnPlanLimitedDeletion("images", LaSelected, LdConfig.maxDeleteCount);
      fnSkipCandidates(LdReport, "images", LaSkipped, LSkippedReason);
      await fnDeleteImageCandidates(LdRuntime.clDockerGatewayClient, LaLimited, LdReport, LdRuntime.clLogger);

      if (LaOverflow.length > 0 && LDeleteOverflow) {
        await fnDeleteImageCandidates(LdRuntime.clDockerGatewayClient, LaOverflow, LdReport, LdRuntime.clLogger);
      } else if (LaOverflow.length > 0) {
        fnSkipCandidates(LdReport, "images", LaOverflow, "MAX_DELETE_COUNT exceeded; DEL ALL not confirmed");
      }
    }
  } catch (idError) {
    const LMessage = idError instanceof Error ? idError.message : String(idError);
    LdReport.containers.failed.push({ id: "startup", error: LMessage });
    clLogger.error(LMessage);
    console.error(`Error: ${LMessage}`);
    process.exitCode = 1;
  } finally {
    const clActiveLogger = LdRuntime?.clLogger ?? clLogger;
    const LReportPath = await fnWriteFinalReport(LdReport, clActiveLogger);
    fnPrintSummary(LdReport, LReportPath);
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
  } catch (idError) {
    const LMessage = idError instanceof Error ? idError.message : String(idError);
    LdReport.containers.failed.push({ id: "validate", error: LMessage });
    clLogger.error(LMessage);
    console.error(`Validation failed: ${LMessage}`);
    process.exitCode = 1;
  } finally {
    const LReportPath = await fnWriteFinalReport(LdReport, clLogger);
    console.log(`Report: ${LReportPath}`);
  }
}

/**
 * Finalizes and persists the report after every command path.
 */
async function fnWriteFinalReport(idReport: ICleanupReport, clLogger: Logger): Promise<string> {
  fnFinalizeReport(idReport);
  const LReportPath = fnWriteReport(idReport);
  clLogger.info(`Cleanup report written to ${LReportPath}`);
  return LReportPath;
}

/**
 * Validates only endpoint active status; Docker type is intentionally not trusted.
 */
function fnValidateEndpoint(iEndpoint: IPortainerEndpoint): void {
  if (iEndpoint.Status !== undefined && iEndpoint.Status !== 1) {
    throw new Error(`Selected endpoint ${iEndpoint.Name} (ID: ${iEndpoint.Id}) is not active. Status: ${iEndpoint.Status}`);
  }
}

/**
 * Prints final per-resource counts after reports are finalized.
 */
function fnPrintSummary(idReport: ICleanupReport, iReportPath: string): void {
  fnPrintHeader("Final Summary");
  console.table([
    fnSummaryRow("containers", idReport.containers),
    fnSummaryRow("volumes", idReport.volumes),
    fnSummaryRow("images", idReport.images)
  ]);
  console.log(`Report: ${iReportPath}`);
}

/**
 * Converts one report section into a summary table row.
 */
function fnSummaryRow(iName: string, idSection: ICleanupReport["containers"]): Record<string, number | string> {
  return {
    resource: iName,
    candidates: idSection.candidates.length,
    deleted: idSection.deleted.length,
    skipped: idSection.skipped.length,
    failed: idSection.failed.length
  };
}

/**
 * Exposes pure cleanup helpers for unit tests without changing CLI behavior.
 */
export const GdPortainerCleanupTestApi = {
  fnClip,
  fnFormatBytes,
  fnIsStackActive,
  fnParseIndexList,
  fnPlanLimitedDeletion,
  fnSkipCandidates,
  fnSummaryRow
};
