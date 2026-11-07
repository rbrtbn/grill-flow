# 0012. Publish source-owned updates and read models

- Status: accepted
- Date: 2026-11-07
- Scope: grill-flow

## Decision
Agent updates are versioned source-owned items, not questions or answers. An expected previous
revision prevents overwrites; identical revisions replay, conflicting ones fail, and events remain.
Source reloads cannot erase updates. Remote outboxes publish immutable item files; only accepted
imports enter the file ledger, so an unmet revision can be retried after its predecessor arrives.
Read models retain canonical source identity and original text beside separately mapped display text.
Answer history uses immutable submissions; missing legacy context is never rebuilt from current prose.
A source-qualified local question URL resolves through registration; explicit source wins over shared
numbers, and retired members redirect to preserved source pages. Updates confer no page authority.
