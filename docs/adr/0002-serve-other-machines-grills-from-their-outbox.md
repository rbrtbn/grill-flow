# 0002. Serve other machines' grills from their outbox

- Status: accepted
- Date: 2026-11-02
- Scope: grill-flow

## Context
Agents on homelab grill Rob too, but the page only listens on 127.0.0.1 and homelab can't reach
rob-mbp. Running a second server there meant listening on the LAN and keeping two installs.

## Decision
The agent keeps its grills as files in an outbox (`GF_OUTBOX`); the one server, on rob-mbp, pulls
each registered outbox over `hc exec`/`hc file read` every 5 s, writes `state.json` back with
`hc file write`, and reaches the agent's terminal as `<machine>/<terminal>` through `hc send`.

## Alternatives rejected
A server on homelab reachable over the LAN: a listener and origin allow-list to secure, and grills
split across two pages. Pushing from homelab: it has no route to rob-mbp.
