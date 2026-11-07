# 0005. Route answers to asking sessions

- Status: accepted
- Date: 2026-11-07
- Scope: grill-flow

## Decision
A lead's page gathers several agents' questions; routing everything to the lead loses direct discussion.
Version 4 adds optional question `session`; absent or blank uses the grill session.
Display sources never route messages. Send groups selected answers by recipient and records receipts.
Partial failures preserve successful deliveries and leave failed answers unsent for selective retries.
Question discussions share this route. The `grill-flow` target uses a configured maintainer session.
Remote imports qualify question addresses; reply commands point to each recipient's machine.
Keep the existing event store and canonical answer lines; no database migration.
