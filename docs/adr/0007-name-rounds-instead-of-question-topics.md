# 0007. Name rounds instead of question topics

- Status: accepted
- Date: 2026-11-07
- Scope: grill-flow

## Decision
Use `grill.roundNames` to describe the work in existing numbered rounds.
Remove Topic grouping; keep Round and Agent, preserving question memberships.
Owners may rename rounds inline; name events override writer names across reloads.
Store names in the existing event log rather than adding a table or browser-only state.
Persist grouping preference separately from grill content, falling back from old Topic to Round.
Show round context in the sidebar, page header and browser title.
