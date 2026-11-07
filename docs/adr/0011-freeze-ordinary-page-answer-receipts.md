# 0011. Freeze ordinary page answer receipts

- Status: accepted
- Date: 2026-11-07
- Scope: grill-flow

## Decision
Capture verified displayed wording with each new answer; reject stale revisions, retain legacy gaps.
Freeze all selected canonical source batches in one event transaction before terminal delivery.
Each source's submitted event ID identifies its immutable readback; delivery events are evidence.
Request IDs detect replay/conflict; replay never repeats transport. Missing delivery receipts stay
visible as unconfirmed sends on the page, including after a crash between commit and delivery.
`gf grant` reads evidence only: context/key/own/note are page words; message/lines confer no authority.
Canonical member grill plus submitted ID is the citation; shared page IDs cannot substitute for it.
PAGE activation and message-only eligibility remain at LAB-1310's gate; no marker activates here.
