# Current instructions for grill-flow authors

Read this complete guide after session start or context loss. Before each authoring write,
run `gf --skill --if-newer-than <revision-read>`. A changed guide replaces the whole earlier
rule set. An unchanged response is enough only while that guide remains in your context.
Declare `--skill-revision <revision-read>` on load, item, revise, reply and draw commands.
The guide revision is independent of grill format and item revisions; copying a revision
number does not prove understanding.

Give every write its reason: `--reason "<why>"` on `gf load`, `gf item`, `gf draw`,
`gf restore` and `gf revise --kind rewrite`, in a short line a later reader can act on, such
as `--reason "round 3: Q7-Q9 after the reply"`. A missing reason warns now and will be refused
later. The author is `$HC_TERMINAL_ID`; pass `--session <address>` when you write for another
session. Every load is kept as a numbered revision with its time, author and reason:
`gf history <id>` lists them, and `gf history <id> <question-id>` shows what changed in that
question at each revision (`--json` for machine-readable output). History is for retros and
audits; read the page or `gf state` to work.

Missing/stale revisions warn during migration and include this guide on stderr. A successful
write remains published as submitted; do not retry it as though rejected. Apply the new guide
to your next write or deliberately correct the content using its normal revision rules.
Objective validation failures still reject. Read-only commands and page answers are outside
this freshness policy. A future switch to rejection requires an owner decision.

With `GF_OUTBOX`, writes are queued until the host imports them. `gf --skill` reads the guide
returned by that host in `state.json`; the output names its revision and labels it cached.
Without an unambiguous host copy, bundled guidance is labelled unverified. A cache cannot
prove current host freshness while disconnected. `gf state` and `gf wait` expose import
warnings, including the complete host guide; an import warning does not mean rejection.
Use a guide-aware CLI on remote writers to display these returned fields. Older writers keep
publishing and the host retains their warnings; older `state`/`wait` commands do not display
new warning fields. Updating those checkouts is a separate rollout action.

## Write for the reader

- Use short, concrete decision/change titles. The sidebar displays at most two lines while
  retaining full accessible text. Length guidance is editorial, not a fixed character gate.
- A question explains the decision, relevant facts/evidence, why it matters now, the recommended
  choice and consequences/tradeoffs. Supply accurate urgency and dependencies; leave unknown
  times out rather than inventing them. Keep session recipients and source/round identity exact.
- An update says what changed, what evidence supports the result, its impact and next step.
  Distinguish agent-reported completion from independent evidence and delivery from acceptance.
- Every PR/Linear mention that should link needs its exact key in the source grill's `refs`,
  with the verified source URL and current metadata. Obtain missing URLs/titles/status from
  the primary source before publishing; providing these entries is the author's job.
  `squad#107` and `LAB-1388` do not create reference entries automatically. Code spans stay
  literal; conflicting source targets stay linkless. Unknown status stays unknown. Refresh
  references before loading, as described below.

## Minimal valid examples

Replace the illustrative evidence and recipients before publishing. The question example uses
an empty session for a writer that will run `gf wait`; use your actual Herdr address when set.

```json
{
  "version": 4,
  "id": "guide-example",
  "title": "Choose the next step",
  "session": "",
  "round": 1,
  "intro": [],
  "entities": [],
  "terms": [],
  "parts": [
    {
      "id": "decision",
      "title": "Next step",
      "summary": "Choose the direction and its consequence."
    }
  ],
  "steps": [
    {
      "id": "next-step",
      "part": "decision",
      "heading": "Choose the next step",
      "prose": [
        "The example change reduces a repeated manual step. Approving it starts implementation; declining leaves the process as it is. Inspect squad#107 and LAB-1388 for the supplied evidence."
      ],
      "question": {
        "id": "Q1",
        "title": "Approve the next step?",
        "scope": "This example decision",
        "ask": "Should we implement the recommended next step?",
        "options": [
          {
            "key": "a",
            "label": "Implement it",
            "effect": "Start implementation and verify the result.",
            "recommended": true
          },
          {
            "key": "b",
            "label": "Keep the process",
            "effect": "Retain the manual step and revisit when the cost changes.",
            "recommended": false
          }
        ],
        "dependsOn": [],
        "when": [],
        "round": 1,
        "urgency": "wait"
      }
    }
  ],
  "next": ["Send your choice or discuss the evidence."],
  "refs": {
    "squad#107": {
      "text": "Illustrative PR reference; verify before publishing",
      "url": "https://github.com/rbrtbn/squad/pull/107"
    },
    "LAB-1388": {
      "text": "Authoring instructions; verify before publishing",
      "url": "https://linear.app/rbrtbn/issue/LAB-1388"
    }
  }
}
```

Load the source, then publish an update with `gf item guide-example --file update.json
--skill-revision <revision-read>`. Revisions begin at previous 0/revision 1 and advance by one;
use the exact existing item id when revising it.

```json
{
  "version": 1,
  "id": "verification-result",
  "kind": "update",
  "previous": 0,
  "revision": 1,
  "session": "t1",
  "title": "Verification ready",
  "body": "Example: the change is ready for review. Evidence: https://example.test/check. The next step is owner review."
}
```

## Other source-owned item types

Each `gf item` publishes one JSON object. All kinds share version, id, previous, revision,
session and body; title and associated question are optional. Publish prerequisites before
blockers that name them. Revise an existing item by keeping its id and supplying the correct
previous/revision; replaying an identical body is safe, changing an immutable revision is not.

- Owner steps name an exact host, destination and action. Completion requires dated proof;
  copying an action or focusing a terminal does not report completion. Remote writers use
  explicit HTTP destinations; native terminal destinations belong to the serving machine.
- Provisional decisions give a deadline and affected work. Veto receipt, transport, owner
  acknowledgment and outcome are separate; a delivery receipt is not acceptance.
- Evidence names its exact provider identity, observed state, proof and checked/expiry times.
  The illustrative evidence below is expired and unknown; obtain current primary evidence.
- Blockers name a precise question, owner step or provider/evidence condition. Refer to source
  identities, never the shared page's display question number as a source identity.

The following array groups four examples for reading. Write each object to its own file for
`gf item`. Replace all illustrative destinations, hosts, times and bodies before publication.

```json
[
  {
    "version": 1,
    "previous": 0,
    "revision": 1,
    "session": "t1",
    "body": "Illustrative record; replace its facts and evidence before publication.",
    "kind": "owner-step",
    "id": "owner-review",
    "title": "Review the result",
    "host": "example-host",
    "destination": "https://example.test/review",
    "action": "Review the example result and report the outcome.",
    "urgency": "wait",
    "blockers": [],
    "progress": {
      "state": "open"
    }
  },
  {
    "version": 1,
    "previous": 0,
    "revision": 1,
    "session": "t1",
    "body": "Illustrative record; replace its facts and evidence before publication.",
    "kind": "decision",
    "id": "proposed-direction",
    "title": "Use the proposed direction",
    "deadline": 4102444800000,
    "affected": ["Example implementation"],
    "resolution": {
      "state": "provisional"
    }
  },
  {
    "version": 1,
    "previous": 0,
    "revision": 1,
    "session": "t1",
    "body": "Illustrative record; replace its facts and evidence before publication.",
    "kind": "evidence",
    "id": "reference-evidence",
    "title": "Reference evidence",
    "reference": {
      "provider": "linear",
      "id": "LAB-1388"
    },
    "state": "unknown",
    "proof": "https://linear.app/rbrtbn/issue/LAB-1388",
    "checkedAt": 0,
    "validUntil": 1
  },
  {
    "version": 1,
    "previous": 0,
    "revision": 1,
    "session": "t1",
    "body": "Illustrative record; replace its facts and evidence before publication.",
    "kind": "blocker",
    "id": "review-complete",
    "title": "Wait for review",
    "condition": {
      "kind": "owner-step",
      "source": "guide-example",
      "id": "owner-review"
    }
  }
]
```

Read `src/channel.ts` for the precise variant fields when publishing completion, decision
resolution, veto responses or provider/question blockers. The existing contracts in
`docs/implementation/2026-11-07-channel-attention-contract.md` explain their semantics.

The remaining reference explains the complete interview, delivery, routing and item workflow.
All `gf` authoring commands shown below also take `--skill-revision <revision-read>` and,
where the top of this guide says so, `--reason "<why>"`.

# Grill on grill-flow

A grill is an interview that settles a decision with the user. When a
`grilling` skill is installed, invoke it for the interview; this guide then
provides the page format. Without one, run it this way:

- Map the decision as a design tree: each decision branches into the ones
  that hang off it.
- Work in rounds. A round asks the whole frontier: every decision whose
  prerequisites are settled. A question that depends on one still open waits
  for a later round.
- Give a recommendation for every question, worded so yes takes it.
- Facts are yours to find, by subagent when it takes more than a read or two;
  only decisions go to the user.
- The grill is done when the frontier is empty and the user confirms you
  share an understanding.

Each round is a grill-flow page, and the chat carries the link.

The checkout is `~/repos/rbrtbn/grill-flow`; a fork changes this line. Below,
`gf` means `bun run --cwd <checkout> gf`. The server serves
`http://127.0.0.1:4317`. Without the checkout, grill in chat instead.

The user's asks and reply reach you one of two ways:

- **In a Herdr terminal** (`$HC_TERMINAL_ID` is set): set the grill's
  `session` to it, and the server types each ask and the reply into your
  terminal through `hc send`.
- **Anywhere else**, such as Claude desktop: set `session` to `""`, and the
  server keeps them for you. After each load, run `gf wait <id>` in the
  background. It exits with what arrived: asks with their `gf revise`
  commands, or the reply. Handle it, then run the `next:` line it ends with.

### On a machine whose grills another machine serves

When the user reads grills on another machine's grill-flow server, such as
homelab's grills served on the workstation (rob-mbp), keep the checkout here
but run no server, and export `GF_OUTBOX=~/data/grill-flow/outbox`. Then
`gf load`, `gf revise`, `gf state`, `gf events` and `gf wait` work on that
folder: each grill is `<outbox>/<id>/grill.json`, each reply a file in its
`revisions/`, and the serving machine writes the answers back to
`<outbox>/<id>/state.json`. Set `session` to `$HC_TERMINAL_ID` as usual: the
serving machine types asks and replies into your terminal through hc, a few
seconds after the user sends them. The page link is the serving machine's
(`http://127.0.0.1:4317/g/<id>` there), not this one's. The serving machine
registers your outbox once with `gf remote add <this machine> <outbox>`.

## Each round

1. `gf up`. It starts the server unless it already answers.
2. Write the grill to `<checkout>/grills/<id>.json` (Writing the grill, below). Round 1
   creates it; a later round edits the same file: add the new frontier with the next free ids
   and set `round` on each new question and on the grill. Keep open and partly resolved
   questions; take fully resolved questions down using the resolution rule below. Send
   includes every unsent answer across rounds, labelled by round; only the current round can
   use the `all recommended` shorthand. `<id>` is unique across every agent's grills, e.g.
   `<repo>-<topic>`.
   In a squad, every session's grill joins the squad's one page (Shared squad page, below);
   never open a separate page for your questions or copy them onto another page.
3. `gf load grills/<id>.json --reason "<why>"`. Answers, notes and asks already given
   stay, keyed by question id.
4. Tell the user in one short message: the link `http://127.0.0.1:4317/g/<id>`,
   the round and how many questions are open. The questions live on the page.
5. Wait for the reply, with `gf wait` running when there's no `session`. The
   round is done when the reply arrives.

## Reading the reply

Send delivers the reply in one of two forms:

```
Round 3: all recommended (Q7 a, Q8 a, Q9 a)
```

```
Round 3 (3 of 5 answered):
Q7 b
Q8 a (note on the pick)
Q9 other: the user's own answer
Open: Q10, Q11 (note left on an open question)
```

Either form can end with a `Message:` line: what the user added in the send
dialog about the round as a whole. Weigh it before the next round.

Once you've taken the reply in, tell the user on the page what you decided
and what comes next: write it to a file and run `gf reply <id> --file <path>`.
Say per question what you took from it, then the next step, such as the next
round or the work it starts. The page shows it in the top bar and as a toast,
and keeps it under Replies.

`Open:` questions stay on the frontier with the same id, as is or reworded.
A note on an open question is not an answer: weigh it, for example a reason
to wait or a fact to look up, before asking again. `gf state <id>` prints the
same reply as it stands, plus asks still waiting.

## Asks from the page

An ask arrives as `[grill-flow] Ask on <id>, step <step-id> (ask N): ...`,
with the exact `gf revise` command to answer it.
Answer each one while the user is still on the page:

1. Look the facts up, by subagent when it takes more than a read or two.
2. Reply: write the answer to a file and run `gf revise <id> <step-id> --ask N
--kind comment --file <path>`. It shows as your message in the concept's
   conversation. An ask on a whole concept names `part:<part-id>`, and one on
   a whole card `card:<card>`; both take only comments.
3. When the ask shows the reasoning was unclear or wrong, also rewrite the
   step's prose: the same command with `--kind rewrite`, the whole prose,
   paragraphs split by blank lines. The user sees it as a diff.
4. When the answer changes a question, its options or the recommendation,
   edit the JSON and `gf load` it again. A reworded question keeps its id.
   Say in the comment what moved, including a recommendation that now differs
   from a pick the user already made.

An ask is answered once `gf revise --ask N` has run.

## Writing the grill

The schema is `Grill` in `<checkout>/src/domain.ts`; read it for the field
names, and `<checkout>/examples/` for a whole grill. What makes the page read
well:

- `parts` are concepts: one idea each, a one-line `summary` that defines it.
  The page shows one concept at a time.
- `steps` run in the order a person thinks the problem through. Each `prose`
  says what is decided, why, and why now, in short paragraphs. Every list is
  bullets, one `- ` line per item after an optional lead line. Backticks mark
  code. A fenced ` ``` ` block shows in monospace with its spacing and
  blank lines kept, for a timeline or anything no diagram kind fits.
  Rewrites and Talk replies take the same blocks.
- A `### Title` first line titles its paragraph; the reader sees it on hover,
  so a few words that say what the paragraph is for. Rewrites and Talk replies
  take titles too.
- Every question has a `scope`: one line on when or where it applies. `ask`
  is worded so yes takes the recommendation. Each option's `effect` is one
  line on what that choice changes later; mark one `recommended`.
- `dependsOn` greys a question until those are answered. `when` marks it not
  needed when an upstream answer falls outside `oneOf`.
- `terms` is a short glossary of words the reasoning leans on, underlined
  where each first appears. `entities` are the names that recur (hosts,
  sessions, services), each with a colour `tone`.
- `session` is `$HC_TERMINAL_ID`, or `""` without one. `next` says what the
  answers unblock.

### Diagrams

Draw the problem and the change when a picture is quicker to read than the
prose: who owns what, where a boundary moves, what path work takes. Set
`version: 3` when you use them. The shapes are `Compare` and `Diagram` in
`<checkout>/src/diagram.ts`; `examples/decision-sample.json` has one of each.

- `compare` on a question is the overview under its options: where today
  breaks and what each answer changes. `now` names today's column; each row is
  one part of the problem, with `cells` keyed by `now` and every option key. A
  cell is a short holder (`"Squad wiki + cos-rob"` for two) or `{value, note,
flag}`. `flag` marks the problems: `twice` (two places hold it), `gap`
  (nothing covers it), `risk` (works, with a known failure), `open` (a later
  round decides). Rows alike in every column fold into one line, so keep the
  rows to the parts that differ.
- In prose, rewrites and Talk replies, a ` ```diagram ` block holding
  JSON draws a diagram; one that doesn't parse shows as plain text. Kinds:
  `zones` (regions and what each holds), `flow` (lanes across steps) and
  `compare` (a table like the above). `states` keyed by `now` and option keys
  give it a switch, opening on the reader's answer. Use as many as help, each
  for one job: an overview first, then one beside each hard part.
- A diagram's `follow` maps paragraph titles to `{state, focus}`, `focus`
  being a lane or zone id. The diagram then stays pinned while those
  paragraphs are read and shows what each one is about, so title every
  paragraph it should follow and put it before them.

When questions are about Linear issues or PRs, any grill can add:

- `issue` on each question: the `refs` key of the issue it is about. Parts
  stay concepts; the question retains its issue association and link.
- `refs`: every Linear id, PR or ADR the text names, as `{text, url, state,
type}`, where `type` is Linear's state type or `pr`. `text` is the full
  issue, PR or ADR title; the map key supplies its ID. Each mention links to
  `url` and shows its title and state on hover. Look titles and states up at
  every load and set `refsAt` to that time.
- `decided`: the earlier decisions as `{id, text}`, listed under Decided so
  far.

### Shared squad page

A squad has one page, `/g/<squad profile>` (e.g. `/g/squad-eff`); every lead,
orchestrator, helper and builder session of that squad joins it. Each member
keeps its own grill ID, file and event history. Add this version 4 field to
that grill, then use the same `gf load <file>` command. When `GF_SQUAD` is set,
`gf load` adds the field for a grill that lacks it; `--solo` keeps a page of
its own, only for work outside the squad:

```json
{
  "squad": {
    "id": "squad",
    "section": "Grant checks"
  }
}
```

The server composes `/g/squad` from all loaded members with that squad ID.
Give each member a descriptive section. Keep its own rounds and
`roundNames`.
Only the lead member adds `"lead": true` and, when applicable,
`"openForYou": "open-for-you"` (the lead's existing step ID). Its pinned link
stays at the top of the navigation. The squad ID differs from every member ID.

Continue `gf revise`, `reply`, `state` and `wait` on your own grill ID and
local question/step IDs. The shared page has stable question numbers of its
own; delivered answers and reply commands use your original IDs. Keep
`question.session` for the actual asker; it overrides the member's session.
New questions get fresh shared numbers; existing questions keep theirs.

Remote members add the same field in their `GF_OUTBOX/<grill-id>/grill.json`
using `GF_OUTBOX=... gf load <file>`. The registered remote pull joins that
member to the same squad page and returns its normal `state.json`.
A new lead takes the page over in one step, with no renaming or copying:
`gf handover <squad profile> --session $HC_TERMINAL_ID --reason "<why>"`
(add `--member <its grill id>` when the successor keeps its own member grill).
The page's run and lead then route to the new session, and deliveries to
questions that still name the previous lead's address go to it too.
Membership persists only when you keep the field in subsequent loads. Existing
URLs and saved drafts, asks, replies and send receipts remain valid; joining
neither copies nor resends them. Agents on older checkouts must update first
so their schema preserves membership. Never edit another member's file.

A squad lead's grill, gathering questions from several agents, also sets
`kind: "squad"` and adds:

- `urgency` on each question: `blocking`, `soon`, `wait` or `fyi`. Only a
  question queue offers Urgency sorting, most urgent first; an unspecified
  urgency ranks right after `blocking`. Round remains the default sort.
- `from` and `row` on each question: who asked (a `sources` key) and its id in
  the asker's rows, with `sources` giving each name as `{text, link}`. Write
  `row` as `<card>/<item>` (`cos-hardening-3/B2`) to preserve its source item identity.
- `session` on a question: the Herdr address of the session that asked it
  (`t109` locally, `homelab/t12` on another machine). Answers and question
  discussions go there; omitted or blank uses the grill's `session`.
  `from` is display metadata and never determines delivery. Use `version: 4`
  when naming per-question recipients. Review & Send lists each recipient;
  partial failures leave only the failed recipients' answers unsent.
- `roundNames` on the grill (version 4): round numbers mapped to short work
  descriptions, e.g. `{"1": "Stage definitions", "2": "Run grants"}`. Keep the
  existing rounds and their question memberships; name each round by its work.
  The sidebar shows these names in round groups and Filters. Stored name overrides
  survive writer reloads; round renaming controls are not exposed in the sidebar.
- `blocksAt` on a question (version 4): optional ISO 8601 date/time with a
  timezone, such as `2026-11-07T14:00:00+01:00`. Open circles use red for
  `blocking`, yellow for `soon`, green for `wait`, and a hollow circle for
  `fyi`; no urgency leaves the circle neutral. Hover reveals urgency and
  the time, when supplied. Omit unknown times. Drafts use a dotted checkmark
  circle; Sent uses a solid
  checkmark circle.
- Dependents nest below their first unanswered blocker from `dependsOn` or
  `when`, across Round and Agent groups. A chevron folds the branch.
  Each question appears once, under its blocker's group; filtering out a
  blocker promotes matching dependents so search never hides a result.
  Answered blockers release children to their next open blocker or their own
  group. Self references, missing targets and cycles never hide questions.
- `version: 2` and a `plan`, so the page gets a Plan page ranking what waits
  on the user. Rewrite the plan at every load, from the run's own state:
  - `plan.issues`: every issue in the run, and the user's own ones that
    follow it, as `{id, title, phase, follows, start, review, optional, card,
agent, note}`. `phase` is `building`, `review`, `merged`, `gated` (its
    gate passed, its builder waits on answers), `stuck` (an agent is blocked),
    `later` (not started) or `outside` (not the run's to build). `follows`
    lists the issues it waits to merge; `start`, `review` and `optional` list
    the page's question ids it needs before its builder starts, before its
    first review, or not at all. `card` is the card its questions came from;
    `agent` says who holds it now, such as `builder, review round 1`.
  - `plan.deadline` (ISO time), `plan.slots` (agents live at once) and
    `plan.critical` (the chain of issue ids that decides the finish, first to
    last), each when the run has one.

  A grill without `version` is version 1 and shows as before. A newer
  `version` than the checkout reads still loads: the page shows what it knows
  and says so.

## Resolve and take down a question

Keep only open questions and live updates on the page. When the owner has answered and you
have acted, or the question was withdrawn, remove its step from your own source. Record the
outcome in `decided` as `{id, text}`: id is the exact local/source question id (for example Q6),
not its shared display number or step id, and text is the nonblank outcome. Then `gf load`
the source with the guide revision you read. Answer events and frozen submissions stay in
history; a decided entry is an author-reported outcome and creates no new approval. The load
records each new outcome, so it stays under Decided even when a later load leaves it out of
`decided`; reword one by loading the same id with new text.

If only part is resolved, keep its step and question id. Rewrite the prose/options to the
remaining open work. Keep picked option keys stable; a decided entry does not bypass that
protection for a question that remains. Do not reuse removed ids for different decisions.

## Finishing

The grill is done when the frontier is empty and the user confirms you share
an understanding. Record the decisions where the work lives: the issue, an
ADR (per the repo's CLAUDE.md), or the doc the grill was about. Then name in
chat where they went.
