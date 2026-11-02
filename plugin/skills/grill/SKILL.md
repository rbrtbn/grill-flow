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
   conversation. An ask on a whole concept names `part:<part-id>` and takes
   only comments.
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
  code.
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
  the asker's rows, with `sources` giving each name as `{text, link}`.

## Finishing

The grill is done when the frontier is empty and the user confirms you share
an understanding. Record the decisions where the work lives: the issue, an
ADR (per the repo's CLAUDE.md), or the doc the grill was about. Then name in
chat where they went.
