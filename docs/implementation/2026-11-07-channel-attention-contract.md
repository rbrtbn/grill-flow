# Owner work and veto receipt contract

Version 1 extends `gf item <canonical-source> --file <record>` with owner steps, decisions,
evidence and blockers. Updates remain compatible. Every item has `version`, `kind`, source-local
`id`, expected `previous`, next `revision`, owning `session` and `body`. `title` and a source-local
`question` are optional. Item kinds cannot change. Source JSON is unchanged; revisions persist
through reload and retirement in the existing append-only event log.

## Owner steps

```json
{
  "version": 1, "kind": "owner-step", "id": "set-concurrency",
  "previous": 0, "revision": 1, "session": "t7",
  "title": "Set the run's concurrency", "body": "The run is waiting for this owner action.",
  "host": "rob-mbp", "destination": {"kind": "terminal", "address": "t7"},
  "action": "use concurrency 4", "urgency": "soon", "blockers": [],
  "progress": {"state": "open"}
}
```

`destination` is either an HTTP(S) link or the local terminal object shown above. The page only
copies `action` to the clipboard. A terminal jump resolves the published source/item/revision
and executes fixed argv `herdr-app do agent.focus --terminal <address>` without a shell.
The request cannot supply an address or action. Local tN syntax, trimming and length are
validated; remote forms and crafted options/control characters fail. Preview refuses focus.
`GF_OUTBOX` publication and remote import accept only link destinations: native focus is local
to the serving host. Remote focus has not been verified.

The source publishes completion in the next revision, preserving the other fields:

```json
{"state":"completed","proof":"https://example.test/evidence","checkedAt":1794052800000}
```

This is `progress`, not a separate page action. `checkedAt` is epoch milliseconds and cannot
be in the future. Optional `validUntil` makes proof expire. A withdrawal uses
`{"state":"withdrawn","reason":"The action is no longer needed."}`. The page archives completed
and withdrawn steps and identifies proof as agent-reported. Grant steps remain copy-and-jump;
they never submit grant text or alter a grant log's typed-word check.

## Provisional decisions and vetoes

```json
{
  "version": 1, "kind": "decision", "id": "nightly-choice",
  "previous": 0, "revision": 1, "session": "t7",
  "title": "Run tonight", "body": "The exact provisional ruling.",
  "deadline": 1794139200000, "affected": ["Nightly work"],
  "resolution": {"state":"provisional"}
}
```

The server evaluates the epoch-millisecond deadline. An elapsed window remains visible and
accepts an explicitly late request. The existing page event endpoint accepts
`kind:veto-requested`, canonical `source`, local `item`, `revision` and a client `requestId`.
It rejects another page's source, a changed decision and a reused request ID with different
identity. It freezes one version-1 source receipt before transport, with exact body, deadline,
recipient, recorded time and late flag. Concurrent requests for the same revision share it.

The source grill plus receipt event ID is the durable identity, for example `source-name#72`.
Transport uses one `<grill-flow source="page">…</grill-flow>` block at every length. It is a page
veto, never a typed grant or immutable answer submission. The lead copies each T1 receipt to
Linear; grill-flow does not write Linear.

A replay never repeats terminal delivery. Pending or failed delivery remains visible, including
a crash after freezing. The source can read it through `gf events` even without transport.
Network failures leave the page request retryable; a saved receipt prevents duplicate requests
for that decision revision. Delivery never implies that an action stopped.

The owning source publishes the next decision revision with optional responses:

```json
"vetoResponses": [{"receipt":72,"state":"acknowledged","text":"I received the request."}]
```

A later response can report `stopped` or `continued`, with exact explanation. Responses must
name this source decision's receipts. A confirmed outcome cannot be replaced by a conflicting
one. Responses remain visible across later revisions even when the latest record omits them.
The receipt retains its original wording separately from a revised decision. A decision's own
`resolution` may become `withdrawn` or `confirmed`, with a `reason`; that is a source report too.
No receipt or outcome activates PAGE authority or bypasses an independent guard.

## Evidence and named blockers

An evidence item uses the common fields plus a fixed provider reference, reported `state`,
HTTP(S) `proof`, `checkedAt` and `validUntil`. Provider references are either
`{"provider":"github","repository":"rbrtbn/squad","number":102,"kind":"pull"}` (or `issue`), or
`{"provider":"linear","id":"LAB-1280"}`. The check cannot be future-dated and expiry is at most
24 hours after the check. Provider polling is a later adapter; these records are agent reports.

A blocker uses `kind:blocker`, the common fields and exactly one `condition`:

```json
{"kind":"question","source":"member","question":"Q1","oneOf":["a"]}
{"kind":"owner-step","source":"member","id":"set-concurrency"}
{"kind":"provider","source":"member","evidence":"pr-102","reference":{"provider":"github","repository":"rbrtbn/squad","number":102,"kind":"pull"},"state":"merged"}
```

A question condition requires a saved answer with captured wording that still matches its
published page, and an allowed key. A legacy or reworded answer is unknown. Owner conditions
require reported completion with current proof. Provider conditions require fresh evidence
for the exact named reference and state. Missing, future, expired or mismatched evidence is
unknown. A merged PR clears only that PR condition, never a separate owner or grant condition.

The page shows the derived state, checked time, canonical question and available proof links.
No record supplies a shell checker, and no arbitrary URL is fetched. These display conditions
confer no execution or grant authority.
