# Auth model

Load this document when credentials, tokens, or connector clients change.

HTTP is OAuth 2.1 authorization code + S256 PKCE. Access and refresh tokens are HMAC-signed
`mcp1.` blobs. The login bag is encrypted into the token so Grok, Claude, and Codex never store
the calendar app-specific password. There is no mailbox or SMTP password.

## Modes

Visible consent fields come from `visibleLoginFields` in `src/auth/service.ts`:

When `MCP_AUTH_PASSWORD` is set, `/authorize` is two steps: login fields (**Continue**), then
**Server password** (**Authorize**). Skip step 1 if no login fields are visible.

- No `MCP_AUTH_PASSWORD`: each user must submit iCloud address and calendar app-specific password.
- `MCP_AUTH_PASSWORD` plus env fallbacks: consent shows the operator password; secrets come from env.
- `MCP_AUTH_PASSWORD` without env fallbacks: password plus login secrets.

Stdio ignores OAuth and reads `ICLOUD_EMAIL` / `ICLOUD_APP_PASSWORD`. `MCP_AUTH=bearer` is not a
supported mode. HTTP tools recover `CalendarCredentials` via `credentialsFromBag`.

## Token rules

- Authorization codes are single-use with a 5-minute TTL.
- Refresh tokens rotate; reuse of a previous `jti` revokes the family.
- Access tokens are audience-bound to this MCP origin + `/mcp`.
- Redirect URIs are allowlisted in `src/auth/redirects.ts` (HTTPS callback paths, loopback HTTP,
  Cursor `cursor:` callback).
- Dynamic clients are public (`token_endpoint_auth_method: none`) unless they register a secret.
