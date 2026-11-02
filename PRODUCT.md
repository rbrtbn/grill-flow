# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Foldkit (Effect, Elm architecture) in the browser, chosen by Rob. A small Bun server beside it
serves the page, stores everything in SQLite, and hands answers and asks to the agent session.
Runs on Rob's laptop only.

## Users

Rob, alone for now (confirmed 2026-11-02). He is an engineering lead deciding with his own coding
agents. An agent prepares a decision page; Rob reads it, answers, and sends the answers back to
the agent's terminal session. Teammates may read pages later, so nothing assumes a single reader,
but no sharing features exist.

## Product Purpose

Let Rob decide a planned change without reading the agent's session. The page carries the
agent's reasoning in the order a person would think it through, stopping at each decision point
to ask one plain question. Success: Rob can skim to the question when he already gets it, read
the reasoning when he doesn't, and send a complete set of answers in one press.

## Positioning

The decision tree is the page. Questions sit inside the reasoning that leads to them, in thinking
order, not urgency order; each option says what it changes downstream; later questions grey out
until the ones they depend on are answered, and say why. Rob can ask the agent to rewrite any
piece of reasoning and see the change as a diff.

## Operating Context

- Pages come from a grill: an agent's structured interview about a design. The same UI renders
  any grill from a JSON data file; an agent's job is to write that file, not a new page.
- Answers go back as one message to the agent's terminal through `hc send`, in the grill's reply
  format (`Round N: Q1 a, ...`), or by copy and paste.
- Asks about the prose go to the agent the same way; the agent answers by posting a rewrite or a
  comment, which the page shows.
- Every answer, note, ask, send and revision is stored as an event, so later pages can learn from
  how Rob used earlier ones.

## Capabilities and Constraints

- Local only: the server binds to 127.0.0.1 and refuses writes without the page's token.
- A grill's content stays on the machine: `grills/` and the store are gitignored.
- Rounds share one page: a later round adds questions to the same grill.

## Evidence on Hand

A 21-question security-design grill answered over a day, with about 30 asks and their rewrites,
kept in the local store. `examples/squad-sample.json` shows the squad fields.

## Product Principles

1. Reasoning first, but never in the way: the question is always reachable in one skip.
2. Every option names its consequence, so comparing never needs scrolling back.
3. State is visible at a glance: answered, open, waiting on another answer, not needed.
4. Nothing Rob types is lost: answers, notes and asks persist and are mined later.
5. Restraint over decoration (Rob, 2026-11-02): the page must not be too decorative or too long
   to skim.
