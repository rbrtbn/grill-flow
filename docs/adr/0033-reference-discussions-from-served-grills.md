# 0033. Reference discussions from served grills

- Status: accepted
- Date: 2026-11-14
- Scope: grill-flow

## Decision
Discussions stay in the SQLite event store; no mirror folder. Served snapshots (`/api/grills`,
remote `state.json`) carry `discussions`: per question id (shared on a squad page) or whole
target, the reply target, ask/reply/open counts, `lastAt` and `firstAskId`, derived from the
snapshot's asks and revisions, so polls read no extra events and never touch revisions.
Grill writes (`gf load`, outbox load and import) drop a `discussions` key with one warning, so
a served grill copied back can neither write nor erase references. `gf export <id> [--out]` is
the full record for retros and audits: grill, revisions, threads, answers, sends, submissions,
retirement and events minus `reference-checked`; a squad page adds each member and its mapping.
