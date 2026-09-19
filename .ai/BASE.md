# Repository AI Context

This is the only always-loaded project entry point. Before work begins, the exhaustive
[context index](SUMMARY.md) must be inspected, and only documents whose activation conditions match
the task may be loaded.
This is agent-only context. `README.md` is the only human-facing package document. `.ai/` is the
integration and repository context for agents and must stay self-contained.

## Conduct and change discipline

- The user's authorized scope must be followed exactly. A read, diagnosis, or documentation task
  must not be broadened into an implementation change.
- Commits must not be created unless the user explicitly requests one.
- Unrelated files and existing user changes must be preserved and must not be discarded, rewritten,
  or cleaned up as a side effect.
- The current implementation must be inspected before adding a pattern, abstraction, library, or
  dependency. Existing project conventions and the source that owns the behavior should be
  preferred.
- Changes must remain focused. `src/mcp/catalog.ts` is generated from `src/tools` at build and must not be edited by hand.
- Secrets, tokens, passwords, and other sensitive data must not be exposed in source, fixtures,
  logs, diagnostics, or reports.
- Repository work must not be claimed or disclosed as assisted or generated in commits, pull
  requests, changelogs, documentation, or code comments unless explicitly requested.
- `Co-authored-by`, generated-by, assistant-attribution, and similar trailers must not be added.

## Authority and conflicts

Explicit task and safety constraints take precedence. This file supplies universal repository
rules; applicable Instructions are mandatory within their domains. Personas may add scrutiny but
must not override this file or an Instruction. For implementation facts, enforced configuration
and current code take precedence over explanatory documentation. If a material conflict remains
unresolved, work must stop and the user must be asked rather than a choice being made silently.

## Compact task routing

- For OAuth, consent HTML, login fields, tokens, redirects, Host checks, or HTTP transport,
  [MCP OAuth](instructions/mcp-oauth.md) must be loaded.
- For adding or changing tools, catalogs, write confirmation, or redaction,
  [tool safety](instructions/tool-safety.md) must be loaded.
- For Docker, compose, bind addresses, or production env,
  [production](knowledge/production.md) must be loaded.
- For changing `src/auth/login-fields.ts` or adding extra consent questions,
  [login fields](knowledge/login-fields.md) must be loaded.
- For changing the CalDAV client, ICS, tools, or runtime dependencies,
  [architecture](knowledge/architecture.md) must be loaded.
- For iCloud CalDAV discovery, ICS, or `src/caldav/` protocol work,
  [CalDAV](knowledge/caldav.md) must be loaded.
- For implementation, tests, or builds,
  [quality and testing](instructions/quality-testing.md) must be loaded.
- [AI context governance](AI.md) must be read only when modifying the `.ai/` system itself.
- [STYLE.md](STYLE.md) must always be loaded for consent-page UI, design, responsive, interaction,
  motion, or accessibility work.

The following context-selection sequence must be used:

1. The task and affected domains must be classified.
2. [SUMMARY.md](SUMMARY.md) must be inspected for relevant existing documents.
3. Applicable Knowledge and all mandatory domain Instructions must be loaded.
4. A Persona may be applied when its distinct review method adds useful scrutiny.
5. `STYLE.md` must always be loaded for UI work.
6. Validation and change-impact checks must be applied before completion.

## Completion

Work must be verified with the repository's actual checks in proportion to risk. The final change
set must be inspected to confirm that only authorized files changed; reports must distinguish checks
that ran from checks that could not run and identify remaining risks without claiming unperformed
validation.
