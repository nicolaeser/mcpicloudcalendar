import { createHash } from "node:crypto";
import type { LoginBag } from "./fields.js";
import {
  assertLoginFields,
  collectLoginBag,
  visibleLoginFields,
  type LoginField
} from "./fields.js";
import { loginFields } from "./login-fields.js";
import { randomId, safeEqualText, signCsrf, verifyCsrfMac } from "./crypto.js";
import { filterRedirectUris, isAllowedRedirect, redirectUriMatches } from "./redirects.js";
import { decodeToken, issuePair, looksLikeMcpToken, openBag } from "./tokens.js";
import type { AuthConfig } from "../config.js";
import { PACKAGE_NAME } from "../version.js";
import { MemoryDurableKv, type DurableKv } from "../lib/durable.js";
import { FAMILY_TTL_MS, OAuthPersist } from "./persist.js";

export const MCP_SCOPE = "mcp:tools";
const CODE_TTL_MS = 5 * 60 * 1000;
const CSRF_PREFIX = "csrf1";
const CSRF_TTL_MS = 30 * 60 * 1000;

export interface CsrfBind {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly codeChallenge: string;
}

export type CsrfFailReason = "hmac" | "expired" | "bind" | "replay";
export type CsrfVerifyResult = { readonly ok: true } | { readonly ok: false; readonly reason: CsrfFailReason };

type CsrfPayload = { v: 1; n: string; exp: number; cid: string; ru: string; ch: string };
type CsrfNonceState = "unused" | "used";

export interface OAuthClient {
  readonly client_id: string;
  readonly client_name?: string;
  readonly redirect_uris: readonly string[];
  readonly token_endpoint_auth_method?: string;
  readonly grant_types?: readonly string[];
  readonly response_types?: readonly string[];
  readonly client_id_issued_at?: number;
}

interface AuthCode {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly codeChallenge: string;
  readonly resource: string;
  readonly scopes: readonly string[];
  readonly bag: LoginBag;
  readonly exp: number;
  used: boolean;
}

interface Family {
  currentRefreshJti: string;
  revoked: boolean;
  exp: number;
}

export interface VerifiedAccess {
  readonly token: string;
  readonly clientId: string;
  readonly familyId: string;
  readonly audience: string;
  readonly scopes: readonly string[];
  readonly bag: LoginBag;
  readonly expiresAt: number;
}

export class McpOAuthService {
  private readonly fields: readonly LoginField[];
  private readonly persist: OAuthPersist;

  public constructor(
    private readonly auth: AuthConfig,
    private readonly env: NodeJS.ProcessEnv,
    fields: readonly LoginField[] = loginFields(),
    store: DurableKv = new MemoryDurableKv()
  ) {
    assertLoginFields(fields);
    this.fields = fields;
    this.persist = new OAuthPersist(store);
    if (this.auth.oauthSecret.length < 32) {
      throw new Error("OAuth signing secret is missing.");
    }
  }

  public get visibleLoginFields(): readonly LoginField[] {
    const fields = this.requirePassword
      ? this.fields
      : this.fields.map((field) =>
          field.prompt === "never" ? field : { ...field, prompt: "always" as const }
        );
    return visibleLoginFields(fields, this.env);
  }

  public get requirePassword(): boolean {
    return this.auth.authPassword !== undefined && this.auth.authPassword.length > 0;
  }

  public resourceMetadata(origin: string, path: string): Record<string, unknown> {
    const resource = `${origin}${path}`;
    return {
      resource,
      authorization_servers: [origin],
      bearer_methods_supported: ["header"],
      scopes_supported: [MCP_SCOPE],
      resource_name: PACKAGE_NAME
    };
  }

  public authorizationServerMetadata(origin: string): Record<string, unknown> {
    return {
      issuer: origin,
      authorization_endpoint: `${origin}/authorize`,
      token_endpoint: `${origin}/token`,
      registration_endpoint: `${origin}/register`,
      revocation_endpoint: `${origin}/revoke`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: [MCP_SCOPE],
      resource_indicators_supported: true
    };
  }

  public registerClient(input: {
    readonly redirect_uris?: unknown;
    readonly client_name?: unknown;
    readonly token_endpoint_auth_method?: unknown;
    readonly grant_types?: unknown;
    readonly response_types?: unknown;
    readonly client_id?: unknown;
  }): OAuthClient {
    const requested = Array.isArray(input.redirect_uris)
      ? input.redirect_uris.filter((item): item is string => typeof item === "string")
      : [];
    const redirect_uris = filterRedirectUris(requested);
    if (redirect_uris.length === 0) {
      throw new Error("invalid_client_metadata: no allowed redirect_uri");
    }
    const client_id =
      typeof input.client_id === "string" && input.client_id.length > 0 ? input.client_id : randomId(16);
    const client: OAuthClient = {
      client_id,
      redirect_uris,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      token_endpoint_auth_method:
        typeof input.token_endpoint_auth_method === "string" ? input.token_endpoint_auth_method : "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      ...(typeof input.client_name === "string" ? { client_name: input.client_name } : {})
    };
    this.persist.saveClient(client);
    return client;
  }

  public getClient(clientId: string): OAuthClient | undefined {
    return this.persist.loadClient(clientId);
  }

  public issueCsrf(bind: CsrfBind): string {
    const n = randomId(24);
    const exp = Date.now() + CSRF_TTL_MS;
    const payload: CsrfPayload = {
      v: 1,
      n,
      exp,
      cid: bind.clientId,
      ru: bind.redirectUri,
      ch: bind.codeChallenge
    };
    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const mac = signCsrf(this.secret(), `${CSRF_PREFIX}.${encoded}`);
    const token = `${CSRF_PREFIX}.${encoded}.${mac}`;
    this.persist.saveCsrf(n, { state: "unused", exp });
    return token;
  }

  public verifyCsrf(token: string, bind: CsrfBind): CsrfVerifyResult {
    const parsed = this.parseCsrf(token);
    if (parsed === undefined) return { ok: false, reason: "hmac" };
    if (parsed.exp < Date.now()) return { ok: false, reason: "expired" };
    if (
      parsed.cid !== bind.clientId ||
      parsed.ru !== bind.redirectUri ||
      parsed.ch !== bind.codeChallenge
    ) {
      return { ok: false, reason: "bind" };
    }
    if (this.persist.loadCsrf(parsed.n)?.state === "used") return { ok: false, reason: "replay" };
    return { ok: true };
  }

  public consumeCsrf(token: string): boolean {
    const parsed = this.parseCsrf(token);
    if (parsed === undefined || parsed.exp < Date.now()) return false;
    const row = this.persist.loadCsrf(parsed.n);
    if (row === undefined || row.state === "used") return false;
    this.persist.saveCsrf(parsed.n, { state: "used", exp: row.exp });
    return true;
  }

  private parseCsrf(token: string): CsrfPayload | undefined {
    const parts = token.split(".");
    if (parts.length !== 3 || parts[0] !== CSRF_PREFIX) return undefined;
    const encoded = parts[1];
    const mac = parts[2];
    if (encoded === undefined || mac === undefined || encoded.length === 0 || mac.length === 0) {
      return undefined;
    }
    if (!verifyCsrfMac(this.secret(), `${CSRF_PREFIX}.${encoded}`, mac)) return undefined;
    try {
      const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<CsrfPayload>;
      if (parsed.v !== 1) return undefined;
      if (typeof parsed.n !== "string" || parsed.n.length === 0) return undefined;
      if (typeof parsed.exp !== "number" || !Number.isFinite(parsed.exp)) return undefined;
      if (typeof parsed.cid !== "string" || typeof parsed.ru !== "string") return undefined;
      if (typeof parsed.ch !== "string") return undefined;
      return { v: 1, n: parsed.n, exp: parsed.exp, cid: parsed.cid, ru: parsed.ru, ch: parsed.ch };
    } catch {
      return undefined;
    }
  }

  public completeAuthorization(input: {
    readonly clientId: string;
    readonly redirectUri: string;
    readonly codeChallenge: string;
    readonly resource: string;
    readonly scopes: readonly string[];
    readonly bag: LoginBag;
    readonly csrf?: string;
  }): string {
    this.sweep();
    const code = randomId(24);
    this.persist.saveCode(code, {
      clientId: input.clientId,
      redirectUri: input.redirectUri,
      codeChallenge: input.codeChallenge,
      resource: input.resource,
      scopes: input.scopes.length > 0 ? input.scopes : [MCP_SCOPE],
      bag: input.bag,
      exp: Date.now() + CODE_TTL_MS,
      used: false
    });
    if (input.csrf !== undefined && input.csrf.length > 0) {
      const parsed = this.parseCsrf(input.csrf);
      if (parsed !== undefined) this.persist.saveCsrfCode(parsed.n, { code, exp: Date.now() + CODE_TTL_MS });
    }
    return code;
  }

  public unusedCodeForCsrf(token: string): string | undefined {
    const parsed = this.parseCsrf(token);
    if (parsed === undefined) return undefined;
    const row = this.persist.loadCsrfCode(parsed.n);
    if (row === undefined || row.exp < Date.now()) return undefined;
    const auth = this.persist.loadCode(row.code);
    if (auth === undefined || auth.used || auth.exp < Date.now()) return undefined;
    return row.code;
  }

  public exchangeCode(input: {
    readonly clientId: string;
    readonly code: string;
    readonly codeVerifier: string;
    readonly redirectUri?: string;
    readonly resource?: string;
  }): { access_token: string; refresh_token: string; token_type: "bearer"; expires_in: number; scope: string } {
    const row = this.persist.loadCode(input.code);
    if (row === undefined || row.used || row.exp < Date.now()) throw new Error("invalid_grant");
    if (row.clientId !== input.clientId) throw new Error("invalid_grant");
    if (input.redirectUri !== undefined && input.redirectUri !== row.redirectUri) throw new Error("invalid_grant");
    if (!verifyS256(input.codeVerifier, row.codeChallenge)) throw new Error("invalid_grant");
    const resource = input.resource ?? row.resource;
    if (resource !== row.resource) throw new Error("invalid_grant");
    row.used = true;
    this.persist.deleteCode(input.code);
    const pair = issuePair(this.secret(), {
      clientId: row.clientId,
      audience: row.resource,
      scopes: row.scopes,
      bag: row.bag
    });
    this.persist.saveFamily(pair.familyId, {
      currentRefreshJti: pair.refreshJti,
      revoked: false,
      exp: Date.now() + FAMILY_TTL_MS
    });
    return {
      access_token: pair.accessToken,
      refresh_token: pair.refreshToken,
      token_type: "bearer",
      expires_in: pair.expiresIn,
      scope: row.scopes.join(" ")
    };
  }

  public exchangeRefresh(input: {
    readonly clientId: string;
    readonly refreshToken: string;
    readonly resource?: string;
  }): { access_token: string; refresh_token: string; token_type: "bearer"; expires_in: number; scope: string } {
    const claims = decodeToken(this.secret(), input.refreshToken);
    if (claims === undefined || claims.typ !== "refresh") throw new Error("invalid_grant");
    if (claims.cid !== input.clientId) throw new Error("invalid_grant");
    const family = this.persist.loadFamily(claims.fam);
    if (family === undefined || family.revoked) throw new Error("invalid_grant");
    if (family.currentRefreshJti !== claims.jti) {
      this.persist.saveFamily(claims.fam, { ...family, revoked: true });
      throw new Error("invalid_grant");
    }
    const resource = input.resource ?? claims.aud;
    if (resource !== claims.aud) throw new Error("invalid_grant");
    const bag = openBag(this.secret(), claims.bag);
    const pair = issuePair(this.secret(), {
      clientId: claims.cid,
      audience: claims.aud,
      scopes: claims.scp,
      bag,
      familyId: claims.fam
    });
    this.persist.saveFamily(claims.fam, { ...family, currentRefreshJti: pair.refreshJti });
    return {
      access_token: pair.accessToken,
      refresh_token: pair.refreshToken,
      token_type: "bearer",
      expires_in: pair.expiresIn,
      scope: claims.scp.join(" ")
    };
  }

  public revoke(token: string): void {
    if (!looksLikeMcpToken(token)) return;
    const claims = decodeToken(this.secret(), token);
    if (claims === undefined) return;
    const family =
      this.persist.loadFamily(claims.fam) ?? {
        currentRefreshJti: claims.jti,
        revoked: false,
        exp: claims.exp * 1000
      };
    this.persist.saveFamily(claims.fam, { ...family, revoked: true });
  }

  public verifyAccess(token: string, origin?: string): VerifiedAccess | undefined {
    const claims = decodeToken(this.secret(), token);
    if (claims === undefined || claims.typ !== "access") return undefined;
    if (!claims.scp.includes(MCP_SCOPE)) return undefined;
    const family = this.persist.loadFamily(claims.fam);
    if (family?.revoked === true) return undefined;
    if (origin !== undefined && !originMatchesAudience(claims.aud, origin)) return undefined;
    let bag: LoginBag;
    try {
      bag = openBag(this.secret(), claims.bag);
    } catch {
      return undefined;
    }
    return {
      token,
      clientId: claims.cid,
      familyId: claims.fam,
      audience: claims.aud,
      scopes: claims.scp,
      bag,
      expiresAt: claims.exp
    };
  }

  public verifyOperatorPassword(password: string | undefined): boolean {
    const expected = this.auth.authPassword;
    if (expected === undefined || expected.length === 0) return true;
    if (password === undefined || password.length === 0 || password.length > 256) return false;
    return safeEqualText(this.secret(), password, expected);
  }

  public collectBag(body: Record<string, string | undefined>): ReturnType<typeof collectLoginBag> {
    if (!this.requirePassword) {
      const email = (body.email ?? "").trim();
      const appPassword = (body.appPassword ?? "").trim();
      if (email.length === 0 || appPassword.length === 0) {
        return { ok: false, error: "iCloud Mail address and app-specific password are required." };
      }
    }
    return collectLoginBag(this.fields, body, this.env);
  }

  public allowRedirect(uri: string): boolean {
    return isAllowedRedirect(uri);
  }

  public clientRedirectOk(client: OAuthClient, uri: string): boolean {
    return redirectUriMatches(uri, client.redirect_uris);
  }

  private secret(): string {
    return this.auth.oauthSecret;
  }

  private sweep(): void {
    this.persist.sweep();
  }
}

export function isS256Challenge(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}

export function isRfc7636Verifier(value: string): boolean {
  return value.length >= 43 && value.length <= 128 && /^[A-Za-z0-9\-._~]+$/.test(value);
}

function verifyS256(verifier: string, challenge: string): boolean {
  if (!isRfc7636Verifier(verifier) || !isS256Challenge(challenge)) return false;
  const computed = createHash("sha256").update(verifier).digest("base64url");
  return computed === challenge;
}

export function scopesFrom(value: string | undefined): string[] {
  if (value === undefined || value.trim() === "") return [MCP_SCOPE];
  const requested = value.split(/[\s+]+/).filter((item) => item.length > 0);
  if (requested.every((scope) => scope === MCP_SCOPE || scope === "offline_access")) {
    return requested.includes(MCP_SCOPE) ? requested.filter((scope) => scope === MCP_SCOPE) : [MCP_SCOPE];
  }
  if (requested.includes(MCP_SCOPE)) return [MCP_SCOPE];
  throw new Error("invalid_scope");
}

function originMatchesAudience(audience: string, origin: string): boolean {
  try {
    const aud = new URL(audience);
    const base = new URL(origin.includes("://") ? origin : `http://${origin}`);
    return aud.protocol === base.protocol && aud.hostname === base.hostname;
  } catch {
    return false;
  }
}
