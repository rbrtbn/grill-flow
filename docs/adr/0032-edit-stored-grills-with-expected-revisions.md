# 0032. Edit stored grills with expected revisions

- Status: accepted
- Date: 2026-11-14
- Scope: grill-flow

## Decision
Agents edit the stored grill in place: `gf get` reads it (or one RFC 6901 pointer) with its rev,
`gf question add|update|resolve` and `gf patch` (RFC 6902) change it, and each edit is an ordinary
`loadGrill` load, so revisions, reasons, squad registration and the reload guard all apply.
Writes take `--expect-rev`: a stale one exits 3 with the current rev and a field diff, checked in
the load's transaction. Edits require it and `--reason`; `gf load` warns without it until
`GF_REQUIRE_EXPECT_REV=1`. Writers validate strictly: unknown keys are errors (warnings in a grill
declaring a newer format) and every problem is reported with its pointer; reads and host imports
stay lenient (0001). Edits are refused under `GF_OUTBOX`. Guide revision 5 teaches this.
