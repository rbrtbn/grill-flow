# Inert local pull-adapter proof

Status: approved by t16h as a fixture-only pilot. No live session, runtime or server is wired to it.
Estimate: 650–900 code / 450–650 tests; check in before exceeding 1350 / 975 lines.
Sources: LAB-1123, LAB-1114, LAB-875 and LAB-1327, refreshed on 2026-11-08 with linear-snapshot.

## Capability boundary

All CLI outputs identify fixture-only mode and productionReady:false. Independent fixture
observations model a native runtime, UUID, process/frontend/backend/socket tuple, current turn,
source/thread/run, route and question revision. Matching them proves protocol behavior only.
There is no real native observer, unattended adapter, transport, background worker or enrollment.
The current hc path remains the only live page delivery path. No runtime settings or hook changes,
server deployment, production event writes or remote bridge changes are part of this proof.

LAB-1114's real runtime readiness stays HOLD; these fixtures cannot satisfy its actual-native
evidence requirement. LAB-1123 remains a separate consumer/source integration. LAB-875 keeps its
Artifact comments contract. LAB-1327's relay remains held for the store's grant work. No issue
is closed, dispatcher replaced or authority granted by this pilot.

## Identity and transitions

Bindings explicitly name canonical source/thread/run, a local route, native runtime namespace
and UUID, process identity, question revision and handover epoch. Claude CLI, Claude desktop and
Codex CLI remain distinct even when UUID strings coincide. A route or label is not authentication.
Observations require a supported fixture capability and a current timestamp (30 seconds old at
most, five seconds future skew). A missing, stale, mismatched or unsupported reading fails closed.

Binding changes require the previous binding event and next epoch. Replays are idempotent;
an old binding cannot roll a handover back. Envelopes freeze the recipient binding/event/digest,
source/thread, message ID, reply-to ID, sender-kind claim, exact body and question revision.
Reusing one source/thread/message ID with different content conflicts. Identical retries keep
the original envelope, even after handover; they never silently reroute it. Reply targets must
belong to the same source/thread. Sender kind is a claim, never grant or human-authorship proof.

Inbox reads do not consume. Transport evidence is separate from pending/conflict/consumed state.
Explicit acknowledgement names one envelope and rechecks its exact current recipient and question
inside the event transaction. Duplicate acknowledgement by the same binding returns its receipt.
A changed owner, reused route/process or revision cannot acknowledge the old pending envelope.
The new owner sees conflict IDs, not the previous recipient's pending bodies. Existing consumed
receipts remain immutable after later handovers or question edits.

The controlled turn runner checks before each fixture handler and again after acceptance.
Declined, crashed or unsupported handlers do not consume. There is no native callback installed.
Bodies passed to the fixture handler retain one page-marked text block and a fixture label.

## Scratch CLI

The CLI dispatches pilot operations before opening the ordinary database or using GF_OUTBOX.
Every operation requires --fixture-only and --pilot-dir. The directory must be an explicitly
owned grill-flow-pilot-* child of the system temporary directory, initialized while empty.
A fixed marker and pilot.sqlite use the existing events-table shape; no production table or
migration is added. Input files must be regular, unshared files inside that same directory.
Symlinks and shared hard links are refused. Inbox and inspect open the scratch database read-only.

```sh
pilot_dir=$(mktemp -d "${TMPDIR%/}/grill-flow-pilot-demo-XXXXXX")
bun run gf pilot init --fixture-only --pilot-dir "$pilot_dir"
# Write synthetic binding.json, observation.json and request.json inside this directory.
bun run gf pilot bind --fixture-only --pilot-dir "$pilot_dir" \
  --file "$pilot_dir/binding.json" --fixture "$pilot_dir/observation.json"
bun run gf pilot enqueue --fixture-only --pilot-dir "$pilot_dir" \
  --file "$pilot_dir/request.json"
bun run gf inbox --fixture-only --pilot-dir "$pilot_dir" \
  --source alpha --thread thread-Q1 --fixture "$pilot_dir/observation.json"
bun run gf ack --fixture-only --pilot-dir "$pilot_dir" \
  --event <envelope-id> --fixture "$pilot_dir/observation.json"
```

The schemas in server/runtimePilot.ts define the input files; server/runtimePilot.test.ts
contains complete synthetic examples. No real UUID/process/socket observation is needed or
claimed. pilot delivery records fixture transport evidence only; pilot inspect reads its state.
The store caps records at 10,000; a turn returns at most 100 pending bodies and 100 conflict IDs,
with truncation reported. Unknown arguments, implicit inbox use and unowned stores are refused.

## Owner activation gate

Rob decides whether to permit a controlled real-session experiment in the morning. That needs
independent runtime identity evidence, current source membership, coordination with LAB-1123 and
LAB-1114, a reviewed enable/rollback plan and separate permission for any settings or hooks.
The owner step requests that decision; it does not contain a command that activates a session.
Until then there is no live pull delivery and no change to hc delivery defaults. Browser and
push notifications remain held independently.
