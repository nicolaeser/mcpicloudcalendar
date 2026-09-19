---
type: instruction
description: Governs MCP tools, catalogs, confirm flags, and redaction.
scope: repository
---

# Tool safety

## Scope and activation

This Instruction must be loaded when adding, renaming, or changing tools, annotations, formatters,
or redaction.

## Mandatory rules

- Tools are defined with `defineTool` in `src/mcp/define-tool.ts`. Names must use the `icloud_`
  prefix. `src/mcp/catalog.ts` is generated from `src/tools/*/index.ts` at build and must not be
  edited by hand. Domain order is set in `tsup.config.ts`.
- Each domain folder must export `export const tools = [ ... ]` from `index.ts`.
- Tools call only `ctx.client` (`CalendarAccountClient`). They must not import `src/caldav/http.ts`,
  parse ICS, or call `fetch`.
- Write tools must require `confirm: true` via `confirmField` + `requireConfirm` and must no-op
  without it. Write prefixes in `hintsForName`:
  `create_|update_|delete_|move_|duplicate_|set_|invite_|remove_|rsvp|complete_|cancel_|put_`.
- Read-only prefixes: `list_|get_|search_|whoami|verify|agenda|freebusy|find_|expand_|sync_`.
- Tool output must pass `src/lib/redact.ts` with `ctx.secrets`. Tokens, passwords, and login-bag
  secrets must not appear in text returned to the model.
- Annotations must keep `readOnlyHint` / `destructiveHint` honest. Open-world tools stay
  `openWorldHint: true`. Destructive includes `delete` and `cancel`.
- Shared Zod: `calendarHrefField`, `eventUidField`, `isoTimeField` in `src/mcp/format.ts`.
- Do not log request bodies, Authorization headers, or login fields.

## Domains

| Folder | Tools |
| --- | --- |
| `account` | `icloud_whoami`, `icloud_verify`, `icloud_get_principal` |
| `calendars` | list/get/create/update/delete calendar, `icloud_get_ctag` |
| `events` | list/get/ics/create/update/delete/move/duplicate event |
| `search` | `icloud_search_events`, `icloud_agenda`, `icloud_freebusy`, `icloud_find_conflicts` |
| `recurrence` | expand, update occurrence, cancel occurrence |
| `attendees` | list, invite, remove, rsvp |
| `alarms` | list, set, remove |
| `sync` | `icloud_sync_changes` |

## Sources of truth

- `src/mcp/define-tool.ts`, `src/mcp/format.ts`, `src/mcp/server.ts` (`MCP_INSTRUCTIONS`),
  `src/lib/redact.ts`, `src/tools/`, `src/caldav/client.ts`.
