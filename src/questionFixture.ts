import type { Question, Snapshot, Step } from './domain'

// Preview-only open questions (`?fixture=owner-actions` on a GF_PREVIEW server), from prototype
// F's sample, so the Questions page and the Inbox's question lines stay reviewable once every
// real question is answered. Writes about them stay in this browser (main.ts postEvent).

const PART = 'fixture::owner-actions'

type Sample = Readonly<{
  id: string
  key: string
  session: string
  source: string
  round: number
  urgency: 'soon' | 'wait' | 'fyi'
  title: string
  ask: string
  context: string
  options: ReadonlyArray<readonly [string, string, string]>
  recommended: string
  prose: ReadonlyArray<string>
  compare?: Question['compare']
}>

const ROUNDS: Readonly<Record<string, readonly [string, number, string]>> = {
  '901': ['Discussion threads', 1, 'Question page conversations'],
  '902': ['run stage1-t2cr', 1, 'LAB-1455 design gate'],
  '903': ['Send shortcuts', 1, 'Send shortcuts'],
  '904': ['Owner actions', 1, 'First prototypes'],
  '905': ['Owner actions', 2, 'Combined prototype'],
}

const SOURCES: Readonly<Record<string, string>> = {
  t2j6: 'Discussion threads prototypes',
  t2hq: 'run stage1-t2cr (orchestrator t2hq)',
  t2j8: 'Send shortcuts prototypes',
  t2j5: 'Owner actions prototypes',
}

const SAMPLES: ReadonlyArray<Sample> = [
  {
    id: 'Q901',
    key: 'session-finder',
    session: 't2j6',
    source: 't2j6',
    round: 901,
    urgency: 'soon',
    title: 'How should the sessions panel find sessions?',
    ask: 'Should the sessions panel group by squad, by issue, or list every session by recency?',
    context:
      'The panel keeps only conversations outside a question, and a squad can run a dozen sessions.',
    options: [
      [
        'a',
        'By squad',
        'Squads stay together; a session’s issue shows on its row.',
      ],
      [
        'b',
        'By issue',
        'Work comes first; sessions without an issue gather at the end.',
      ],
      ['c', 'By recency', 'One list, newest first; nothing groups.'],
    ],
    recommended: 'a',
    prose: [
      'Group by squad: you look for a session by the squad it works in, and the issue and work on each row find it within one. Group and order stay one choice away.',
      'A squad runs up to a dozen sessions, and two squads can share a page. Recency alone mixes them, so a long-idle lead sinks below a helper that just spoke.',
      'Grouping by issue fits the Runs page better, where work is the point; here it splits a squad across several headings.',
    ],
    compare: {
      now: 'Discussion panel today',
      rows: [
        {
          label: 'Finding the lead',
          cells: {
            now: 'In a To list',
            a: 'Pinned on top',
            b: 'Under its issue',
            c: 'Wherever it last spoke',
          },
        },
        {
          label: 'Two squads on one page',
          cells: { now: 'Mixed', a: 'Apart', b: 'Mixed by issue', c: 'Mixed' },
        },
        {
          label: 'A session with no issue',
          cells: {
            now: 'Listed',
            a: 'In its squad',
            b: { value: 'At the end', flag: 'gap' },
            c: 'Listed',
          },
        },
      ],
    },
  },
  {
    id: 'Q902',
    key: 'question-page-conversations',
    session: 't2j6',
    source: 't2j6',
    round: 901,
    urgency: 'soon',
    title: 'Which question-page layout do we build?',
    ask: 'Should conversations about a question live under it, in its margin, or as one issue-style timeline?',
    context:
      'Conversations about a question move from the Discussion panel onto the question page.',
    options: [
      [
        'a',
        'Under the question',
        'Threads appear in reading order under their paragraph.',
      ],
      [
        'b',
        'Margin threads',
        'The reading flow stays untouched; threads sit beside it.',
      ],
      [
        'c',
        'Issue page',
        'Answers stay in view and one timeline holds every thread.',
      ],
    ],
    recommended: 'c',
    prose: [
      'Build the issue page: answers stay in view, the background folds away, and one timeline holds every thread in the order it happened.',
      'Margin threads need about 1,300px of width and break on a laptop with the sessions panel open.',
    ],
  },
  {
    id: 'Q903',
    key: 'answer-shape',
    session: 't2hq',
    source: 't2hq',
    round: 902,
    urgency: 'soon',
    title: 'LAB-1455 gate · one documented shape for owner answers?',
    ask: 'Should every owner answer follow one documented shape that gates can parse?',
    context:
      'Illustrative: a design gate the orchestrator would ask before LAB-1455 builds.',
    options: [
      [
        'a',
        'One shape',
        'Gates parse `card: picks`; anything else is read back.',
      ],
      ['b', 'Per gate', 'Each gate documents its own shape.'],
    ],
    recommended: 'a',
    prose: [
      'One shape: every gate reads `<card>: <picks>`, so a typed line answers exactly one card and a slip is read back instead of failing silently.',
    ],
  },
  {
    id: 'Q904',
    key: 'readback',
    session: 't2hq',
    source: 't2hq',
    round: 902,
    urgency: 'wait',
    title: 'LAB-1455 gate · read back a refused answer?',
    ask: 'When a gate refuses an answer, should it read the answer back to you instead of failing silently?',
    context: 'Illustrative, same gate.',
    options: [
      [
        'a',
        'Read it back',
        'The session replies with what it understood and why it refused.',
      ],
      ['b', 'Fail quietly', 'The card stays open; you notice later.'],
    ],
    recommended: 'a',
    prose: ['Read it back: a refusal you never see costs a round.'],
  },
  {
    id: 'Q905',
    key: 'send-shortcut-variant',
    session: 't2j8',
    source: 't2j8',
    round: 903,
    urgency: 'wait',
    title: 'Which send shortcut should be built?',
    ask: 'Which of the three send shortcut prototypes should be built?',
    context:
      'Three prototypes run locally; until one is picked, sending still means Review & send.',
    options: [
      ['a', 'Header counter', 'An “N unsent” counter opens a tray.'],
      ['b', 'Strip under answers', 'Each answer gets a send strip.'],
      ['c', 'Both', 'The counter and the strip together.'],
    ],
    recommended: 'c',
    prose: [
      'Both: the strip sends where you answer, and the counter catches what you left behind.',
    ],
  },
  {
    id: 'Q906',
    key: 'send-guard',
    session: 't2j8',
    source: 't2j8',
    round: 903,
    urgency: 'wait',
    title: 'How should a one-click send guard against a slip?',
    ask: 'Hold each send for 5 seconds with Undo before it is delivered?',
    context:
      'One-click sends make it easy to send an answer you meant to keep.',
    options: [
      [
        'a',
        'Hold 5 s with Undo',
        'One click sends after 5 s; Undo cancels while it waits.',
      ],
      ['b', 'Confirm first', 'Every send takes two clicks.'],
      [
        'c',
        'Send at once',
        'Fastest; a slip can only be corrected in a conversation.',
      ],
    ],
    recommended: 'a',
    prose: [
      'A delivered answer can’t be recalled, so a one-click send needs some guard.',
    ],
  },
  {
    id: 'Q907',
    key: 'cmd-enter-sends',
    session: 't2j8',
    source: 't2j8',
    round: 903,
    urgency: 'wait',
    title: 'Should ⌘↵ on a question send its answer?',
    ask: 'Should ⌘↵ on a question send that answer instead of opening Review & send?',
    context: '⌘↵ opens Review & send today, so changing it retrains a habit.',
    options: [
      ['a', 'Send this answer', '⌘↵ sends the answer in view.'],
      ['b', 'Keep Review', '⌘↵ keeps opening Review & send.'],
    ],
    recommended: 'a',
    prose: [
      'Send this answer: the key works where you are, and ⇧⌘↵ still sends the round.',
    ],
  },
  {
    id: 'Q908',
    key: 'owner-actions-grant-button',
    session: 't2j5',
    source: 't2j5',
    round: 904,
    urgency: 'wait',
    title: 'Build an “Answer on page” button for grants now?',
    ask: 'Should the board offer an “Answer on page” button for grants before page answers count as grants?',
    context: 'Page answers aren’t grants until you add page to grant_sources.',
    options: [
      [
        'a',
        'Build it dormant',
        'It shows only on steps that carry a page answer.',
      ],
      ['b', 'Wait', 'Nothing until grant_sources lists page.'],
    ],
    recommended: 'a',
    prose: [
      'Build it dormant: it costs little and is ready when you change grant_sources.',
    ],
  },
  {
    id: 'Q909',
    key: 'owner-actions-batching',
    session: 't2j5',
    source: 't2j5',
    round: 905,
    urgency: 'wait',
    title: 'Where should batching live?',
    ask: 'Should batches (all merges, or all lines for one session) be views on the Inbox or their own mode?',
    context:
      'All the merges, or all the lines for one session, in one sitting.',
    options: [
      ['a', 'Views', 'Group by Where or Kind covers it.'],
      ['b', 'Batch mode', 'A one-at-a-time mode: copy, focus, I did it, next.'],
    ],
    recommended: 'a',
    prose: ['Views: grouping already puts the lines for one session together.'],
  },
  {
    id: 'Q910',
    key: 'owner-actions-names',
    session: 't2j5',
    source: 't2j5',
    round: 905,
    urgency: 'fyi',
    title: 'Which set of names should the pages use?',
    ask: 'Keep Inbox, Questions, Runs and Conversations, with Task, Freeze and Status for the rest?',
    context: 'One vocabulary before any copy is written.',
    options: [
      ['a', 'Keep them', 'The names as built.'],
      ['b', 'Revisit', 'Another round on names.'],
    ],
    recommended: 'a',
    prose: [
      'Keep them: they read at a glance and match tools you already use.',
    ],
  },
]

const stepOf = (sample: Sample): Step => ({
  id: `fixture-${sample.key}`,
  part: PART,
  heading: sample.title,
  prose: sample.prose,
  question: {
    id: sample.id,
    key: sample.key,
    title: sample.title,
    context: sample.context,
    scope: 'Preview sample: not a real question.',
    ask: sample.ask,
    options: sample.options.map(([key, label, effect]) => ({
      key,
      label,
      effect,
      recommended: key === sample.recommended,
    })),
    dependsOn: [],
    when: [],
    round: sample.round,
    urgency: sample.urgency,
    from: `fixture::${sample.source}`,
    session: sample.session,
    ...(sample.compare === undefined ? {} : { compare: sample.compare }),
  },
})

const FIXTURE_IDS = new Set(SAMPLES.map(sample => sample.id))
const FIXTURE_STEPS = new Set(SAMPLES.map(sample => `fixture-${sample.key}`))

/** Whether a question id or step id belongs to the preview sample. */
/** A channel source the preview fixture made up; nothing about it reaches the server. */
export const isFixtureSource = (source: string): boolean =>
  source.startsWith('fixture::')

export const isFixtureQuestion = (id: string): boolean =>
  FIXTURE_IDS.has(id) || FIXTURE_STEPS.has(id)

const cache = new WeakMap<Snapshot, Snapshot>()

export const withFixtureQuestions = (snapshot: Snapshot): Snapshot => {
  const cached = cache.get(snapshot)
  if (cached !== undefined) {
    return cached
  }
  const grill = snapshot.grill
  const merged: Snapshot = {
    ...snapshot,
    grill: {
      ...grill,
      parts: grill.parts.some(part => part.id === PART)
        ? grill.parts
        : [
            ...grill.parts,
            {
              id: PART,
              title: 'Preview sample',
              summary: 'Sample open questions for reviewing the page.',
            },
          ],
      steps: [
        ...grill.steps.filter(step => !FIXTURE_STEPS.has(step.id)),
        ...SAMPLES.map(stepOf),
      ],
      sources: {
        ...grill.sources,
        ...Object.fromEntries(
          Object.entries(SOURCES).map(([session, text]) => [
            `fixture::${session}`,
            { text },
          ]),
        ),
      },
      roundNames: {
        ...grill.roundNames,
        ...Object.fromEntries(
          Object.entries(ROUNDS).map(([round, [, , name]]) => [round, name]),
        ),
      },
      roundNumbers: {
        ...grill.roundNumbers,
        ...Object.fromEntries(
          Object.entries(ROUNDS).map(([round, [, number]]) => [round, number]),
        ),
      },
      roundSections: {
        ...grill.roundSections,
        ...Object.fromEntries(
          Object.entries(ROUNDS).map(([round, [section]]) => [round, section]),
        ),
      },
      activeRounds: [
        ...(grill.activeRounds ?? []),
        ...Object.keys(ROUNDS).map(Number),
      ],
    },
  }
  const withThread: Snapshot = {
    ...merged,
    decisions: [
      ...(snapshot.decisions ?? []).filter(
        entry => !isFixtureSource(entry.source),
      ),
      ...SAMPLE_DECISIONS,
    ],
    asks: [
      ...snapshot.asks.filter(ask => ask.stepId !== SAMPLE_THREAD),
      ...SAMPLE_ASKS,
    ],
    revisions: [
      ...snapshot.revisions.filter(
        revision => revision.stepId !== SAMPLE_THREAD,
      ),
      ...SAMPLE_ANSWERS,
    ],
  }
  cache.set(snapshot, withThread)
  return withThread
}

// A direct thread with t2j6, so the sessions panel has a conversation to open.
const SAMPLE_THREAD = 'agent:t2j6'
const SAMPLE_ASKS: Snapshot['asks'] = [
  {
    id: 990001,
    stepId: SAMPLE_THREAD,
    text: 'When the side list comes back on Questions, does it change your thread schema?',
    at: Date.parse('2026-11-14T03:52:00Z'),
    answered: true,
  },
  {
    id: 990002,
    stepId: SAMPLE_THREAD,
    text: 'And the unread count per question: can it count passage and side threads too?',
    at: Date.parse('2026-11-14T04:06:00Z'),
    answered: true,
  },
]
const SAMPLE_ANSWERS: Snapshot['revisions'] = [
  {
    id: 990101,
    stepId: SAMPLE_THREAD,
    askId: 990001,
    kind: 'comment',
    text: 'No. A thread is still <subject>@<address>; the list only reads it.',
    at: Date.parse('2026-11-14T03:58:00Z'),
  },
  {
    id: 990102,
    stepId: SAMPLE_THREAD,
    askId: 990002,
    kind: 'comment',
    text: 'Yes: every thread whose subject is the question counts, passage and side ones included. I add read state per thread in the business-logic phase.',
    at: Date.parse('2026-11-14T04:15:00Z'),
  },
]

const decision = (
  session: string,
  id: string,
  title: string,
  body: string,
  deadline: string,
  affected: ReadonlyArray<string>,
): NonNullable<Snapshot['decisions']>[number] => ({
  source: `fixture::${session}`,
  event: 1,
  at: Date.parse('2026-11-14T03:40:00Z'),
  window: 'open',
  vetoes: [],
  item: {
    version: 1,
    id,
    previous: 0,
    revision: 1,
    session,
    title,
    body,
    kind: 'decision',
    deadline: Date.parse(deadline),
    affected,
    resolution: { state: 'provisional' },
  },
})

// Provisional decisions: none exist in real data yet, so the quiet Inbox list has samples.
const SAMPLE_DECISIONS: NonNullable<Snapshot['decisions']> = [
  decision(
    't2hq',
    'keep-stage1-branch',
    'Keep stage1 on its own branch until LAB-1449 merges',
    'Rebasing stage1 onto main now would drag in the unreleased channel changes. I keep it separate and merge after LAB-1449.',
    '2026-11-14T18:00:00Z',
    ['stage1-t2cr', 'LAB-1449'],
  ),
  decision(
    't2j8',
    'shortcut-default-off',
    'Ship the send shortcut off by default',
    'Cmd-Enter sends only after you turn it on in Settings, so nobody sends a draft by habit.',
    '2026-11-15T09:00:00Z',
    ['send shortcuts'],
  ),
  decision(
    't2cr',
    'nightly-backup-window',
    'Move the nightly backup to 03:30',
    'The 02:00 backup overlaps the squad-eff digest; 03:30 is quiet on every host.',
    '2026-11-15T12:00:00Z',
    ['grill-flow service'],
  ),
]
