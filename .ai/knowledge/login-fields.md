# Login fields

Load this document when adding or changing consent questions.

`src/auth/login-fields.ts` is the only customization point for extra OAuth questions. Do not fork
`src/auth/consent.ts`, `src/auth/service.ts`, `src/auth/routes.ts`, `src/auth/tokens.ts`, or
`src/auth/fields.ts` to add a field. Visual branding of `/authorize` lives in `src/auth/consent.html`
(open it in a browser to preview). When `MCP_AUTH_PASSWORD` is set, the server password is a
separate Continue → Authorize step. `<!--slot:clientName-->` is the OAuth client, not the calendar
account.

This package defines two fields only:

- `email` — required iCloud address, claim, `ICLOUD_EMAIL`, prompt if-missing, autocomplete username.
- `appPassword` — required secret app-specific password, `ICLOUD_APP_PASSWORD`, prompt if-missing.

There is no `fromAddress` and no `ICLOUD_FROM`. Calendar has no sender alias.

`CalendarEnv` is `{ email?, appPassword? }`. CalDAV (`https://caldav.icloud.com`) is hardcoded in
`src/caldav/icloud.ts`. Discovery follows `.well-known/caldav` and `DAV:current-user-principal`.

`credentialsFromBag` is the only assembler. It returns `CalendarCredentials | undefined`
(`email`, `password`, `caldavUrl`, `username`). `icloud_whoami` returns those claims and never the
password.

## Field contract

Owned by `src/auth/fields.ts`:

- `name` must match `^[A-Za-z][A-Za-z0-9_]{0,63}$` and must not be `operator_password`.
- `secret: true` values go into `bag.secrets`. They are normalized with `normalizeSecretToken`
  (trim, strip wrapping quotes, strip a leading `Bearer`/`Token` prefix).
- `secret: false` (or omitted) values go into `bag.claims` after trim only. Tools may show claims.
- `envFallback` names the process env var that fills the field when the consent form omits it.
- `prompt: "always" | "if-missing" | "never"` controls consent visibility. The default is
  `"if-missing"` when `envFallback` is set, otherwise `"always"`.
- Select fields require `options`. Values longer than 512 characters are rejected.

`collectLoginBag` is the only splitter. A secret must not be stored in `claims`; a claim must not
be stored in `secrets`.

## Env fallback and consent visibility

`visibleLoginFields` in `src/auth/service.ts` is what `/authorize` renders:

When `MCP_AUTH_PASSWORD` is set, `/authorize` is two steps: login fields (**Continue**), then
**Server password** (**Authorize**). Skip step 1 if no login fields are visible.

- No `MCP_AUTH_PASSWORD`: login fields are forced to `prompt: "always"`.
- `MCP_AUTH_PASSWORD` plus env fallbacks: consent shows the operator password; secrets come from env.
- `MCP_AUTH_PASSWORD` without env fallbacks: password plus login secrets.

Stdio ignores OAuth and reads env (`src/transport/stdio.ts`). HTTP tools read the sealed bag.

## Extra questions at OAuth consent

`src/auth/consent.ts` prefixes form names with `login_`. `submittedLoginFields` strips that
prefix before `collectBag`. Extra questions must be declared on `loginFields()`; they appear
automatically. Secrets must not be prefilled. Password fields must set `autocomplete` from the
field object. The operator password is not a login field.

## Encrypting the bag into the access token

`completeAuthorization` stores the `LoginBag` on the one-time code. `issuePair` in
`src/auth/tokens.ts` AES-256-GCM-encrypts that JSON into `claims.bag` on both the access token
and the refresh token (`mcp1.` HMAC envelope). The OAuth token JSON must not contain plaintext
calendar secrets. `verifyAccess` / `openBag` decrypts on this host only. Grok, Claude, Cursor,
and Codex receive the session token, never `bag.secrets`.

`resolveHttpAuth` in `src/auth/resolve.ts` recovers credentials via `credentialsFromBag` and puts
every `bag.secrets` value on `ctx.secrets`. Tools use `ctx.client` and `ctx.bag.claims`.

## Never log or return secrets

- Do not log request bodies, `Authorization` headers, login field values, or the decrypted bag.
- Tool output must pass `src/lib/redact.ts` with `ctx.secrets`. Login-bag secrets must not appear
  in text returned to the model.
- Consent HTML, health, and authorize stderr (`auth.authorize ok client=…`) must not print
  tokens, passwords, or field values.
