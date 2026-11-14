# Work flow home page (PROTOTYPE)

Throwaway. Rob's question (2026-11-14): which Linear issues the squad is working on, the state
each one is in, which agents have held it, what is happening on it, how much is left and how much
time it has taken, all as a flow through the states. Work in progress and blocked work shows in
full. Done work folds dimmed at the top, and planned work folds at the bottom.

Run `bun prototypes/work-flow-serve.ts`, then open http://127.0.0.1:4356/?variant=A. Switch
variants with the bottom bar or the ← and → keys.

- **A · Track**: one row per issue, a line through Design gate → Building → Review → Fixing →
  Merge-ready → Merged. The line is coloured by the agent that held each stage and labelled with
  the time spent there. The issue's current stage shows that agent's avatar, ringed in rust when
  blocked.
- **B · Timeline**: bars over real time, coloured by state, with markers where an agent picks the
  issue up, a now line, dashed bars for what is left, and dependency arrows.
- **C · Stages**: the active states as columns, each with a count and median stay. Cards show
  what is being done, the blocker, the agents and the time spent.

Every variant has the stats strip (in progress, blocked, done, planned, median start → merge,
time spent, handovers, review rounds) and an issue drawer with time per state and every move.

**Data** (`data.js`): 18 real issues from run `2026-11-11-squad-stage1-t2cr`, extracted from its
run directory, Linear and GitHub on 2026-11-14. Assignments in state.md carry no timestamps, so
many times come from file mtimes and are marked "(mtime)". A real page needs agents to log
their moves: one entry each time an agent picks an issue up or moves it to another state. The
proposal is a `work` item on the board (issue, state, agent, note, at), written by `/squad:build`
and the lead at each transition.
