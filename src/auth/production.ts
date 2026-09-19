import { randomBytes } from "node:crypto";

export function isProductionEnv(env: { readonly NODE_ENV?: string }): boolean {
  return (env.NODE_ENV ?? "").trim().toLowerCase() === "production";
}

export function allowOpenConsent(env: { readonly MCP_ALLOW_OPEN_CONSENT?: string }): boolean {
  return (env.MCP_ALLOW_OPEN_CONSENT ?? "").trim() === "1";
}

export function normalizePublicOrigin(value: string | undefined, name = "MCP_PUBLIC_URL"): string | undefined {
  if (value === undefined) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("unsupported");
    }
    if (url.username !== "" || url.password !== "") {
      throw new Error("userinfo");
    }
    return url.origin;
  } catch {
    throw new Error(`${name} must be an absolute http(s) URL (any path is ignored).`);
  }
}

export function resolveOAuthSecret(input: {
  readonly secret: string | undefined;
  readonly production: boolean;
  readonly exposed: boolean;
  readonly secretName?: string;
}): string {
  const name = input.secretName ?? "MCP_OAUTH_SECRET";
  if (input.secret !== undefined && input.secret.length >= 32) return input.secret;
  if (input.production || input.exposed) {
    throw new Error(
      `${name} must be a stable value of at least 32 characters when HTTP is exposed or NODE_ENV=production.`
    );
  }
  return randomBytes(32).toString("base64url");
}

export function assertExposedHttp(input: {
  readonly exposed: boolean;
  readonly publicUrl: string | undefined;
  readonly authPassword: string | undefined;
  readonly allowOpen: boolean;
  readonly publicUrlName: string;
}): void {
  if (!input.exposed) return;
  if (input.publicUrl === undefined) {
    throw new Error(`${input.publicUrlName} is required when binding to a non-loopback address.`);
  }
  if (input.authPassword === undefined && !input.allowOpen) {
    throw new Error(
      "MCP_AUTH_PASSWORD is required when HTTP is reachable from the network. Set MCP_ALLOW_OPEN_CONSENT=1 only on a trusted isolated network."
    );
  }
}
