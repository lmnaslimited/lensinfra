/**
 * Module: Cleanup Logger
 *
 * Responsibility:
 * - Create the cleanup logger used by cleanup and validation flows.
 * - Keep detailed disk logs while keeping console output quiet.
 *
 * Notes:
 * - Part of LENSINFRA oclif CLI.
 * - Do not change runtime behavior.
 */

import fs from "node:fs";
import path from "node:path";
import winston from "winston";

/**
 * Keeps all cleanup runs grouped by calendar day in the log directory.
 */
function fnDateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Creates a shared logger that is quiet on screen but detailed on disk.
 */
export function fnCreateLogger(): winston.Logger {
  const LsLogsDir = path.resolve(process.cwd(), "logs");
  fs.mkdirSync(LsLogsDir, { recursive: true });

  return winston.createLogger({
    level: "info",
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.printf(({ timestamp: LsTimestamp, level: LsLevel, message: LsMessage, stack: LsStack }) => {
        return `${LsTimestamp} ${LsLevel}: ${LsStack ?? LsMessage}`;
      })
    ),
    transports: [
      new winston.transports.Console({
        level: "warn",
        format: winston.format.combine(winston.format.colorize(), winston.format.simple())
      }),
      new winston.transports.File({
        filename: path.join(LsLogsDir, `cleanup-${fnDateStamp()}.log`)
      })
    ]
  });
}
