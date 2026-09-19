# AI Context Index

This is the exhaustive index of active `.ai/` Markdown context; load entries only when their
stated activation matches the task.

This package is **mcpicloudcalendar**: iCloud Calendar over CalDAV. Stdio or HTTP `/mcp`.

## Core

- [BASE.md](BASE.md) — Defines universal conduct, safety, precedence, compact routing, and
  completion expectations and must be loaded before every repository task.
- [AI.md](AI.md) — Governs the context system and must be loaded only when auditing or modifying
  `.ai/`, root adapters, or legacy instruction and style surfaces.
- [STYLE.md](STYLE.md) — Defines the consent-page visual contract and must be loaded for
  documentation presentation or any UI, design, responsive, interaction, motion, or accessibility
  work.

## Knowledge

- [architecture.md](knowledge/architecture.md) — Maps stdio vs HTTP, the CalDAV client, tool
  domains, and process entry points and must be loaded when choosing where a change belongs.
- [caldav.md](knowledge/caldav.md) — Records iCloud CalDAV discovery, ICS, and driver facts and
  must be loaded when changing `src/caldav/`.
- [auth-model.md](knowledge/auth-model.md) — Records the OAuth session model and must be loaded
  when credentials, tokens, or connector clients change.
- [login-fields.md](knowledge/login-fields.md) — Explains `src/auth/login-fields.ts` as the only
  login customization point (email + app-specific password) and must be loaded when adding
  consent questions.
- [production.md](knowledge/production.md) — Records fail-closed HTTP deploy rules, GHCR compose,
  and `MCP_SESSION_STORE` and must be loaded for Docker, compose, bind addresses, or production env.

## Instructions

- [quality-testing.md](instructions/quality-testing.md) — Defines mandatory validation. Tests live
  in `test/`. Must be loaded for implementation, tests, builds, packaging, or CI.
- [mcp-oauth.md](instructions/mcp-oauth.md) — Defines mandatory OAuth, consent, redirect, and Host
  rules and must be loaded for authentication or HTTP transport work.
- [tool-safety.md](instructions/tool-safety.md) — Defines mandatory tool catalog, confirm, and
  redaction rules for `icloud_*` calendar tools and must be loaded when adding or changing tools.

## Personas

- [application-security-reviewer.md](personas/application-security-reviewer.md) — Defines the
  credential trust-flow review method and must be loaded when that lens is applied to auth,
  transport, logs, or secrets.
- [mcp-connector-reviewer.md](personas/mcp-connector-reviewer.md) — Defines the Grok/Claude/Codex
  connector review method and must be loaded when that lens is applied to OAuth discovery or
  `/mcp`.
