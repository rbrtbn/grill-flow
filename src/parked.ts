// Pieces the redesign parked rather than dropped silently. The header's "Not in this design
// yet" marker lists them so Rob can pick what comes back.

import type { DecisionStatus } from './retirement'

// What to do with a parked piece: bring it back, drop it, keep it as it is, or leave it to Rob.
export type ParkedVerdict = 'Bring back' | 'Drop' | 'Keep' | 'Open'

export type Parked = Readonly<{
  title: string
  detail: string
  verdict: ParkedVerdict
  where: string
  status: DecisionStatus
}>

export const PARKED: ReadonlyArray<Parked> = [
  {
    title: "The old question sidebar's extras",
    detail:
      "Questions has F's side list again. Left out: folded rounds and round sections, renaming a round, and the resizable width. The waiting tree became the Waiting view.",
    verdict: 'Drop',
    where: '',
    status: 'Open',
  },
  {
    title: 'Advanced question filters and sort',
    detail:
      'Several rounds at once, urgency detail (Blocking, Can wait, unspecified), sort by urgency or recency, and grouping by agent. The filter strip covers urgency, one round, session and Open/Waiting/Drafts/All.',
    verdict: 'Open',
    where: 'Questions filter strip',
    status: 'Open',
  },
  {
    title: 'Option consequences under each answer',
    detail:
      'Each answer is a short label; its consequence shows on hover and in the comparison table under Trade-offs and details.',
    verdict: 'Drop',
    where: '',
    status: 'Open',
  },
  {
    title: '"Add a note" and "Discuss" links under the answers',
    detail:
      'A pick opens its note, and the conversation sits under the question.',
    verdict: 'Drop',
    where: '',
    status: 'Open',
  },
  {
    title: 'Expanding the discussion to full width, and resizing it',
    detail:
      'The sessions panel has a fixed width; Conversations shows any thread in a wide middle pane.',
    verdict: 'Drop',
    where: 'Conversations',
    status: 'Open',
  },
  {
    title: 'Discussion context for a question in the side panel',
    detail:
      'The panel showed the question, its answers and its reasoning above the thread. Question threads live on the question page.',
    verdict: 'Drop',
    where: 'The question page',
    status: 'Open',
  },
  {
    title: 'Unread replies tray in the sidebar',
    detail:
      'Replies count on the header bell, open from its tray into their session’s thread, and show as N new on that session’s row.',
    verdict: 'Drop',
    where: 'Header bell',
    status: 'Done',
  },
  {
    title: 'Needs you and Updates as top-level pages',
    detail: 'The Inbox and Runs carry their parts; old links redirect there.',
    verdict: 'Drop',
    where: 'Inbox, Runs',
    status: 'Done',
  },
  {
    title: 'Kept on purpose, in their old look',
    detail:
      'The full Review & send page (the tray covers quick sends), Settings, Your grills, Run overview (until Runs › one run has shown its work for a while), and a single session’s concept pages outside the workspace. Each still works; none has had the redesign yet.',
    verdict: 'Keep',
    where: 'More, and the Review & send tray',
    status: 'Open',
  },
]
