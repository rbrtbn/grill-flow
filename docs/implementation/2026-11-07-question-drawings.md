# Question drawings

Draw this requests a comparison table or flow from the question's owning session. It does not
answer the question, submit drafts or interpret a discussion comment as a response.

The event endpoint receives `kind: drawing-requested`, the displayed question, its published
`contextRevision`, the preceding request event ID (`previous`, initially 0) and a fresh
`requestId`. The server resolves the canonical source/question through the page registration.
Before transport it saves the exact title, scope, ask, options, route and display context in a
`drawing-requested` event. Identical requests replay; conflicting identities or preceding
requests fail. Delivery uses the ordinary page-marked terminal transport.

Transport evidence is a separate `drawing-delivery` event. A saved request without evidence,
including a crash between saving and transport, remains visibly unconfirmed. Replays never
silently redeliver. Failed requests can be requested again; an unconfirmed request remains
available through the source's events and remote `gf wait --since 0` pickup. No runtime
consumption or owner acknowledgment is inferred from transport success.

## Responding

Write raw diagram JSON to a file. A table uses frozen option keys plus `now`:

```json
{
  "kind": "compare",
  "now": "Today",
  "rows": [
    {"label": "Owner", "cells": {"now": "Unassigned", "a": "One named owner"}}
  ]
}
```

A flow uses named lanes, ordered steps and switchable states:

```json
{
  "kind": "flow",
  "title": "Request to response",
  "lanes": [{"id": "owner", "label": "Question owner"}],
  "steps": ["Read", "Reply"],
  "states": {
    "now": {"nodes": {"owner": ["Read frozen wording", null]}},
    "a": {"nodes": {"owner": [null, "Publish drawing"]}}
  }
}
```

```bash
bun run gf draw <source-grill> <local-question> --request <event-id> --file diagram.json
```

The initial response revision is 1. To revise it, use `--previous 1 --revision 2`. Revisions
are immutable and sequential per request; identical replays are harmless. The saved request
must belong to that source and local question. The server bounds the payload to 100,000
characters, 100 comparison rows, 12 flow lanes, 80 steps and 16 states, and validates referenced
choices, lanes and band positions. It renders data through the existing diagram components;
HTML, SVG and executable diagrams are not response formats.

With `GF_OUTBOX`, the command queues `drawings/<request>-<revision>.json`. Import retries
unmet revisions, validates against the serving host's frozen request, and never replaces an
accepted file. The returned `state.json` includes accepted drawings. Queued is not published.

## Reading

The page shows the latest request per canonical source question, its delivery state and latest
accepted response. Prior events remain in history. Response labels come from frozen options;
current question wording never rewrites them. A changed wording hash marks the drawing stale,
removes current-answer highlighting and permits a fresh request. A new request does not borrow
an older request's response. Answer controls and uncontrolled editors retain their identity
across drawing polls. Older snapshots without drawings remain readable.
