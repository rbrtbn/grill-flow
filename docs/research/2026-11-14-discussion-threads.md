# Discussion threads: four prototypes and a recommendation (2026-11-14)

Rob's ask 9656 (page `squad`, part 2): the Discussion panel's "To" dropdown makes it easy to
send to the wrong session after switching questions, and messaging the asker, the lead or
grill-flow about one question doesn't feel like one set of threads. The "remember the last
recipient per question" bug is fixed separately (`fix/remember-discussion-recipient`); this
note compares new panel designs.

Prototypes: branch `prototype/discussion-threads`, `prototypes/discussion-threads-*`, served
by `prototypes/discussion-threads-shared/serve.sh` on 4361-4364. Sample data: four squad
questions from four askers, a side thread with the lead about `cache-budget`, a grill-flow
maintainer thread, a direct thread with another builder and an unread reply on `night-grant`.

## What Rob needs from the panel

1. Ask about *this question* with one click, defaulting to whoever asked it.
2. Reach sessions he already talked to with one click; anyone else may take more.
3. Come back to a question and find the conversation he left, with the same recipient.
4. Keep "the lead about this question" or "grill-flow about this question" attached to the
   question, as its own thread.
5. Never be unsure who a message goes to before pressing send.

All four variants share one thread model: a thread is **one session, optionally about one
question**. Each question remembers the thread you last used on it (the dashed box in the
prototypes shows this) and reopens it, whatever you opened elsewhere.

## The variants

| | A · Thread tabs | B · One addressed timeline | C · Thread list beside the panel | D · Thread cards on the question |
|---|---|---|---|---|
| Shape | Tab row over the thread: asker, others about this question, recent direct threads, `+` | One merged conversation per question; each message names its recipient; chips pick the next one | Wider panel: inbox of threads (this question, direct, other questions) beside the open thread | Stacked cards under the question, one open at a time, each with its own reply box; direct threads in a dock |
| Goal 1 (ask this question) | Asker tab first and default | Asker chip default | Top row of the list | Asker card first |
| Goal 2 (known sessions) | One click: their tab is always in the row | One click about this question; direct threads behind a second tab | One click, everything visible | One click via cards or dock |
| Goal 3 (come back) | Reopens the remembered tab | Reopens the remembered recipient chip | Reopens the remembered row | Reopens the remembered card (or the direct drawer) |
| Goal 4 (side threads on the question) | Yes, as tabs | Strongest: everything about the question reads in one order | Yes, grouped under "This question" | Strong: the cards *are* the question's threads |
| Goal 5 (recipient obvious) | Strong: coloured "To" bar plus "Send to Squad lead" | Medium: chips and button name the recipient, but the timeline mixes speakers and recipients | Strong: large recipient header plus button | Strongest: you type inside that person's card; "Reply to Squad lead" |
| Weak spots | Tab row grows; needs a cap on direct tabs | Easy to misread who answered whom; a reply to the lead looks like part of the asker's thread | Needs about 640px; squeezes the question on a laptop and duplicates the Conversations page | Tall with three or more cards; direct threads feel secondary |
| Front-end size | ~150 lines (replaces `recipientPicker`, adds a tab row and "To" bar) | ~300 (merged timeline, chips, reply-to) | ~350 (new split layout; could replace the Conversations page) | ~300 (cards, inline composers, dock and drawer) |

## What every variant needs on the server

Today's targets are a question's step id (its asker), `run`, `agent:<address>`,
`grill-flow`, `part:…` and `card:…`. None of them means "the lead about this question", so
every variant needs one new kind, a **side thread**, e.g. `<step-id>@<address>`:

- Recipient: the address, accepted only from the same list as `agent:` targets plus the
  maintainer (ADR 0029's rule that the page never relays to arbitrary terminals still holds).
- The ask carries the question's context, as a step ask does today; replies use
  `gf revise <grill> <step-id>@<address> --ask <id> --kind comment`.
- Squad pages scope it like a step id; `discussions` references (ADR 0033) count it per
  question so the "N messages" link includes side threads.
- About 200-300 lines with tests, the same for every variant. Remembering the last thread per
  question is client state (it builds on `fix/remember-discussion-recipient`).

Migration maps today's threads unchanged: step id → the asker's thread about that question;
`agent:<address>` and `grill-flow` → direct threads; `run` → the direct thread with the page
session (the lead on a squad page); `part:`/`card:` stay as they are. No stored thread moves.

## Recommendation

**A · Thread tabs**. It meets all
five goals, is the smallest change from today's panel, keeps the panel's current width, and
maps one tab to one existing thread, so delivery state, quote-reply and discussion refs keep
working per tab. Cap direct tabs at the three most recent and leave the rest behind `+`.

Pick **D** instead if seeing every conversation about a question at once matters more than
compactness: its in-card reply box is the hardest design to misaddress. B is the most
original but the riskiest for goal 5; C is the best global overview but costs panel width the
question needs, and the Conversations page already plays that role.

## Round 2: conversations on the question page

Rob's reply (2026-11-14): conversations about a question belong on the question page, since
the question is their context; quote-reply on selected text should start a thread on that
passage; the side should keep only Grill-flow, the lead and sessions he opens; tabs wrap and
grow out of hand, and C's list makes a specific session hard to find. Three more prototypes,
each pairing a question-page layout with a way to find sessions:

| | E · Conversation under the question | F · Margin threads + palette | G · Question as an issue page |
|---|---|---|---|
| Question page | Passage threads open under their paragraph; the asker conversation and side threads run under the answers; a sticky bar jumps to them | Question in one column, conversations in a margin beside it like document comments: the asker's card pinned, one card per quoted passage | Compact sticky header with the answers, background collapsed to its first paragraph, then one timeline where passage and side threads nest where they started |
| Long questions | Gets longer with every open passage thread | Reading flow untouched; margin scrolls on its own | Best: background folds away, answers stay in view |
| Finding a session | Directory: pinned, recent, then each squad with role and work; search | No sidebar: ⌘K palette searches name, issue, work, squad; the chat opens as a window that stays across questions | Board by work: this question's issue first, then who waits on you, then every issue with its sessions; search |
| Weak spots | Conversation is far below a long question | Needs about 1,300px; the chat window can cover the margin | Sticky header costs height on short screens |
| Front-end size | ~350 lines | ~450 | ~400 |

Shared server work for any of them: an ask can carry a quoted passage (its text and where it
sits in the question) so a passage thread survives reloads and `gf revise` replies land in it,
plus the side-thread target from round 1 for "the lead about this question". Finding sessions
by work needs a source for each session's issue and work: today Herdr gives only the terminal
name and program, so the squad's state (claimed issues) has to feed it.

Recommendation: **G's question page with G's board by work.** It handles long questions,
keeps the whole conversation about a question in one readable order, and lets Rob find a
session by what it's doing rather than by its terminal name. F's ⌘K palette can be added
later as a shortcut to the same search.

## Round 3: building on G

Rob picked G's question page and asked for: short answers with no description beside them, a
"Write my own" answer, one click to answer with or without a note, a one-paragraph summary
whose fold holds the trade-offs and a comparison table, the quick starters sent on click,
every reference linked, passage threads that survive a rewrite, pinned sessions with a
choice of grouping and order, and a look at how the sessions panel behaves while a run moves.
Guide revision 8 (PR #23, ADR 0037) asks agents for the summary-first shape and a `compare`
table, which the schema already supports.

| | H · split answers, sessions by issue | I · answer then note, sessions by squad |
|---|---|---|
| Answering | Each answer is a split chip: the label picks it, ✎ picks it and opens a note | Clicking an answer picks it and opens an optional note under the answers |
| Own answer | "✎ Write my own" opens a composer | "Write my own…" opens a composer |
| Sessions default | Pinned, Waiting on you, then by issue (this question's issue first) | Pinned, Recent conversations, then by squad |
| Both | Group by issue, squad, status or none; order by recent, waiting first or name; pin any session |

What the scenario shows, the same in both:

- A reply about a question you have left counts on that question in the sidebar and as an
  "N new on <key> ›" chip on the asker's row, which opens the thread.
- A merged PR and a resolved issue show on the session's chips; once a session's issue is done
  or its terminal closes, it moves to a folded "Finished or closed · history only" section,
  which opens on the step that moves someone in.
- A closed session's conversation stays readable, without a composer, and offers the lead
  instead; a question whose asker closed says its replies go to the lead (ADR 0030).
- A rewritten question keeps a passage thread whose text is gone: the quote is struck through
  and marked "changed in revision 2".
- A lead handover moves the lead pin to the new session; the previous lead's history moves to
  Finished or closed.

Recommendation: **H**. Its split chip is exactly one click for each of "answer" and "answer
with a note", and grouping by issue lets finished work fold away as issues resolve. The
grouping control keeps I's squad view one choice away.

Building it for real needs, beyond rounds 1 and 2: per-session issue, PR and terminal state
(the squad's claimed issues and Herdr's terminal list), and a note field on answers in the send.

## Decision (2026-11-14)

Rob chose G's question page with variant I:

- Clicking an answer picks it and opens an optional note under the answers, with "Write my own"
  as the last answer.
- The sessions panel replaces the Discussion panel and opens grouped by squad, with recent
  conversations on top.
- Finished and closed sessions leave the panel after a day; their history stays on the
  Conversations page (`finished-sessions` = c, unlike the prototype, which folds them).

The UI is built in `feat/inbox-ui` by the inbox-ui session; the business logic follows on
`feat/discussion-threads`, branched from it. The full change list against today's page is in
`~/.handoffs/2026-11-14-discussion-threads-variant-i.md`.
