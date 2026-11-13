# 0028. Show ask delivery and offer the grill session

- Status: accepted
- Date: 2026-11-14
- Scope: grill-flow

## Decision
Each ask carries its latest `sent` result (recipient, delivered or failed, hc's detail).
A failed ask names the recipient and Herdr's reason instead of waiting forever, and offers a
retry or the grill's session as a fallback; the owner chooses, nothing reroutes silently.
A redelivery keeps the ask id, so the `gf revise --ask` reply path is unchanged.
The server probes the maintainer session with `hc get` in the background (15 s) and the
Grill-flow tab says when it is stopped or no longer in Herdr; probes never block a poll.
Extends 0005: the route stays the asker's session; only delivery becomes visible.
