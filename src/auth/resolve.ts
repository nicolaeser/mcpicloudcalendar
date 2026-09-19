import { looksLikeMcpToken } from "./tokens.js";
import { credentialsFromBag, type CalendarEnv } from "./login-fields.js";
import { parseHttpCredentials, type ParsedCredentials } from "../transport/auth.js";
import type { LoginBag } from "./fields.js";
import { MCP_PATH, type RuntimeConfig } from "../config.js";
import { MCP_SCOPE, type McpOAuthService } from "./service.js";
import { publicOrigin } from "./origin.js";
import { PACKAGE_NAME } from "../version.js";
import type { Request } from "express";

export type ResolvedAuth =
  | {
      readonly ok: true;
      readonly apiToken: string;
      readonly sessionKey: string;
      readonly familyId: string;
      readonly expiresAt: number;
      readonly secrets: readonly string[];
      readonly bag: LoginBag;
    }
  | { readonly ok: false; readonly code: "missing" | "invalid"; readonly wwwAuthenticate: string };

export function authenticateHeader(config: RuntimeConfig, origin?: string): string {
  const parts = [`Bearer realm="${PACKAGE_NAME}"`, `scope="${MCP_SCOPE}"`];
  const base = (origin ?? config.auth.publicUrl ?? "").replace(/\/+$/, "");
  if (base.startsWith("http://") || base.startsWith("https://")) {
    parts.push(`resource_metadata="${base}/.well-known/oauth-protected-resource${MCP_PATH}"`);
  }
  return parts.join(", ");
}

export function authenticateInvalidHeader(config: RuntimeConfig, origin?: string): string {
  return `${authenticateHeader(config, origin)}, error="invalid_token"`;
}

export function resolveHttpAuth(
  req: Request,
  config: RuntimeConfig,
  service: McpOAuthService
): ResolvedAuth {
  const origin = publicOrigin(req, config.auth.publicUrl);
  const www = authenticateHeader(config, origin);
  const wwwInvalid = authenticateInvalidHeader(config, origin);
  const parsed: ParsedCredentials = parseHttpCredentials(req.headers);
  if (!parsed.ok) {
    return { ok: false, code: parsed.code, wwwAuthenticate: parsed.code === "missing" ? www : wwwInvalid };
  }
  if (!looksLikeMcpToken(parsed.token)) {
    return { ok: false, code: "invalid", wwwAuthenticate: wwwInvalid };
  }
  const verified = service.verifyAccess(parsed.token, origin);
  if (verified === undefined) {
    return { ok: false, code: "invalid", wwwAuthenticate: wwwInvalid };
  }
  const creds = credentialsFromBag(verified.bag, envFromConfig(config));
  if (creds === undefined) {
    return { ok: false, code: "invalid", wwwAuthenticate: wwwInvalid };
  }
  return {
    ok: true,
    apiToken: creds.password,
    sessionKey: parsed.token,
    familyId: verified.familyId,
    expiresAt: verified.expiresAt,
    secrets: [...new Set([parsed.token, creds.password, ...Object.values(verified.bag.secrets)].filter((value) => value.length > 0))],
    bag: verified.bag
  };
}

export function envFromConfig(config: RuntimeConfig): CalendarEnv {
  return {
    email: config.email,
    appPassword: config.password
  };
}
