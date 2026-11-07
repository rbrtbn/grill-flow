# 0013. Use independent round scope in the sidebar

- Status: accepted
- Date: 2026-11-07
- Scope: grill-flow

## Decision
Sidebar G separates labeled app destinations, round scope and the scrolling question tree.
Quick views replace status and urgency together while preserving scope and search. Attention
means Open with Blocking or Soon urgency. Custom filters expose the same underlying values.
Round scope is stored per grill in existing workspace preferences; old Agent grouping becomes Round.
A reload restores independent scope even when the main question belongs to another round.
Explicit question navigation reveals its target round; browser navigation metadata distinguishes
initial deep links from reloads, regardless of settings and snapshot completion order.
Names are trimmed with a Round N fallback. Existing dependencies, routing and send state survive.
