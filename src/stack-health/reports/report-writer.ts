/**
 * Module: Stack Health Report Writer
 *
 * Responsibility:
 * - Persist JSON health reports to the configured report directory.
 * - Generate timestamped filenames that are easy to sort and archive.
 *
 * Notes:
 * - Part of LENSINFRA oclif CLI.
 * - Do not change runtime behavior.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { IHealthReport } from "../types.js";

/**
 * Produces YYYY-MM-DD-HH-mm-ss for report filenames.
 */
function fnTimestampForFile(iDate = new Date()): string {
  // Function: Pad date/time parts to two digits.
  const fnPad = (iValue: number): string => String(iValue).padStart(2, "0");

  // Output: Timestamp string suitable for Windows filenames.
  return [
    iDate.getFullYear(),
    fnPad(iDate.getMonth() + 1),
    fnPad(iDate.getDate())
  ].join("-") + `-${fnPad(iDate.getHours())}-${fnPad(iDate.getMinutes())}-${fnPad(iDate.getSeconds())}`;
}

/**
 * Writes the health report JSON to disk.
 */
export async function fnWriteHealthReport(iReportDir: string, iReport: IHealthReport): Promise<string> {
  // Action: Ensure report directory exists before writing the JSON file.
  await fs.mkdir(iReportDir, { recursive: true });

  // String path: Full report path with sortable timestamp.
  const LPath = path.join(iReportDir, `bench-health-report-${fnTimestampForFile()}.json`);

  // Action: Write pretty JSON so users can open reports directly.
  await fs.writeFile(LPath, `${JSON.stringify(iReport, null, 2)}\n`, "utf8");

  // Output: Return the path for console ACK output.
  return LPath;
}
