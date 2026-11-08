# 0021. Package an opt-in Claude page-write guard

- Status: accepted
- Date: 2026-11-08
- Scope: grill-flow

## Decision
Package a bounded Claude Bash command-text guard without auto-registering a plugin hook.
Refuse visible page mutations, token reads and named store opens lacking explicit read-only mode.
Classify stdin without executing commands, reading protected files or echoing input.
Malformed relevant input denies; supported clients block hook failures and timeouts too.
An explicit per-account installer preserves other settings, backs them up privately and is idempotent.
Rob enables the guard through an owner step; packaging does not imply installation or authority.
Indirect scripts, browser tools, other runtimes and same-user storage writes remain accepted limits.
