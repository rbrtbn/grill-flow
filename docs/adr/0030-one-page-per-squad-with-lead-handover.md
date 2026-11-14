# 0030. One page per squad, with lead handover

- Status: accepted
- Date: 2026-11-14
- Scope: grill-flow, squad

## Decision
Every session of a squad joins one composed page named after the squad profile (0008).
`gf load` adds the squad field from `GF_SQUAD` when a grill lacks it; `--solo` opts out, and a
session in a `squad.*` Herdr space that joins no page gets a warning.
`gf handover <page> --session <addr> --reason <why> [--member <grill>]` appends a `squad-lead`
event: the newest names the page's lead member and session, replacing first-`lead: true`-wins.
Each handover maps the previous lead's address to the new one; every page delivery resolves
addresses through that map, so open questions follow the lead without copying or reloads.
A handover back to an address clears its own mapping. Orca transports are a follow-up.
Amends 0005 (routing) and 0008 (lead selection).
