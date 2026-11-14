import { Schema } from 'effect'

// The Work page's model: each issue's moves through the squad's states, turned into segments,
// a flow position, time per state, the agents that held it and what is left. One model feeds
// both the Timeline and each row's Track, so the two never disagree.

export const WorkState = Schema.Literals([
  'planned',
  'design-gate',
  'building',
  'review',
  'fixing',
  'merge-ready',
  'merged',
  'released',
  'blocked',
  'parked',
])
export type WorkState = typeof WorkState.Type

export const WorkMove = Schema.Struct({
  at: Schema.String,
  state: WorkState,
  agent: Schema.String,
  note: Schema.String,
})
export type WorkMove = typeof WorkMove.Type

export const WorkItem = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  linearStatus: Schema.String,
  pr: Schema.NullOr(Schema.Number),
  prState: Schema.NullOr(Schema.String),
  state: WorkState,
  dependsOn: Schema.Array(Schema.String),
  blockedBy: Schema.NullOr(Schema.String),
  doing: Schema.String,
  rounds: Schema.Struct({ review: Schema.Number, fix: Schema.Number }),
  estimateLeft: Schema.NullOr(Schema.String),
  transitions: Schema.Array(WorkMove),
})
export type WorkItem = typeof WorkItem.Type

export const WorkLog = Schema.Struct({
  run: Schema.Struct({
    id: Schema.String,
    lead: Schema.String,
    orchestrator: Schema.String,
    startedAt: Schema.String,
    notes: Schema.String,
  }),
  issues: Schema.Array(WorkItem),
  sources: Schema.Array(Schema.String),
  gaps: Schema.Array(Schema.String),
  now: Schema.String,
})
export type WorkLog = typeof WorkLog.Type

// The order work moves in. Blocked and parked are not positions: an issue keeps the position it
// reached before them.
export const FLOW: ReadonlyArray<WorkState> = [
  'planned',
  'design-gate',
  'building',
  'review',
  'fixing',
  'merge-ready',
  'merged',
  'released',
]

/** The Track's columns: the stages an issue passes between being picked up and merging. */
export const STAGES: ReadonlyArray<WorkState> = [
  'design-gate',
  'building',
  'review',
  'fixing',
  'merge-ready',
  'merged',
]

export const STATE_LABELS: Readonly<Record<WorkState, string>> = {
  planned: 'Planned',
  'design-gate': 'Design gate',
  building: 'Building',
  review: 'Review',
  fixing: 'Fixing',
  'merge-ready': 'Merge-ready',
  merged: 'Merged',
  released: 'Released',
  blocked: 'Blocked',
  parked: 'Parked',
}

const DONE: ReadonlyArray<WorkState> = ['merged', 'released']
const LATER: ReadonlyArray<WorkState> = ['planned', 'parked']

export const isLaterState = (state: WorkState): boolean => LATER.includes(state)

const positionOf = (state: WorkState): number => FLOW.indexOf(state)

export type WorkGroup = 'Done' | 'Active' | 'Later'

export type Segment = Readonly<{
  state: WorkState
  // The flow position this segment counts towards: its own state, or the one before a block.
  flow: WorkState
  agent: string
  note: string
  from: number
  to: number
  // Times taken from file mtimes, not from a logged move.
  isInferred: boolean
}>

export type WorkIssue = WorkItem &
  Readonly<{
    segments: ReadonlyArray<Segment>
    isBlocked: boolean
    // Where the issue stands in the flow.
    at: WorkState
    spent: number
    perState: Readonly<Partial<Record<WorkState, number>>>
    // Each change of hands, in order; an agent can appear more than once.
    agents: ReadonlyArray<string>
    reviewLoops: number
    group: WorkGroup
    sinceLast: number
    stepsLeft: number
    first: number | undefined
    last: number | undefined
  }>

export type WorkStats = Readonly<{
  inProgress: number
  blocked: number
  done: number
  planned: number
  medianCycle: number
  spentOpen: number
  handovers: number
  reviewRounds: number
}>

export type WorkModel = Readonly<{
  now: number
  start: number
  issues: ReadonlyArray<WorkIssue>
  // Blocked first, then furthest along.
  active: ReadonlyArray<WorkIssue>
  // Oldest merge first.
  done: ReadonlyArray<WorkIssue>
  later: ReadonlyArray<WorkIssue>
  stats: WorkStats
}>

/** A duration the way the page writes it: 45m, 2.5h, 13h, 1d 4h. */
export const duration = (ms: number): string => {
  if (!Number.isFinite(ms) || ms <= 0) {
    return '—'
  }
  const minutes = Math.round(ms / 60000)
  if (minutes < 60) {
    return `${minutes}m`
  }
  const hours = minutes / 60
  if (hours < 23.95) {
    return `${hours < 10 ? hours.toFixed(1).replace(/\.0$/, '') : Math.round(hours)}h`
  }
  const total = Math.round(hours)
  const days = Math.floor(total / 24)
  const rest = total - days * 24
  return rest === 0 ? `${days}d` : `${days}d ${rest}h`
}

export const agoText = (ms: number): string =>
  ms < 60000 ? 'now' : `${duration(ms)} ago`

export const median = (values: ReadonlyArray<number>): number => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  return sorted.length === 0
    ? Number.NaN
    : (sorted[Math.floor(sorted.length / 2)] ?? Number.NaN)
}

export const cycleTime = (issue: WorkIssue): number =>
  issue.first === undefined || issue.last === undefined
    ? Number.NaN
    : issue.last - issue.first

const deriveIssue = (item: WorkItem, now: number): WorkIssue => {
  const moves = [
    ...item.transitions.filter(move => Number.isFinite(Date.parse(move.at))),
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
  const segments = moves.reduce<ReadonlyArray<Segment>>((done, move, index) => {
    const from = Date.parse(move.at)
    const next = moves[index + 1]
    const isEnd = DONE.includes(move.state) || LATER.includes(move.state)
    const flow =
      positionOf(move.state) >= 0
        ? move.state
        : (done[done.length - 1]?.flow ?? 'planned')
    return [
      ...done,
      {
        state: move.state,
        flow,
        agent: move.agent,
        note: move.note,
        from,
        to: next === undefined ? (isEnd ? from : now) : Date.parse(next.at),
        isInferred: move.note.includes('mtime'),
      },
    ]
  }, [])
  const lastFlow = segments[segments.length - 1]?.flow ?? 'planned'
  const isDone = DONE.includes(item.state)
  const isLater = LATER.includes(item.state)
  const at = positionOf(item.state) >= 0 ? item.state : lastFlow
  const working = segments.filter(segment => !LATER.includes(segment.state))
  const perState = working.reduce<Partial<Record<WorkState, number>>>(
    (sums, segment) => ({
      ...sums,
      [segment.flow]: (sums[segment.flow] ?? 0) + (segment.to - segment.from),
    }),
    {},
  )
  const agents = segments.reduce<ReadonlyArray<string>>(
    (held, segment) =>
      segment.agent === '' || held[held.length - 1] === segment.agent
        ? held
        : [...held, segment.agent],
    [],
  )
  return {
    ...item,
    segments,
    isBlocked:
      item.state === 'blocked' ||
      (!isDone && !isLater && item.blockedBy !== null),
    at,
    spent: working.reduce((sum, segment) => sum + segment.to - segment.from, 0),
    perState,
    agents,
    reviewLoops: segments.filter(segment => segment.state === 'fixing').length,
    group: isDone ? 'Done' : isLater ? 'Later' : 'Active',
    sinceLast:
      segments.length === 0
        ? 0
        : now - (segments[segments.length - 1]?.from ?? now),
    stepsLeft: isDone
      ? 0
      : Math.max(0, positionOf('merged') - Math.max(positionOf(at), 0)),
    first: working[0]?.from,
    last: segments[segments.length - 1]?.to,
  }
}

/** The page's model from a work log: every issue derived, grouped and summed up. */
export const workModel = (log: WorkLog): WorkModel => {
  const times = log.issues
    .flatMap(item => item.transitions.map(move => Date.parse(move.at)))
    .filter(Number.isFinite)
  const logged = Date.parse(log.now)
  const now = Number.isFinite(logged)
    ? logged
    : times.length === 0
      ? 0
      : Math.max(...times)
  const start = times.length === 0 ? now : Math.min(...times)
  const issues = log.issues.map(item => deriveIssue(item, now))
  const active = [...issues.filter(issue => issue.group === 'Active')].sort(
    (a, b) =>
      Number(b.isBlocked) - Number(a.isBlocked) ||
      positionOf(b.at) - positionOf(a.at),
  )
  const done = [...issues.filter(issue => issue.group === 'Done')].sort(
    (a, b) => (a.last ?? 0) - (b.last ?? 0),
  )
  const later = issues.filter(issue => issue.group === 'Later')
  const rounds = [...active, ...done].map(issue => issue.rounds.review)
  return {
    now,
    start,
    issues,
    active,
    done,
    later,
    stats: {
      inProgress: active.length,
      blocked: active.filter(issue => issue.isBlocked).length,
      done: done.length,
      planned: later.length,
      medianCycle: median(done.map(cycleTime)),
      spentOpen: active.reduce((sum, issue) => sum + issue.spent, 0),
      handovers: issues.reduce(
        (sum, issue) => sum + Math.max(0, issue.agents.length - 1),
        0,
      ),
      reviewRounds:
        rounds.reduce((sum, count) => sum + count, 0) /
        Math.max(1, rounds.length),
    },
  }
}

export type StageMark = 'Here' | 'Past' | 'Skipped' | 'Future'

export type TrackStage = Readonly<{
  stage: WorkState
  mark: StageMark
  // The agent that last held the issue in this stage.
  agent: string | undefined
  spent: number | undefined
  loops: number
}>

/** One issue's Track: each stage, whether it is behind, current or ahead, and who held it. */
export const trackStages = (issue: WorkIssue): ReadonlyArray<TrackStage> => {
  const current = positionOf(issue.at)
  return STAGES.map(stage => {
    const position = positionOf(stage)
    const spent = issue.perState[stage]
    const held = issue.segments.filter(segment => segment.flow === stage)
    const isHere = stage === issue.at && issue.group === 'Active'
    const isVisited =
      spent !== undefined || (position < current && issue.group !== 'Later')
    return {
      stage,
      mark: isHere
        ? 'Here'
        : isVisited
          ? 'Past'
          : position < current
            ? 'Skipped'
            : 'Future',
      agent: isHere
        ? (held[held.length - 1]?.agent ??
          issue.agents[issue.agents.length - 1])
        : held[held.length - 1]?.agent,
      spent,
      loops: stage === 'fixing' ? issue.reviewLoops : 0,
    }
  })
}

/** What is left, in the page's words. */
export const leftLine = (issue: WorkIssue): string =>
  issue.group === 'Done'
    ? 'Done'
    : `${issue.stepsLeft} step${issue.stepsLeft === 1 ? '' : 's'} to merge`

const DAY = 86400000

export type TimelineScale = Readonly<{
  start: number
  end: number
  // Midnights (UTC) between start and end.
  days: ReadonlyArray<number>
}>

// Room after now for the dashed bars of what is left.
const AHEAD = 0.18

export const timelineScale = (model: WorkModel): TimelineScale => {
  const end = model.now + (model.now - model.start) * AHEAD
  const first = Math.ceil(model.start / DAY) * DAY
  return {
    start: model.start,
    end,
    days: Array.from(
      { length: Math.max(0, Math.ceil((end - first) / DAY)) },
      (_, index) => first + index * DAY,
    ).filter(day => day < end),
  }
}

/** Where a time falls on the timeline, as a percentage of its width. */
export const timelineX = (scale: TimelineScale, ms: number): number =>
  scale.end === scale.start
    ? 0
    : ((ms - scale.start) / (scale.end - scale.start)) * 100

/** The issues the URL's `open` parameter names. */
export const openIssues = (query: string): ReadonlyArray<string> =>
  (new URLSearchParams(query).get('open') ?? '')
    .split(',')
    .map(id => id.trim())
    .filter(id => id !== '')

export type WorkFold = 'Done' | 'Later'

const FOLD_KEYS: Readonly<Record<WorkFold, string>> = {
  Done: 'done',
  Later: 'later',
}

// Commas stay readable in the address (`?open=LAB-1426,LAB-1451`), so a link can be typed.
const withParam = (query: string, key: string, value: string): string => {
  const params = new URLSearchParams(query)
  if (value === '') {
    params.delete(key)
  } else {
    params.set(key, value)
  }
  return params.toString().replace(/%2C/g, ',')
}

export const isFoldShown = (query: string, fold: WorkFold): boolean =>
  new URLSearchParams(query).get(FOLD_KEYS[fold]) === '1'

export const toggleFold = (query: string, fold: WorkFold): string =>
  withParam(query, FOLD_KEYS[fold], isFoldShown(query, fold) ? '' : '1')

export const toggleOpenIssue = (query: string, id: string): string => {
  const open = openIssues(query)
  return withParam(
    query,
    'open',
    (open.includes(id)
      ? open.filter(other => other !== id)
      : [...open, id]
    ).join(','),
  )
}

/** Opens an issue's row, and the fold it sits in, so a link to it always lands on it. */
export const revealIssue = (
  query: string,
  id: string,
  group: WorkGroup,
): string => {
  const opened = openIssues(query).includes(id)
    ? query
    : toggleOpenIssue(query, id)
  return group === 'Active' || isFoldShown(opened, group)
    ? opened
    : toggleFold(opened, group)
}
