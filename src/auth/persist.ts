import type { LoginBag } from "./fields.js";
import { sweepExpired, type DurableKv } from "../lib/durable.js";

export const FAMILY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const CLIENT = "oauth:client:";
const FAMILY = "oauth:family:";
const CODE = "oauth:code:";
const CSRF = "oauth:csrf:";
const CSRF_CODE = "oauth:csrf-code:";

export type CsrfNonceState = "unused" | "used";

export interface OAuthClient {
  readonly client_id: string;
  readonly client_name?: string;
  readonly redirect_uris: readonly string[];
  readonly token_endpoint_auth_method?: string;
  readonly grant_types?: readonly string[];
  readonly response_types?: readonly string[];
  readonly client_id_issued_at?: number;
}

export interface AuthCode {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly codeChallenge: string;
  readonly resource: string;
  readonly scopes: readonly string[];
  readonly bag: LoginBag;
  readonly exp: number;
  used: boolean;
}

export interface Family {
  currentRefreshJti: string;
  revoked: boolean;
  exp: number;
}

export class OAuthPersist {
  private readonly store: DurableKv;
  private readonly clients: RecordCache<OAuthClient>;
  private readonly families: RecordCache<Family>;
  private readonly codes: RecordCache<AuthCode>;
  private readonly csrf: RecordCache<{ state: CsrfNonceState; exp: number }>;
  private readonly csrfCodes: RecordCache<{ code: string; exp: number }>;

  public constructor(store: DurableKv) {
    this.store = store;
    this.clients = new RecordCache(store, CLIENT, isClient);
    this.families = new RecordCache(store, FAMILY, isFamily);
    this.codes = new RecordCache(store, CODE, isCode);
    this.csrf = new RecordCache(store, CSRF, isCsrf);
    this.csrfCodes = new RecordCache(store, CSRF_CODE, isCsrfCode);
  }

  public saveClient(client: OAuthClient): void {
    this.clients.set(client.client_id, client);
  }

  public loadClient(id: string): OAuthClient | undefined {
    return this.clients.get(id);
  }

  public saveFamily(id: string, family: Family): void {
    this.families.set(id, family);
  }

  public loadFamily(id: string): Family | undefined {
    return this.families.get(id);
  }

  public saveCode(code: string, row: AuthCode): void {
    this.codes.set(code, row);
  }

  public loadCode(code: string): AuthCode | undefined {
    return this.codes.get(code);
  }

  public deleteCode(code: string): void {
    this.codes.delete(code);
  }

  public saveCsrf(nonce: string, row: { state: CsrfNonceState; exp: number }): void {
    this.csrf.set(nonce, row);
  }

  public loadCsrf(nonce: string): { state: CsrfNonceState; exp: number } | undefined {
    return this.csrf.get(nonce);
  }

  public saveCsrfCode(nonce: string, row: { code: string; exp: number }): void {
    this.csrfCodes.set(nonce, row);
  }

  public loadCsrfCode(nonce: string): { code: string; exp: number } | undefined {
    return this.csrfCodes.get(nonce);
  }

  public sweep(): void {
    this.codes.dropExpired();
    this.csrf.dropExpired();
    this.csrfCodes.dropExpired();
    this.families.dropExpired();
    sweepExpired(this.store, CODE);
    sweepExpired(this.store, CSRF);
    sweepExpired(this.store, CSRF_CODE);
    sweepExpired(this.store, FAMILY);
  }
}

class RecordCache<T> {
  private readonly rows = new Map<string, T>();

  public constructor(
    private readonly store: DurableKv,
    private readonly prefix: string,
    private readonly parse: (value: unknown) => T | undefined
  ) {}

  public get(id: string): T | undefined {
    const cached = this.rows.get(id);
    if (cached !== undefined) return this.alive(id, cached);
    const raw = this.store.get(this.prefix + id);
    if (raw === undefined) return undefined;
    try {
      const parsed = this.parse(JSON.parse(raw));
      if (parsed === undefined) return undefined;
      this.rows.set(id, parsed);
      return this.alive(id, parsed);
    } catch {
      return undefined;
    }
  }

  public set(id: string, value: T): void {
    this.rows.set(id, value);
    this.store.set(this.prefix + id, JSON.stringify(value));
  }

  public delete(id: string): void {
    this.rows.delete(id);
    this.store.delete(this.prefix + id);
  }

  public dropExpired(now = Date.now()): void {
    for (const [id, row] of this.rows) this.alive(id, row, now);
  }

  private alive(id: string, value: T, now = Date.now()): T | undefined {
    const exp = (value as { exp?: unknown }).exp;
    if (typeof exp === "number" && exp < now) {
      this.delete(id);
      return undefined;
    }
    return value;
  }
}

function isClient(value: unknown): OAuthClient | undefined {
  if (!isRecord(value) || typeof value.client_id !== "string" || !Array.isArray(value.redirect_uris)) {
    return undefined;
  }
  return value as unknown as OAuthClient;
}

function isFamily(value: unknown): Family | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.currentRefreshJti !== "string" || typeof value.revoked !== "boolean") return undefined;
  if (typeof value.exp !== "number") return undefined;
  return { currentRefreshJti: value.currentRefreshJti, revoked: value.revoked, exp: value.exp };
}

function isCode(value: unknown): AuthCode | undefined {
  if (!isRecord(value) || typeof value.clientId !== "string" || typeof value.exp !== "number") return undefined;
  return value as unknown as AuthCode;
}

function isCsrf(value: unknown): { state: CsrfNonceState; exp: number } | undefined {
  if (!isRecord(value) || typeof value.exp !== "number") return undefined;
  if (value.state !== "unused" && value.state !== "used") return undefined;
  return { state: value.state, exp: value.exp };
}

function isCsrfCode(value: unknown): { code: string; exp: number } | undefined {
  if (!isRecord(value) || typeof value.code !== "string" || typeof value.exp !== "number") return undefined;
  return { code: value.code, exp: value.exp };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
