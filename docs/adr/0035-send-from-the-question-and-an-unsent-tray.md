# 0035. Send from the question and an unsent tray

- Status: accepted
- Date: 2026-11-14
- Scope: grill-flow

## Context
Owner ask 9673: answers sat unsent because Review & send was easy to forget and hard to sort
across rounds. Prototypes in `docs/research/2026-11-14-send-shortcuts.md`; Rob chose B plus C.

## Decision
A strip under each answer sends that answer (⌘↵) or its round (⇧⌘↵); the header's Review &
send becomes an "N unsent" counter opening a tray (u) with per-round and selected sends.
One-click sends post the existing `questions` subset through quick send's save-then-send, with
no covering message, after a 5 s hold the page shows with Undo; a later one joins the hold.
Leaving during the hold cancels it. Keep back marks drafts held on purpose, per grill in
browser storage (like read cursors, 0018): out of the count, nudges and Review's default
selection. A quiet minute after an answer edit nudges; a link to another page asks first.
Review & send stays for a message and cross-round picking; no server or schema change.

## Alternatives rejected
Send buttons on each sidebar row: too noisy in the queue. Confirm dialogs: two clicks per
send. A stored Keep back event: needs a schema change for a reader-local preference.
