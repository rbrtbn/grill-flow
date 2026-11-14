// PROTOTYPE sample data for the discussion-threads studies (ask 9656). Illustrative only.

export type Session = Readonly<{
  address: string
  name: string
  role: string
  color: string
  lead?: boolean
  maintainer?: boolean
}>

export const sessions: ReadonlyArray<Session> = [
  {
    address: 't2cr',
    name: 'Squad lead',
    role: 'Lead',
    color: '#8a5a00',
    lead: true,
  },
  {
    address: 't2j6',
    name: 'Token efficiency',
    role: 'Builder',
    color: '#2c4c9c',
  },
  { address: 't2k1', name: 'Grant checks', role: 'Builder', color: '#6b3f8f' },
  { address: 't2m4', name: 'Homelab lanes', role: 'Builder', color: '#1f6f5c' },
  { address: 't2p9', name: 'Release notes', role: 'Builder', color: '#5b6b2a' },
  {
    address: 't2hw',
    name: 'Grill-flow',
    role: 'Maintainer',
    color: '#a03c2c',
    maintainer: true,
  },
]

export const session = (address: string): Session =>
  sessions.find(item => item.address === address) ?? {
    address,
    name: address,
    role: 'Agent',
    color: '#585e5a',
  }

export type Option = Readonly<{ key: string; label: string; effect: string }>
export type Question = Readonly<{
  key: string
  title: string
  asker: string
  round: string
  ask: string
  why: string
  options: ReadonlyArray<Option>
}>

export const questions: ReadonlyArray<Question> = [
  {
    key: 'cache-budget',
    title: 'Cap the prompt cache per run?',
    asker: 't2j6',
    round: 'Tonight',
    ask: 'Night runs re-read the same repo context on every question. Should each run get a shared prompt-cache budget, and how big?',
    why: 'Last week the three night runs spent 41% of their tokens re-reading context they had already cached once. A cap keeps a runaway run from evicting everyone else.',
    options: [
      {
        key: 'A',
        label: 'No cap',
        effect: 'Runs cache freely; one long run can evict the others.',
      },
      {
        key: 'B',
        label: '40k per run',
        effect:
          'Each run keeps its own 40k budget and evicts its oldest entries first.',
      },
      {
        key: 'C',
        label: 'Shared 100k pool',
        effect:
          'All night runs share one pool; the lead rebalances it between rounds.',
      },
    ],
  },
  {
    key: 'night-grant',
    title: 'Grant the night runs merge rights?',
    asker: 't2k1',
    round: 'Tonight',
    ask: 'Should builders running overnight be allowed to merge their own green PRs, or wait for your morning review?',
    why: 'Four PRs sat green for nine hours last night. Merging them would have unblocked two dependent issues before you woke up.',
    options: [
      {
        key: 'A',
        label: 'Wait for review',
        effect: 'Nothing merges overnight; mornings start with a queue.',
      },
      {
        key: 'B',
        label: 'Merge after two reviews',
        effect: 'A PR merges once two fresh reviewers find no high findings.',
      },
      {
        key: 'C',
        label: 'Merge docs only',
        effect: 'Only PRs that touch docs/ merge overnight.',
      },
    ],
  },
  {
    key: 'pr-order',
    title: 'Which PR lands first?',
    asker: 't2cr',
    round: 'Release & grants',
    ask: 'The question-keys PR and the discussion-refs PR both touch the grill schema. Which one lands first?',
    why: 'Whichever lands second has to rebase over the other’s migration; question-keys is smaller, discussion-refs is older.',
    options: [
      {
        key: 'A',
        label: 'Question keys first',
        effect: 'Discussion refs rebases; about an hour of work.',
      },
      {
        key: 'B',
        label: 'Discussion refs first',
        effect: 'Question keys rebases; its lint rules need re-running.',
      },
    ],
  },
  {
    key: 'old-pages',
    title: 'Retire pages older than a week?',
    asker: 't2m4',
    round: 'Clean-up',
    ask: 'Pages from finished squads still show in Your grills. Retire them automatically after seven quiet days?',
    why: 'Your grills lists 23 pages; 17 have had no activity for over a week.',
    options: [
      {
        key: 'A',
        label: 'Retire after 7 days',
        effect: 'Quiet pages leave the list; `gf export` keeps them.',
      },
      {
        key: 'B',
        label: 'Ask before retiring',
        effect: 'A weekly question lists candidates for you to confirm.',
      },
      {
        key: 'C',
        label: 'Keep everything',
        effect: 'The list keeps growing; search does the filtering.',
      },
    ],
  },
]

export const question = (key: string): Question =>
  questions.find(item => item.key === key) ?? questions[0]!

/** A thread is one conversation with one session, optionally about one question. */
export const GENERAL = '-'
export const threadKey = (about: string, address: string) =>
  `${about}|${address}`
export const threadAbout = (key: string) => key.split('|')[0] ?? GENERAL
export const threadWith = (key: string) => key.split('|')[1] ?? ''
export const askerThread = (questionKey: string) =>
  threadKey(questionKey, question(questionKey).asker)

export type Line = Readonly<{
  id: number
  from: string
  text: string
  at: string
  state: 'sending' | 'delivered' | 'reply'
  unread: boolean
}>

const rob = (id: number, at: string, text: string): Line => ({
  id,
  from: 'rob',
  text,
  at,
  state: 'delivered',
  unread: false,
})
const agent = (
  id: number,
  from: string,
  at: string,
  text: string,
  unread = false,
): Line => ({ id, from, text, at, state: 'reply', unread })

export const seedThreads: Record<string, ReadonlyArray<Line>> = {
  [threadKey('cache-budget', 't2j6')]: [
    rob(1, '21:02', 'Does B reset the cache per question or per run?'),
    agent(
      2,
      't2j6',
      '21:03',
      'Per run. Every question in a run shares its 40k; B evicts the oldest entries first when it fills.',
    ),
    rob(5, '21:09', 'And a run that hits the cap mid-question?'),
    agent(
      6,
      't2j6',
      '21:10',
      'It keeps going uncached until the next question starts. Nothing fails, it just costs more for that one question.',
    ),
  ],
  [threadKey('cache-budget', 't2cr')]: [
    rob(
      3,
      '21:05',
      'If we cap the cache at 40k, does tonight’s schedule still fit?',
    ),
    agent(
      4,
      't2cr',
      '21:06',
      'Yes, with room: the three night runs peaked at 31k each last week. C would need me to rebalance between rounds, which I can do.',
    ),
  ],
  [threadKey(GENERAL, 't2hw')]: [
    rob(
      7,
      '20:40',
      'The quote popover hides behind the composer on narrow windows.',
    ),
    agent(
      8,
      't2hw',
      '20:44',
      'Reproduced at 900px. The fix raises the popover above the composer; it lands after the question-keys PR.',
    ),
  ],
  [threadKey(GENERAL, 't2m4')]: [
    rob(9, '19:58', 'Why did the backup job skip last night?'),
    agent(
      10,
      't2m4',
      '20:15',
      'The NAS was asleep at 03:00. I added a wake call five minutes before the job; tonight’s run will show whether it holds.',
    ),
  ],
  [threadKey('night-grant', 't2k1')]: [
    rob(11, '21:20', 'Which repos would the grant cover?'),
    agent(
      12,
      't2k1',
      '21:24',
      'Only grill-flow and squad. Dotfiles stays owner-merge in every option.',
      true,
    ),
  ],
}

export const cannedReply = (key: string): string => {
  const about = threadAbout(key)
  const name = session(threadWith(key)).name
  return about === GENERAL
    ? `${name} here. Got it; I'll look and reply in this thread.`
    : `On ${about}: noted. I'll check and answer here, next to the question.`
}
