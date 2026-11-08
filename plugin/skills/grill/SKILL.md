---
name: grill
description: Run a structured interview or publish source-owned questions and updates on a local grill-flow page. Use when the user asks for grill-flow or a page-based grill.
---

# Grill on grill-flow

The checkout is `~/repos/rbrtbn/grill-flow`; below, `gf` means
`bun run --cwd <checkout> gf`. Without the checkout, conduct the interview
in chat.

1. Run `gf --skill` and read the complete guide. It owns authoring,
   delivery, routing, examples and constraints. Keep its revision with the
   guide in context.
2. Before each load, item, revise, reply or draw, run
   `gf --skill --if-newer-than <revision-read>`. Read the full replacement
   when changed. After context loss, fetch the full guide rather than only a
   version.
3. Follow the guide and declare `--skill-revision <revision-read>` on the
   write. A warning during migration preserves successful publication; apply
   changed guidance to the next write or make a deliberate correction.

Use the same retrieval with `GF_OUTBOX` for remote writing. Read its cached
or unverified label honestly, and read host import warnings through
`gf state`/`gf wait`. The guide describes how questions, updates, asks,
answers and revisions reach the page.
