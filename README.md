# grill-flow

A local page for an agent's grill: the interview an agent runs to settle a decision with you.
The page lays the reasoning out concept by concept, puts a question at each decision point, says
what each option changes, and greys a question until what it depends on is answered. You answer
on the page, ask about anything you don't follow, and get rewrites back as diffs. Send reviews
your answers, takes an optional message, and types it all into the agent's terminal.

![A decision grill: the overview with its colour-coded names and the map of questions](docs/screenshots/decision-overview.png)

Everything stays on your machine. Every answer, note, ask and rewrite is kept as an event in a
local SQLite file, so you can later mine how you use the pages.

Hold Command to turn the header's **Review & send** button into **Send**. Command-click sends
the currently selected unsent drafts across rounds, keeping any answers you unchecked in Review
excluded and including your saved review message. It saves visible notes and custom answer text
first. Ordinary click still opens Review; failed saves or deliveries keep the drafts available.

The header holds Needs you, Questions and Conversations, with Review & send at the far right.
More contains What changed, Replies, Updates, Answer history, overviews, Your grills and Settings.
The single question queue has Open, Drafts and All quick views, a matching-round selector and an
icon Filters popdown for every state and urgency, including Sent and Unspecified. New browser
preferences start with Open; existing saved filters remain intact. Search and round scope survive
quick-view changes. Named rounds retain their labels without renaming controls. Question titles
show at most two lines with full wording in the reading pane and accessible label.
State, urgency and each grill's round scope are saved in the browser and restored on reload.
Explicit question links reveal the target round; older Agent grouping preferences become Round.
The discussion pane offers This question and Grill-flow; existing run conversations remain in
Conversations and at their saved routes.

Needs you also shows source-owned owner steps, provisional decisions with veto receipts, and
named blocking conditions. Owner completion is agent-reported with dated proof. Copy action
copies only; a local session destination focuses its published tN address. Veto delivery and the
owner's acknowledgment/outcome stay separate. See the
[record contract](docs/implementation/2026-11-07-channel-attention-contract.md)
for `gf item` examples.

In a discussion, Enter sends and Shift + Enter adds a line. Sending moves to the bottom;
new agent answers follow only when you were already there, leaving older reading undisturbed.

Hide notifications collapses the toast stack without marking replies read. Its badge keeps the
full unread count after the cards expire; click Notifications to reopen the newest unread cards.
Toasts stay inside the main reading section and hide when Discussion takes that space. Agent
messages visible in Discussion count as seen after a short dwell; hidden messages stay unread.

Answers from a current page capture the question wording shown when picked. A newly stale pick
is rejected with its draft retained; an already saved answer keeps its original wording after
later edits. Send freezes a receipt for each source before delivery. An interrupted send without
a delivery receipt stays visible as unconfirmed, including when its request is replayed.

Readback runs on the serving machine without `GF_OUTBOX`:

```bash
bun run gf grant --version             # {"versions":[1]}
bun run gf grant <source-grill> <submitted-event-id>
```

This command reads ordinary evidence and never records or classifies a grant. Cite the canonical
member grill and its submitted event ID, not the shared squad page or its page-level sent event.
Only `answers[].context`, `key`, `own` and `note` are page words; `message` and `lines` are not
authority in v1. Exit 3 means missing/legacy context or a message-only send; other errors exit 2.
PAGE reader activation and message-only eligibility remain pending at LAB-1310's gate.

## Two kinds of grill

One page serves both; which one you get depends only on the fields the grill's file fills in.

### A decision grill

The everyday kind: one decision, thought through in order. Start here.

- **Concepts** down the left, one idea each; the page shows one at a time with its part of the
  map.
- **Names in colour.** The agent lists the names that keep coming up (machines, services,
  people) as `entities`, each with a colour. They're coloured the same way everywhere on the
  page, and a key under the introduction says what each one is.
- **A glossary.** Words the reasoning leans on (`terms`) are underlined and explained on hover.
- **Questions that wait.** `dependsOn` greys a question until its inputs are answered; `when`
  marks it not needed after an answer that rules it out. An answered question folds to a line
  with your pick, and the next one opens.

![A concept's questions: Q4 answered and folded, Q5 open with its options, the map beside](docs/screenshots/decision-questions.png)

- **Talk per concept.** Ask about a question or the whole concept from the sidebar. The agent
  answers there, or rewrites the reasoning and you see the diff.

![A concept with the agent's reply and the rewrite it made, shown as a diff](docs/screenshots/decision-concept.png)

`examples/decision-sample.json` is a whole one.

### Questions about issues

Any grill can tie its questions to Linear issues or PRs. The concepts stay the default view, and
the sidebar adds a second one that lists the same questions by issue. Each issue or PR named in
the text links to it and shows its state on hover.

### A squad grill

For a long-running multi-agent effort, where questions from several agents and issues pile up
for one person. It adds, on top of the above:

- **Urgency** on each question (blocking, soon, can wait, FYI), and a third sidebar view that
  lists by urgency. Only a squad grill has it.
- **Who asked**, with the asker's own row id, and **decided so far** from earlier rounds.

![A squad grill listed by issue, with a PR's state on hover](docs/screenshots/squad-by-issue.png)

![The same grill listed by urgency](docs/screenshots/squad-by-urgency.png)

`examples/squad-sample.json` uses every field.

## What you need

- macOS or Linux.
- [Bun](https://bun.sh) 1.3 or later. It runs the server, the build and the tests.
- [Claude Code](https://claude.com/claude-code), for the `grill` skill the agent follows.
- Optional: Herdr's `hc`. With the agent in a Herdr terminal, your asks and answers are typed
  straight into it. Anywhere else, Claude desktop included, the agent runs `gf wait` in the
  background and collects them from the page's store instead.

## Get started

```bash
git clone <your fork> grill-flow && cd grill-flow
bun install
bun run gf up          # builds the page and starts the server at http://127.0.0.1:4317
bun run gf load examples/decision-sample.json
```

When starting a maintainer-enabled server, run
`GF_MAINTAINER_SESSION=<builder-address> bun run gf up`. `gf up` forwards explicitly supplied
`GF_*` server settings through Herdr's `env` command; it does not infer the maintainer from the
terminal that starts it. An already-running server keeps its configured maintainer until restart.

Open `http://127.0.0.1:4317/g/decision-sample` to see a made-up grill, or `http://127.0.0.1:4317/`
for every grill the server holds, grouped by the machine it came from; a grill page's title links
back there. An agent on another machine can keep its grills there and still have them served here:
it sets `GF_OUTBOX` and this server pulls that folder over hc (`gf remote add <machine> <outbox>`;
docs/adr/0002). `GF_PORT` and `GF_DB`
move the server and its database elsewhere, say for a second copy.

### Retire a finished grill

On the serving machine, hide a source grill from the catalog, inbox and shared squad page:

```bash
bun run gf retire <grill-id> --reason 'Work finished'
bun run gf restore <grill-id>
```

Retirement keeps the source file, answers, discussions and events. The source page's direct URL
and `gf state`/`gf events` still work; `gf state` shows the retirement reason. Restore brings back
the same shared question numbers. Reloading the source, including a remote outbox import, does
not undo retirement. Run these commands on the serving machine without `GF_OUTBOX`; they also
work for sources imported from another host. Refresh an open overview to update its catalog.

Install the skill from your checkout, so your edits take effect without a release:

```bash
claude plugin marketplace add "$PWD"
claude plugin install grill-flow@grill-flow
```

Then ask an agent for a grill on grill-flow. It writes the grill to `grills/<id>.json`, loads
it and gives you the link.

To make it the default whenever you ask to be grilled, add this line to `~/.claude/CLAUDE.md`
(or to one repo's `CLAUDE.md` for just that repo):

```markdown
- When I ask to be grilled, or a skill runs a grill, put each round on a grill-flow page with the `grill-flow:grill` skill.
```

`bun run dev` serves the page and rebuilds it on every change to `src/`; an open page reloads
itself within a few seconds and keeps what you were typing. `bun test` runs the tests.

## Make it yours

This is a base to fork and bend to how you think, not a product taking requests.

- **The skill**: `plugin/skills/grill/SKILL.md`. Change the checkout path near the top to where
  you cloned it, and the rest to how you want agents to grill you.
- **The look**: `src/styles.css`, with colour tokens for light and dark at the top, including the
  five entity colours. `DESIGN.md` and `PRODUCT.md` record why it looks the way it does.
- **The grill shape**: `src/domain.ts`. A new field goes in the schema, then into `src/view.ts`.
- **Where answers go**: `server/main.ts` sends through `hc send`; swap that for whatever reaches
  your agent.

The page is built with [Foldkit](https://foldkit.dev) on [Effect](https://effect.website); read
`FOLDKIT.md` before changing `src/`. The design work used
[Impeccable](https://github.com/pbakaus/impeccable), installed project-locally into `.claude/`
and not committed.

### Publish an update without a question

An agent publishes an informational update on its own source grill:

```json
{
  "version": 1,
  "kind": "update",
  "id": "progress",
  "previous": 0,
  "revision": 1,
  "session": "t-worker",
  "body": "The checks passed. The remaining decision is Q1.",
  "question": "Q1"
}
```

```bash
bun run gf item <source-grill> --file update.json
```

The Updates page reads these items without creating a question, a Seen answer or a draft to send.
Increment `revision` and set `previous` to the accepted revision when editing; identical replays
are harmless and conflicting content is rejected. Optional `supersedes` names another update in
that source. The session is publisher-supplied display metadata.
Events keep every accepted revision.

With `GF_OUTBOX`, the command queues an immutable `items/<id>-<revision>.json` file. The serving
machine validates it before publication and returns accepted updates in `state.json`.
Queued is not confirmation of publication; `gf events` shows the accepted
`item-published` event. Reloading a grill does not remove its updates.
No other source's JSON file needs editing.

Answer history shows original question/option words, custom answers and notes from
each submission,
with delivery status and separately labelled extra messages. Legacy wording remains explicitly
unavailable. On the original display page, a later wording change offers a word diff; another page
links back to the original surface for comparison. Saved receipts remain unchanged.

A durable local-question link can name its source explicitly:
`/g/<shared-page>/question/<local-id>?source=<source-grill>`.
The source determines the question even when its local ID resembles another member's
shared Q number. Retired members lead to their preserved direct page;
unknown source/question pairs fail instead of guessing.

### Draw a question

Draw this beside Discuss sends the question owner a saved request with frozen wording. The
owner returns raw compare/flow JSON through `gf draw <source> <question> --request <event-id>
--file diagram.json`. The drawing stays separate from answers and comments. Changed wording
marks it stale; original option labels remain intact. Delivery failures and unconfirmed
requests remain visible. See the
[drawing contract](docs/implementation/2026-11-07-question-drawings.md)
for examples, revision rules and remote outbox behavior.
