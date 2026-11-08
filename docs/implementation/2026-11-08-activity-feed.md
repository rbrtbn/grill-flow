# What changed

The optional snapshot activity projection uses the existing event table. It creates no events,
tables or endpoints. Composed pages include only their current source members; direct pages keep
their own history, including retirement records. Stable identities are source grill plus event ID,
never a composed question number. The feed caches unchanged histories by source event high water.

The newest 300 meaningful events are returned, with total count and per-source high-water marks.
Unread counts with hidden older records show a lower bound with +. Mark all seen advances each
source cursor to the supplied high water, saved only in browser workspace preferences. Reading,
filtering and following links never mark anything seen. There is no server read-marker write.
Saved preferences exclude the feed, catalog and other transient workspace data.

Unread, All and Needs action filter the feed, grouped by canonical source. Needs action derives
from current open questions, unsent drafts, open owner steps and provisional decisions. An old
event's excerpt remains recorded wording; its link opens the current item. Seen never completes
work, acknowledges a reply, answers a question, grants permission or requests a veto.

Reload events record added, changed and removed question IDs and whether page context changed.
Unchanged reloads are omitted. Older events without that metadata explicitly lack detailed changes.
Per-keystroke note events are omitted. Recorded requests, transport delivery and agent consumption
stay distinct; delivery is not acknowledgement. Provider events retain their exact named reference.

Question links resolve source-local IDs through the existing registration route. Item and answer
anchors encode a source/ID pair without collisions. Removed questions fall back to the source
overview. Exact archived targets open their nearest native details once, await font readiness
with a bounded wait, then scroll and focus without a second scroll. Subsequent user closure
survives polling; settings restoration does not reset a fragment reveal to the page top.

Scene tests cover local-only seen persistence, reload and new events, current action independence,
legacy snapshots, truncation and reserved source keys. The Mount regression holds fonts pending
and requires scrolling only after readiness. Backend tests cover source ownership, event semantics,
reload differences, bounded history and canonical targets without database writes. Independent
mocked browser checks cover exact archive/history reveals, user closure across polls, font reflow,
compact storage and desktop/narrow bounds. API writes are intercepted in browser acceptance.
