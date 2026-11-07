# Squad channel: interfaces and delivery order

Status: steps 1–4 approved by t124; step 5 and notifications require a new check-in.
Source: grill-flow-squad-channel, round 1, submitted event 1959 on 2026-11-07.
Selections: Q1–Q12 a except Q8 b; Q9 also requests page notifications.
Issue descriptions checked through a rbrtbn Linear snapshot at 2026-11-07T17:20:21Z.

## Scope and order

1. Review the ordinary-answer receipt format with t10m; keep PAGE authority disabled.
2. Add updates, ordinary answer history and source-qualified links.
3. Add owner steps, provisional decisions and evidence-backed blockers.
4. Add Draw this, the label-based roster, live reference refresh and What changed.
5. Prove one pull runtime adapter before changing delivery defaults.
6. Add opt-in browser notifications after stable event identities and deduplication.
7. Add phone/Slack push later; destination setup and sending need their own explicit choice.

Retire/restore shipped in 4c10e52 under ADR 0009. Ordinary page wrappers shipped in ad52466
under ADR 0010. The independent Command-click request shipped in 035c5c0 before these steps.
Other-profile filtering remains outside that change pending squad-lead-21.

## Shared implementation

Keep canonical source ownership in `server/squad.ts`: a shared page remains a projection.
New items retain source grill, local item/question ID and recorded event ID separately.
Never use a shared Q number as the durable identity of a source-owned item.

Use the existing SQLite event table. Add event kinds and optional Snapshot fields rather than
new tables or a second source store. A source reload cannot erase agent-published items or
receipts. Keep remote imports immutable and idempotent using the existing file ledger.

Introduce a channel module for item validation, revision rules and projections. Put delivery
envelopes and acknowledgement transitions behind a separate delivery module. Keep provider
refresh/checking in an evidence module with fixed adapters and bounded caches.

Use the installed Effect Schema types and Foldkit model/message conventions. Add no dependency.
Old snapshots default new collections to empty. Source JSON additions are optional and use the
next grill format version, with the existing newer-format notice for older readers.

## Proposed public changes by part

| Part | Interface and visible result | Code lines | Test lines |
|---|---|---:|---:|
| Q1 updates | `gf item <source> --file <record>`; an update has no answer or send state | 250–450 | 150–250 |
| Q2 Draw this | scoped drawing request and `gf draw <source> <question> --request <id> --file <diagram>` | 200–400 | 150–250 |
| Q3 queue proof | `gf inbox`, explicit acknowledgement, one verified turn-boundary adapter | 800–1,400 | 500–900 |
| Q4 grant contract | immutable readback and later `gf grant`; no authority activation in this phase | 200–400 | 150–300 |
| Q5 owner steps | owner-step item, proof link and explicit owner-reported completion | 350–650 | 200–400 |
| Q6 veto receipts | provisional-decision item and source-owned veto receipt | 250–450 | 150–300 |
| Q7 roster | read existing Herdr labels and observed process state | 300–550 | 150–300 |
| Q8 links/status | source-qualified URLs and fixed-provider cached refresh | 450–850 | 300–500 |
| Q9 urgent push | after delivery proof; opt-in browser control is the first destination | 400–700 | 200–400 |
| Q10 blockers | typed condition and evidence reference; derive status | 400–700 | 250–450 |
| Q11 What changed | source-qualified activity feed and durable per-reader cursor | 300–500 | 180–300 |
| Q12 exact words | immutable ordinary-answer context and wording-change comparison | 250–450 | 180–300 |

Ranges are the research estimates, not a promised exact diff. Shared work must not be counted
twice. Runtime installation, other-repo work and notification-channel provisioning are separate.

## Item publication: updates, owner steps and decisions

One versioned `gf item` record carries `kind`, local `id`, `revision`, owning session, body and
optional related question. The serving process records time; callers cannot backdate it.
Publish revisions with an expected prior revision. Replaying an identical record is idempotent;
conflicting content at the same revision fails without overwriting the accepted item.

An update may supersede another update. An owner step adds host/destination, exact action,
urgency, reason, related blockers and a completion record with proof URL and checked time.
A grant-related owner step offers copy-and-jump only, following LAB-1280.

A provisional decision adds exact decision text, affected items and a server-checked deadline.
Veto appends a source-owned request with its own stable ID. Requested, delivered, acknowledged
and outcome-confirmed are distinct states. Late requests remain visible as late requests.
The lead consumes T1 veto receipts and records them in Linear; grill-flow does not write Linear.

Remote publishers use immutable item files beside their existing revisions. Import never edits
another member's grill JSON, and central events keep the original remote item identity.

## Exact answer context and stable links

Draft the Q12 capture format with t10m using the companion page-answer contract. Ordinary
answer receipts are useful before page grants are enabled and carry no new authority.

Capture title, scope, ask, selected option label/effect, own text, note, local question ID and
published revision. At Send, freeze the chosen answer-event identities, expected lines and
source/recipient mapping. Later source edits do not rewrite the receipt or revoke old answers.
Mark missing historical context unavailable; never rebuild it from the newest source JSON.

Resolve `/g/<shared>/question/<local>?source=<source-grill>` through the existing registration.
Existing shared-Q URLs retain their meaning. A source-qualified local ID may resemble a shared
Q number; the explicit source wins. An ambiguous unqualified local ID is never guessed.
Retired source links can lead to their preserved direct page rather than inventing membership.

## Draw this

The page adds a small request action beside Discuss. A request carries the canonical question,
its published revision and an ask/event ID, routed to the current owning session.
The diagram response uses the existing validated Compare/Diagram data, not parsed comment text.
Show empty, requested, ready, failed and stale states. Keep answer controls visible and preserve
editor nodes/focus across polling. A changed question marks its old drawing stale.

## Queue proof and runtime identity

Read LAB-1327, LAB-1123 and LAB-875 before implementation. LAB-1327's relay design has an open
owner gate. LAB-875 retains its Artifact-specific contract; a local web queue does not close it.

An immutable envelope contains source/thread, message ID, reply-to ID, sender kind, recipient,
body, recorded time and question revision when relevant. An agent's claimed identity stays a
claim unless a runtime adapter independently verifies its exact membership and native UUID.
Keep Claude and Codex native IDs in separate namespaces; a Herdr address is only a route.

`gf inbox` reads pending envelopes at an explicit agent turn boundary. Acknowledgement names
the envelope and verified recipient binding. Replays do not acknowledge a different session,
and unknown/reused routes remain pending or fail explicitly. Transport success is not consumption.

The first proof uses a controlled local adapter and synthetic fixtures for retries, source
handover, unknown capability and acknowledgement. A pull command alone is not unattended runtime
support. Do not install hooks, alter runtime settings or claim native capability from fixtures.
Coordinate with LAB-1123/LAB-1114 owners before an actual unattended runtime pilot.

Until a pull adapter is verified, any existing terminal delivery must be explicitly tagged as
the page. A proposed ordinary-message wrapper is `<grill-flow source="page">…</grill-flow>`;
it carries no grant marker or human-authorship assurance. Never fall back to bare terminal text.
Do not emit a LAB-1310 `<gf grill=… send=…>` marker before its reader contract is approved.

Keep the existing remote bridge. It returns envelopes, responses and acknowledgement records
through the outbox; it does not need a remote HTTP listener or a second dispatcher.

## Roster and evidence

Read Herdr `squad.profile`, `squad.role` and, when present, `squad.run` labels, plus observed
terminal state. Do not infer membership from titles, folders or a `where` label. Use cached
`hc get` details when `hc ls` omits labels. Missing labels and unavailable hosts remain unknown;
the roster never writes labels or invents a parallel membership registry.

Join labelled sessions to their published page/run links and explicit owner waits. A Core
blocked status is not necessarily blocked on Rob. Budget values appear only from a supported,
dated account-scoped report; missing/shared budgets must not become per-agent allowances.

For Q8, fixed GitHub and Linear adapters refresh only validated provider references, with
bounded caching, checked-at times and explicit stale/error states. Keep credentials server-side.
Never fetch arbitrary URLs from grill content or run arbitrary check commands from JSON.
Permitted provider access and identity must be verified before live polling is enabled.

Blockers name typed conditions: an answered source question, an evidenced owner step, or an
identified provider item/state. Clear only that condition. Missing/stale evidence yields unknown,
not permission to proceed. A merged PR cannot satisfy an independent grant requirement.

## Activity and notifications

What changed projects the existing events plus the new item/receipt events. Its cursor uses
stable source/event identities; a composite page's shared-number allocation is not a read ID.
Reading an update does not answer a question, acknowledge agent consumption or grant permission.

Browser notifications require an explicit page action and the browser permission prompt.
Show unsupported/denied states honestly. Start with a running-page notification adapter;
closed-page or phone delivery is a separate capability, not implied by browser permission.
Persist one notification attempt per source item/urgency transition to avoid replay spam.

## Validation and coordination gates

Test all new records through their public CLI/event interfaces with synthetic source grills.
Cover legacy decoding, partial sends, retries, remote reimport, stable shared mappings and
source ownership. Use Foldkit story/scene tests for state and accessible UI flows, then inspect
the built interface at desktop and narrow widths. Browser sends must use intercepted endpoints.

T124 approved steps 1–4, and t10m reviewed the page contract. Check in before the runtime pilot
and notifications; stop at the current commit if Rob vetoes the pinned scope.
No page grant composer, PAGE activation, grant-source/profile change, guard installation,
other-repo edit, new dependency or remote runtime deployment is part of this proposal's approval.
