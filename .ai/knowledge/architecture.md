# Architecture

Load this document when choosing which layer a change belongs in.

This package is a hostable MCP server for **iCloud Calendar** (CalDAV VEVENT). Mail stays in
`mcpicloudmail`. Stdio is the local process transport. HTTP is Streamable HTTP at `/mcp` plus OAuth.

Upstream is iCloud CalDAV. Event calendars are VEVENT collections; VTODO on those returns HTTP 403.

Product identity lives in `src/version.ts`: package `mcpicloudcalendar`, product `iCloud Calendar`,
accent `#C9341C`. Default local HTTP port is `3848`. Docker binds `0.0.0.0:8080`.

## Entry points

- `src/index.ts` — CLI: stdio by default, `http` for the listener.
- `src/http-main.ts` — HTTP process. Refuses passwords on argv.
- `src/cli.ts` — `mcpicloudcalendar` / `mcpicloudcalendar http` help.
- `src/transport/stdio.ts` — stdio MCP. Uses env credentials. Must not speak OAuth.
- `src/transport/http.ts` — Express app, session map, Host allowlist, health.
- `src/transport/mcp-sessions.ts` — Streamable HTTP session table and sqlite restore.
- `src/auth/persist.ts` — durable OAuth clients, families, codes, CSRF.
- `src/lib/session-store.ts` — AES-GCM sqlite (`node:sqlite`, no extra package).
- `src/lib/durable.ts` — KV adapter over sqlite or memory.
- `src/auth/routes.ts` — OAuth HTTP surface and consent POST.
- `src/mcp/server.ts` and `src/mcp/catalog.ts` — MCP server and tool catalog.
- `src/auth/login-fields.ts` — the only login-question customization point.
- `src/caldav/client.ts` — `CalendarAccountClient`. Tools talk only to this.

## CalDAV modules

- `src/caldav/types.ts` — credentials, events, reminders, `CalDavDriver`, `CalendarAccountError`.
- `src/caldav/icloud.ts` — `https://caldav.icloud.com`, namespaces, object href helper.
- `src/caldav/ics.ts` — RFC 5545 parse/generate. Tools never parse ICS.
- `src/caldav/xml.ts` — PROPFIND/REPORT/MKCALENDAR/PROPPATCH builders and parsers.
- `src/caldav/http.ts` — Basic-auth `fetch` (Node 26). No axios, no tsdav.
- `src/caldav/driver.ts` — `HttpCalDavDriver` (live iCloud).
- `src/caldav/memory.ts` — `MemoryCalDavStore` for tests.
- `src/caldav/rrule.ts` — recurrence expansion used by agenda and `icloud_expand_recurrence`.

## Layering

```
src/tools/*  ->  CalendarAccountClient (src/caldav/client.ts)
             ->  CalDavDriver (HttpCalDavDriver or MemoryCalDavStore)
HttpCalDavDriver -> http.ts + xml.ts + ics.ts + fetch
MemoryCalDavStore -> in-memory collections + ICS objects
```

Tools never call `fetch`. Tests inject `MemoryCalDavStore` as `driver`.

## Tool domains

`tsup.config.ts` discovers `src/tools/*/index.ts` and regenerates `src/mcp/catalog.ts`. Priority
order: account, calendars, events, search, recurrence, attendees, alarms, reminders, sync.

All tool names are `icloud_*`. Writes need `confirm: true`. Instructions in `src/mcp/server.ts`.
`icloud_list_events` expands RRULE when start+end are set. `icloud_move_event` uses HTTP MOVE.
Undated Erinnerungen (no DUE) are listed by `icloud_undated` / `icloud_inbox` / `icloud_list_reminders`.

## Runtime dependencies

`@modelcontextprotocol/sdk`, `express`, `zod`, `fast-xml-parser`. ICS is custom. HTTP is `fetch`.
Do not add `tsdav`, `ical.js`, `imapflow`, `nodemailer`, or `axios` without an explicit need.

## Facts that are easy to get wrong

- HTTP Bearer must be an `mcp1.` session token from this host. The calendar app-specific password
  is not a connector credential.
- Tool handlers receive calendar credentials from the sealed login bag, never from the client.
- `src/mcp/catalog.ts` is generated. Do not edit it by hand.
- Tests live in `test/`, not under `src/`.
- `MCP_SESSION_STORE` overrides the sqlite path. Compose sets it to `/var/lib/mcp/sessions.sqlite`.
