# 0010. Mark page deliveries as page messages

- Status: accepted
- Date: 2026-11-07
- Scope: grill-flow

## Decision
Every terminal delivery starts with `<grill-flow source="page">` in the same text block as its body.
Apply the wrapper at the shared terminal transport, covering asks and answer batches at every length.
The wrapper marks page input as refusable markup even when Herdr caller identity is missing.
It establishes neither human authorship nor PAGE authority and does not use the reserved grant tag.
