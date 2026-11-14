import { Array, Option, Order, Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

import { ownerWorkCounts } from './channel'
import {
  type Answers,
  type Snapshot,
  type Step,
  questionSession,
  roundLabel,
  roundOf,
  statusOf,
} from './domain'
import { inboxFixture } from './inboxFixture'

// NAMES: Rob's labels (docs/adr/0038-name-the-product-squad-board.md). A rename is one edit
// here.
export const NAMES = {
  brand: 'Board',
  squadBoard: 'Squad Board',
  sessionBoard: 'Session Board',
  inbox: 'Inbox',
  questions: 'Questions',
  runs: 'Runs',
  conversations: 'Conversations',
  task: 'Task',
  now: 'Now',
  next: 'Next',
  later: 'Later',
  promised: 'Waiting on agent',
  confirming: 'Confirming',
  freeze: 'Freeze',
  status: 'Status',
  thread: 'Thread',
  done: 'Recently done',
  requestUpdate: 'Request update',
  filter: 'Filter',
  views: 'Views',
  quickLook: 'Quick look',
  interactive: 'Interactive',
} as const

export const boardName = (grill: Snapshot['grill']): string =>
  grill.kind === 'squad' ? NAMES.squadBoard : NAMES.sessionBoard

export const INBOX = 'inbox'
export const RUNS = 'runs'
export const RUN_PAGE = 'runs:'
export const ITEM_PAGE = 'item:'
export const DECISION_PAGE = 'decision:'

// MODEL

export const UpdateScope = Schema.Literals(['tasks', 'questions', 'status'])
export type UpdateScope = typeof UpdateScope.Type

export const RequestUpdateState = defineTaggedUnion({
  Closed: {},
  Open: {
    scope: Schema.Array(UpdateScope),
    sessions: Schema.Array(Schema.String),
  },
})
export type RequestUpdateState = typeof RequestUpdateState.Type

export const UpdateRequest = Schema.Struct({
  session: Schema.String,
  at: Schema.Number,
  scope: Schema.Array(UpdateScope),
  delivery: Schema.Literals(['Pending', 'Undeliverable']),
})
export type UpdateRequest = typeof UpdateRequest.Type

export const ThreadMessage = Schema.Struct({
  from: Schema.Literals(['You', 'Agent']),
  text: Schema.String,
  at: Schema.Number,
})

export const SavedView = Schema.Struct({
  name: Schema.String,
  query: Schema.String,
})
export type SavedView = typeof SavedView.Type

export const SessionOrder = Schema.Literals(['Recent', 'Waiting', 'Name'])
export type SessionOrder = typeof SessionOrder.Type

export const InboxUi = Schema.Struct({
  expanded: Schema.Array(Schema.String),
  openQuestionLines: Schema.Array(Schema.String),
  isDoneShown: Schema.Boolean,
  isQuickLookOpen: Schema.Boolean,
  requestUpdate: RequestUpdateState,
  requests: Schema.Array(UpdateRequest),
  savedViews: Schema.Array(SavedView),
  threads: Schema.Record(Schema.String, Schema.Array(ThreadMessage)),
  threadDrafts: Schema.Record(Schema.String, Schema.String),
  isFixture: Schema.Boolean,
  maybeOpenThread: Schema.Option(Schema.String),
  // Side threads started on this page; delivery to `<subject>@<address>` comes later.
  sideThreads: Schema.Array(Schema.String),
  isSidePickerOpen: Schema.Boolean,
  // The sessions panel shows its directory until a row opens a conversation.
  isSessionDirectory: Schema.Boolean,
  sessionSearch: Schema.String,
  sessionOrder: SessionOrder,
  pinned: Schema.Array(Schema.String),
})
export type InboxUi = typeof InboxUi.Type

export const initialInboxUi: InboxUi = {
  expanded: [],
  openQuestionLines: [],
  isDoneShown: false,
  isQuickLookOpen: false,
  requestUpdate: RequestUpdateState.Closed(),
  requests: [],
  savedViews: [],
  threads: {},
  threadDrafts: {},
  isFixture: false,
  maybeOpenThread: Option.none(),
  sideThreads: [],
  isSidePickerOpen: false,
  isSessionDirectory: true,
  sessionSearch: '',
  sessionOrder: 'Recent',
  pinned: [],
}

// DOMAIN: the Inbox's view of a snapshot. Plain types: these are derived every render, never
// stored in the Model.

export type Bucket = 'now' | 'next' | 'later'
export type Urgency = 'blocking' | 'soon' | 'wait' | 'fyi'
export type TaskState =
  | Readonly<{ _tag: 'Open' }>
  | Readonly<{ _tag: 'Promised'; until: string }>
  | Readonly<{ _tag: 'Reported'; via: string }>
  | Readonly<{ _tag: 'Completed'; proof: string; at: number }>
  | Readonly<{ _tag: 'Withdrawn'; reason: string }>

export type TaskStep = Readonly<{
  text: string
  copy?: string
  link?: string
  heldBy?: string
}>

export type TaskOrigin =
  | Readonly<{
      _tag: 'Answer'
      question: string
      title: string
      answer: string
      note: string
    }>
  | Readonly<{ _tag: 'Pick'; card: string; pick: string }>
  | Readonly<{ _tag: 'Picks'; label: string; questions: ReadonlyArray<string> }>

export type Destination =
  | Readonly<{ _tag: 'Link'; url: string }>
  | Readonly<{ _tag: 'Terminal'; address: string }>

export type Task = Readonly<{
  id: string
  // The published owner step it shows, when one exists; fixture-only tasks have none.
  maybeSource: Option.Option<{ source: string; revision: number }>
  session: string
  title: string
  body: string
  action: string
  host: string
  destination: Destination
  urgency: Urgency
  state: TaskState
  at: number
  copy?: string
  steps?: ReadonlyArray<TaskStep>
  heldBy?: ReadonlyArray<string>
  origin?: TaskOrigin
  unblocks?: ReadonlyArray<string>
  routeWhy?: string
  // Set only when the step's agent accepts a page answer for it (a PAGE grant).
  pageAnswer?: Readonly<{ question: string; option: string }>
  optional?: boolean
}>

export type Freeze = Readonly<{
  id: string
  session: string
  title: string
  body: string
  clearsWhen: string
  at: number
  // A blocker whose evidence couldn't be checked: shown as a freeze, marked as unconfirmed.
  isUnknown?: boolean
}>

export type InboxQuestion = Readonly<{
  id: string
  key: string
  title: string
  context: string
  urgency: Urgency | undefined
  session: string
  round: number
  roundName: string
}>

export type SessionType =
  | 'Orchestrated'
  | 'Lead'
  | 'Helper'
  | 'Interactive'
  | 'Ended'

export type SessionInfo = Readonly<{
  address: string
  label: string
  type: SessionType
  maybeLastActive: Option.Option<{ at: number; what: string }>
}>

export type StatusLine = Readonly<{
  session: string
  title: string
  body: string
  at: number
}>

export type InboxBase = Readonly<{
  tasks: ReadonlyArray<Task>
  freezes: ReadonlyArray<Freeze>
  questions: ReadonlyArray<InboxQuestion>
  statuses: ReadonlyArray<StatusLine>
}>

export type InboxData = InboxBase &
  Readonly<{
    sessions: ReadonlyArray<SessionInfo>
    provisional: number
  }>

export const SESSION_TYPES: Readonly<
  Record<SessionType, { label: string; note: string }>
> = {
  Orchestrated: {
    label: 'Orchestrated run',
    note: 'Follows the squad rules: run state, gates, grants through the grant log, one status per run.',
  },
  Lead: {
    label: 'Squad lead',
    note: 'Plans and routes the squad’s work; owns the page.',
  },
  Helper: {
    label: 'Helper',
    note: 'Builds for the squad and publishes tasks and status, without a run of its own.',
  },
  Interactive: {
    label: NAMES.interactive,
    note: 'Joined the page only: no run state, gates or status of its own. It reports through questions and tasks.',
  },
  Ended: {
    label: 'Ended',
    note: 'Session closed or handed over; what it left is stale until someone takes it over.',
  },
}
export const SESSION_TYPE_ORDER: ReadonlyArray<SessionType> = [
  'Orchestrated',
  'Lead',
  'Helper',
  'Interactive',
  'Ended',
]

export const bucketOf = (urgency: Urgency | undefined): Bucket =>
  urgency === 'blocking' || urgency === 'soon'
    ? 'now'
    : urgency === 'wait'
      ? 'next'
      : 'later'

export const BUCKETS: ReadonlyArray<Bucket> = ['now', 'next', 'later']
export const bucketLabel = (bucket: Bucket): string => NAMES[bucket]

const DAY = 24 * 60 * 60 * 1000

const destinationOf = (
  destination: string | Readonly<{ kind: 'terminal'; address: string }>,
): Destination =>
  typeof destination === 'string'
    ? { _tag: 'Link', url: destination }
    : { _tag: 'Terminal', address: destination.address }

const publishedTasks = (snapshot: Snapshot): ReadonlyArray<Task> =>
  (snapshot.ownerSteps ?? []).map(entry => {
    const item = entry.item
    const progress = item.progress
    return {
      id: item.id,
      maybeSource: Option.some({
        source: entry.source,
        revision: item.revision,
      }),
      session: item.session,
      title: item.title ?? item.action,
      body: item.body,
      action: item.action,
      host: item.host,
      destination: destinationOf(item.destination),
      urgency: item.urgency,
      state:
        progress.state === 'open'
          ? { _tag: 'Open' }
          : progress.state === 'completed'
            ? {
                _tag: 'Completed',
                proof: progress.proof,
                at: progress.checkedAt,
              }
            : { _tag: 'Withdrawn', reason: progress.reason },
      at: entry.at,
    }
  })

const openQuestions = (
  snapshot: Snapshot,
  answers: Answers,
): ReadonlyArray<InboxQuestion> =>
  snapshot.grill.steps
    .filter(step =>
      ['Open', 'Waiting'].includes(
        statusOf(snapshot.grill, answers, step.question.id)._tag,
      ),
    )
    .map(step => questionOf(snapshot, step))

export const questionOf = (snapshot: Snapshot, step: Step): InboxQuestion => {
  const round = roundOf(snapshot.grill, step.question)
  return {
    id: step.question.id,
    key: step.question.key ?? step.question.id,
    title: step.question.title,
    context: step.question.context ?? '',
    urgency: step.question.urgency,
    session: questionSession(snapshot.grill, step.question),
    round,
    roundName: roundLabel(snapshot.grill, round, false),
  }
}

/** Label for each session: its question source, else the member grill that published for it. */
const sessionLabels = (snapshot: Snapshot): Readonly<Record<string, string>> =>
  Object.fromEntries([
    ...(snapshot.updates ?? []).map(entry => [
      entry.item.session,
      entry.source,
    ]),
    ...(snapshot.ownerSteps ?? []).map(entry => [
      entry.item.session,
      entry.source,
    ]),
    ...snapshot.grill.steps.flatMap(step => {
      const source =
        step.question.from === undefined
          ? undefined
          : snapshot.grill.sources?.[step.question.from]
      return source === undefined || step.question.session === undefined
        ? []
        : [[step.question.session, source.text]]
    }),
  ])

const lastActivity = (
  snapshot: Snapshot,
  label: string,
): Option.Option<{ at: number; what: string }> =>
  Option.map(
    Array.findLast(
      snapshot.activity?.entries ?? [],
      entry => entry.member === label,
    ),
    entry => ({ at: entry.at, what: entry.summary || entry.label }),
  )

/**
 * A heuristic type until sessions publish one: the page's lead, Ended when the roster says the
 * terminal finished or nothing moved for a day, Orchestrated when it publishes status.
 */
const typeOf = (
  snapshot: Snapshot,
  address: string,
  maybeLast: Option.Option<{ at: number }>,
  now: number,
): SessionType => {
  const member = snapshot.roster?.members.find(
    entry => entry.address === address,
  )
  const agent = snapshot.agents?.find(entry => entry.address === address)
  const updates = (snapshot.updates ?? []).filter(
    entry => entry.item.session === address,
  )
  const lastSeen = Math.max(
    Option.match(maybeLast, { onNone: () => 0, onSome: last => last.at }),
    ...updates.map(entry => entry.at),
    ...(snapshot.ownerSteps ?? [])
      .filter(entry => entry.item.session === address)
      .map(entry => entry.at),
  )
  if (agent?.lead === true || address === snapshot.grill.session) {
    return 'Lead'
  }
  if (
    member?.terminal === 'finished' ||
    (snapshot.agents !== undefined && agent === undefined) ||
    (now > 0 && lastSeen > 0 && now - lastSeen > DAY)
  ) {
    return 'Ended'
  }
  return Array.isReadonlyArrayNonEmpty(updates) ? 'Orchestrated' : 'Interactive'
}

const sessionsOf = (
  snapshot: Snapshot,
  tasks: ReadonlyArray<Task>,
  questions: ReadonlyArray<InboxQuestion>,
  now: number,
): ReadonlyArray<SessionInfo> => {
  const labels = sessionLabels(snapshot)
  return Array.dedupe([
    snapshot.grill.session,
    ...tasks.map(task => task.session),
    ...questions.map(question => question.session),
    ...(snapshot.updates ?? []).map(entry => entry.item.session),
    ...(snapshot.agents ?? []).map(agent => agent.address),
  ])
    .filter(address => address !== '')
    .map(address => {
      const label = labels[address] ?? address
      const maybeLastActive = lastActivity(snapshot, label)
      return {
        address,
        label,
        type: typeOf(snapshot, address, maybeLastActive, now),
        maybeLastActive,
      }
    })
}

type Blocker = NonNullable<Snapshot['blockers']>[number]

const clearsWhenOf = (condition: Blocker['item']['condition']): string =>
  condition.kind === 'question'
    ? `${condition.question} is answered ${condition.oneOf.join(' or ')}`
    : condition.kind === 'owner-step'
      ? `the owner step ${condition.id} is done`
      : `${
          condition.reference.provider === 'linear'
            ? condition.reference.id
            : `${condition.reference.repository}#${condition.reference.number}`
        } is no longer ${condition.state}`

/** Published blockers hold work the way a freeze does: blocked and unknown show, clear doesn't. */
export const blockerFreezes = (snapshot: Snapshot): ReadonlyArray<Freeze> =>
  (snapshot.blockers ?? [])
    .filter(blocker => blocker.state !== 'clear')
    .map(blocker => ({
      id: blocker.item.id,
      session: blocker.item.session,
      title:
        blocker.item.title ?? blocker.item.body.split('\n')[0] ?? 'Blocked',
      body: [blocker.item.body, blocker.detail].filter(Boolean).join(' '),
      clearsWhen: clearsWhenOf(blocker.item.condition),
      at: blocker.at,
      ...(blocker.state === 'unknown' ? { isUnknown: true } : {}),
    }))

const statusesOf = (snapshot: Snapshot): ReadonlyArray<StatusLine> =>
  Array.sort(
    (snapshot.updates ?? [])
      .filter(entry => entry.supersededBy === undefined)
      .map(entry => ({
        session: entry.item.session,
        title: entry.item.title ?? 'Status',
        body: entry.displayBody ?? entry.item.body,
        at: entry.at,
      })),
    Order.flip(Order.mapInput(Order.Number, (line: StatusLine) => line.at)),
  )

export const inboxData = (
  snapshot: Snapshot,
  answers: Answers,
  now: number,
  withFixture: boolean,
): InboxData => {
  const base: InboxBase = {
    tasks: publishedTasks(snapshot),
    freezes: blockerFreezes(snapshot),
    questions: openQuestions(snapshot, answers),
    statuses: statusesOf(snapshot),
  }
  const merged = withFixture
    ? inboxFixture(base)
    : { ...base, sessionTypes: {} }
  const sessions = sessionsOf(
    snapshot,
    merged.tasks,
    merged.questions,
    now,
  ).map(session => ({
    ...session,
    type: merged.sessionTypes[session.address] ?? session.type,
  }))
  return {
    tasks: merged.tasks,
    freezes: merged.freezes,
    questions: merged.questions,
    statuses: merged.statuses,
    sessions: [
      ...sessions,
      ...Object.keys(merged.sessionTypes)
        .filter(
          address => !sessions.some(session => session.address === address),
        )
        .filter(address =>
          merged.statuses.some(status => status.session === address),
        )
        .map(address => ({
          address,
          label: address,
          type: merged.sessionTypes[address] ?? 'Interactive',
          maybeLastActive: Option.none(),
        })),
    ],
    provisional: ownerWorkCounts(snapshot).provisional,
  }
}

/** The thread target an item shares with side threads: `item:<source>/<id>@<address>`. */
export const threadTarget = (task: Task): string =>
  `${ITEM_PAGE}${Option.match(task.maybeSource, {
    onNone: () => 'fixture',
    onSome: published => published.source,
  })}/${task.id}@${task.session}`

export const sessionOf = (
  data: InboxData,
  address: string,
): Option.Option<SessionInfo> =>
  Array.findFirst(data.sessions, session => session.address === address)

export const isLive = (session: SessionInfo): boolean =>
  session.type !== 'Ended'

// ENTRIES AND FILTERS

export type Kind = 'question' | 'merge' | 'type' | 'edit' | 'page' | 'setup'
export const KINDS: ReadonlyArray<readonly [Kind, string]> = [
  ['question', 'Questions'],
  ['merge', 'Merges'],
  ['type', 'Lines to type'],
  ['edit', 'Edits'],
  ['page', 'In the browser'],
  ['setup', 'Setup'],
]

// Where a task is done. A PR, issue or Linear issue link names its place; any other link (a doc
// to read, a setup guide) is reference, so the step's host names the place instead.
export const placeOf = (task: Task): string => {
  if (task.destination._tag === 'Terminal') {
    return `terminal:${task.destination.address}`
  }
  const url = task.destination.url
  return /github\.com\/[^/]+\/[^/]+\/(pull|issues)\/\d+/.test(url)
    ? 'github'
    : /linear\.app\/[^/]+\/issue\//.test(url)
      ? 'linear'
      : /^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url) ||
          task.host === 'this browser'
        ? 'here'
        : `host:${task.host}`
}
export const placeLabel = (place: string): string =>
  place.startsWith('terminal:')
    ? `In ${place.slice('terminal:'.length)}`
    : place.startsWith('host:')
      ? `On ${place.slice('host:'.length)}`
      : ({
          questions: 'On the Questions page',
          github: 'On GitHub',
          linear: 'In Linear',
          here: 'In this browser',
        }[place] ?? place)

export const kindOf = (task: Task): Kind =>
  /\/pull\/\d+/.test(
    task.destination._tag === 'Link' ? task.destination.url : '',
  ) || task.id.startsWith('merge')
    ? 'merge'
    : task.destination._tag === 'Terminal'
      ? 'type'
      : placeOf(task) === 'linear'
        ? 'edit'
        : placeOf(task) === 'here'
          ? 'page'
          : 'setup'

export type Entry =
  | Readonly<{
      _tag: 'Task'
      task: Task
      kind: Kind
      place: string
      session: string
      bucket: Bucket
    }>
  | Readonly<{
      _tag: 'Question'
      question: InboxQuestion
      kind: Kind
      place: string
      session: string
      bucket: Bucket
    }>

export const taskEntry = (task: Task): Entry => ({
  _tag: 'Task',
  task,
  kind: kindOf(task),
  place: placeOf(task),
  session: task.session,
  bucket: task.optional === true ? 'later' : bucketOf(task.urgency),
})
const questionEntry = (question: InboxQuestion): Entry => ({
  _tag: 'Question',
  question,
  kind: 'question',
  place: 'questions',
  session: question.session,
  bucket: bucketOf(question.urgency),
})

export const openTasks = (data: InboxData): ReadonlyArray<Task> =>
  data.tasks.filter(task => task.state._tag === 'Open')

export const entriesOf = (data: InboxData): ReadonlyArray<Entry> => [
  ...openTasks(data).map(taskEntry),
  ...data.questions.map(questionEntry),
]

/** What the header counts: everything in Now and Next, questions included. */
export const dueCount = (data: InboxData): number =>
  entriesOf(data).filter(entry => entry.bucket !== 'later').length

export type GroupBy = 'urgency' | 'place' | 'kind' | 'session'
export const GROUP_BYS: ReadonlyArray<readonly [GroupBy, string]> = [
  ['urgency', 'Urgency'],
  ['place', 'Where'],
  ['kind', 'Kind'],
  ['session', 'Session'],
]

export type Filters = Readonly<{
  kind: ReadonlyArray<string>
  urgency: ReadonlyArray<string>
  session: ReadonlyArray<string>
  groupBy: GroupBy
}>
export type Facet = 'kind' | 'urgency' | 'session'

const listParam = (params: URLSearchParams, key: string) =>
  (params.get(key) ?? '').split(',').filter(value => value !== '')

export const filtersFrom = (query: string): Filters => {
  const params = new URLSearchParams(query)
  const group = params.get('group')
  return {
    kind: listParam(params, 'kind'),
    urgency: listParam(params, 'urgency'),
    session: listParam(params, 'run'),
    groupBy: Option.getOrElse(
      Option.map(
        Array.findFirst(GROUP_BYS, ([value]) => value === group),
        ([value]) => value,
      ),
      (): GroupBy => 'urgency',
    ),
  }
}

export const queryOf = (filters: Filters): string => {
  const params = new URLSearchParams()
  if (Array.isReadonlyArrayNonEmpty(filters.kind)) {
    params.set('kind', filters.kind.join(','))
  }
  if (Array.isReadonlyArrayNonEmpty(filters.urgency)) {
    params.set('urgency', filters.urgency.join(','))
  }
  if (Array.isReadonlyArrayNonEmpty(filters.session)) {
    params.set('run', filters.session.join(','))
  }
  if (filters.groupBy !== 'urgency') {
    params.set('group', filters.groupBy)
  }
  return params.toString()
}

export const toggleFacet = (
  filters: Filters,
  facet: Facet,
  value: string,
): Filters => ({
  ...filters,
  [facet]: filters[facet].includes(value)
    ? filters[facet].filter(current => current !== value)
    : [...filters[facet], value],
})

export const hasFilters = (filters: Filters): boolean =>
  [filters.kind, filters.urgency, filters.session].some(
    Array.isReadonlyArrayNonEmpty,
  )

export const passes = (filters: Filters, entry: Entry): boolean =>
  (!Array.isReadonlyArrayNonEmpty(filters.kind) ||
    filters.kind.includes(entry.kind)) &&
  (!Array.isReadonlyArrayNonEmpty(filters.urgency) ||
    filters.urgency.includes(entry.bucket)) &&
  (!Array.isReadonlyArrayNonEmpty(filters.session) ||
    filters.session.includes(entry.session))

export const PRESET_VIEWS = (data: InboxData): ReadonlyArray<SavedView> => [
  { name: 'Everything', query: '' },
  { name: 'Merges and lines to type', query: 'kind=merge,type&group=place' },
  { name: 'Just questions', query: 'kind=question&group=session' },
  { name: 'Now only', query: 'urgency=now' },
  {
    name: 'Interactive sessions',
    query: queryOf({
      kind: [],
      urgency: [],
      session: data.sessions
        .filter(session => session.type === 'Interactive')
        .map(session => session.address),
      groupBy: 'session',
    }),
  },
]

/** A view matches when its filters equal the current ones, in any order. */
export const isCurrentView = (view: SavedView, filters: Filters): boolean => {
  const wanted = filtersFrom(view.query)
  const same = (a: ReadonlyArray<string>, b: ReadonlyArray<string>) =>
    a.length === b.length && a.every(value => b.includes(value))
  return (
    same(wanted.kind, filters.kind) &&
    same(wanted.urgency, filters.urgency) &&
    same(wanted.session, filters.session) &&
    wanted.groupBy === filters.groupBy
  )
}

// QUESTIONS PAGE FILTERS (?run=…&urgency=…&round=…)

export type QuestionQuery = Readonly<{
  session: ReadonlyArray<string>
  urgency: ReadonlyArray<string>
  maybeRound: Option.Option<number>
}>

export const questionQueryFrom = (query: string): QuestionQuery => {
  const params = new URLSearchParams(query)
  const round = Number(params.get('round'))
  return {
    session: listParam(params, 'run'),
    urgency: listParam(params, 'urgency'),
    maybeRound:
      params.get('round') !== null && Number.isInteger(round)
        ? Option.some(round)
        : Option.none(),
  }
}

export const questionQueryString = (query: QuestionQuery): string => {
  const params = new URLSearchParams()
  if (Array.isReadonlyArrayNonEmpty(query.session)) {
    params.set('run', query.session.join(','))
  }
  if (Array.isReadonlyArrayNonEmpty(query.urgency)) {
    params.set('urgency', query.urgency.join(','))
  }
  Option.map(query.maybeRound, round => params.set('round', String(round)))
  return params.toString()
}

const narrowedCache = new WeakMap<
  Snapshot,
  Readonly<{ query: string; snapshot: Snapshot }>
>()

/**
 * The snapshot the Questions page walks: only the questions the address's filters keep. One
 * narrowed snapshot per query keeps the snapshot-keyed caches downstream warm.
 */
export const narrowedSnapshot = (
  snapshot: Snapshot,
  query: string,
): Snapshot => {
  const parsed = questionQueryFrom(query)
  if (isQuestionQueryEmpty(parsed)) {
    return snapshot
  }
  const cached = narrowedCache.get(snapshot)
  if (cached?.query === query) {
    return cached.snapshot
  }
  const narrowed: Snapshot = {
    ...snapshot,
    grill: {
      ...snapshot.grill,
      steps: snapshot.grill.steps.filter(step =>
        questionPasses(parsed, questionOf(snapshot, step)),
      ),
    },
  }
  narrowedCache.set(snapshot, { query, snapshot: narrowed })
  return narrowed
}

export const isQuestionQueryEmpty = (query: QuestionQuery): boolean =>
  questionQueryString(query) === ''

export const questionPasses = (
  query: QuestionQuery,
  question: InboxQuestion,
): boolean =>
  (!Array.isReadonlyArrayNonEmpty(query.session) ||
    query.session.includes(question.session)) &&
  (!Array.isReadonlyArrayNonEmpty(query.urgency) ||
    query.urgency.includes(bucketOf(question.urgency))) &&
  Option.match(query.maybeRound, {
    onNone: () => true,
    onSome: round => question.round === round,
  })

// REQUEST UPDATE

export const SCOPE_LABELS: Readonly<Record<UpdateScope, string>> = {
  tasks: 'Tasks and freezes',
  questions: 'Questions',
  status: 'Status',
}
export const ALL_SCOPES: ReadonlyArray<UpdateScope> = [
  'tasks',
  'questions',
  'status',
]

export const requestMessage = (
  pageId: string,
  scope: ReadonlyArray<UpdateScope>,
): string =>
  `[Squad Board] Rob asks for an up-to-date version of your ${scope.map(value => SCOPE_LABELS[value].toLowerCase()).join(', ') || 'items'} on page ${pageId}. Check each against the current state: revise what changed, withdraw what is done or no longer needed, add what is missing, then reply on the page.`

type PublishedDecision = NonNullable<Snapshot['decisions']>[number]

/** A decision's page key: its source and id, which together name it on the page. */
export const decisionKey = (entry: PublishedDecision): string =>
  `${entry.source}/${entry.item.id}`

/** Decisions still open to a veto, nearest deadline first. */
export const provisionalDecisions = (
  snapshot: Snapshot,
): ReadonlyArray<PublishedDecision> =>
  Array.sort(
    (snapshot.decisions ?? []).filter(
      entry => entry.item.resolution.state === 'provisional',
    ),
    Order.mapInput(
      Order.Number,
      (entry: PublishedDecision) => entry.item.deadline,
    ),
  )
