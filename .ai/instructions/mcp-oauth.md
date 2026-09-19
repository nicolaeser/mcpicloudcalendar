---
type: instruction
description: Governs OAuth, consent, redirects, and HTTP host checks.
scope: repository
---

# MCP OAuth

## Scope and activation

This Instruction must be loaded for authentication, consent HTML, tokens, redirects, Host
headers, or HTTP transport work.

## Mandatory rules

- HTTP `/mcp` must reject any Bearer that is not an `mcp1.` access token issued by this process.
  The iCloud app-specific password must not authenticate the connector.
- Stdio must keep using `ICLOUD_EMAIL` and `ICLOUD_APP_PASSWORD` and must not speak OAuth.
- Authorization code + S256 PKCE is required. Other `response_type` and challenge methods must
  fail.
- Redirect URIs must pass `src/auth/redirects.ts`. Open redirects on error paths are forbidden.
- Consent HTML must escape every untrusted string. CSRF must bind client, redirect, and challenge.
- `/authorize` is `src/auth/consent.html` filled by `src/auth/consent.ts`. Do not return the page
  from a TypeScript string. No fake logos. `<!--slot:clientName-->` is the OAuth client, not the
  upstream brand.
- When `MCP_AUTH_PASSWORD` is set, the server password is a second step (Continue, then Authorize).
- Operator password compare must stay timing-safe (`safeEqualText` in `src/auth/crypto.ts`).
- Access tokens must stay audience-bound to this MCP origin. Refresh reuse must revoke the family.
- Login secrets must be encrypted into the token bag. They must not appear in tool text or logs.
- When HTTP is exposed or `NODE_ENV=production`, `src/auth/production.ts` must refuse a missing
  OAuth secret, public URL, or operator password (unless `MCP_ALLOW_OPEN_CONSENT=1`).
- `publicOrigin` must use `MCP_PUBLIC_URL` when set and must not trust `X-Forwarded-Host` as the
  issuer when it is unset. A configured public URL must be stored as `URL.origin` (path stripped).
- Authorization codes must lock the CSRF nonce (`consumeCsrf` returns false on reuse) before any
  await, including upstream token probes.
- Token endpoint auth methods advertised to connectors must be `none` (public PKCE). Do not advertise
  `client_secret_post` unless `/token` actually authenticates a secret.
- A mismatched RFC 8707 `resource` must fail with `invalid_target`, not be rewritten to this server.
- `/mcp` Host headers must match loopback or the configured public hostname. Binding `0.0.0.0`
  must not disable the allowlist.
- Dynamic registration must drop unknown redirect URIs rather than persist them.

## Sources of truth

- Service: `src/auth/service.ts`, `src/auth/tokens.ts`, `src/auth/routes.ts`.
- Consent: `src/auth/consent.html` (previewable branded page), `src/auth/consent.ts` (slot fill), `src/auth/login-fields.ts`.
- Transport: `src/auth/resolve.ts`, `src/transport/http.ts`, `src/auth/origin.ts`.
