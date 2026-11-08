# Page answer readback: contract draft for t10m

Status: reader contract reviewed by t10m; ordinary capture approved, PAGE activation held.
Owners: grill-flow page/storage/CLI; t10m for LAB-1310 and LAB-1303's squad readers.
Basis: LAB-1310 as fetched from Linear on 2026-11-07T17:20:21Z; Q4 a and Q12 a in send 1959.

## Policy kept

LAB-1310's accepted choices stay intact: sent page answers may become PAGE-labelled grants
under its shipped reader; later rewordings keep counting; the chosen instruction/Claude-hook
guard has its documented limits; grant-source/guard changes still need typed authority.
Do not impose a stronger human-proof policy as an extra implementation gate.

Until LAB-1310 ships and its existing hold clears, all records described here are ordinary
answer history. No page grant composer, submit-grant control, PAGE eligibility flag or grant
text submission is introduced. LAB-1280 owner steps remain copy-and-jump for typed grants.

## Capture at answer time

The server publishes a stable revision digest for each question's visible context. Retain its
title, scope, ask and option labels/effects as a versioned immutable context. The digest is a
content identifier, not proof of human authorship.

A new page client submits its published context revision with the answer. Validate that it
matches the served context; reject a newly stale answer with a conflict instead of substituting
new wording. Preserve the draft so Rob can read the change. Already recorded answers remain
valid after later edits, as LAB-1310 requires.

Record the canonical source grill/local question ID, displayed page/shared ID, round,
answer-event ID, context revision, selected option key/label/effect, own text, note and time.
Keep displayed wording separate from canonical IDs, since shared composition rewrites Q links.
The browser cannot supply a trusted sender kind, server time or grant classification.

Legacy clients and historical answers without verified context remain readable but are marked
context-unavailable. Do not reconstruct their original words from the current source file.
Legacy/context-unavailable records are never PAGE; the reader fails closed and asks for a new
answer.

## Freeze at Send

Before delivery, record one immutable submission per canonical source batch. Allocate its
source send/event ID in the same transaction that freezes selected answer-event IDs, exact
context, expected lines, optional message and recipient mapping.

Keep a client request ID separate from this canonical send ID. Repeated requests with the same
request ID/content return the original submission. The same request ID with different content
conflicts. Record transport attempts and acknowledgements separately from the frozen selection.

A shared-page Send can contain several source batches. Each tag/readback names one source and
its own send ID; do not present a composite shared Q number as the source's canonical identity.
Successful recipients and failed recipients retain distinct receipts during partial delivery.
An acknowledgement from a new/reused recipient cannot settle the old recipient's envelope.

The future PAGE reader uses committed submissions; delivery state is evidence only. A failed
delivery does not alter the frozen submission. Message-only sends default to not PAGE in v1;
this is t10m's fail-closed recommendation, pending Rob at LAB-1310's gate.

## Reserved reader interface

After t10m accepts the contract, the proposed command is:

```text
gf grant <source-grill-id> <source-send-id>
gf grant --version
```

It is read-only. It returns versioned JSON for exactly that source/submission, or a nonzero
error for an unknown source/send, unsupported version or missing required context. The version
probe advertises supported integer version 1. A shared
page ID cannot silently resolve an ambiguous source send. The command never creates a receipt,
rewrites history, records a grant-log entry or claims TYPED/PAGE on its own.

Proposed JSON fields:

- `version`, canonical `grill`, `send`, stable `requestId`, and server `recordedAt`.
- `displayPage` and the source/local-to-shared question mapping frozen for that submission.
- `answers[]`: local question, round, answer event, published revision, visible title/scope/ask,
  selected key/label/effect or own text, and note. Missing context is explicit.
- `message`: the extra text Rob included with that Send.
- `deliveries[]`: intended recipient, transport attempts, pending/delivered/failed/acknowledged
  state and evidence IDs. Route identity is distinct from verified native runtime identity.

The future transport marker is LAB-1310's `<gf grill=… send=…>`. Its values point to readback;
its body is not authority. The reader looks up the immutable record and independently applies
its accepted source/profile/hold rules. The ordinary page-message wrapper is distinct from it.
Every delivery, including ordinary messages, starts with refusable markup in the same text block
as its body, at short and long lengths; no body-only delivery path is permitted (ADR 0010).

## Provenance limits

Record the surface as page and retain its origin/cookie checks, but do not call those checks
human authentication. Herdr environment tags, writable labels and native user-role input do
not establish that Rob authored a submission. LAB-1327's relay design remains owner-gated.

Implement the instruction and Claude guard chosen in LAB-1310 only in its approved work.
It does not protect browser tools, file-generated scripts or Codex. No new claim of protection
for those clients appears in this format, UI or CLI output.

## Reader owner's resolved interface choices

1. JSON version 1; the canonical source send ID is its immutable submission event ID.
2. Committed submissions count; delivery is evidence. Message-only sends default to not PAGE
   in v1, pending Rob's decision at LAB-1310's gate.
3. Legacy/context-unavailable records are never PAGE; never backfill from current wording.
4. Ordinary receipt capture and wording comparisons can ship while PAGE remains held.
5. Ship refusal markup first, then readback with a version probe, then the separately gated squad
   reader. A missing command or unsupported version is BLOCKED, never PAGE.

This review fixes the interface, not LAB-1310's design gate or authority rollout. The review
lives in the owning run at `design/t118-page-contract-review.md`.

Contract tests should cover rewording after answer/send, identical option keys with changed
meaning, source composition, request replay/conflict, partial sends and an agent-forged tag.
No fixture or tag alone may manufacture a PAGE grant.

## Ordinary capture implementation

The implementation freezes `answers[].sendRevision` beside the original `context.revision`.
Rewording between answer and Send is visible without rewriting the answer. Only
`answers[].context`, `key`, `own` and `note` are page words. `message` and `lines` are not
closure text or authority in v1; a later reader must not promote either field.

A future grant cites the canonical member grill and its submitted event ID (for example, the
member `squad-grants` and its own ID), never `/g/squad` or the page-level sent event.
The reserved marker must carry that same source/submission pair.

The probe returns `{"versions":[1]}`. Exit 3 denotes unavailable/legacy context or a message-only
send; other nonzero errors use exit 2. The later reader maps those to NOT PAGE and BLOCKED,
respectively. Until remote readback is implemented, `GF_OUTBOX` fails explicitly and tells the
caller to run on the serving machine.

Request replay returns the original committed evidence without repeating terminal transport.
If a crash interrupts delivery after freezing, the page lists the source/submitted ID as
unconfirmed and keeps its unsent drafts available for review. A replay cannot silently hide it
or manufacture a delivery receipt.

## Submission marker

Answer batches now carry `<gf grill="member-id" send="submitted-id">` inside the ordinary
page wrapper, in the same text block as the body. Attributes are double quoted; source IDs
use only `[A-Za-z0-9._-]+` and send IDs are positive safe integers. Invalid source IDs refuse
delivery before any submission is frozen. Every recipient of one member batch receives the
same pair, which is retained in delivery receipts and wait output. Message-only submissions
may carry a locator but remain ineligible readback. Asks and drawings have no submission tag.

The marker changes no authority classification. T10m checked synthetic short and long messages
against PR 121 head 29820f96: all 16 string/block/paste shapes remain NOT TYPED, including its
strict mid-turn path. Only the independently checked immutable readback supplies page words.
