# 0009. Retire source grills with events

- Status: accepted
- Date: 2026-11-07
- Scope: grill-flow

## Decision
Retire and restore a source through append-only events on the serving machine.
Hide retired sources from the catalog and shared composition, retaining source URLs and history.
Keep registration identities reserved so restoration preserves shared question and round numbers.
Source reloads and remote imports do not change lifecycle state; only explicit restore does.
Keep the existing tables and source format; retirement is optional snapshot metadata.
Other profiles and unretired sources keep their existing discovery behavior.
