// Where each part of a page the redesign may retire goes, with t2j5's recommendation
// (~/.handoffs/2026-11-14-board-retirement-inventory.md). Squad overview renders it read-only;
// Rob decides. Usage counts come from the preview copy of 2026-11-14 04:35Z (43 boards).

export type Verdict = 'Already in' | 'Move to' | 'Keep' | 'Drop'

export type RetiringPart = Readonly<{
  part: string
  verdict: Verdict
  // Empty for Drop: the part has no new home.
  where: string
  why: string
  usage?: string
}>

export type RetiringPage = Readonly<{
  page: string
  usage?: string
  parts: ReadonlyArray<RetiringPart>
}>

export const RETIRING: ReadonlyArray<RetiringPage> = [
  {
    page: 'Needs you (old)',
    parts: [
      {
        part: 'Drafts ready to send, with Review & send',
        verdict: 'Already in',
        where: 'Header: Review & send tray',
        why: 'The tray holds the same drafts and is on every page.',
      },
      {
        part: 'Open decisions list',
        verdict: 'Already in',
        where: 'Inbox question lines, then Questions',
        why: 'Same questions, grouped by urgency and linked to a filtered list.',
      },
      {
        part: 'Waiting on another answer',
        verdict: 'Move to',
        where: 'Questions: a "Waiting" state chip next to Open / Drafts / All',
        why: "That's the only place the queue shows questions held behind another answer.",
      },
      {
        part: 'Owner steps (action, destination, Copy, Open session, completed or withdrawn fold)',
        verdict: 'Already in',
        where: 'Inbox tasks, item page, Recently done',
        why: 'F built the Inbox from these items.',
      },
      {
        part: 'Provisional decisions with Veto and receipts',
        verdict: 'Move to',
        where:
          'Inbox as a "Veto by <deadline>" task, with the receipt on its item page',
        why: 'Rob must be able to veto before the deadline. 0 on any board so far, so this is low priority. Drop it if agents never publish one.',
      },
      {
        part: 'Blocking conditions',
        verdict: 'Move to',
        where:
          'Freeze banner (a condition that holds work), with evidence on the item page',
        why: 'Same idea as a freeze. 0 on any board so far.',
      },
    ],
  },
  {
    page: 'Updates (old)',
    parts: [
      {
        part: 'Current status per session',
        verdict: 'Already in',
        where: 'Inbox › Status, and each Runs lane',
        why: 'Same items (8 across boards).',
      },
      {
        part: 'Superseded updates',
        verdict: 'Move to',
        where: 'Runs › one session: "Earlier status" fold',
        why: 'History belongs with the run, not in the Inbox.',
      },
      {
        part: 'The link from an update to its question',
        verdict: 'Move to',
        where: 'The status line in the Inbox and the Runs lane',
        why: 'Kept today only on the old page.',
      },
    ],
  },
  {
    page: 'What changed',
    parts: [
      {
        part: 'Unread changes and Mark all seen',
        verdict: 'Move to',
        where:
          'Inbox: a "new since you last looked" dot on items, plus one Mark seen',
        why: 'That was the catch-up use; the Inbox is the catch-up page now.',
      },
      {
        part: 'Needs action filter',
        verdict: 'Already in',
        where: 'Inbox',
        why: 'The Inbox is that filter.',
      },
      {
        part: 'The full feed by source',
        verdict: 'Move to',
        where: 'Runs › one session: Activity fold',
        why: 'Runs lanes already read it for "Last active"; per session it is readable.',
        usage: '300 latest of 4,406 events',
      },
      {
        part: 'The page itself',
        verdict: 'Drop',
        where: '',
        why: "It's covered by the Inbox and Runs once the two moves land.",
      },
    ],
  },
  {
    page: 'Replies & decisions',
    parts: [
      {
        part: 'Agent replies to your sends',
        verdict: 'Move to',
        where:
          'That session\'s thread (sessions panel, Conversations), and a "Reply" line on each answered question it covers',
        why: 'A reply is a message from a session; it belongs in that thread.',
        usage: '162 across boards',
      },
      {
        part: "Answers in a question's discussion",
        verdict: 'Already in',
        where: 'The question page conversation',
        why: 'Variant I moved them there.',
      },
      {
        part: '"About the whole run" messages',
        verdict: 'Move to',
        where: "The run lead's thread (pinned Squad lead row)",
        why: 'Same reason as replies.',
      },
      {
        part: 'Decided list',
        verdict: 'Move to',
        where:
          'Questions › All: each answered question shows its decided line, searchable',
        why: 'That\'s where Rob would look for "what did we decide on X".',
        usage: '553 lines across boards',
      },
      {
        part: 'The page itself',
        verdict: 'Drop',
        where: '',
        why: 'Nothing is left after the moves.',
      },
    ],
  },
  {
    page: 'Answer history',
    parts: [
      {
        part: 'Exact wording per send, delivery state, extra message',
        verdict: 'Move to',
        where: 'Review & send tray: a "Sent" tab',
        why: "It's the send log, so it belongs next to sending. Keep it: it is the audit record of what Rob said (Q126).",
        usage: '47 sends on squad',
      },
      {
        part: 'Wording changed since you answered (diff)',
        verdict: 'Move to',
        where: 'The question page, under "Sent B"',
        why: 'It matters when Rob looks at that question again.',
      },
    ],
  },
  {
    page: 'Squad overview (this page)',
    parts: [
      {
        part: 'Active runs table, with the Completed fold',
        verdict: 'Keep',
        where: 'Home',
        why: 'It\'s the portfolio view and the reason to try this page as home. Point "Attention" at the Inbox filtered to that run, not the old Needs you.',
      },
      {
        part: 'Squad roster table (Herdr)',
        verdict: 'Already in',
        where:
          'Sessions panel (state, role, work), with the profile and host notes in its header',
        why: 'Budget has always been blank, so drop it. Ended sessions follow finished-sessions = c.',
      },
      {
        part: '"Where to go next"',
        verdict: 'Drop',
        where: '',
        why: 'The nav and this list replace it.',
      },
      {
        part: 'Refresh',
        verdict: 'Keep',
        where: 'Home',
        why: 'Reloads the boards list.',
      },
    ],
  },
  {
    page: 'Run overview',
    usage: '4 boards have a plan',
    parts: [
      {
        part: 'Work table (work, state, next action, session)',
        verdict: 'Move to',
        where: 'Runs › one run: its work table under the lane',
        why: "It's the run's own detail. Keep it until it moves.",
      },
      {
        part: 'Sessions tab',
        verdict: 'Already in',
        where: 'Runs lanes',
        why: 'Same list, typed.',
      },
      {
        part: 'Dependencies tab',
        verdict: 'Move to',
        where: 'Runs › one run: a Dependencies fold',
        why: 'Rarely read, but no other place has it.',
      },
      {
        part: 'Run brief and "After this round"',
        verdict: 'Move to',
        where: 'Runs › one run: Brief fold',
        why: 'Same.',
      },
    ],
  },
  {
    page: 'Your grills',
    parts: [
      {
        part: 'Every board grouped by machine, with attention counts and an Archived fold',
        verdict: 'Move to',
        where: 'More › "All boards" (renamed)',
        why: "It's the only way to reach a non-squad board, so keep the list and rename it for Board. It's no longer the home page.",
        usage: '43 boards',
      },
    ],
  },
  {
    page: 'Conversations (old page)',
    parts: [
      {
        part: 'Question conversations ("About Qn")',
        verdict: 'Already in',
        where:
          'The question page conversation, and the session\'s "N new on <key>"',
        why: 'Variant I.',
      },
      {
        part: 'Run coordination',
        verdict: 'Move to',
        where: "The lead's row in the two-pane Conversations page",
        why: 'Same thread, now found by session.',
      },
      {
        part: 'Squad Board (interface and improvements)',
        verdict: 'Already in',
        where: 'The pinned Board row',
        why: 'Pinned in the sessions panel.',
      },
    ],
  },
  {
    page: 'Question sidebar',
    parts: [
      {
        part: 'The sidebar outside Questions',
        verdict: 'Drop',
        where: '',
        why: "Rob's ask.",
      },
      {
        part: 'Unread count per question, and "Answered B"',
        verdict: 'Move to',
        where:
          'Rows of the filtered list on Questions, and the question header',
        why: 'Rob wants both signals; the list carries them without a second column.',
      },
      {
        part: 'Round sections and folded rounds',
        verdict: 'Move to',
        where: 'Questions: Group by round in the filter bar',
        why: 'The facet already selects a round.',
      },
      {
        part: 'Questions waiting on other sessions (tree)',
        verdict: 'Move to',
        where: 'The "Waiting" state chip (see Needs you)',
        why: 'One place for held questions.',
      },
      {
        part: 'Renaming a round',
        verdict: 'Drop',
        where: '',
        why: 'Agents name rounds through gf. Bring it back if Rob misses it.',
      },
    ],
  },
]

export const RETIRING_SUMMARY =
  'Retire Needs you, Updates, What changed, Replies and the question sidebar once the Move rows land. Fold Answer history into the Review & send tray and Run overview into Runs. Rename Your grills to All boards. Squad overview becomes the home page.'
