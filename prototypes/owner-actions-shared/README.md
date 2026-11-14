# Owner actions prototypes · asks 9612, 9623

Throwaway. These prototypes show three ways to tell Rob what is waiting on him (actions, holds,
follow-ups and status) in place of to-do questions like Q314 and Q196 on `/g/squad`. The
recommendation is `docs/research/2026-11-14-owner-actions.md`.

```sh
bun prototypes/owner-actions-serve.ts
```

- A · One list: <http://127.0.0.1:4351/>. Needs you and Updates merge into one "Waiting on
  you" page.
- B · By place: <http://127.0.0.1:4352/>. To-dos are grouped by session, GitHub and Linear,
  with Status kept on its own page.
- C · By conversation: <http://127.0.0.1:4353/>. Each session gets a lane, and every step
  sits under the answer or pick it came from.

The sample data copies the owner steps t2hq and t2cr published on 2026-11-14 for ask 9621,
Q380's answer note, and t1mn's Q196 digest. Q380's filled-in grant line, the open question
titles and the proof strings are illustrative. Everything stays in memory: nothing reaches the
live server, its database or any agent. "Focus" and "Open" only record an event and show a
toast.

The floating bar switches variants (← and → also work) and runs the simulations: squad#157
merges (this fills in the Q380 promise), agents post proof, the hold clears, and
`grant_sources` toggles between `desktop+cli` and `desktop cli page`. State opens every
item's progress and the event log. Append `?sim=merge157,togglePageGrants` to load a
simulated state from a link.
