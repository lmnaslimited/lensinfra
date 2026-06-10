/**
 * Module: Cleanup Report Writer
 *
 * Responsibility:
 * - Build cleanup report structures for all resource stages.
 * - Persist timestamped JSON cleanup reports.
 *
 * Notes:
 * - Part of LENSINFRA oclif CLI.
 * - Do not change runtime behavior.
 */

import fs from "node:fs";
import path from "node:path";
import { ICleanupReport, IResourceReport } from "../types.js";

/**
 * Creates the repeated report section structure used by each cleanup stage.
 */
function fnEmptyResourceReport(): IResourceReport {
  return {
    candidates: [],
    deleted: [],
    skipped: [],
    failed: []
  };
}

/**
 * Starts a report before scanning so failures can still be written.
 */
export function fnCreateInitialReport(iEndpointId: string, iIsDryRun: boolean): ICleanupReport {
  return {
    startedAt: new Date().toISOString(),
    finishedAt: "",
    endpointId: iEndpointId,
    dryRun: iIsDryRun,
    summary: {
      deleted: 0,
      candidates: 0,
      skipped: 0,
      failed: 0
    },
    containers: fnEmptyResourceReport(),
    volumes: fnEmptyResourceReport(),
    images: fnEmptyResourceReport()
  };
}

/**
 * Recalculates summary totals after all stages finish.
 */
export function fnFinalizeReport(idReport: ICleanupReport): ICleanupReport {
  idReport.finishedAt = new Date().toISOString();
  idReport.summary.candidates =
    idReport.containers.candidates.length + idReport.volumes.candidates.length + idReport.images.candidates.length;
  idReport.summary.deleted =
    idReport.containers.deleted.length + idReport.volumes.deleted.length + idReport.images.deleted.length;
  idReport.summary.skipped =
    idReport.containers.skipped.length + idReport.volumes.skipped.length + idReport.images.skipped.length;
  idReport.summary.failed =
    idReport.containers.failed.length + idReport.volumes.failed.length + idReport.images.failed.length;
  return idReport;
}

/**
 * Persists the report to disk using the existing timestamped filename format.
 */
export function fnWriteReport(idReport: ICleanupReport): string {
  const LReportsDir = path.resolve(process.cwd(), "reports");
  fs.mkdirSync(LReportsDir, { recursive: true });

  const LStamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const LReportPath = path.join(LReportsDir, `cleanup-report-${LStamp}.json`);
  fs.writeFileSync(LReportPath, `${JSON.stringify(idReport, null, 2)}\n`, "utf8");
  return LReportPath;
}
