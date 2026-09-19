import { decryptString, encryptString, randomId, sign, verifyHmac } from "./crypto.js";
import type { LoginBag } from "./fields.js";

const PREFIX = "mcp1";

export type TokenKind = "access" | "refresh";

export interface TokenClaims {
  readonly v: 1;
  readonly typ: TokenKind;
  readonly jti: string;
  readonly fam: string;
  readonly cid: string;
  readonly aud: string;
  readonly scp: readonly string[];
  readonly iat: number;
  readonly exp: number;
  readonly bag: string;
}

export function looksLikeMcpToken(token: string): boolean {
  return token.startsWith(`${PREFIX}.`);
}

function encodeToken(secret: string, claims: TokenClaims): string {
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const mac = sign(secret, `${PREFIX}.${payload}`);
  return `${PREFIX}.${payload}.${mac}`;
}

export function decodeToken(secret: string, token: string): TokenClaims | undefined {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== PREFIX) return undefined;
  const payload = parts[1];
  const mac = parts[2];
  if (payload === undefined || mac === undefined) return undefined;
  if (!verifyHmac(secret, `${PREFIX}.${payload}`, mac)) return undefined;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as TokenClaims;
    if (claims.v !== 1) return undefined;
    if (typeof claims.exp !== "number" || claims.exp * 1000 < Date.now()) return undefined;
    if (claims.typ !== "access" && claims.typ !== "refresh") return undefined;
    return claims;
  } catch {
    return undefined;
  }
}

function sealBag(secret: string, bag: LoginBag): string {
  return encryptString(secret, JSON.stringify(bag));
}

export function openBag(secret: string, blob: string): LoginBag {
  const parsed = JSON.parse(decryptString(secret, blob)) as {
    secrets?: Record<string, string>;
    claims?: Record<string, string>;
  };
  return {
    secrets: parsed.secrets ?? {},
    claims: parsed.claims ?? {}
  };
}

export function issuePair(
  secret: string,
  input: {
    readonly clientId: string;
    readonly audience: string;
    readonly scopes: readonly string[];
    readonly bag: LoginBag;
    readonly familyId?: string;
    readonly accessTtlSec?: number;
    readonly refreshTtlSec?: number;
  }
): { accessToken: string; refreshToken: string; expiresIn: number; familyId: string; refreshJti: string } {
  const now = Math.floor(Date.now() / 1000);
  const accessTtl = input.accessTtlSec ?? 3600;
  const refreshTtl = input.refreshTtlSec ?? 60 * 60 * 24 * 30;
  const familyId = input.familyId ?? randomId(16);
  const bag = sealBag(secret, input.bag);
  const accessJti = randomId(16);
  const refreshJti = randomId(16);
  const access = encodeToken(secret, {
    v: 1,
    typ: "access",
    jti: accessJti,
    fam: familyId,
    cid: input.clientId,
    aud: input.audience,
    scp: [...input.scopes],
    iat: now,
    exp: now + accessTtl,
    bag
  });
  const refresh = encodeToken(secret, {
    v: 1,
    typ: "refresh",
    jti: refreshJti,
    fam: familyId,
    cid: input.clientId,
    aud: input.audience,
    scp: [...input.scopes],
    iat: now,
    exp: now + refreshTtl,
    bag
  });
  return {
    accessToken: access,
    refreshToken: refresh,
    expiresIn: accessTtl,
    familyId,
    refreshJti
  };
}
