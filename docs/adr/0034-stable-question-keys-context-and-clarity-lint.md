# 0034. Stable question keys, context and a clarity lint

- Status: accepted
- Date: 2026-11-14
- Scope: grill-flow

## Decision
A question takes an optional `key` (kebab-case, 3–48 characters, unique in its grill) and
`context` (format 5). Writers check the key's form; once loaded it never changes, goes away or
names another question. `gf get`, `question` and `history` take it like an id; `[[key]]` links
in agent text, and a squad page shows a key two members share as `<member>/<key>` (amends 0008).
Each write lints the questions it adds or changes (bare Q numbers, forward references, undefined
ALL-CAPS terms, missing key or context) and warns; `GF_REQUIRE_CONTEXT=1` refuses missing context.
The plugin registers a fail-open hook denying edits of an existing `grills/<id>.json` in the
checkout, pointing to `gf question`/`gf patch`; unlike 0021's guard it is advisory, so it ships on.
