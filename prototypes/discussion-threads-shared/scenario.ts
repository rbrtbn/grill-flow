// PROTOTYPE round 3 (ask 9656): a run that moves under the page. Each step changes sessions,
// issues, pull requests, questions or replies, so the sessions panel and question page can be
// judged mid-run, not only at rest. Roster state is derived from the step number.
import { type Member, roster, threadKey } from './data'

export type Live = Member &
  Readonly<{
    pr?: Readonly<{ number: number; state: 'open' | 'merged' }>
    issueState: 'open' | 'done'
    terminal: 'running' | 'closed'
    joinedAt?: number
    previousLead?: boolean
  }>

export type Step = Readonly<{ title: string; detail: string }>

export const STEPS: ReadonlyArray<Step> = [
  {
    title: 'Tonight’s run is under way',
    detail:
      'Eight sessions in Efficiency, three in Briefings, plus Grill-flow.',
  },
  {
    title: 'A reply arrives while you read another question',
    detail:
      'You moved to pr-order; Token efficiency answers your passage thread on cache-budget.',
  },
  {
    title: 'PR #21 merges',
    detail: 'Grant checks’ pull request for LAB-1398 merges on green.',
  },
  {
    title: 'LAB-1398 is resolved in Linear',
    detail: 'Grant checks and Codex builder have no open work left.',
  },
  {
    title: 'Grant checks’ session closes',
    detail: 't2k1 leaves Herdr; its conversations stay readable.',
  },
  {
    title: 'You answer night-grant',
    detail: 'The question leaves the open list; its threads stay with it.',
  },
  {
    title: 'cache-budget is rewritten (revision 2)',
    detail:
      'The passage you quoted about paused runs is no longer in the text. Its thread stays.',
  },
  {
    title: 'Reviewer round 4 closes, round 5 joins',
    detail: 'A fresh reviewer session takes LAB-1412.',
  },
  {
    title: 'The lead hands over',
    detail:
      'A new lead session (t2cx) takes the page; the pinned lead follows it.',
  },
]

const extra: ReadonlyArray<Member> = [
  {
    address: 't2r9',
    name: 'Reviewer · round 5',
    role: 'Reviewer',
    color: '#9a5a2a',
    squad: 'Efficiency',
    issue: 'LAB-1412',
    work: 'Reviews PR #18',
    state: 'working',
  },
  {
    address: 't2cx',
    name: 'Squad lead',
    role: 'Lead',
    color: '#a06a00',
    lead: true,
    squad: 'Efficiency',
    issue: 'LAB-1400',
    work: 'Night-run plan',
    state: 'working',
  },
]

export const rosterAt = (step: number): ReadonlyArray<Live> =>
  [...roster, ...extra]
    .filter(item =>
      item.address === 't2r9'
        ? step >= 7
        : item.address === 't2cx'
          ? step >= 8
          : true,
    )
    .map(item => {
      const live: Live = {
        ...item,
        issueState: 'open',
        terminal: 'running',
        ...(item.address === 't2k1'
          ? { pr: { number: 21, state: step >= 2 ? 'merged' : 'open' } }
          : {}),
        ...(item.address === 't2j6'
          ? { pr: { number: 18, state: 'open' } }
          : {}),
        ...(item.address === 't2r9' ? { joinedAt: 7 } : {}),
        ...(item.address === 't2cx' ? { joinedAt: 8 } : {}),
      }
      const done = step >= 3 && item.issue === 'LAB-1398'
      const closed =
        (step >= 4 && item.address === 't2k1') ||
        (step >= 7 && item.address === 't2r3') ||
        (step >= 8 && item.address === 't2cr')
      return {
        ...live,
        issueState: done ? 'done' : 'open',
        terminal: closed ? 'closed' : 'running',
        state: closed || done ? 'idle' : item.state,
        ...(step >= 8 && item.address === 't2cr'
          ? { lead: false, previousLead: true, name: 'Previous lead' }
          : {}),
      }
    })

export const currentLead = (step: number) => (step >= 8 ? 't2cx' : 't2cr')

/** What each step changed, so the panel can mark those rows for one step. */
export const changedAt: Record<number, ReadonlyArray<string>> = {
  1: ['t2j6'],
  2: ['t2k1'],
  3: ['t2k1', 't2v8'],
  4: ['t2k1'],
  5: ['t2k1'],
  7: ['t2r3', 't2r9'],
  8: ['t2cr', 't2cx'],
}

export const STEP_REPLY = threadKey('cache-budget#p2', 't2j6')
export const REVISION_STEP = 6

/** cache-budget as the summary-first shape guide revision 8 asks for. */
export const summaries: Record<string, string> = {
  'cache-budget':
    'Should night runs get a prompt-cache budget? Recommended: B, 40k per run. It saves about a third of tonight’s tokens and stops one long run from evicting the others, with no extra work for the lead. Details: LAB-1412.',
  'night-grant':
    'Should overnight builders merge their own green PRs? Recommended: B, after two clean reviews. Four PRs sat green for nine hours last night and blocked two issues. Details: LAB-1398.',
  'pr-order':
    'Two PRs touch the grill schema; one must rebase over the other. Recommended: A, question keys first: it is smaller, so the rebase costs an hour instead of a lint re-run. See PR #18.',
  'old-pages':
    'Your grills lists 23 pages and 17 are quiet for a week. Recommended: B, ask before retiring, so nothing disappears without you seeing it. Details: LAB-1405.',
}

export const detailsAt = (
  questionKey: string,
  step: number,
  original: ReadonlyArray<string>,
) =>
  questionKey === 'cache-budget' && step >= REVISION_STEP
    ? [
        original[0] ?? '',
        'The prompt cache keeps recently sent context for five minutes. Runs that wait on reviewers lose it and pay to send the whole context again.',
        ...original.slice(2),
      ]
    : original

export type Table = Readonly<{
  now: string
  rows: ReadonlyArray<
    Readonly<{ label: string; cells: Record<string, string> }>
  >
}>

export const compares: Record<string, Table> = {
  'cache-budget': {
    now: 'Today',
    rows: [
      {
        label: 'Tokens tonight',
        cells: { now: '100%', A: '~100%', B: '~66%', C: '~60%' },
      },
      {
        label: 'One run evicts others',
        cells: { now: 'Yes', A: 'Yes', B: 'No', C: 'Rarely' },
      },
      {
        label: 'Lead work per round',
        cells: { now: 'None', A: 'None', B: 'None', C: 'Rebalance the pool' },
      },
      {
        label: 'Short runs',
        cells: { now: 'Full price', A: 'Full price', B: 'Cached', C: 'Cached' },
      },
    ],
  },
  'night-grant': {
    now: 'Today',
    rows: [
      {
        label: 'Green PRs overnight',
        cells: {
          now: 'Wait ~9 h',
          A: 'Wait ~9 h',
          B: 'Merge after 2 reviews',
          C: 'Docs only',
        },
      },
      {
        label: 'Risk of a bad merge',
        cells: { now: 'None', A: 'None', B: 'Low', C: 'Very low' },
      },
      {
        label: 'Morning queue',
        cells: { now: '4 PRs', A: '4 PRs', B: '0–1', C: '3 PRs' },
      },
    ],
  },
  'pr-order': {
    now: 'Today',
    rows: [
      {
        label: 'Rebase cost',
        cells: { now: '—', A: '~1 hour', B: 'Lint re-run' },
      },
      {
        label: 'Lands tonight',
        cells: { now: 'Neither', A: 'Both', B: 'Both, later' },
      },
    ],
  },
  'old-pages': {
    now: 'Today',
    rows: [
      {
        label: 'Pages listed',
        cells: {
          now: '23',
          A: '6',
          B: '6 after you confirm',
          C: '23 and growing',
        },
      },
      {
        label: 'Surprise removals',
        cells: { now: 'None', A: 'Possible', B: 'None', C: 'None' },
      },
    ],
  },
}

/** Where references link. Linear and GitHub targets are illustrative. */
export const refUrl = (ref: string): string | undefined => {
  const linear = /^(LAB|PDE)-\d+$/.exec(ref)
  if (linear !== null)
    return `https://linear.app/${ref.startsWith('PDE') ? 'buddywise' : 'rbrtbn'}/issue/${ref}`
  const pr = /^PR #(\d+)$/.exec(ref)
  return pr === null
    ? undefined
    : `https://github.com/rbrtbn/grill-flow/pull/${pr[1]}`
}
export const REF_PATTERN = /(LAB-\d+|PDE-\d+|PR #\d+)/g
