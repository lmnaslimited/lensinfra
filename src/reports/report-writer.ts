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
import { CleanupReport, ResourceReport } from "../types.js";

/**
 * Creates the repeated report section structure used by each cleanup stage.
 */
function fnEmptyResourceReport(): ResourceReport {
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
export function fnCreateInitialReport(iLsEndpointId: string, iLbIsDryRun: boolean): CleanupReport {
  return {
    startedAt: new Date().toISOString(),
    finishedAt: "",
    endpointId: iLsEndpointId,
    dryRun: iLbIsDryRun,
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
export function fnFinalizeReport(iLdReport: CleanupReport): CleanupReport {
  iLdReport.finishedAt = new Date().toISOString();
  iLdReport.summary.candidates =
    iLdReport.containers.candidates.length + iLdReport.volumes.candidates.length + iLdReport.images.candidates.length;
  iLdReport.summary.deleted =
    iLdReport.containers.deleted.length + iLdReport.volumes.deleted.length + iLdReport.images.deleted.length;
  iLdReport.summary.skipped =
    iLdReport.containers.skipped.length + iLdReport.volumes.skipped.length + iLdReport.images.skipped.length;
  iLdReport.summary.failed =
    iLdReport.containers.failed.length + iLdReport.volumes.failed.length + iLdReport.images.failed.length;
  return iLdReport;
}

/**
 * Persists the report to disk using the existing timestamped filename format.
 */
export function fnWriteReport(iLdReport: CleanupReport): string {
  const LsReportsDir = path.resolve(process.cwd(), "reports");
  fs.mkdirSync(LsReportsDir, { recursive: true });

  const LsStamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const LsReportPath = path.join(LsReportsDir, `cleanup-report-${LsStamp}.json`);
  fs.writeFileSync(LsReportPath, `${JSON.stringify(iLdReport, null, 2)}\n`, "utf8");
  return LsReportPath;
}
