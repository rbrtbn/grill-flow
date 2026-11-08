# Running-page browser notifications

Status: step 6 approved by t16h. Off until Rob opts in in Settings on a grill-flow page.
Phone, Slack, closed-page delivery, service workers and credentials remain outside this part.

## Consent and capability

Settings offers Enable browser notifications and a local Turn off control. Merely loading the
page or having OS permission does not opt in. Only the explicit enable action requests browser
permission, when its current state is default. Dismissal keeps it off; denied permission names
the browser settings action. Missing secure-context, Notification or Web Locks support is shown
as unsupported. Constructor, asynchronous notification and preference failures pause the feature.
An enabled label describes the browser preference, not proof that the OS displayed an alert.

This uses non-persistent notifications from a running document. It installs no worker or runtime
hook and sends no network notification request. Browser/OS policies still govern actual display
and background-page timing. A closed page cannot receive through this adapter.

## Canonical items and transitions

Candidates are eligible open questions explicitly labelled blocking/soon and open owner steps
with those urgencies. Unknown urgency, blocked questions, saved answers and completed owner work
do not generate urgent alerts. Decisions and external blockers get no invented urgency.

Keys encode kind, canonical source and local question/item ID. Questions use questionOrigins and
the source's existing activity high-water event ID; owner steps use their published event ID.
Missing canonical identity or event metadata suppresses a legacy question alert. Shared question
numbers, display titles and current URLs are not durable deduplication IDs. A higher source
event version can change urgency; an older tab cannot reverse it. Rewording with the same urgency
does not alert again. Clearing/de-escalation is recorded, so a later observed escalation can alert.

Enabling and the first snapshot after reload seed the current state quietly, without replaying
a backlog. Subsequent observed transitions create at most five attempts per poll; remaining
unadvanced candidates wait for later polls. Unobserved changes while the page is closed are not
claimed as delivered notifications.

## Browser storage and effects

The separate version-1 preference key is grill-flow:browser-notifications:v1. It stores enabled
and per-item urgency, cycle and event version, not answers, notes, messages or grant text.
Web Locks serialize the critical section across tabs, with a bounded wait. Persist attempts
before constructing notifications, so retries do not repeat the same escalation. Malformed
preferences fall back off. Storage failures and size limits fail closed (4096 items/1 MB).

Notification bodies contain only a short item title. They never copy an owner command or body.
Clicks emit a navigation fact; its Command opens a validated local /g/ destination in a new tab,
preserving uncontrolled and dictated drafts in the source page. They do not answer, acknowledge,
grant, veto or complete owner work. Normal reading policy in an opened page remains separate.
Native cards created by a tab close when an item clears or the feature turns off; a replacement
closes its predecessor. Cross-tab preference changes refresh that tab's state. OS close events
release objects.
Existing reply toasts, notification tray and read-marker behavior are independent.

## Verification and owner action

Unit tests replace Notification and permission calls, serialize fake lock requests, and inspect
saved attempts before constructor effects. They cover quiet opt-in/reload, urgency transitions,
stale/concurrent tabs, turn-off, burst limits, permission dismissal/denial/unsupported states,
storage/constructor failure, canonical IDs, owner-title privacy and close/click/error events.
Scenes cover consent controls, pending serialization, late completions and unchanged work/read
state. The open Command is tested without navigating or modifying a DOM-only dictated draft.

The isolated browser probe uses real Chrome Web Locks with mocked permission, constructors,
window opening and every API response. It blocks all writes, checks desktop/narrow bounds,
cross-tab behavior and preserved textarea node/text/caret, and shows no real OS notifications.
Real browser consent and OS delivery are Rob's owner action, not inferred from those mocks.

The [Notification standard](https://notifications.spec.whatwg.org/) and
[Web Locks draft](https://w3c.github.io/web-locks/) were checked on 2026-11-08. Permission and
non-persistent page events follow the former; same-origin tab coordination follows the latter.
