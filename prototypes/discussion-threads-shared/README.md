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

Try: talk to Grill-flow on `cache-budget`, switch to another question, switch back; ask the
lead about `cache-budget`; open the unread reply on `night-grant`. The comparison and
recommendation are in `docs/research/2026-11-14-discussion-threads.md`.
