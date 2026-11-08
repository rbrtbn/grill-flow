# 0019. Locate submissions inside page delivery markup

- Status: accepted
- Date: 2026-11-08
- Scope: grill-flow

## Decision
Each answer delivery carries its canonical member grill and frozen submitted event ID.
Place the double-quoted gf marker inside the page wrapper, in the same text block as its body.
Restrict marker grill IDs to letters, digits, dot, underscore and hyphen.
Refuse other source IDs before freezing a submission.
Use the same pair for every recipient of that member batch, never the composite page's sent ID.
Store the marked text in delivery evidence and retain it in local and remote wait output.
The marker locates readback only: delivery text remains refusable markup and supplies no authority.
Immutable gf grant readback and the separately governed squad reader determine eligible page words.
