---
type: instruction
description: Governs validation; load for code, tests, or builds.
scope: repository
---

# Quality and testing

## Scope and activation

This Instruction must be loaded for every implementation change and whenever tests or builds
are modified.

## Mandatory rules

- Validation must be proportional to risk and must exercise the public or wire-visible behavior
  affected by the change. A bug fix must include a regression test at the narrowest stable layer.
- Source and test code must continue to pass the strict compiler settings in `tsconfig.json`
  (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`).
- Tests live in `test/`. Vitest include is `test/**/*.test.ts`. Do not colocate `*.test.ts` under
  `src/`. Helpers live in `test/helpers.ts`.
- Runtime tests in the default suite must be deterministic, make no live CalDAV or iCloud
  requests, and require no real credentials. Inject `MemoryCalDavStore` as `driver`.
- Test fixtures, diagnostics, and logs must not contain real tokens, passwords, or production
  data. Fake secrets are `cal-user@icloud.com` / `abcd-efgh-ijkl-mnop`.
- A check must be reported as passing only when it was run successfully in the current workspace;
  otherwise report it as not run or blocked, with the reason.
- `npm run check` is typecheck + test + build. `tsup.config.ts` regenerates `src/mcp/catalog.ts`
  on build.

## Suite

- `test/oauth.test.ts` — HTTP OAuth, Host allowlist, stolen app-specific password as Bearer is 401,
  realm `mcpicloudcalendar`.
- `test/config.production.test.ts` — fail-closed production HTTP, `MCP_SESSION_STORE`.
- `test/login-fields.test.ts` — email + appPassword only, CalDAV URL, no `fromAddress`.
- `test/consent.test.ts` — consent HTML escaping and slots.
- `test/calendar-tools.test.ts` — tools/list, whoami, calendars, confirm, events.
- `test/ics.test.ts`, `test/xml.test.ts`, `test/http.test.ts`, `test/rrule.test.ts` — CalDAV units
  with fake fetch / fixtures.

## Sources of truth

- Commands: `package.json#scripts`.
- Compiler: `tsconfig.json`.
- Runner: `vitest.config.ts`.
