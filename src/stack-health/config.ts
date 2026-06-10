/**
 * Module: Stack Health Config
 *
 * Responsibility:
 * - Load, normalize, validate, and safely mask CLI configuration.
 * - Keep .env handling separate from Portainer and Docker API logic.
 *
 * Notes:
 * - Part of LENSINFRA oclif CLI.
 * - Do not change runtime behavior.
 */

import dotenv from "dotenv";
import { AppConfig } from "./types.js";

// Action: Load .env values into process.env before any command reads configuration.
dotenv.config();

/**
 * Converts a text environment value into a boolean with a safe fallback.
 */
function fnReadBoolean(iValue: string | undefined, iFallback: boolean): boolean {
  // Guard: Empty boolean values should use the caller supplied default.
  if (iValue === undefined || iValue.trim() === "") {
    // Output: The safe default boolean.
    return iFallback;
  }

  // Output: Common true-like strings are accepted for operator-friendly .env files.
  return ["1", "true", "yes", "y"].includes(iValue.trim().toLowerCase());
}

/**
 * Removes trailing slashes so URL joins do not produce double slashes.
 */
function fnNormalizeUrl(iValue: string): string {
  // Output: Portainer base URL without trailing slash characters.
  return iValue.replace(/\/+$/, "");
}

/**
 * Reads all supported environment settings into one typed config object.
 */
export function fnLoadConfig(): AppConfig {
  // Local string: Normalize auth mode so users can type API-KEY, api-key, or bearer.
  const LsAuthMode = (process.env.PORTAINER_AUTH_MODE ?? "api-key").trim().toLowerCase();

  // Output object: Central app configuration used by every command.
  return {
    portainerUrl: fnNormalizeUrl(process.env.PORTAINER_URL ?? "https://portainer.docker.localhost"),
    portainerPatToken: process.env.PORTAINER_PAT_TOKEN ?? "",
    portainerAuthMode: LsAuthMode === "bearer" ? "bearer" : "api-key",
    portainerEndpointId: process.env.PORTAINER_ENDPOINT_ID ?? "auto",
    allowSelfSignedCert: fnReadBoolean(process.env.ALLOW_SELF_SIGNED_CERT, false),
    stackNameFilter: process.env.STACK_NAME_FILTER?.trim() || undefined,
    stackLabelFilter: process.env.STACK_LABEL_FILTER?.trim() || undefined,
    reportDir: process.env.REPORT_DIR?.trim() || "reports",
    logDir: process.env.LOG_DIR?.trim() || "logs"
  };
}

/**
 * Validates configuration before any network call is attempted.
 */
export function fnValidateConfig(iConfig: AppConfig): string[] {
  // Local array: Collect all validation messages so the user sees every .env issue at once.
  const LaFailed: string[] = [];

  // Guard: Portainer URL is required for all commands.
  if (!iConfig.portainerUrl) {
    // Message: Tell the user exactly which setting is missing.
    LaFailed.push("PORTAINER_URL is required.");
  }

  // Guard: URL parsing catches malformed host, scheme, and path values.
  try {
    // Local object: Parsed URL used only for protocol validation.
    const LdParsedUrl = new URL(iConfig.portainerUrl);
    // Guard: Portainer must be reachable over HTTP or HTTPS.
    if (!["http:", "https:"].includes(LdParsedUrl.protocol)) {
      // Message: Tell the user which URL schemes are supported.
      LaFailed.push("PORTAINER_URL must use http or https.");
    }
  } catch {
    // Message: The supplied URL cannot be parsed by Node.
    LaFailed.push("PORTAINER_URL must be a valid URL.");
  }

  // Guard: Portainer API access token is mandatory.
  if (!iConfig.portainerPatToken) {
    // Message: Avoid saying the token value back to the user.
    LaFailed.push("PORTAINER_PAT_TOKEN is required.");
  }

  // Guard: Only the supported Portainer auth modes are allowed.
  if (!["api-key", "bearer"].includes(iConfig.portainerAuthMode)) {
    // Message: Make the allowed values copy-pasteable.
    LaFailed.push("PORTAINER_AUTH_MODE must be api-key or bearer.");
  }

  // Guard: Endpoint selection must be explicit or automatic.
  if (!iConfig.portainerEndpointId) {
    // Message: Explain the accepted endpoint setting.
    LaFailed.push("PORTAINER_ENDPOINT_ID is required. Use a numeric endpoint ID or auto.");
  }

  // Output: Empty array means configuration is valid.
  return LaFailed;
}

/**
 * Masks a secret while preserving enough shape for debugging token mix-ups.
 */
export function fnMaskSecret(iValue: string): string {
  // Guard: Empty secret remains empty.
  if (!iValue) {
    // Output: Nothing to mask.
    return "";
  }

  // Guard: Short secrets are fully masked.
  if (iValue.length <= 8) {
    // Output: Fixed mask avoids leaking small tokens.
    return "********";
  }

  // Output: Show only the first and last four characters.
  return `${iValue.slice(0, 4)}...${iValue.slice(-4)}`;
}

/**
 * Removes known secrets from any error or status message before display.
 */
export function fnMaskKnownSecrets(iMessage: unknown, iConfig: AppConfig): string {
  // Local string: Convert unknown thrown values into readable text.
  const LsMessage = iMessage instanceof Error ? iMessage.message : String(iMessage);
  // Output: Replace the PAT if it ever appears in an error string.
  return iConfig.portainerPatToken ? LsMessage.replaceAll(iConfig.portainerPatToken, fnMaskSecret(iConfig.portainerPatToken)) : LsMessage;
}
