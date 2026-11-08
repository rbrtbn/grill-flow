# Navigation structure studies

Three throwaway UI studies prompted by the sidebar screenshots on 2026-11-08.
All 91 questions, counts, replies and actions are illustrative and live only in memory.
Two edited sample answers start as drafts: 4 open, 2 drafts and 85 sent.
There is no app runtime, API, database, OS notification, persistence or actual send.

Run `python3 -m http.server 4346 --bind 127.0.0.1 --directory .` here.
Open http://127.0.0.1:4346/?variant=A and compare with the bottom arrows or keyboard.

- A: one work queue, no app or round rails. Recommended: recover width while questions stay visible.
- B: a small rail, with rounds as a temporary drill-down view instead of a second column.
- C: header navigation and an on-demand question browser. Reading gets more width; the inbox
  moves behind header access when the browser is closed, changing the earlier always-visible choice.

Try Open/All, searching, round scope, selecting questions, Needs you, Changes, closing discussion,
writing a draft, and simulating a four-second reply preview. Drafts and sample picks survive view
and variant switches; reload resets the study. Utility destinations are illustrative placeholders.
The implemented notification PR and live app are separate from these studies.

## Carry-through audit · ask 3033

Draft access and the global Review & send action are required in both A and B.
The study now includes two seeded drafts, a Drafts filter, draft state marks, a global
counted Review & send action, inclusion/exclusion, a message field and a local simulated send.
Selecting an answer creates another draft; simulated send clears only selected drafts.
No transport or persistence is implied by this demonstration.

The production redesign must preserve these existing capabilities:

- Review across rounds and recipients, custom answers and notes, message text, inclusion,
  save/send shortcuts, save failure/retry and unconfirmed-delivery state.
- Pinned Open for you, Needs you with owner/provisional work, Replies and full Conversations.
- This question / Whole run / Grill-flow discussion scope, expansion, drafts and unread state.
- Search by question or issue; urgency and state filters, including Draft and Sent.
- Source, round and question identity; direct links, meaningful counts, urgency and dependency state.
- Dependent-question nesting, waiting reasons, fold/unfold, round progress and rename.
- Question notes, own answer, skip, reasoning, references, drawings and answer history.
- Updates, Squad/Run overview, all grills and Settings, even if moved under More.
- Resizing and restored navigation preferences, browser back/forward and draft preservation.

Actual placement choices remain: a visible Needs attention shortcut versus Filters;
which of Open for you / Replies / Conversations stay directly available;
and round management/progress in a contextual menu versus always visible controls.
These are choices about access, not deleting the underlying functions. The prototype's
utility destinations and full question tools are still placeholders or abbreviated.

## Updated design ready

A/B now expose Needs attention, detailed urgency and Sent filters, contextual round progress/
rename, source-qualified round labels, pinned Open for you, full Conversations, all Replies,
three discussion scopes with separate drafts, expansion, note/own-answer controls, Skip and an
illustrative Draw this comparison. More retains Changes, Updates, answer history, Squad/Run
overview, all grills, Settings and sample delivery states. Some destination contents remain
labelled placeholders; existing production behavior is the carry-through contract above.
These navigation affordances are ready for the A/B choice, separate from implementation.
