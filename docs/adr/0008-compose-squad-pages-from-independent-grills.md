# 0008. Compose squad pages from independent grills

- Status: accepted
- Date: 2026-11-07
- Scope: grill-flow

## Decision
An optional v4 `squad` membership joins a source grill to one virtual squad page.
Members own their files, rounds and events; the lead may pin an Open for you step.
Allocate shared question and round identities transactionally in registration events.
Read composition and route every write, ask and send back to its canonical source.
Keep local IDs in deliveries and outboxes; preserve successful partial-send receipts.
Old pages share the same records and remain usable without migrating their history.
Use the existing remote pull for cross-host members; no shared multi-writer JSON.
