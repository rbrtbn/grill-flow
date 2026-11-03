---
name: grill
description: Run a grill on a local grill-flow page, where the user reads the reasoning concept by concept, answers, asks for rewrites, and sends the reply back into this session. Use for a grill on a machine with the grill-flow checkout, or when the user asks for grill-flow.
---

# Grill on grill-flow

A grill is an interview that settles a decision with the user. When a
`grilling` skill is installed, invoke it for the interview; this skill then
replaces only its round format. Without one, run it this way:

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

When the user reads grills on another machine's grill-flow server (homelab's
grills are served on rob-mbp), keep the checkout here but run no server, and
export `GF_OUTBOX=~/data/grill-flow/outbox`. Then `gf load`, `gf revise`,
`gf state`, `gf events` and `gf wait` work on that folder: each grill is
`<outbox>/<id>/grill.json`, each reply a file in its `revisions/`, and the
serving machine writes the answers back to `<outbox>/<id>/state.json`. Set
`session` to `$HC_TERMINAL_ID` as usual: the serving machine types asks and
replies into your terminal through hc, a few seconds after the user sends
them. The page link is the serving machine's
(`http://127.0.0.1:4317/g/<id>` there), not this one's. The serving machine
registers your outbox once with `gf remote add <this machine> <outbox>`.

## Each round

1. `gf up`. It starts the server unless it already answers.
2. Write the grill to `<checkout>/grills/<id>.json` (Writing the grill,
   below). Round 1 creates it; a later round edits the same file: add the new
   frontier with the next free ids, set `round` on each new question and on
   the grill, and keep every answered question, which the page folds to its
   answer. The reply and the send dialog then cover only this round's
   questions. `<id>` is unique across
   every agent's grills, e.g. `<repo>-<topic>`.
3. `gf load grills/<id>.json`. Answers, notes and asks already given stay,
   keyed by question id.
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
  code. To compare options as a diagram or timeline, draw it in a fenced
  ```` ``` ```` block: it shows in monospace with its spacing and blank lines
  kept. Rewrites and Talk replies take the same blocks.
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

When questions are about Linear issues or PRs, any grill can add:

- `issue` on each question: the `refs` key of the issue it is about. Parts
  stay concepts; the sidebar then also lists the questions by issue.
- `refs`: every Linear id, PR or ADR the text names, as `{text, url, state,
  type}`, where `type` is Linear's state type or `pr`. Each mention links to
  `url` and shows its state on hover. Look the states up at every load and
  set `refsAt` to that time.
- `decided`: the earlier decisions as `{id, text}`, listed under Decided so
  far.

A squad lead's grill, gathering questions from several agents, also sets
`kind: "squad"` and adds:

- `urgency` on each question: `blocking`, `soon`, `wait` or `fyi`. Only a
  squad grill lists by urgency, most urgent first, and a question without one
  ranks right after `blocking`.
- `from` and `row` on each question: who asked (a `sources` key) and its id in
  the asker's rows, with `sources` giving each name as `{text, link}`. Write
  `row` as `<card>/<item>` (`cos-hardening-3/B2`): the sidebar's Cards list
  groups the questions by the part before the slash.
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

## Finishing

The grill is done when the frontier is empty and the user confirms you share
an understanding. Record the decisions where the work lives: the issue, an
ADR (per the repo's CLAUDE.md), or the doc the grill was about. Then name in
chat where they went.
