import { Option } from 'effect'

import type {
  Destination,
  Freeze,
  InboxBase,
  SessionType,
  StatusLine,
  Task,
} from './inbox'

// A preview-only overlay (`?fixture=owner-actions` on a GF_PREVIEW server) with prototype F's
// sample records, so every Inbox state shows before the server has a schema for it.

const at = (iso: string) => Date.parse(iso)
const t2hq: Destination = { _tag: 'Terminal', address: 't2hq' }

const FREEZES: ReadonlyArray<Freeze> = [
  {
    id: 'hold-plugin-reload',
    session: 't2hq',
    title: 'Don’t update or reload the squad plugin',
    body: 'squad 25.8.0 carries three high-severity bugs (LAB-1454). No host has installed it; this Mac is on 25.7.0.',
    clearsWhen: 'the LAB-1454 fix is released (squad 25.8.1)',
    at: at('2026-11-14T01:58:00Z'),
  },
  {
    id: 'hold-sandbox-merge',
    session: 't2hq',
    title: 'Don’t merge the sandbox-tools PR yet',
    body: 'It waits on squad#160’s CI, which hasn’t reported since 03:10.',
    clearsWhen: 'squad#160 is no longer failed',
    at: at('2026-11-14T03:12:00Z'),
    isUnknown: true,
  },
]

const ENRICH: Readonly<Record<string, Partial<Task>>> = {
  'type-card-15': {
    copy: 'stage1-t2cr-15: all a',
    origin: { _tag: 'Pick', card: 'stage1-t2cr-15', pick: 'all a' },
    unblocks: ['reviews of squad#161, #163, #164'],
  },
  'type-card-16': {
    copy: 'stage1-t2cr-16: fix forward, R4-A2 security',
    origin: { _tag: 'Pick', card: 'stage1-t2cr-16', pick: 'fix-forward' },
    unblocks: ['squad#162 closed', 'LAB-1454 fix PR'],
  },
  'type-card-17': {
    copy: 'stage1-t2cr-17: scope a, rule-files a, sandbox-tools d, worktree-tool a, lead-ask-tools a, tier-tool a, new-file-guard a',
    origin: {
      _tag: 'Picks',
      label: 'LAB-1451 gate',
      questions: ['Q372', 'Q373', 'Q374', 'Q375', 'Q376', 'Q377', 'Q378'],
    },
  },
  'type-card-18': {
    copy: 'stage1-t2cr-18: all a',
    origin: {
      _tag: 'Picks',
      label: 'LAB-1449 gate',
      questions: ['Q379', 'Q380', 'Q381'],
    },
    pageAnswer: { question: 'Q380', option: 'a' },
  },
  'merge-157': {
    routeWhy:
      'Round-cap merge that changes merging.md: the gate refuses agents (squad ADR 0053).',
    unblocks: ['LAB-1449 build', 'Q380 follow-up'],
  },
  'merge-grill-mod': {
    steps: [
      {
        text: 'Merge dotfiles#432 on GitHub.',
        link: 'https://github.com/rbrtbn/dotfiles/pull/432',
      },
      { text: 'In your own terminal:', copy: 'chezmoi apply' },
      {
        text: 'In each session you use:',
        copy: '/reload-plugins',
        heldBy: 'hold-plugin-reload',
      },
    ],
    heldBy: ['hold-plugin-reload'],
  },
  'merge-gf-19': {
    steps: [
      {
        text: 'Merge grill-flow#19 on GitHub.',
        link: 'https://github.com/rbrtbn/grill-flow/pull/19',
      },
      {
        text: 'Restart the page server from your terminal:',
        copy: 'bash ~/.handoffs/2026-11-14-grill-flow-maintainer-restart.sh',
      },
    ],
  },
  'admit-1455': { copy: 'admit LAB-1455', optional: true },
  'lab-1019-milestone': {
    routeWhy:
      'A Linear edit in your name. Agents could make it as rbrtbn-squad if you say so once.',
  },
}

const EXTRA_TASKS: ReadonlyArray<Task> = [
  {
    id: 'q380-grant-followup',
    maybeSource: Option.none(),
    session: 't2hq',
    title: 'Grant change for the version-gate fix, if any',
    body: 'You asked on Q380: if this needs an update to the grants, give the prompt to send and which agent to send it to. I can only tell once squad#157 merges and LAB-1449 lands.',
    action: 'Filled in when LAB-1449 lands.',
    host: 'rob-mbp · Herdr terminal t2hq',
    destination: t2hq,
    urgency: 'wait',
    state: { _tag: 'Promised', until: 'squad#157 merges and LAB-1449 lands' },
    origin: {
      _tag: 'Answer',
      question: 'Q380',
      title:
        'LAB-1449 gate · version-gate: ship the fix to runs already going?',
      answer: 'a · Every run',
      note: 'If this needs an update to the grants, then also provide a prompt that I would need to send and to which agent to send it.',
    },
    at: at('2026-11-14T02:45:00Z'),
  },
  {
    id: 'type-card-14',
    maybeSource: Option.none(),
    session: 't2hq',
    title: 'Type your LAB-1440 review answer',
    body: 'You picked “ship as is” on the page. Typed in t2hq at 03:12; t2hq checks the grant log before it closes this.',
    action: 'stage1-t2cr-14: ship as is',
    copy: 'stage1-t2cr-14: ship as is',
    host: 'rob-mbp · Herdr terminal t2hq',
    destination: t2hq,
    urgency: 'soon',
    state: { _tag: 'Reported', via: 'I did it, 03:12' },
    at: at('2026-11-14T02:30:00Z'),
  },
  {
    id: 'review-owner-actions',
    maybeSource: Option.none(),
    session: 't2j5',
    title: 'Look at the Inbox build',
    body: 'The Inbox, Runs and item pages from prototype F, built into the real page. Answer the three owner-actions questions after.',
    action: 'Open the Inbox and tell the builder what to change.',
    host: 'this browser',
    destination: { _tag: 'Link', url: 'http://127.0.0.1:4381/g/squad/inbox' },
    urgency: 'wait',
    state: { _tag: 'Open' },
    at: at('2026-11-14T03:40:00Z'),
  },
  {
    id: 'overnight-grant-typed',
    maybeSource: Option.none(),
    session: 't2cr',
    title: 'Type the overnight delegation in t2cr',
    body: 'Scoped overnight delegation for stage1-t2cr.',
    action: 'overnight: stage1-t2cr until 06:00Z',
    copy: 'overnight: stage1-t2cr until 06:00Z',
    host: 'rob-mbp · Herdr terminal t2cr',
    destination: { _tag: 'Terminal', address: 't2cr' },
    urgency: 'soon',
    state: {
      _tag: 'Completed',
      proof: 'grant log gl-8c1e04a9f2d37b60 · Grants row G13',
      at: at('2026-11-14T00:12:00Z'),
    },
    at: at('2026-11-13T23:50:00Z'),
  },
  {
    id: 'pin-node-24',
    maybeSource: Option.none(),
    session: 't1mn',
    title: 'Pin Node 24 on the homelab runner',
    body: 'Superseded: the runner image now ships Node 24.',
    action: 'Pin Node 24.',
    host: 'homelab',
    destination: { _tag: 'Link', url: 'https://github.com/rbrtbn/squad' },
    urgency: 'fyi',
    state: {
      _tag: 'Withdrawn',
      reason: 'The runner image ships Node 24 now.',
    },
    at: at('2026-11-09T01:00:00Z'),
  },
]

const EXTRA_STATUS: ReadonlyArray<StatusLine> = [
  {
    session: 't1mn',
    title: 'Open for you (02:21Z) · Q196',
    body: 'Overnight work ended 2026-11-09T06:00Z. squad#139 merged; main CI green. Posted 5 days ago by t1mn, which handed the lead to t2cr.',
    at: at('2026-11-09T02:21:00Z'),
  },
]

export const SESSION_TYPE_OVERRIDES: Readonly<Record<string, SessionType>> = {
  t2hq: 'Orchestrated',
  t118: 'Helper',
  t1mn: 'Ended',
}

// A session's set-once profile, until sessions publish one (t2j6's session-work-state schema).
export type SessionProfile = Readonly<{
  model: string
  effort: string
  subagents: boolean
}>

export const SESSION_PROFILES: Readonly<Record<string, SessionProfile>> = {
  t2cr: { model: 'Opus 5.5', effort: 'high', subagents: true },
  t2hq: { model: 'Opus 5.5', effort: 'xhigh', subagents: true },
  t2j5: { model: 'Opus 5.5', effort: 'high', subagents: false },
  t2j6: { model: 'Opus 5.5', effort: 'high', subagents: false },
  t2j8: { model: 'Sonnet 5.5', effort: 'medium', subagents: false },
  t118: { model: 'Haiku 5.5', effort: 'low', subagents: false },
  t2j0: { model: 'Sonnet 5.5', effort: 'medium', subagents: false },
  t2gx: { model: 'Opus 5.5', effort: 'high', subagents: true },
}

export const inboxFixture = (
  base: InboxBase,
): InboxBase & { sessionTypes: Readonly<Record<string, SessionType>> } => ({
  tasks: [
    ...base.tasks.map(task => ({ ...task, ...ENRICH[task.id] })),
    ...EXTRA_TASKS.filter(
      extra => !base.tasks.some(task => task.id === extra.id),
    ),
  ],
  freezes: [...base.freezes, ...FREEZES],
  questions: base.questions,
  statuses: [...base.statuses, ...EXTRA_STATUS],
  sessionTypes: SESSION_TYPE_OVERRIDES,
})
