# 0018. Project activity with browser-local read cursors

- Status: accepted
- Date: 2026-11-08
- Scope: grill-flow

## Decision
Project What changed from existing source events; retain canonical source/event identities.
Bound the returned feed to 300 entries and retain source high-water marks for honest unread counts.
Save seen cursors only in compact browser preferences, independently of answers and authority.
Keep recorded excerpts frozen while deriving Needs action from the current published state.
Source-qualified links reveal exact receipts, replies and items, including archived items.
Open native archives once and wait for font layout before scrolling; later user toggles remain intact.
Older reloads without change metadata report that detail as unavailable rather than reconstructing it.
