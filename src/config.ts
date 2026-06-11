/**
 * Module: Cleanup Config
 *
 * Responsibility:
 * - Load cleanup configuration from environment variables.
 * - Normalize safety settings before cleanup stages run.
 *
 * Notes:
 * - Part of LENSINFRA oclif CLI.
 * - Do not change runtime behavior.
 */

import dotenv from "dotenv";
import { IAppConfig } from "./types.js";

// Load local environment values before any command reads configuration.
dotenv.config();

/**
 * Parses optional boolean environment flags in a CLI-friendly way.
 */
function fnEnvBoolean(iName: string, iFallback: boolean): boolean {
  const LValue = process.env[iName];
  if (LValue === undefined || LValue === "") {
    return iFallback;
  }

  return ["1", "true", "yes", "y"].includes(LValue.toLowerCase());
}

/**
 * Reads a required string value and fails early with a clear message.
 */
function fnEnvString(iName: string, iFallback?: string): string {
  const LValue = process.env[iName] ?? iFallback;
  if (!LValue) {
    throw new Error(`Missing required environment variable: ${iName}`);
  }

  return LValue;
}

/**
 * Reads an optional string only when it has meaningful content.
 */
function fnOptionalEnvString(iName: string): string | undefined {
  const LValue = process.env[iName];
  return LValue && LValue.trim() !== "" ? LValue : undefined;
}

/**
 * Parses positive integer values for deletion safety limits.
 */
function fnEnvNumber(iName: string, iFallback: number): number {
  const LRaw = process.env[iName];
  if (!LRaw) {
    return iFallback;
  }

  const LParsed = Number.parseInt(LRaw, 10);
  if (!Number.isFinite(LParsed) || LParsed < 1) {
    throw new Error(`${iName} must be a positive integer`);
  }

  return LParsed;
}

/**
 * Builds the IRuntime configuration used by every cleanup stage.
 */
export function fnLoadConfig(): IAppConfig {
  const LPatToken = fnEnvString("PORTAINER_PAT_TOKEN");

  return {
    portainerUrl: fnEnvString("PORTAINER_URL").replace(/\/+$/, ""),
    patToken: LPatToken,
    endpointId: fnOptionalEnvString("PORTAINER_ENDPOINT_ID"),
    tlsVerify: !fnEnvBoolean("ALLOW_SELF_SIGNED_CERT", false) && fnEnvBoolean("PORTAINER_TLS_VERIFY", true),
    imageCleanupMode: "unused",
    volumeCleanupMode: "all-unused",
    maxDeleteCount: fnEnvNumber("MAX_DELETE_COUNT", 50)
  };
}
