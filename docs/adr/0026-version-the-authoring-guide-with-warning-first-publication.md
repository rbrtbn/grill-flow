# 0026. Version the authoring guide with warning-first publication

- Status: accepted
- Date: 2026-11-08
- Scope: grill-flow

## Decision
The accepting host owns a complete authoring guide with an independent revision.
Bump that revision when guide rules change; conditional refresh replaces the whole guide.
Keep the installed skill as a bootstrap that refreshes before authoring writes.
Missing or stale revisions warn with the full guide; accepted content remains unchanged.
Keep objective validation and immutable item/drawing body replay checks intact.
Carry declared revisions as outbox metadata and exclude them from body replay identity.
Return host guidance and successful-import warnings in existing remote state.
Label cached or unverified guidance honestly; revision claims do not prove understanding.
Guide digests detect inconsistent caches; rejection needs a later owner decision.
