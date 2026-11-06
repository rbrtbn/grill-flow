# Question workspace implementation

Source design: `prototype/squad-conversations`, chosen edition at `a95f7c3`.
The independent teaching session is Herdr `t9s`, UI Language Lab; it does not own grill-flow.

## Implemented

- One question per route, with full options, consequences and reasoning in a single reading flow.
- Previous/next click targets fill the reading gutters; chevrons center in both axes. The native
  scrollbar sits outside those targets. Discuss stays clear of it and lines up with Close.
- Search and explicit All/Open/Draft/Sent filters; questions grouped by round, completed rounds
  collapsible. Next follows the filter even after answering removes the current question from it.
- Existing Markdown, Linear references, source/card links, definitions, comparisons, diagrams,
  notes, own answers, skips, dependencies, rewrite diffs and browser history reuse the original
  rendering and event model. Old concept, card, issue and urgency URLs still work.
- Resizable navigation and discussion; keyboard resizing and saved widths are retained. The
  discussion can expand into the content area. Full conversations show the question and an
  optional list of answer choices.
- Saved question and whole-run discussions use `asked` and `gf revise --kind comment`; the
  whole-run target is `run`. This does not send typed grants on the user's behalf.
- Review shows human-readable answers, selection checkboxes, a visible message composer and
  Discuss. Cmd/Ctrl+Enter opens Review from a question and sends its selection from Review.
- Sends validate selected answers, reject stale reviewed lines and mark only delivered lines
  sent. Legacy send requests retain their original behavior.
- Failed writes keep local answers and offer Retry saving. Sending waits for saves to finish.
- Settings retain highlighting and round-collapse preferences; Escape, Close and outside clicks
  close the accessible dialog and return focus to its trigger.
- Overview uses the grill's introduction and concept map. Run overview tabulates supplied plan
  issues and sessions. Needs you derives its list from actual question dependencies.

## Data boundary

No new dependency or database schema. No squad-repo changes or Linear writes.
The existing format has no live owner-step list, lead-routing address or aggregate squad-status
feed. Those integrations were raised with Rob separately and are not fabricated in this build.
Session/card links render only when the grill supplies them. This implementation covers the
existing grill data and transport; the broader squad workspace remains a separate integration.
Rewrites compare prose as in the original app; changing a label under the same answer key does
not automatically require reconfirmation. Removed answer keys cannot be selected for Send.

## Preview isolation

Use a copied database in this worktree, then run:

```sh
GF_PORT=4330 GF_PREVIEW=1 bun run serve
```

`GF_PREVIEW=1` disables remote polling and sends to sessions, and labels the page as a local
copy. A non-default port uses a separate write-cookie name because browser cookies ignore ports.
Herdr terminal `grill-workspace-preview` keeps this preview running after the coding turn.
Do not use `bun run dev` in the main checkout or change the live server on 4317.
The Vite cache is worktree-local; dependencies reuse the existing installation.

## Validation

`bun run typecheck`, `bun run typecheck:server`, `bun run build`, and `bun run test`.
State and view tests cover filtered navigation, selection and failed-send retention, failed-save
recovery, conversation context, settings dismissal, Cmd/Ctrl+Enter and 30/60 question lists.
Server tests cover selected delivery, older-round drafts, invalid/stale selections, legacy sends,
and whole-run asks/comments. The full repository lint command has pre-existing failures in
legacy casts, record spreads and Command names. The baseline and implementation each report
the same 27 lint findings; the new workspace files pass lint. Wrapcheck reports only earlier
research-file findings, with no findings in this implementation.
131 tests pass (103 client, 28 server), both type checks pass, and the build passes.
The isolated HTTP smoke passed: per-port cookie, rejected unauthorized write, selected-answer
send, retained unchecked draft after reload, stale/empty-selection rejection, and a whole-run
ask answered through the CLI. No session delivery or remote polling ran in the preview.
Browser and native CUA access were unavailable in this session. The page was opened in Chrome,
but visual verification remains unperformed; do not treat the state/view tests as pixel checks.

## Deferred design artifacts

Impeccable's PRODUCT/DESIGN context still describes the original reading-page model. Updating
that product scope was left pending Rob's answer during init; it is not silently rewritten here.
The prototype critique and its alternative remain on the prototype branch. The chosen edition
was used for implementation; this branch does not silently promote every critique alternative.
