import { WWW_AUTHENTICATE, WWW_AUTHENTICATE_INVALID } from "../config.js";

export type ParsedCredentials =
  | { readonly ok: true; readonly token: string }
  | { readonly ok: false; readonly code: "missing" | "invalid"; readonly wwwAuthenticate: string };

export function parseHttpCredentials(headers: HeadersLike): ParsedCredentials {
  const authorization = headerValue(headers, "authorization");
  if (authorization !== undefined) return parseAuthorization(authorization);
  return { ok: false, code: "missing", wwwAuthenticate: WWW_AUTHENTICATE };
}

function parseAuthorization(value: string): ParsedCredentials {
  const trimmed = value.trim();
  const bearer = /^(Bearer)(?:\s+(.*))?$/i.exec(trimmed);
  if (bearer) {
    const token = bearer[2]?.trim() ?? "";
    if (token.length === 0) {
      return { ok: false, code: "invalid", wwwAuthenticate: WWW_AUTHENTICATE_INVALID };
    }
    return { ok: true, token };
  }
  if (trimmed.length === 0 || /^[A-Za-z]+\s/.test(trimmed)) {
    return { ok: false, code: "invalid", wwwAuthenticate: WWW_AUTHENTICATE_INVALID };
  }
  return { ok: true, token: trimmed };
}

type HeadersLike = { readonly [key: string]: string | string[] | undefined } | Headers;

function headerValue(headers: HeadersLike, name: string): string | undefined {
  if (typeof (headers as Headers).get === "function") {
    const value = (headers as Headers).get(name);
    return value === null ? undefined : value;
  }
  const record = headers as { readonly [key: string]: string | string[] | undefined };
  const direct = record[name] ?? record[name.toLowerCase()];
  return Array.isArray(direct) ? direct[0] : direct;
}
