# 0031. Keep grill revisions for history and audits

- Status: accepted
- Date: 2026-11-14
- Scope: grill-flow

## Decision
Every load appends the whole grill to `grill_revisions` as the next per-grill rev, with author
(`--session`, else `$HC_TERMINAL_ID`) and `--reason`, in the load's transaction. A grill stored
earlier becomes rev 1 on its next load; nothing backfills at start. History serves retros and
audits only: snapshots, polls and deliveries never read it; `gf history` and exports do.
Loads, items, drawings, rewrites and restores take `--reason`; a missing one warns until
`GF_REQUIRE_REASON=1` makes it a refusal. Each newly seen `decided` outcome is appended as a
`resolved` event and merged back into the snapshot, so a later load cannot erase it (amends
0027). The server writes an hourly `VACUUM INTO` copy to `data/backups/`, keeping 48.
