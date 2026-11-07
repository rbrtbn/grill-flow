# 0006. Group unblocking trees by their roots

- Status: accepted
- Date: 2026-11-07
- Scope: grill-flow

## Decision
Show each dependent once under its first unanswered `dependsOn` or `when` blocker.
The root determines the Round or Agent group, preserving cross-group chains.
Hover retains each question's own agent, named round, urgency and blocking time.
Break cyclic edges deterministically; self references and unknown targets stay roots.
Filtering out a blocker promotes matching children instead of hiding search results.
Branch folding is shared across groupings; search and navigation reveal matching children.
Duplicating a dependent under every blocker would split its position and answer state.
