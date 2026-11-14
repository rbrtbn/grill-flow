# Discussion threads studies · ask 9656

Four throwaway takes on the Discussion panel, each on its own port. They share only the page
around the panel (questions, sample threads, simulated delivery and replies) in this folder;
each variant's folder holds its panel. Nothing talks to the grill-flow server: threads live in
memory and reset on reload. The floating bar (or ← →) moves between variants and keeps the
question; the dashed box bottom-left shows which thread each question will reopen.

```sh
prototypes/discussion-threads-shared/serve.sh   # from the repo root; starts all four
```

- A · Thread tabs: http://127.0.0.1:4361/prototypes/discussion-threads-tabs/
- B · One addressed timeline: http://127.0.0.1:4362/prototypes/discussion-threads-timeline/
- C · Thread list beside the panel: http://127.0.0.1:4363/prototypes/discussion-threads-inbox/
- D · Thread cards on the question: http://127.0.0.1:4364/prototypes/discussion-threads-stack/

Round 2 moves conversations about a question onto the question page (selecting reasoning
text offers "Reply to this passage", which starts a thread on it) and keeps the side for
sessions outside a question:

- E · Conversation under the question: http://127.0.0.1:4365/prototypes/discussion-threads-under/
- F · Margin threads + message palette (⌘K): http://127.0.0.1:4367/prototypes/discussion-threads-margin/
- G · Question as an issue page: http://127.0.0.1:4368/prototypes/discussion-threads-issue/

Round 3 builds on G (Rob's pick): short answers plus "Write my own", a summary-first background
whose fold holds the trade-offs and a comparison table, starters that send on click, linked
references, and a sessions panel with pinned sessions and Group/Order controls. The scenario
box bottom-left steps a run through a reply arriving elsewhere, a PR merging, an issue
resolving, a session closing, an answer, a question rewrite and a lead handover.

- H · split answers (✎ = with a note), sessions by issue: http://127.0.0.1:4369/prototypes/discussion-threads-board/
- I · answer then optional note, sessions by squad: http://127.0.0.1:4370/prototypes/discussion-threads-directory/

Try: talk to Grill-flow on `cache-budget`, switch to another question, switch back; ask the
lead about `cache-budget`; open the unread reply on `night-grant`. The comparison and
recommendation are in `docs/research/2026-11-14-discussion-threads.md`.
