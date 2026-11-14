// Pieces the redesign parked rather than dropped silently. The header's "Not in this design
// yet" marker lists them so Rob can pick what comes back.

export type Parked = Readonly<{ title: string; detail: string }>

export const PARKED: ReadonlyArray<Parked> = [
  {
    title: "The old question sidebar's extras",
    detail:
      "Questions has F's side list again; it leaves out the tree of questions waiting on others, folded rounds and round sections, renaming a round, and the resizable width.",
  },
  {
    title: 'Advanced question filters and sort',
    detail:
      'Several rounds at once, urgency detail (Blocking, Can wait, unspecified), sort by urgency or recency, and grouping by agent. The filter strip covers session, urgency, one round and Open/Drafts/All.',
  },
  {
    title: 'Option consequences under each answer',
    detail:
      'Each answer is a short label now; its consequence shows on hover and in the comparison table under Trade-offs and details.',
  },
  {
    title: '"Add a note" and "Discuss" links under the answers',
    detail:
      'A pick opens its note, and the conversation sits under the question.',
  },
  {
    title: 'Expanding the discussion to full width, and resizing it',
    detail:
      'The sessions panel has a fixed width; the Conversations page still shows one conversation at full width.',
  },
  {
    title: 'Discussion context for a question in the side panel',
    detail:
      'The panel showed the question, its answers and its reasoning above the thread. Question threads now live on the question page.',
  },
  {
    title: 'Unread replies tray in the sidebar',
    detail:
      'Replies still pop up as notices in the corner; the tray that kept them in the sidebar is gone with the sidebar.',
  },
  {
    title: 'Needs you and Updates as top-level pages',
    detail:
      'Inbox replaces both; they stay under More until the Inbox is done.',
  },
]
