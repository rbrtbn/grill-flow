# Squad two-way channel: feature choices

Verified 2026-11-07 against grill-flow `c5e00c2`, installed hc 0.1.18,
the lead brief, squad ADR 0042 and read-only Linear issue lookups.
This is research and a discussion round. No feature implementation is
authorized by this document.

## Recommendation

Build updates, on-demand drawings and stable question links as bounded
improvements.
Prove queued delivery and sender attribution before promising paste-free
conversations.
Keep Rob’s accepted page-grant policy; coordinate its proof/readback work with
its owner.
Owner steps, vetoes, roster, blockers, catch-up and answer receipts can share
the event spine.
Do not add push or budget collectors just to make the first version look
complete.

## Current capability and limits

- Replies, comments, diagram blocks, direct question routing and remote
  outboxes already work.
- hl already returns page comments/replies through the outbox; a missing
  direct hc route is not a missing file-return path.
- The maintainer discussion tab already reaches t94; arbitrary non-run agents
  are not registered threads.
- `gf wait` can read stored asks and Sends; it is not a general acknowledged
  message inbox.
- Core `terminal.send` is explicitly terminal paste. `doc.set` is CAS, at most
  1 MiB.
- Core lifecycle/doc events do not deliver structured messages into a model by
  themselves.
- Core Status progress is task progress; the schema has no budget/quota
  reading.
- Origin/cookie checks prevent other sites writing casually; they do not prove
  human authorship.
- The exact Codex tool shell has no HC_* variables. An explicit t94 self-send
  was also visibly untagged.
- Self-send wrapping may differ. Cross-session attribution is still
  unverified, so lead reports use a file.
- LAB-1310 already records approved page grants and their Claude-hook/Codex
  limitations.
- LAB-1280’s old assertion that page discussion is absent is superseded by
  shipped code.

## Size guide

Estimates below are code/test ranges for a focused implementation, not
delivery promises.
Days assume one builder, a settled contract and existing provider access.
Runtime, squad,
Herdr Core and dotfiles changes need their own owning-repo work; no such files
were edited.
Shared foundations mean the rows must not be added into one giant build
estimate.

| #   | Feature                                      | Usefulness                                         | Recommended next step                         |
| --- | -------------------------------------------- | -------------------------------------------------- | --------------------------------------------- |
| 1   | Updates without a question                   | High                                               | Add updates without a question                |
| 2   | Draw this question                           | High                                               | Add Draw this                                 |
| 3   | Talk to any agent without terminal pastes    | Very high                                          | Prove the queue and one runtime adapter first |
| 4   | Grants on the page                           | High, with a trust requirement                     | Finish the proof and readback contract first  |
| 5   | Owner steps with proof                       | High                                               | Add owner steps with proof links first        |
| 6   | Decisions you can veto                       | High                                               | Add veto with a receipt                       |
| 7   | Who is working, and where                    | High for the roster; medium for budget integration | Add the roster; keep unknown budgets blank    |
| 8   | Fresh issue chips and links that stay useful | High for stable links; medium for constant refresh | Add stable links and freshness first          |
| 9   | One alert when something becomes urgent      | Medium                                             | Do it after reliable delivery                 |
| 10  | Blocking lines that clear when work finishes | High                                               | Tie blockers to evidence                      |
| 11  | What changed while you were away             | High                                               | Add What changed                              |
| 12  | Show the exact words you answered            | High                                               | Keep exact words and show changes             |

## 1. Updates without a question

**Useful:** Information should not ask for a fake answer. Open for you
currently needs a dummy Seen option.

**Evidence:** The lead brief names Open for you and Q49. AgentReply and
replied events already hold information without a question; the current view
treats them as replies to Sends.

**How it would work:** Add an update item with a stable id, author, time,
optional related question and optional supersedes id. A proposed gf update
command appends it to the member source. Show updates in a quiet feed and the
relevant thread. Reading is separate from answering. Remote agents publish an
immutable update file through their existing outbox.

**Complexity:** 250–450 code lines plus 150–250 test lines; about one day.
Medium risk: repeats, superseded updates and unread state.

**Other owners:** grill-flow only for storage and UI; squad writers need a
publishing convention. No grant-policy change.

**Constraint:** An update must never create a draft answer, a grant or a build
permission. Keep high-volume progress out of the question list.

**Recommendation:** Build a first-class update item; reuse the existing event
store and remote pull.

Sources:

- [Event storage and snapshots][source-1]
- [Grill
- answer and snapshot schema][source-2]
- [Lead brief][source-3]

## 2. Draw this question

**Useful:** A table or flow can explain a choice faster than a long paragraph.
The existing renderer already does most of the drawing.

**Evidence:** The brief names the stage tables and the night-grant table.
Compare and Diagram support compare, zones and flow. There is no dedicated
timeline kind.

**How it would work:** Put a quiet Draw this link near Discuss. Open an empty
visual area only when requested, send a scoped ask to the owning agent, then
accept a versioned diagram response for that question. Start with compare
tables and flow; a timeline can be expressed as a flow until a real timeline
is justified. Reuse the renderer and show pending, failed and stale states.

**Complexity:** 200–400 code lines plus 150–250 test lines; about one day.
Medium risk: the reply must remain attached to the right version of the
question.

**Other owners:** grill-flow; agents must return the existing diagram JSON.
Uses current routing until a queued delivery choice is ready.

**Constraint:** A plain comment should not be silently parsed as a replacement
drawing. Keep the question and answer controls visible while the visual area
opens.

**Recommendation:** Add an on-demand visual area with compare and flow first.

Sources:

- [Diagram schema and rendering state][source-4]
- [Question discussion and starters][source-5]
- [Ask messages and reply targets][source-6]

## 3. Talk to any agent without terminal pastes

**Useful:** This is the central two-way channel. It also avoids mixing agent
messages with Rob’s words when terminal attribution fails.

**Evidence:** server/main.ts invokes hc send. gf wait reads recorded asks and
answer deliveries without requiring a terminal paste. hc 0.1.18 exposes
terminal.send, doc.get/set and lifecycle/doc events, but no named agent
inbox/claim/ack method. Today this Codex tool shell has no HC_* variables, and
the lead observed untagged reports counted as TYPED.

**How it would work:** Keep one durable message stream in grill-flow. Each
envelope has an id, thread, sender kind, sender session, recipient, reply-to
id, body, time and delivery state. Add proposed gf inbox/ack/message commands
and a pull delivery mode that retains the recipient’s session identity. A
runtime adapter consumes messages only at a safe turn boundary and records an
explicit acknowledgement. Page, agent and system messages use the same
envelope, while their authority stays distinct. Do not auto-paste as a
fallback.

**Complexity:** 800–1,400 grill-flow code lines plus 500–900 test lines; 2–4
days. High risk. Runtime adapters and a native Core integration are separate,
unmeasured work.

**Other owners:** Squad hooks/skills or runtime adapters are needed for
unattended delivery. Herdr Core need not change for a pull prototype; a native
solution would need inbox/claim/ack and structured runtime delivery in
dev.herdr.core. Its implementation and runtime support were not inspected.

**Constraint:** A queue alone does not wake or feed a model. doc.set is a
versioned document, capped at 1 MiB, not an unbounded message inbox. Display
names, HC_TERMINAL_ID and user-role terminal input do not authenticate Rob.
Local and remote reconnects must not lose or duplicate messages.

**Recommendation:** Design and prove one pull adapter first; verify sender
attribution before replacing existing delivery.

Sources:

- [Terminal delivery and event handling][source-7]
- [gf state
- wait and reply commands][source-8]
- [Agent-side outbox and news cursor][source-9]
- [Cross-host pull and state return][source-10]
- [Installed hc 0.1.18 schema][source-11]
- [Squad ADR 0042][source-12]
- [Sender-attribution incident and observations][source-13]

## 4. Grants on the page

**Useful:** You already approved page grants in LAB-1310. The remaining
problem is an honest record of what you approved and who submitted it.

**Evidence:** LAB-1310 records your Q25–Q30 decisions, including retained
grants after rewording and an instruction/Claude-hook boundary with a Codex
gap. Current answered events retain an option key and optional own text, not
the exact ask/label/effect. The write cookie checks origin and possession, not
whether a human acted. Today’s untagged agent reports show why inferred TYPED
is insufficient.

**How it would work:** Coordinate the approved page half with the grant-log
owner: immutable answer context, a stable send id/tag, read-only gf grant
lookup and a PAGE-labelled receipt consumed by the existing gate. Keep agent
and owner write paths distinct. Define what the permitted instruction/hook
boundary can and cannot prove before enabling authority. Stronger human-origin
assurance requires a separately trusted owner input/signing boundary; a local
cookie, DOM isTrusted or self-declared sender is not that proof.

**Complexity:** 200–400 grill-flow code lines plus 150–300 test lines, roughly
one day for the page half after the contract is fixed. Cross-repo end-to-end
work is larger; high policy/provenance risk.

**Other owners:** LAB-1310 in squad, the grant-log reader/gate, owner-approved
profile and guard changes in dotfiles, and the page half in grill-flow.
LAB-1303 owns the paste/source-label work. No other repo is changed by this
round.

**Constraint:** Do not silently relabel PAGE or an agent message as TYPED. The
accepted rewording rule remains in force; this proposal does not revoke
existing grants or reopen the approved source policy. Codex is outside the
planned Claude-only guard.

**Recommendation:** Keep the accepted grant plan, settle provenance with its
owner, then build the agreed page half.

Sources:

- [LAB-1310: approved page-grant plan][source-14]
- [LAB-1303: paste sources and covers][source-15]
- [Write-cookie and origin checks][source-7]
- [Stored answer event fields][source-7]
- [Squad ADR 0042][source-12]
- [Sender-attribution incident and observations][source-13]

## 5. Owner steps with proof

**Useful:** A merge, a reload or a typed command is a task, not a
multiple-choice question. It should say exactly what needs doing and where.

**Evidence:** LAB-1280 names the concurrency grant that stayed blocked after a
page answer. The current Needs you view still says No owner actions reported;
source prose carries the real steps.

**How it would work:** Give each owner step an id, owner session, host, exact
text or link, reason, blocker and urgency. Start with agent-reported
completion plus a proof link and time. Add fixed read-only checkers for PR
merged or a verified grant receipt later. A proposed gf owner command
publishes changes through each member source. Never execute arbitrary checker
commands supplied in grill JSON.

**Complexity:** 350–650 code lines plus 200–400 test lines; 1–2 days for
manual records and one narrow checker. Medium risk: stale evidence and
premature completion.

**Other owners:** grill-flow item/command/UI; squad writers publish and retire
their own steps. GitHub/grant readers or a host-side evidence publisher are
needed for automatic checks.

**Constraint:** Empty chezmoi diff alone does not prove the intended change
was applied on the right host/version. A grant step stays copy-and-jump until
the approved PAGE path is live.

**Recommendation:** Ship proper owner-step records with proof links first; add
selected checkers after that.

Sources:

- [LAB-1280: owner steps and questions][source-16]
- [Needs you and owner-step placeholder][source-5]
- [Cross-host pull and state return][source-10]

## 6. Decisions you can veto

**Useful:** A timed provisional decision is easy to miss in prose. You should
see its deadline, what changes and whether your veto arrived.

**Evidence:** The brief lists today’s T1 decisions and 24-hour veto windows.
decided is currently an id/text list with no deadline, response or delivery
state.

**How it would work:** Publish a structured provisional decision with author,
exact decision, affected item, expiry and status. A Veto link appends one
event and sends a message to its owner. Show queued/delivered/acknowledged
separately and keep the decision visible until the owner confirms the outcome.
Reuse the selected delivery method; avoid accidental double vetoes.

**Complexity:** 250–450 code lines plus 150–300 test lines; about one day.
Medium risk: expiry races, retries and decisions already acted upon.

**Other owners:** grill-flow and a squad convention for publishing decisions
and respecting veto receipts. Safe unattended delivery depends on the message
path.

**Constraint:** A browser click is a veto request, not proof that a running
action was stopped. The server clock determines the deadline and records late
requests honestly.

**Recommendation:** Add a veto item with an acknowledgement and clear expiry
state.

Sources:

- [Grill
- answer and snapshot schema][source-2]
- [Event storage and snapshots][source-1]
- [Per-source/session answer delivery][source-17]
- [Lead brief][source-3]

## 7. Who is working, and where

**Useful:** One squad page should name the people behind the sections and show
what is waiting. A shared budget must not be mistaken for one agent’s
allowance.

**Evidence:** The dashboard already reads hc ls and resolves sessions.
Installed Core Status reports working/idle/done/blocked/error and optional
progress; its schema exposes no quota/budget fields. The brief records several
Codex consumers sharing a weekly meter.

**How it would work:** Join squad membership to explicit role/run metadata and
Core terminal state. Show host, address, work, last check and stale/ended
status. Derive blocked on Rob from explicit open questions/owner steps, not
every Core blocked state. Add account-scoped budget readings only from a
supported provider or a named report; show not reported otherwise.

**Complexity:** 300–550 code lines plus 150–300 test lines; about one day for
the roster. Budget collectors are a separate provider-specific estimate.
Medium risk: identity handoffs and stale readings.

**Other owners:** grill-flow plus squad role/run publication. Core already
supplies terminal facts. Budget readings need another supported source; task
progress is not quota.

**Constraint:** Never infer 79% usage from a task progress field or copy a
meter to several agents as separate remaining budgets.

**Recommendation:** Build the roster first and label unavailable/shared
budgets honestly.

Sources:

- [Terminal discovery and cached names][source-18]
- [Installed hc 0.1.18 schema][source-11]
- [Composed source membership][source-19]

## 8. Fresh issue chips and links that stay useful

**Useful:** You should be able to open an agent’s own question id without
asking the lead to find its shared number. Chips should say how fresh their
state is.

**Evidence:** The shared registration already maps source question ids to
shared Q numbers. Current refs and refsAt are writer-supplied snapshots; the
server does not poll Linear or GitHub for chip state. The question route
currently interprets its id as a shared number.

**How it would work:** First resolve source-qualified links through the
existing registration: for example a local id plus source=squad-grants.
Preserve shared-number links; reject ambiguous unqualified ids. Show
checked-at/stale state on existing chips. A later read-only provider or
agent-published ref refresh can update chip state with source/time and cached
failures.

**Complexity:** 100–200 code lines plus 80–150 test lines for stable links;
350–650 additional code lines for provider refresh and caching, 1–2 more days.
Medium risk: ambiguity, stale data and provider limits.

**Other owners:** grill-flow alone for aliases/freshness UI; live refresh
needs permitted Linear/GitHub access or a producer using its existing tools.

**Constraint:** Do not put service credentials in the page or treat a stale
chip as live. Q1 exists in several sources and may also be a shared Q number.

**Recommendation:** Ship source-qualified links and freshness first; decide
live provider polling separately.

Sources:

- [Stable source/shared registration][source-1]
- [Question URL parsing][source-20]
- [Grill
- answer and snapshot schema][source-2]

## 9. One alert when something becomes urgent

**Useful:** A useful alert brings you to one real blocking item. Repeated or
stale alerts create another inbox to clear.

**Evidence:** The brief records runs saying push not sent. The page has reply
toasts/read state, but no phone/Slack push sender or persisted
urgency-transition delivery log.

**How it would work:** After delivery identity is settled, offer an explicit
opt-in destination. Persist one notification per source item and urgency
transition, with a deep link, retry result and acknowledgement policy.
Suppress repeats across reloads and remote imports. A localhost browser toast
alone is not phone push; Slack or phone delivery needs a real adapter and
credentials.

**Complexity:** 400–700 code lines plus 200–400 test lines; about two days
plus channel setup. Medium/high integration risk.

**Other owners:** grill-flow event deduplication and an opted-in Slack/phone
delivery adapter; possible cos-rob ownership. No alerts are sent by this
research round.

**Constraint:** Delivery, reading and acting are separate. Avoid notifications
from stale or already-cleared blockers and never infer approval from an alert
click.

**Recommendation:** Defer push until sender identity, urgent items and
delivery receipts are dependable.

Sources:

- [Reply/read state and notifications][source-20]
- [Event storage and snapshots][source-1]
- [Lead brief][source-3]

## 10. Blocking lines that clear when work finishes

**Useful:** A blocking line should describe what still stops work. A merged PR
must not keep looking like an open build blocker.

**Evidence:** The brief names cards still blocking PR A after merge. Question
dependsOn/when track answer dependencies; blocksAt is descriptive timing.
There is no typed external blocker/evidence model.

**How it would work:** Store typed blocker references to questions, owner
steps or a specific PR state. Derive the display from current evidence and
show checked-at/unknown. A writer or fixed read-only provider updates
evidence. Clear only the named blocker; keep independent approvals and other
prerequisites intact.

**Complexity:** 400–700 code lines plus 250–450 test lines; 1–2 days for a
bounded set of blocker types. Medium risk: confusing a displayed condition
with actual gate authority.

**Other owners:** grill-flow; squad publishers must name actual blockers.
External blockers reuse owner-step/chip evidence providers when selected.

**Constraint:** A merged PR does not imply a grant or safety approval. Missing
or old evidence should say unknown, not unblock work.

**Recommendation:** Add explicit blocker references and derive their status
from evidence.

Sources:

- [Answer dependency status][source-2]
- [Grill
- answer and snapshot schema][source-2]
- [Lead brief][source-3]

## 11. What changed while you were away

**Useful:** With many agents and rounds, finding new replies, changed
questions and new waits is a separate job from answering one question.

**Evidence:** This session has already moved 99 questions into the shared
page. Read ids and reply history exist, but there is no unified
since-last-visit view across updates, answers, decisions and owner steps.

**How it would work:** Add a small What changed view using a durable read
cursor and the existing event ids. Group by member, link each change to its
item and filter to unread or needs action. Start with an honest timeline and
concise event labels; no generated summary is required. Keep read state
separate from approval and delivery.

**Complexity:** 300–500 code lines plus 180–300 test lines; about one day.
Low/medium risk: read state across devices and confusing edited with new.

**Other owners:** grill-flow. It can start with existing replies/revisions and
incorporate new item kinds only if those are selected.

**Constraint:** Reading an item is not answering, acknowledging for an agent,
granting or vetoing it.

**Recommendation:** Add a catch-up timeline with a clear read cursor.

Sources:

- [Agent message history][source-2]
- [Reply/read state and notifications][source-20]
- [Event storage and snapshots][source-1]

## 12. Show the exact words you answered

**Useful:** A stable option key is not the same as stable meaning. You should
be able to inspect what the question and option said when you sent them.

**Evidence:** answered currently stores question/key and optional custom text;
sent stores delivery lines. Rewording a label can leave the same key and sent
line. LAB-1310 already accepts that existing grants keep counting after
rewording.

**How it would work:** Capture the ask, option label/effect, own text and
question revision at answer/send time. Show a compact receipt and a
wording-changed link to a diff. Preserve the original context through source
composition and remote state. Share the capture format with the page-grant
work, but make the review UI useful for ordinary answers too.

**Complexity:** 250–450 code lines plus 180–300 test lines; about one day.
Medium risk: historical answers lack snapshots and old writers must stay
compatible.

**Other owners:** grill-flow; coordinate the stored context format with
LAB-1310 rather than invent two formats.

**Constraint:** Do not reconstruct old wording from the latest JSON. Mark old
context unavailable. A wording-change marker must not revoke a grant that your
accepted policy keeps valid.

**Recommendation:** Add exact answer receipts and a quiet wording-change
marker without changing authority.

Sources:

- [Stored answer event fields][source-7]
- [Per-source/session answer delivery][source-17]
- [LAB-1310: approved page-grant plan][source-14]

## Delivery design for feature 3

The durable queue stays in grill-flow; local agents pull their own envelopes
and acknowledge
message ids through a runtime adapter at turn boundaries. Store author kind,
native session,
recipient, reply-to, source, timestamps, claim/ack outcome and an idempotency
key.
Transport acceptance, agent acknowledgement, a reply and Rob reading it are
separate states.

Remote inbound: the existing serving-host pull writes incoming messages beside
the member’s
state file. Remote outbound: the agent writes immutable message/ack files; the
serving host
pulls and deduplicates them, as it does revision files. No inbound HTTP
listener on hl is needed.
The envelope/ack protocol and crash recovery are new work, not an existing
outbox guarantee.

A native Herdr implementation would expose durable inbox enqueue/claim/ack
plus a runtime
adapter that preserves peer/system provenance instead of typing into a
terminal. The observed
Core API does not provide those named methods. doc.get/set could support a
bounded prototype,
but using them as a second canonical queue would add ordering, retention and
ownership work.
No claim is made about uninspected Core internals or universal Claude/Codex
hook support.

The source-attribution incident is a separate trust problem: a claimed caller
id and a wrapper
are useful labels, not authenticated owner intent. Missing attribution must
remain unknown/agent
in a grant-aware integration; restoring an environment variable is not a
human-authentication fix.
The cited misclassified reports remain agent-authored; this research did not
alter their log.

## Scope of this round

Questions Q1–Q10 cover the brief; Q11–Q12 are additional ideas from this
session.
Each asks for a feature priority, so all twelve are independently discussable
now.
A design-first or Later recommendation does not mean build that feature now.
After the picks, sequence only the selected work and settle any unresolved
cross-repo interfaces.
The source grill is `grills/grill-flow-squad-channel.json`; its `squad`
section is `grill-flow`.
All question discussions route to t94. Lead reports stay in the requested
handoff file until
tagged cross-session delivery is verified.

## Source links

[source-1]: ../../server/store.ts
[source-2]: ../../src/domain.ts
[source-3]: /Users/robertban/.handoffs/2026-11-07-grill-flow-squad-features.md
[source-4]: ../../src/diagram.ts
[source-5]: ../../src/workspaceView.ts
[source-6]: ../../server/messages.ts
[source-7]: ../../server/main.ts
[source-8]: ../../server/cli.ts
[source-9]: ../../server/outbox.ts
[source-10]: ../../server/remote.ts
[source-11]: ./2026-11-07-hc-messaging-capabilities.json
[source-12]:
  ../../../squad/docs/adr/0042-robs-words-reach-sessions-through-a-grant-log.md
[source-13]:
  /Users/robertban/.handoffs/2026-11-07-grill-flow-squad-features/t94-to-lead.md
[source-14]: https://linear.app/rbrtbn/issue/LAB-1310
[source-15]: https://linear.app/rbrtbn/issue/LAB-1303
[source-16]: https://linear.app/rbrtbn/issue/LAB-1280
[source-17]: ../../server/delivery.ts
[source-18]: ../../server/dashboard.ts
[source-19]: ../../server/squad.ts
[source-20]: ../../src/main.ts
