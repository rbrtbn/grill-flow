# 0022. Keep the runtime inbox pilot fixture-only

- Status: accepted
- Date: 2026-11-08
- Scope: grill-flow

## Decision
Prove pull, explicit acknowledgement and handover in an explicitly owned temporary event store.
Freeze source/thread/message and exact recipient runtime/process/epoch with every envelope.
Keep transport evidence separate from consumption and reject stale or mismatched acknowledgements.
Model native observations only as fixtures; every CLI result states productionReady:false.
Require explicit pilot flags before database access, with no production API or delivery changes.
The existing hc path remains live.
Real runtime evidence, enrollment and activation need Rob's decision.
This proves the local protocol without mistaking fixture success for unattended runtime capability.
