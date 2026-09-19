# AI Context System Governance

This manual applies only when auditing or modifying `.ai/`, the root adapters, or a tracked legacy
instruction/style surface. It is not ordinary implementation context.

The `.ai/` tree is agent-only repository context shipped in this repository. This package is
**mcpicloudcalendar** (iCloud Calendar over CalDAV). The only human-facing package document is
`README.md`. Active context must cite implementation, tests, examples, and enforced configuration
rather than a second prose documentation tree.

## Purpose and authority

The mandatory core is:

- `BASE.md`: the concise, always-loaded conduct, safety, precedence, and routing entry point.
- `AI.md`: governance for creating, changing, auditing, and retiring context.
- `STYLE.md`: the authoritative visual, interaction, responsive, motion, and accessibility contract
  for the OAuth consent page.
- `SUMMARY.md`: the exhaustive discovery index for every other active `.ai/` Markdown document.

Optional categories have distinct authority:

- **Knowledge** records verified terminology, system facts, decisions, current limitations, and
  durable experience. It describes what is true and cites non-obvious evidence.
- **Instructions** define persistent mandatory rules for stable, broad engineering domains.
- **Personas** provide optional specialist review methods that apply authoritative rules without
  duplicating them.

`BASE.md` and applicable Instructions are mandatory. A Persona must not override them. Canonical
implementation and enforced configuration own runtime facts.

## Evidence gate

An optional document may be created or retained only when all of these conditions hold:

1. It has a distinct activation condition likely to recur in repository work.
2. One authoritative enforced source or multiple consistent current sources support it.
3. It materially improves implementation, review, debugging, or operational reliability.
4. Its authoritative content is not already covered adequately by an active `.ai/` document or a
   canonical repository source.
5. It can remain concise, actionable, and repository-specific without generic filler.

## Naming and document form

- Active context must be written in concise professional English. Commands, identifiers, paths, and
  product terms must be preserved when translation would change them.
- Optional documents must use lowercase kebab-case filenames and normal relative Markdown links
  inside `.ai/`. `@path` imports must be reserved for the root `CLAUDE.md` adapter.
- **Must**, **must not**, **should**, and **may** must be used consistently.
- Implementation evidence must cite repository-root paths in backticks.
- Active context must not include empty headings, speculative history, private machine paths,
  credentials, personal data, generic best practices, or motivational prose.

## Root adapters

When no verified externally managed block must remain, the default root adapters are exactly:

```text
Read and follow @.ai/BASE.md completely before doing any work.
```

for `AGENTS.md`, and:

```text
@.ai/BASE.md
```

for `CLAUDE.md`.

## Creating, changing, and retiring documents

1. Current implementation, configuration, tests, documentation, and every active `.ai/` document
   must be audited before a change is proposed.
2. The evidence gate must be applied.
3. An existing document must be updated when its activation and ownership still fit.
4. Documents that normally load together and overlap must be merged.
5. Each rule or fact must have one authoritative home.
6. `SUMMARY.md` must be updated in the same change.
7. A commit must not be created as part of context maintenance unless the user explicitly requests
   it.
