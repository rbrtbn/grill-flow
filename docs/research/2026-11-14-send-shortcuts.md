# Sending answers without the Review page (ask 9673)

Date: 2026-11-14. Prototypes on branch `prototype/send-shortcuts`, `prototypes/send-shortcuts-{a,b,c}/`,
served on 127.0.0.1:4371-4373 (setup in `prototypes/send-shortcuts-shared/README.md`).

## The ask

Rob answers part of a round, holds the rest while waiting on an update, and forgets to press
Review & send. When older rounds also hold unsent drafts, the Review page makes him sort out
what to send and what to keep. He wants to send one answer, or a round's drafts, without going
through Review.

## What today's send path already gives us

- `POST /send` takes an optional `questions` subset (`server/sendSelection.ts`). The client
  sends every draft minus `workspace.excluded` (`sendDraftAnswers`, `src/main.ts`).
- A squad page splits the subset by member grill, freezes one submission per grill in one
  transaction, then delivers one message per asking session (`sendPageAnswers`,
  `server/squad.ts`; ADR 0005, 0011). Failed deliveries leave their answers unsent for retry.
- Quick send (Command-click on Review & send) first saves pending own-answer and note edits,
  then sends (`continueQuickSend`).

So every variant is a client-only change. The shared core is one message, roughly
`ClickedSendQuestions({ questions, origin })`, that runs quick send's save-then-send with an
explicit subset. `origin` says where to report the result (row, strip or tray). No server,
schema or receipt change for A or B.

Two gaps all variants share:

- `send === 'Sending'` blocks a second send until the first settles. One-click sends make
  overlapping sends likely, so the second one has to queue or its button has to show "waiting".
- Failure is reported page-wide (`latestSendState`). A per-answer send needs the failure shown
  where it was sent from, plus the existing "not delivered, still a draft" mark on each answer.

## The three variants

| | A · Send from the queue | B · Send where you answer | C · Unsent tray and nudge |
|---|---|---|---|
| Where | Send on each ready draft row, Send N on each round header | Strip under the answer: this answer, or the round | Header "N unsent" counter opens a tray |
| Who it goes to | Popover groups answers by recipient | Strip names the recipient; round button lists the split | Every tray row, plus the footer split |
| Safety | Confirm first (↵ / esc); no undo | 5 s hold with Undo (⌘Z) before freezing | Explicit send; leaving asks first |
| Forgetting | Not addressed: you have to look at the sidebar | Addressed at the moment you answer; an open question offers the round's drafts; other rounds' drafts are mentioned | Addressed most strongly: live counter, quiet-minute nudge, leave prompt |
| Keep vs send (older rounds) | Per round, by eye | "Clean-up also has 2 unsent drafts · Open · Send all 2" | Keep back marks a draft as deliberately held |
| Keyboard | ↵ / esc in the popover | ⌘↵ this answer, ⇧⌘↵ round, ⌘Z undo | u tray, ↑↓, space, k keep back, ⌘↵ send |
| Size (code + tests) | ~200 + ~120 | ~250 + ~150 | ~400 + ~200, plus a new persisted flag |

Estimates add the shared core (~100 + ~80) on top of each.

Honesty notes:

- A asks first because a delivered answer can't be recalled; Discussion is the follow-up.
- B's undo is real only while nothing has left the page. The hold lives in the browser: if the
  tab closes or the page navigates during it, the send is cancelled and the answer stays a
  draft, and the page says so. It must never send silently on unload.
- C's Keep back is a new per-draft state. Browser-local would hide it from other devices, so a
  real build stores it as a page event. That needs a decision record and should be checked in
  first.
- ⌘↵ on a question opens Review today (`PressedWorkspaceShortcut`). B changes it to "send this
  answer" only when the question has a ready draft, and keeps the old meaning otherwise.

## What happens to Review & send

It stays in every variant as the place for a covering message and for cross-round selection,
and Command-click quick send is unchanged. With B or C it stops being the only way to send.
Its header button could later shrink to a counter (C's shape) once the shortcuts carry most
sends.

## Recommendation

Build **B**, plus A's round-level **Send N** in the sidebar round header (no per-row buttons).

- B fixes the forgetting where it happens, after you answer. It covers the "waiting on an
  update" case directly: an open question you can't answer yet offers the round's ready drafts.
- The round header button is a cheap second entry point on the same path. Per-row buttons
  crowd a queue that already carries urgency and time marks.
- The 5 s hold avoids a confirm dialog on every send and stays honest.
- Leave C's Keep back and nudges until we see whether B is enough. They add a persisted state
  and reminders that nag, for a problem B mostly solves.

Size if chosen: shared core plus B plus the round button, about 400 lines of code and 280 of
tests across `src/main.ts`, `src/workspaceView.ts` and new story/scene tests. No server change.
