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
import { AppConfig } from "./types.js";

// Load local environment values before any command reads configuration.
dotenv.config();

/**
 * Parses optional boolean environment flags in a CLI-friendly way.
 */
function fnEnvBoolean(iLsName: string, iLbFallback: boolean): boolean {
  const LsValue = process.env[iLsName];
  if (LsValue === undefined || LsValue === "") {
    return iLbFallback;
  }

  return ["1", "true", "yes", "y"].includes(LsValue.toLowerCase());
}

/**
 * Reads a required string value and fails early with a clear message.
 */
function fnEnvString(iLsName: string, iLsFallback?: string): string {
  const LsValue = process.env[iLsName] ?? iLsFallback;
  if (!LsValue) {
    throw new Error(`Missing required environment variable: ${iLsName}`);
  }

  return LsValue;
}

/**
 * Reads an optional string only when it has meaningful content.
 */
function fnOptionalEnvString(iLsName: string): string | undefined {
  const LsValue = process.env[iLsName];
  return LsValue && LsValue.trim() !== "" ? LsValue : undefined;
}

/**
 * Parses positive integer values for deletion safety limits.
 */
function fnEnvNumber(iLsName: string, iLnFallback: number): number {
  const LsRaw = process.env[iLsName];
  if (!LsRaw) {
    return iLnFallback;
  }

  const LnParsed = Number.parseInt(LsRaw, 10);
  if (!Number.isFinite(LnParsed) || LnParsed < 1) {
    throw new Error(`${iLsName} must be a positive integer`);
  }

  return LnParsed;
}

/**
 * Builds the runtime configuration used by every cleanup stage.
 */
export function fnLoadConfig(): AppConfig {
  const LsPatToken = fnEnvString("PORTAINER_PAT_TOKEN");

  return {
    portainerUrl: fnEnvString("PORTAINER_URL").replace(/\/+$/, ""),
    patToken: LsPatToken,
    endpointId: fnOptionalEnvString("PORTAINER_ENDPOINT_ID"),
    tlsVerify: !fnEnvBoolean("ALLOW_SELF_SIGNED_CERT", false) && fnEnvBoolean("PORTAINER_TLS_VERIFY", true),
    imageCleanupMode: "unused",
    volumeCleanupMode: "all-unused",
    maxDeleteCount: fnEnvNumber("MAX_DELETE_COUNT", 100)
  };
}
