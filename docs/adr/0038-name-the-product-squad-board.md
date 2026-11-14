# 0038. Name the product Squad Board

- Status: accepted
- Date: 2026-11-14
- Scope: grill-flow

## Decision
The page is called **Squad Board**, "the board" for short (Rob, 2026-11-14); agents say "send it
to the board". Page text, titles, the preview notice and help copy use the new name. A grill
stays the name of an agent's interview. Squad's existing rule is reused as written: "a board
answer settles its card and grants nothing" now means an answer on this page, except where it
qualifies as a PAGE grant (squad ADR 0053). The repo, plugin, skill, `gf` CLI and `GF_*`
variables keep their names; LAB-1458 renames them, and `gf` and `GF_*` stay as aliases until it
sets the window. Earlier ADRs keep "grill-flow" as written.
