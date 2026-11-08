# 0020. Preserve picked options on source reload

- Status: accepted
- Date: 2026-11-08
- Scope: grill-flow

## Decision
Before mutating a loaded source, retain each current saved non-custom pick's question and key.
Refuse moving its old label/effect pair to another key while repurposing the selected key.
Allow ordinary wording changes and retain immutable answer-time context beside sendRevision.
Apply the same rule to local loads, cached outbox validation and authoritative remote imports.
Refused remote files stay retryable; only an accepted import advances its file stamp.
Deliberate page clearing or changing a pick can release the constraint; loading cannot clear it.
Already removed historical answers remain readable, without retroactively inventing source wording.
