import {
  allowOpenConsent,
  assertExposedHttp,
  isProductionEnv,
  normalizePublicOrigin,
  resolveOAuthSecret
} from "./auth/production.js";
import { readSessionStorePath } from "./lib/session-path.js";

export const DEFAULT_HTTP_HOST = "127.0.0.1";
export const DEFAULT_HTTP_PORT = 3848;
export const MCP_PATH = "/mcp";
export const HEALTH_PATH = "/health";
export const WWW_AUTHENTICATE = 'Bearer realm="mcpicloudcalendar", scope="mcp:tools"';
export const WWW_AUTHENTICATE_INVALID =
  'Bearer realm="mcpicloudcalendar", scope="mcp:tools", error="invalid_token"';

export interface HttpBindConfig {
  readonly host: string;
  readonly port: number;
}

export interface AuthConfig {
  readonly oauthSecret: string;
  readonly authPassword?: string;
  readonly publicUrl?: string;
}

export interface RuntimeConfig {
  readonly email?: string;
  readonly password?: string;
  readonly http: HttpBindConfig;
  readonly allowedHosts: readonly string[];
  readonly auth: AuthConfig;
  readonly sessionStorePath?: string;
  readonly maxSessions?: number;
}

export interface EnvLike {
  readonly [key: string]: string | undefined;
}

export function readRuntimeConfig(env: EnvLike = process.env): RuntimeConfig {
  const email = nonEmpty(env.ICLOUD_EMAIL);
  const password = nonEmpty(env.ICLOUD_APP_PASSWORD);
  const host = nonEmpty(env.MCPICLOUDCALENDAR_HOST) ?? nonEmpty(env.MCP_HOST) ?? DEFAULT_HTTP_HOST;
  const port = parsePort(env.MCPICLOUDCALENDAR_PORT ?? env.MCP_PORT, DEFAULT_HTTP_PORT);
  const maxSessions = parseMaxSessions(env.MAX_SESSIONS);
  const http = { host, port };
  const auth = readAuthConfig(env, http);
  const sessionStorePath = readSessionStorePath(env, http);
  return {
    ...(email === undefined ? {} : { email }),
    ...(password === undefined ? {} : { password }),
    http,
    allowedHosts: defaultAllowedHosts(host, port, auth.publicUrl),
    auth,
    ...(sessionStorePath === undefined ? {} : { sessionStorePath }),
    ...(maxSessions === undefined ? {} : { maxSessions })
  };
}

function readAuthConfig(env: EnvLike, http: HttpBindConfig): AuthConfig {
  const authPassword = nonEmpty(env.MCP_AUTH_PASSWORD);
  const publicUrl = normalizePublicOrigin(
    nonEmpty(env.MCPICLOUDCALENDAR_PUBLIC_URL) ?? nonEmpty(env.MCP_PUBLIC_URL),
    "MCP_PUBLIC_URL"
  );
  const exposed = !isLoopbackBind(http.host);
  const oauthSecret = resolveOAuthSecret({
    secret: nonEmpty(env.MCP_OAUTH_SECRET),
    production: isProductionEnv(env),
    exposed
  });
  assertExposedHttp({
    exposed,
    publicUrl,
    authPassword,
    allowOpen: allowOpenConsent(env),
    publicUrlName: "MCP_PUBLIC_URL"
  });
  return {
    oauthSecret,
    ...(authPassword === undefined ? {} : { authPassword }),
    ...(publicUrl === undefined ? {} : { publicUrl })
  };
}

function parseMaxSessions(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error("MAX_SESSIONS must be a positive integer");
  }
  return n;
}

function defaultAllowedHosts(host: string, port: number, publicUrl?: string): readonly string[] {
  const names = ["127.0.0.1", "localhost", "[::1]", "::1"];
  const publicHost = publicHostname(publicUrl);
  if (publicHost !== undefined) names.push(publicHost);
  if (!isLoopbackBind(host) && host !== "0.0.0.0" && host !== "::" && host !== "[::]") {
    names.push(host);
  }
  return [...new Set(names.flatMap((name) => [name, `${name}:${port}`]))];
}

function publicHostname(publicUrl: string | undefined): string | undefined {
  if (publicUrl === undefined || publicUrl.length === 0) return undefined;
  try {
    return new URL(publicUrl).hostname;
  } catch {
    return undefined;
  }
}

export function isLoopbackBind(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
}

function parsePort(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`MCP_PORT must be an integer 0–65535, got ${value}`);
  }
  return port;
}

function nonEmpty(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}
