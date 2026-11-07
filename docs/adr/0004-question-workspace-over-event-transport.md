# 0004. A question workspace over the existing event transport

- Status: accepted
- Date: 2026-11-06
- Scope: grill-flow

## Decision
Use the chosen single reading flow with a discussion drawer and answer-table review.
Keep answers, notes, asks, revisions and sends in the existing event store; no database migration.
Give each question a route, add the whole-run ask target `run`, and accept an optional explicit
answer selection on Send. A selected send records only its delivered lines.
The original concept, card and issue routes remain reachable; rich content keeps one renderer.
Owner steps and squad-wide live status need a separate data contract, beyond existing grill data.
Design source: `prototype/squad-conversations` at `a95f7c3` (chosen edition).
