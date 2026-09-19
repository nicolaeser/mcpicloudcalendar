import { isProductionEnv } from "../auth/production.js";

export const DEFAULT_SESSION_STORE = "/var/lib/mcp/sessions.sqlite";

export function readSessionStorePath(
  env: { readonly [key: string]: string | undefined },
  http: { readonly host: string }
): string | undefined {
  if (env.MCP_SESSION_STORE !== undefined) {
    const trimmed = env.MCP_SESSION_STORE.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  }
  const secret = env.MCP_OAUTH_SECRET?.trim();
  if (secret === undefined || secret.length < 32) return undefined;
  const loopback =
    http.host === "127.0.0.1" || http.host === "localhost" || http.host === "::1" || http.host === "[::1]";
  if (!loopback || isProductionEnv(env)) return DEFAULT_SESSION_STORE;
  return undefined;
}
