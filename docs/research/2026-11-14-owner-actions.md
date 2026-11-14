# Owner actions: one place for what is waiting on Rob

Date: 2026-11-14 · Author: t2j5 · Asks: grill-flow 9612, 9623 on `/g/squad`
Prototypes: branch `prototype/owner-actions`, `bun prototypes/owner-actions-serve.ts`
(A <http://127.0.0.1:4351/>, B <http://127.0.0.1:4352/>, C <http://127.0.0.1:4353/>).

## What Rob asked

Rob's to-dos reach him as questions. Two examples are Q314 (t2hq's "Open for you", answered
"Seen") and Q196 (t1mn's digest, "Fine as routed"). They go stale and are hard to find. Some
answers also carry a follow-up for later. On Q380 his note says: if the fix needs a grant
change, tell me the prompt and which agent to send it to. Nothing on the page tracks that
promise. He wants one list of actions waiting on him with a count in the header, follow-ups
linked to the question they came from, and a button wherever the squad would accept one.

## What exists, and what the live data shows

- `owner-step` items (ADR 0012, 0014) already hold one action: host, destination (a link or a
  local `tN`), action, urgency, blockers, and progress from open to completed (with proof) or
  withdrawn. Needs you counts them. The page can copy an action and focus a terminal (the
  `owner-focused` event runs fixed argv). Neither one counts as completion.
- Before ask 9621, only three owner steps had ever been published on `/g/squad`, all by
  grill-flow's builder. Everything else went into questions or into the 55 `update` items,
  which are long progress logs. After ask 9621 (2026-11-14 02:34Z), t2hq split Q314 into eight
  owner steps and t2cr added two. Those ten items are the prototypes' sample data. They show
  where the schema falls short:
  - **The hold has no kind.** "Don't update or reload the squad plugin" is the first line of an
    `update` body. Meanwhile `merge-grill-mod` asks Rob to run `/reload-plugins`, which that
    hold forbids, and nothing connects the two.
  - **`action` mixes instructions with the text to paste.** For the `type-card-*` steps it is
    the exact line. For `merge-gf-19` it reads "Merge the PR, then run: bash …". The page
    can't offer a clean copy of the command, or show several steps as a list.
  - **Nothing links a step to the answer that produced it.** The type-card steps exist because
    a page pick only counts once Rob types it. The step doesn't name the card or question, so
    the page can't show "your pick, now type it" next to the answer.
  - **A follow-up has no state.** Q380's promise ("tell me once the fix lands") can't be an
    owner step yet, because the step's content doesn't exist until later.
  - **Nothing marks status as stale.** Q196 still looks current five days after t1mn handed
    the lead to t2cr.

## What a button may do for Rob

Squad ADR 0042 and 0053, and the rbrtbn profile (`grant_sources: desktop+cli`, no `page`):

| Button | Who acts | Squad accepts it? |
| --- | --- | --- |
| Copy the line, open the PR or issue | the browser | Needs no authority. Copying is not completing. |
| Focus `tN` | grill-flow, through `herdr-app do agent.focus` (fixed argv) | Needs no authority. Rob then pastes and presses Enter. A pasted line counts as `TYPED via paste` (formats-state.md). |
| Turn on browser notifications | the browser | Needs no authority. |
| I did it | the page records an owner report and delivers it to the asker | Counts as an owner report, not completion (ADR 0014). The agent checks and publishes proof. |
| Answer on the page (grant) | a normal page answer to a question the agent named, which the agent reads with `gf grant` | Counts as a `PAGE` citation only once `grant_sources` lists `page` (with `page_actor`), and that is Rob's setting. Even then it never backs lead transfer, activation, gh approval, Cap merges, or merges touching design-gate group 2/3 paths. Today it reads as NOT PAGE, so the button shows "type it in tN". |
| Type into a session for Rob (`hc send` the grant text) | grill-flow | **Refused.** An `hc send` wrapper is never Rob's words (ADR 0042 R10). It would also let any local process forge a grant. |
| Run a merge, script, install or settings change | grill-flow | **Never.** The page has no authority (ADR 0012, 0014). Merges go through the agent that holds the grant. Scripts, hooks, settings and restarts stay as instructions plus a copy box. |

So a one-click grant runs through the asking agent: the agent offers a page answer only where
its own gate accepts PAGE for that action. Grill-flow never decides authority, and every other
step stays as instructions. For squad#157 (a Cap merge that changes `merging.md`), the step
names the reason, so Rob sees why there's no button.

## Prototypes

All three share the same in-memory data (the live items above, Q380's note and the Q196
digest) and the same floating bar. The bar switches variants with ← and →, simulates
"squad#157 merges" (which fills in Q380's follow-up), "agents post proof", "hold clears" and
the `grant_sources` setting, and opens a state drawer that lists every item's progress and
event. `?sim=merge157,togglePageGrants` replays simulations from a link.

- **A · One list** (4351). Needs you and Updates merge into **Waiting on you**. Active holds
  come first, then Do now, When you're ready, Questions to answer (counted and linked),
  Whenever, Coming back to you (promised follow-ups), Checking (reported, awaiting proof),
  Where runs stand (one current status per run, stale ones struck through), and Done. The
  header shows "Waiting on you · N" next to "Questions · M".
- **B · By place** (4352). "To do" is grouped by where Rob acts: In t2hq, In t2cr, On GitHub,
  In Linear, On this page. A trip to t2hq focuses once and lists every line in order. A detail
  sheet shows what, where, unblocks, steps, route and history. Status stays a separate page,
  which makes the case for keeping Updates apart. It has one card per run, holds on top and
  stale cards dashed.
- **C · By conversation** (4353). There is one lane per session. Each lane says what it is
  waiting on ("you (7) · squad#157 merges and LAB-1449 lands"), then shows its holds, its
  status and a thread per step: your answer or page pick → the step. Q380's note shows as a
  promise that fills in. A header tray ("On you 6 +4 ⏸1") lists everything from any page.

**Recommendation: A's page, with C's origin line and B's grouping as a sort option.** A
removes the question of which page to open: there is one destination, and its count means
"things to do". C's threads read well, but scanning four lanes is slow once runs multiply. B
is fastest at the terminal, but keeping Status apart brings back two pages. Two parts are
worth borrowing: the "From your answer Q380" origin line (already in A's expanded rows), and
B's per-session batch with a single Focus as an optional grouping.

## Proposed model

1. **Keep `owner-step` for actions.** Add optional fields, so older items still load:
   - `copy`: the exact text to paste or run. `action` stays the instruction.
   - `steps`: `[{text, copy?, link?, heldBy?}]`, for "merge, then run X".
   - `answer`: `{question, event}`, the source question id or key and the answer event that
     created the step. The question view lists its follow-ups from this, and the step shows
     "From your answer".
   - `pageAnswer`: `{question, option}`. The agent sets it only when its gate would accept a
     PAGE citation for this action. The page then offers "Answer on page", which records and
     sends that answer through the normal send path.
   - `progress` gains `{state: "promised", until: Text}`. This is a follow-up the agent owes
     ("when squad#157 merges"). It shows under Coming back to you and isn't counted until a
     later revision opens it.
   - `heldBy`: ids of holds that block the step or one of its steps.
2. **A new `hold` kind.** Fields: `title`, `body`, `blocks: [Text]` (commands or actions),
   `clearsWhen: Text`, and `state: active | cleared` (cleared carries a reason). A hold
   isn't counted as an action. It shows above the list and as a ⏸ badge in the header, and
   it strikes through any step that names it.
3. **Status stays `update`, with no schema change.** Agents keep one current update per run
   and revise it in place (`previous`/`revision`), or use `supersedes`. The page marks an
   update stale when its session has ended or handed over (roster and `squad-lead` events),
   or when it is older than a day with no revision.
4. **"I did it" becomes a page event** (`owner-reported`, kept apart from completion per ADR
   0014). It is delivered to the step's session the way asks are. The agent verifies the step
   and publishes the completed revision with proof. Steps with nothing to check (a Linear
   edit) still close by agent proof, because the agent can read Linear.
5. **Question to owner-step linkage, with no grill format change.** The page finds follow-ups
   by `answer.question` and lists them under the answered question. An agent that already
   has the step when it asks can cite it in prose as `[[item:<id>]]`. That needs a new link
   form, so it is optional and comes later.

## Page and header

- **Waiting on you** replaces both Needs you and Updates as a top-level destination. The
  Updates feed history moves under More › What changed, which already projects item events.
- **Header:** "Waiting on you · N", where N counts open owner steps with urgency other than
  `fyi` plus provisional decisions before their deadline. An active hold adds a ⏸ badge.
  Questions keep their own "Questions · M". Today's "Needs you · N" adds open questions into
  the same number, which hides how many actions are waiting.
- Rows collapse to urgency, title and place, plus the copy box for one-line steps. Expanded
  rows add the origin, body, steps, route line, buttons and how the step gets done.
- A question with an answer that spawned follow-ups shows them inline: promised, open or
  done.

## Guide text for `gf --skill` (revision 8)

This text replaces the owner-step bullet under "Other source-owned item types". It adds a
section before "Write for the reader":

```markdown
## Tell the user what is waiting on them

Questions are for decisions. Anything the user must *do*, must *not do*, or should *know*
is an item, never a question with a "Seen" option and never a to-do list in a step's prose:

- **Owner step** (`kind: "owner-step"`) for each thing only the user can do: a merge your
  gate refuses, a grant or answer to type into a session, a script, setting or install, an
  edit in their name. One step per action. Put the exact line or command in `copy` and the
  instruction in `action`; use `steps` when it takes more than one move. `destination` is
  where they do it: a `tN` they type into, or the PR or issue URL. Say in `body` why it is
  theirs and what it unblocks.
- **Hold** (`kind: "hold"`) for anything the user must not do yet ("don't reload the
  plugin"), with `blocks` and `clearsWhen`. Name the hold in `heldBy` on any step it
  affects. Clear it with a new revision when it no longer applies.
- **Update** (`kind: "update"`) for status: one current update per run, revised in place.
  Never put an action or a hold only in an update.

When an answer or its note asks for something later ("once the fix lands, tell me the
grants and which session to type them in"), publish an owner step in the same turn you
read the reply. Set `answer: {question, event}` and `progress: {state: "promised", until:
"<condition>"}`. When the condition is met, revise it to `open` with the real `copy` and
`destination`, or withdraw it with a reason ("no grant change needed"). Never leave the
promise only in chat.

Set `pageAnswer` only when your own gate would accept a page answer for that action: today
`grant_sources` lacks `page`, so no step sets it. Never offer to type into a session for the
user, and never put a merge, restart or settings change behind a page button.

A step is done when you publish `progress: completed` with proof (the merged PR, the grant
log entry your Grants row cites). The user's "I did it" reaches you as an owner report:
check it, then publish the proof. Copying, focusing and owner reports are not completion.
```

## Sizes

Code and tests are counted separately. Guide and ADR lines count as docs.

| Piece | Where | Code | Tests | Docs |
| --- | --- | --- | --- | --- |
| Schema: owner-step fields, `promised`, `hold` kind, attention projection | `src/channel.ts`, `server/attention.ts` | ~140 | ~160 | — |
| Waiting on you page, header count, holds, stale status | `workspaceView.ts`, `attentionView.ts`, `channelView.ts`, CSS | ~380 | ~260 (scene + story) | — |
| Follow-ups under the answered question | question view | ~80 | ~80 | — |
| `owner-reported` event and delivery to the asker | server + client | ~120 | ~120 | — |
| "Answer on page" for `pageAnswer` steps | client send path | ~90 | ~100 | — |
| Guide revision 8, plugin bump, ADR 0035 | `server/authoring-guide.md`, `plugin/` | — | — | ~70 |
| Squad: lead and orchestrator publish steps, holds and promises instead of OFY questions | squad repo (another repo) | — | — | ~40 |

The grill-flow pieces total ~810 code and ~720 tests in three PRs: schema, page, then
report and answer. Turning on one-click grants is Rob's `grant_sources` and `page_actor`
setting, not code.

## Open points

- `pageAnswer` needs a question to answer. Today's type-card steps answer squad cards, not
  page questions, so the squad would have to publish its cards as page questions first.
- Staleness after a day is a guess. The handover and session-ended signal is the reliable
  part.
