/**
 * Module: Stack Health Logger
 *
 * Responsibility:
 * - Create the daily file logger used by stack-health commands.
 * - Redact tokens and keep logs suitable for post-housekeeping audits.
 *
 * Notes:
 * - Part of LENSINFRA oclif CLI.
 * - Do not change runtime behavior.
 */

import fs from "node:fs";
import path from "node:path";
import pino, { Logger } from "pino";
import { AppConfig } from "./types.js";

/**
 * Produces YYYY-MM-DD for the daily log filename.
 */
function fnDateStamp(iDate = new Date()): string {
  // Output: ISO date prefix is stable and sortable.
  return iDate.toISOString().slice(0, 10);
}

/**
 * Builds a pino logger that writes to logs/bench-health-YYYY-MM-DD.log.
 */
export function fnCreateLogger(iConfig: AppConfig): Logger {
  // Action: Ensure the log directory exists before pino opens the destination file.
  fs.mkdirSync(iConfig.logDir, { recursive: true });

  // Local path: Full daily log file path.
  const LsPath = path.join(iConfig.logDir, `bench-health-${fnDateStamp()}.log`);

  // Class instance: Pino file destination for structured JSON logs.
  const clLoggerDestination = pino.destination({ dest: LsPath, sync: false, mkdir: true });

  // Output: Configured logger with token redaction enabled.
  return pino(
    {
      level: process.env.LOG_LEVEL ?? "info",
      redact: {
        paths: [
          "portainerPatToken",
          "headers.authorization",
          "headers.Authorization",
          "headers.X-API-Key",
          "config.portainerPatToken"
        ],
        censor: "[REDACTED]"
      },
      base: undefined,
      timestamp: pino.stdTimeFunctions.isoTime
    },
    clLoggerDestination
  );
}
