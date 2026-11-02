---
name: grill
description: Run a grill on a local grill-flow page, where the user reads the reasoning concept by concept, answers, asks for rewrites, and sends the reply back into this session. Use for a grill in a Herdr session on a machine with the grill-flow checkout, or when the user asks for grill-flow.
---

# Grill on grill-flow

Run the `grilling` skill's interview (invoke it): the design tree, rounds over
the frontier, a recommendation per question, facts looked up by subagents and
never asked of the user. This skill replaces only its round format: each
round is a grill-flow page, and the chat carries the link.

The checkout is `~/repos/rbrtbn/grill-flow`; a fork changes this line. Below,
`gf` means `bun run --cwd <checkout> gf`. The server serves
`http://127.0.0.1:4317` and types the user's asks and reply into your
terminal through `hc send`, so it needs `$HC_TERMINAL_ID`. Without a Herdr
terminal or the checkout, use `rbrtbn:grill-with-page` where it is installed.

## Each round

1. `gf up`. It starts the server under hc unless it already answers.
2. Write the grill to `<checkout>/grills/<id>.json` (Writing the grill,
   below). Round 1 creates it; a later round edits the same file: add the new
   frontier with the next free ids, bump `round`, and keep every answered
   question, which the page folds to its answer. `<id>` is unique across
   every agent's grills, e.g. `<repo>-<topic>`.
3. `gf load grills/<id>.json`. Answers, notes and asks already given stay,
   keyed by question id.
4. Tell the user in one short message: the link `http://127.0.0.1:4317/g/<id>`,
   the round and how many questions are open. The questions live on the page.
5. Wait for the reply. The round is done when it arrives.

## Reading the reply

Send types the reply into your terminal in one of two forms:

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

An ask arrives typed into your terminal as `[grill-flow] Ask on <id>, step
<step-id> (ask N): ...`, with the exact `gf revise` command to answer it.
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
- `session` is `$HC_TERMINAL_ID`. `next` says what the answers unblock.

A grill that gathers questions across issues, such as a squad lead's, adds:

- One part per Linear issue, with `issue` set to its `refs` key.
- `urgency` on each question: `blocking`, `soon`, `wait` or `fyi`. The
  sidebar then lists by issue or by urgency, most urgent first, and a
  question without one ranks right after `blocking`.
- `issue`, `from` and `row` on each question: the issue it is about, who
  asked (a `sources` key), and its id in the asker's rows.
- `refs`: every Linear id, PR or ADR the text names, as `{text, url, state,
  type}`, where `type` is Linear's state type or `pr`. Each mention links to
  `url` and shows its state on hover. Look the states up at every load and
  set `refsAt` to that time.
- `sources`: each `from` name as `{text, link}`, and `decided`: the earlier
  decisions as `{id, text}`, listed under Decided so far.

## Finishing

The grill is done when the frontier is empty and the user confirms you share
an understanding. Record the decisions where the work lives: the issue, an
ADR (per the repo's CLAUDE.md), or the doc the grill was about. Then name in
chat where they went.
