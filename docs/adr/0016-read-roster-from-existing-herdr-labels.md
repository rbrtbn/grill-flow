# 0016. Read the roster from existing Herdr labels

- Status: accepted
- Date: 2026-11-07
- Scope: grill-flow

## Decision
Squad roster membership comes from exact Herdr profile labels, with role/run/host metadata.
A bounded background cache reads only fixed ls/get argv and retains dated stale observations.
Core status and explicit page waits remain separate; route matches do not verify runtime identity.
Raw terminal output is not returned or persisted, and the roster offers no terminal actions.
Budgets stay unreported until an account-scoped supported source exists.
This avoids a second membership registry and prevents task progress from becoming quota.
