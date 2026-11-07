# 0017. Refresh only validated provider references

- Status: accepted
- Date: 2026-11-07
- Scope: grill-flow

## Decision
Fixed read-only provider adapters refresh canonical GitHub and Linear references in a bounded cache.
Check GitHub account identity and pin Linear's organization through a known immutable issue UUID.
Project normalized state and freshness without rewriting source grills or storing raw responses.
Persist meaningful reading changes in the existing event table, with canonical source ownership.
Conflicting shared reference keys lose their link; stale and unknown readings never become success.
Primary evidence evaluates only its exact provider condition, independently of owner or grant blockers.
This keeps current link state useful without accepting arbitrary fetches, commands or authority.
