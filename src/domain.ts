import { Array, Option, Order, Record, Schema, pipe } from 'effect'

import { Compare, titleOf } from './diagram'

// GRILL

export const AnswerOption = Schema.Struct({
  key: Schema.String,
  label: Schema.String,
  effect: Schema.String,
  recommended: Schema.Boolean,
})
export type AnswerOption = typeof AnswerOption.Type

export const Condition = Schema.Struct({
  question: Schema.String,
  oneOf: Schema.Array(Schema.String),
})
export type Condition = typeof Condition.Type

// SQUAD FIELDS: a squad lead's grill adds these; every one is optional.

export const Urgency = Schema.Literals(['blocking', 'soon', 'wait', 'fyi'])
export type Urgency = typeof Urgency.Type

// Linear's state types, plus `pr` for a pull request.
export const RefType = Schema.Literals([
  'triage',
  'backlog',
  'unstarted',
  'started',
  'completed',
  'canceled',
  'pr',
])
export type RefType = typeof RefType.Type

// What a Linear id, PR or other reference named in the text points at.
export const Ref = Schema.Struct({
  text: Schema.String,
  url: Schema.optionalKey(Schema.String),
  state: Schema.optionalKey(Schema.String),
  type: Schema.optionalKey(RefType),
})
export type Ref = typeof Ref.Type

// Who asked a question: a session or run.
export const Source = Schema.Struct({
  text: Schema.String,
  link: Schema.optionalKey(Schema.String),
})
export type Source = typeof Source.Type

// A decision settled before this grill's questions, listed under Decided so far.
export const Decision = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
})
export type Decision = typeof Decision.Type

export const Question = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  // One line on when or where the decision applies, shown beside the question.
  scope: Schema.String,
  ask: Schema.String,
  options: Schema.Array(AnswerOption),
  dependsOn: Schema.Array(Schema.String),
  when: Schema.Array(Condition),
  // The round that first asked it; untagged questions belong to round 1.
  round: Schema.optionalKey(Schema.Number),
  urgency: Schema.optionalKey(Urgency),
  blocksAt: Schema.optionalKey(Schema.String),
  // A `refs` key: the issue the question is mainly about.
  issue: Schema.optionalKey(Schema.String),
  // A `sources` key, and the question's id in that asker's own rows.
  from: Schema.optionalKey(Schema.String),
  row: Schema.optionalKey(Schema.String),
  session: Schema.optionalKey(Schema.String),
  // How today stands beside each answer, shown under the options.
  compare: Schema.optionalKey(Compare),
})
export type Question = typeof Question.Type

export const Step = Schema.Struct({
  id: Schema.String,
  part: Schema.String,
  heading: Schema.String,
  prose: Schema.Array(Schema.String),
  question: Question,
})
export type Step = typeof Step.Type

export const Part = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  summary: Schema.String,
  // A `refs` key, when the concept is one issue.
  issue: Schema.optionalKey(Schema.String),
})
export type Part = typeof Part.Type

export const Tone = Schema.Literals([
  'ochre',
  'teal',
  'violet',
  'rust',
  'olive',
])
export type Tone = typeof Tone.Type

// A recurring actor or machine, coloured wherever its name appears.
export const Entity = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  tone: Tone,
  about: Schema.String,
  aliases: Schema.Array(Schema.String),
})
export type Entity = typeof Entity.Type

// A word the reasoning leans on, defined once and explained wherever it appears.
export const Term = Schema.Struct({
  term: Schema.String,
  about: Schema.String,
  aliases: Schema.Array(Schema.String),
})
export type Term = typeof Term.Type

/**
 * One issue in a squad run's plan. `phase` is the run's own word for it (`building`, `gated`,
 * `stuck`, `review`, `merged`, `later`, `outside`); a phase this page doesn't know reads as
 * `later`, so a newer orchestrator can add phases without breaking an older page.
 */
export const PlanIssue = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  phase: Schema.String,
  // Issues whose merge this one waits for.
  follows: Schema.optionalKey(Schema.Array(Schema.String)),
  // Questions its builder needs before it starts, before its first review, or not at all.
  start: Schema.optionalKey(Schema.Array(Schema.String)),
  review: Schema.optionalKey(Schema.Array(Schema.String)),
  optional: Schema.optionalKey(Schema.Array(Schema.String)),
  card: Schema.optionalKey(Schema.String),
  agent: Schema.optionalKey(Schema.String),
  note: Schema.optionalKey(Schema.String),
})
export type PlanIssue = typeof PlanIssue.Type

export const Plan = Schema.Struct({
  issues: Schema.Array(PlanIssue),
  // ISO time the run must finish by.
  deadline: Schema.optionalKey(Schema.String),
  // How many agents the run may have live at once.
  slots: Schema.optionalKey(Schema.Number),
  // The chain of issues that decides when the run can finish, first to last.
  critical: Schema.optionalKey(Schema.Array(Schema.String)),
})
export type Plan = typeof Plan.Type

/**
 * The grill format this page reads. A grill without `version` is version 1. Version 2 adds
 * `plan`; version 3 adds `compare` and diagrams; version 4 adds per-question session routing.
 * Newer fields are dropped on decode, so an older page still shows the rest
 * (docs/adr/0001-version-the-grill-format.md).
 */
export const FORMAT_VERSION = 4

export const SquadMembership = Schema.Struct({
  id: Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]*$/)),
  section: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80)),
  lead: Schema.optionalKey(Schema.Boolean),
  openForYou: Schema.optionalKey(Schema.String),
})

export const Grill = Schema.Struct({
  squad: Schema.optionalKey(SquadMembership),
  activeRounds: Schema.optionalKey(Schema.Array(Schema.Number)),
  roundSections: Schema.optionalKey(
    Schema.Record(Schema.String, Schema.String),
  ),
  roundNumbers: Schema.optionalKey(Schema.Record(Schema.String, Schema.Number)),
  version: Schema.optionalKey(Schema.Number),
  id: Schema.String,
  title: Schema.String,
  entities: Schema.Array(Entity),
  terms: Schema.Array(Term),
  round: Schema.Number,
  roundNames: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  session: Schema.String,
  intro: Schema.Array(Schema.String),
  parts: Schema.Array(Part),
  steps: Schema.Array(Step),
  next: Schema.Array(Schema.String),
  // A squad grill gathers questions from several agents; only it lists by urgency.
  kind: Schema.optionalKey(Schema.Literals(['decision', 'squad'])),
  refs: Schema.optionalKey(Schema.Record(Schema.String, Ref)),
  // When the refs' states were looked up.
  refsAt: Schema.optionalKey(Schema.String),
  sources: Schema.optionalKey(Schema.Record(Schema.String, Source)),
  decided: Schema.optionalKey(Schema.Array(Decision)),
  plan: Schema.optionalKey(Plan),
})
export type Grill = typeof Grill.Type

export const GRILL_FLOW_TARGET = 'grill-flow'

export const questionSession = (grill: Grill, question?: Question): string =>
  question?.session?.trim() || grill.session

export const questionAgent = (grill: Grill, question?: Question): string => {
  const session = questionSession(grill, question)
  const source =
    question?.from === undefined ? undefined : grill.sources?.[question.from]
  return source === undefined
    ? session || 'Asking agent'
    : `${source.text}${session === '' ? '' : ` · ${session}`}`
}

export const roundOf = (grill: Grill, question: Question): number =>
  question.round ??
  (grill.steps.some(step => step.question.round !== undefined)
    ? 1
    : grill.round)

export const roundLabel = (
  grill: Grill,
  round: number,
  includeSection = true,
): string => {
  const name = grill.roundNames?.[String(round)]?.trim()
  const number = grill.roundNumbers?.[String(round)] ?? round
  const section = includeSection
    ? grill.roundSections?.[String(round)]
    : undefined
  return `${section ? `${section} · ` : ''}Round ${number}${name ? ` · ${name}` : ''}`
}

export const urgencyDetail = (question: Question): Option.Option<string> =>
  question.urgency === undefined
    ? Option.none()
    : Option.some(
        `${{ blocking: 'Blocking', soon: 'Blocks soon', wait: 'Can wait', fyi: 'For information' }[question.urgency]}${question.blocksAt?.trim() ? ` · Starts blocking ${question.blocksAt.trim()}` : ''}`,
      )

// PLAN

export type PlanPhase =
  | 'building'
  | 'review'
  | 'merged'
  | 'ready'
  | 'you'
  | 'stuck'
  | 'after'
  | 'outside'

const runPhase = (phase: string): Option.Option<PlanPhase> =>
  phase === 'building' ||
  phase === 'review' ||
  phase === 'merged' ||
  phase === 'outside'
    ? Option.some(phase)
    : Option.none()

/**
 * Where an issue stands given the answers: what the run says while it is busy with it, else
 * waiting on another issue, waiting on Rob's answers, or ready to start.
 */
export const planPhaseOf = (
  grill: Grill,
  issue: PlanIssue,
  answers: Answers,
): PlanPhase => {
  const busy = runPhase(issue.phase)
  if (Option.isSome(busy)) {
    return busy.value
  }
  const issues = grill.plan?.issues ?? []
  const waitsOnIssue = (issue.follows ?? []).some(id =>
    issues.some(other => other.id === id && other.phase !== 'merged'),
  )
  if (waitsOnIssue) {
    return 'after'
  }
  if (openGatesOf(grill, issue, answers).length > 0) {
    return issue.phase === 'stuck' ? 'stuck' : 'you'
  }
  return 'ready'
}

// A question another answer made unneeded holds nothing up, as the answered count treats it.
const isUnsettled = (grill: Grill, answers: Answers, id: string): boolean => {
  const status = statusOf(grill, answers, id)._tag
  return status !== 'Answered' && status !== 'NotNeeded'
}

/** The start questions still to settle, in the plan's order. */
export const openGatesOf = (
  grill: Grill,
  issue: PlanIssue,
  answers: Answers,
): ReadonlyArray<string> =>
  Array.filter(issue.start ?? [], id => isUnsettled(grill, answers, id))

/** The questions its review needs that are still to settle. */
export const openReviewOf = (
  grill: Grill,
  issue: PlanIssue,
  answers: Answers,
): ReadonlyArray<string> =>
  Array.filter(issue.review ?? [], id => isUnsettled(grill, answers, id))

/** Every in-run issue that waits, directly or through others, on this one. */
export const downstreamOf = (
  grill: Grill,
  id: string,
): ReadonlyArray<string> => {
  const issues = grill.plan?.issues ?? []
  const found: Array<string> = []
  const walk = (from: string): void => {
    for (const issue of issues) {
      if (
        issue.phase !== 'outside' &&
        (issue.follows ?? []).includes(from) &&
        !found.includes(issue.id)
      ) {
        found.push(issue.id)
        walk(issue.id)
      }
    }
  }
  walk(id)
  return found
}

/**
 * The issues waiting on Rob, most urgent first. A builder that can't start comes before a running
 * one whose review needs an answer; within each, the more work an issue holds up, the earlier it
 * comes, the critical chain breaks ties, and then fewer questions left to answer.
 */
export const waitingOnYou = (
  grill: Grill,
  answers: Answers,
): ReadonlyArray<PlanIssue> => {
  const critical = new Set(grill.plan?.critical ?? [])
  const weight = (issue: PlanIssue): number =>
    (openGatesOf(grill, issue, answers).length > 0 ? 100 : 0) +
    downstreamOf(grill, issue.id).length * 2 +
    (critical.has(issue.id) ? 3 : 0) -
    openGatesOf(grill, issue, answers).length * 0.1
  return pipe(
    grill.plan?.issues ?? [],
    Array.filter(issue => {
      const phase = planPhaseOf(grill, issue, answers)
      return (
        phase === 'you' ||
        phase === 'stuck' ||
        ((phase === 'building' || phase === 'review') &&
          openReviewOf(grill, issue, answers).length > 0)
      )
    }),
    Array.sort(
      Order.mapInput(Order.Number, (issue: PlanIssue) => -weight(issue)),
    ),
  )
}

/** A question's urgency; `unset` only matters on a grill where some question sets one. */
export type UrgencyLevel = Urgency | 'unset'

// An unset urgency ranks right after blocking, so nothing unknown hides below the fold.
export const URGENCY_ORDER: ReadonlyArray<UrgencyLevel> = [
  'blocking',
  'unset',
  'soon',
  'wait',
  'fyi',
]

export const usesUrgency = (grill: Grill): boolean =>
  grill.kind === 'squad' &&
  grill.steps.some(step => step.question.urgency !== undefined)

/** The issues the questions are about, in page order, each once. */
export const issuesOf = (grill: Grill): ReadonlyArray<string> =>
  Array.dedupeWith(
    Array.flatMap(grill.steps, step =>
      step.question.issue === undefined ? [] : [step.question.issue],
    ),
    (a, b) => a === b,
  )

/** The run card a squad question came from: its `row` up to the slash. */
export const cardOf = (question: Question): Option.Option<string> =>
  question.row === undefined
    ? Option.none()
    : Option.some(question.row.split('/')[0] ?? question.row)

/** The cards the questions came from, in page order, each once. */
export const cardsOf = (grill: Grill): ReadonlyArray<string> =>
  Array.dedupeWith(
    Array.flatMap(grill.steps, step => Option.toArray(cardOf(step.question))),
    (a, b) => a === b,
  )

/** A conversation about the run, a concept (`part:<id>`) or a card (`card:<card>`). */
export const isWholeTarget = (target: string): boolean =>
  target === GRILL_FLOW_TARGET ||
  target === 'run' ||
  target.startsWith('part:') ||
  target.startsWith('card:')

/** Whether this grill contains the step, concept, card or whole-run reply target. */
export const hasTarget = (grill: Grill, target: string): boolean =>
  target === 'run' || target === GRILL_FLOW_TARGET
    ? true
    : target.startsWith('part:')
      ? grill.parts.some(part => `part:${part.id}` === target)
      : target.startsWith('card:')
        ? cardsOf(grill).some(card => `card:${card}` === target)
        : grill.steps.some(step => step.id === target)

export const urgencyOf = (question: Question): UrgencyLevel =>
  question.urgency ?? 'unset'

export const urgencyRank = (question: Question): number =>
  URGENCY_ORDER.indexOf(urgencyOf(question))

// SNAPSHOT

export const Ask = Schema.Struct({
  id: Schema.Number,
  stepId: Schema.String,
  text: Schema.String,
  at: Schema.Number,
  answered: Schema.Boolean,
})
export type Ask = typeof Ask.Type

export const RevisionKind = Schema.Literals(['rewrite', 'comment'])
export type RevisionKind = typeof RevisionKind.Type

export const Revision = Schema.Struct({
  id: Schema.Number,
  stepId: Schema.String,
  askId: Schema.NullOr(Schema.Number),
  kind: RevisionKind,
  text: Schema.String,
  at: Schema.Number,
})
export type Revision = typeof Revision.Type

/** What the agent wrote back after a Send: what it took in, decided, and does next. */
export const AgentReply = Schema.Struct({
  id: Schema.Number,
  text: Schema.String,
  at: Schema.Number,
})
export type AgentReply = typeof AgentReply.Type

export const Send = Schema.Struct({
  at: Schema.Number,
  ok: Schema.Boolean,
  detail: Schema.String,
})
export type Send = typeof Send.Type

export const Snapshot = Schema.Struct({
  grill: Grill,
  maintainerSession: Schema.optionalKey(Schema.String),
  answers: Schema.Record(Schema.String, Schema.String),
  notes: Schema.Record(Schema.String, Schema.String),
  own: Schema.Record(Schema.String, Schema.String),
  asks: Schema.Array(Ask),
  revisions: Schema.Array(Revision),
  sends: Schema.Array(Send),
  // The reply line each question last went out with, so Send leaves out what the agent has. A
  // server from before it was kept sends none.
  sent: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  // Missing from a server that predates `gf reply`.
  replies: Schema.optionalKey(Schema.Array(AgentReply)),
})
export type Snapshot = typeof Snapshot.Type

/**
 * Everything the agent has said to the user, oldest first: its replies to a Send, and its
 * answers to asks (a comment, or a rewrite of a step's reasoning). Ids are unique across both.
 */
export type AgentMessage = Readonly<{
  id: string
  at: number
  kind: 'reply' | 'answer'
  // The answered ask's target: a step, `part:<id>` or `card:<card>`; empty for a reply.
  stepId: string
  text: string
}>

export const agentMessagesOf = (
  snapshot: Snapshot,
): ReadonlyArray<AgentMessage> => {
  const replies: ReadonlyArray<AgentMessage> = Array.map(
    snapshot.replies ?? [],
    (reply): AgentMessage => ({
      id: `reply-${reply.id}`,
      at: reply.at,
      kind: 'reply',
      stepId: '',
      text: reply.text,
    }),
  )
  const answers: ReadonlyArray<AgentMessage> = Array.flatMap(
    snapshot.revisions,
    (revision): ReadonlyArray<AgentMessage> =>
      revision.askId === null
        ? []
        : [
            {
              id: `answer-${revision.id}`,
              at: revision.at,
              kind: 'answer',
              stepId: revision.stepId,
              text:
                revision.kind === 'rewrite'
                  ? 'I rewrote the reasoning on your ask.'
                  : revision.text,
            },
          ],
  )
  return Array.sort(
    [...replies, ...answers],
    Order.mapInput(Order.Number, (message: AgentMessage) => message.at),
  )
}

/** What the reader hasn't seen: newer than where their reading started, and not yet read. */
export const unreadOf = (
  messages: ReadonlyArray<AgentMessage>,
  since: number,
  read: ReadonlyArray<string>,
): ReadonlyArray<AgentMessage> =>
  Array.filter(
    messages,
    message => message.at > since && !read.includes(message.id),
  )

type FenceReading = Readonly<{ lines: ReadonlyArray<string>; inFence: boolean }>

const notYetRead: FenceReading = { lines: [], inFence: false }

const outsideFences = (text: string): ReadonlyArray<string> =>
  Array.reduce(text.split('\n'), notYetRead, (read, line): FenceReading =>
    FENCE.test(line)
      ? { lines: read.lines, inFence: !read.inFence }
      : read.inFence
        ? read
        : { lines: Array.append(read.lines, line), inFence: false },
  ).lines

/** A message's first line of text, outside any ``` block, as plain text for a one-line preview. */
export const previewOf = (text: string): string =>
  (outsideFences(text).find(line => line.trim() !== '') ?? '')
    .replace(/[*_`#>]/g, '')
    .replace(/^\s*-\s+/, '')
    .trim()

export type Answers = Readonly<Record<string, string>>

// The key an answer gets when Rob writes his own instead of picking an option.
export const OWN = 'other'
export type Notes = Readonly<Record<string, string>>

// STATUS

export type Status =
  | Readonly<{ _tag: 'Answered'; key: string }>
  | Readonly<{ _tag: 'Open' }>
  | Readonly<{ _tag: 'Waiting'; on: ReadonlyArray<string> }>
  | Readonly<{ _tag: 'NotNeeded'; because: string }>

const findQuestion = (grill: Grill, id: string): Option.Option<Question> =>
  pipe(
    grill.steps,
    Array.findFirst(step => step.question.id === id),
    Option.map(step => step.question),
  )

/** A given answer stays answered while what it builds on is open; a question skipped for now
 *  doesn't hold back the questions that wait on it. */
export const statusOf = (
  grill: Grill,
  answers: Answers,
  id: string,
  skipped: ReadonlyArray<string> = [],
): Status => statusWithin(grill, answers, id, [], skipped)

const statusWithin = (
  grill: Grill,
  answers: Answers,
  id: string,
  seen: ReadonlyArray<string>,
  skipped: ReadonlyArray<string>,
): Status => {
  if (Array.contains(seen, id)) {
    return { _tag: 'Open' }
  }
  const visited = Array.append(seen, id)
  return Option.match(findQuestion(grill, id), {
    onNone: () => ({ _tag: 'Open' }),
    onSome: question => {
      const notNeeded = pipe(
        question.when,
        Array.findFirst(condition => {
          const upstream = statusWithin(
            grill,
            answers,
            condition.question,
            visited,
            skipped,
          )
          if (upstream._tag === 'NotNeeded') {
            return true
          }
          // An own answer can't be checked against the options, so it keeps what follows open.
          return (
            upstream._tag === 'Answered' &&
            upstream.key !== OWN &&
            !Array.contains(condition.oneOf, upstream.key)
          )
        }),
      )
      if (Option.isSome(notNeeded)) {
        const condition = notNeeded.value
        const upstream = Record.get(answers, condition.question)
        return {
          _tag: 'NotNeeded',
          because: Option.match(upstream, {
            onNone: () => `${condition.question} isn't needed`,
            onSome: key => `you chose ${condition.question} ${key}`,
          }),
        }
      }
      const given = Record.get(answers, id)
      if (Option.isSome(given)) {
        return { _tag: 'Answered', key: given.value }
      }
      const waitingOn = pipe(
        Array.appendAll(
          question.dependsOn,
          Array.map(question.when, condition => condition.question),
        ),
        Array.dedupe,
        Array.filter(dependency => {
          const upstream = statusWithin(
            grill,
            answers,
            dependency,
            visited,
            skipped,
          )
          return (
            (upstream._tag === 'Open' || upstream._tag === 'Waiting') &&
            !Array.contains(skipped, dependency)
          )
        }),
      )
      if (Array.isArrayNonEmpty(waitingOn)) {
        return { _tag: 'Waiting', on: waitingOn }
      }
      return { _tag: 'Open' }
    },
  })
}

/** The neighbouring step in page order that is still needed, from a step or from the top. */
export const neighbourStep = (
  grill: Grill,
  answers: Answers,
  maybeCurrent: Option.Option<string>,
  direction: 'next' | 'previous',
): Option.Option<Step> => {
  const needed = Array.filter(
    grill.steps,
    step =>
      step.id === Option.getOrElse(maybeCurrent, () => '') ||
      statusOf(grill, answers, step.question.id)._tag !== 'NotNeeded',
  )
  return Option.match(
    Option.flatMap(maybeCurrent, id =>
      Array.findFirstIndex(needed, step => step.id === id),
    ),
    {
      onNone: () => (direction === 'next' ? Array.head(needed) : Option.none()),
      onSome: index =>
        Array.get(needed, direction === 'next' ? index + 1 : index - 1),
    },
  )
}

export type Tally = Readonly<{
  total: number
  answered: number
  open: number
  waiting: number
  notNeeded: number
}>

/** The questions this round asks, or every question when none carries a round. */
export const roundSteps = (grill: Grill): ReadonlyArray<Step> =>
  grill.activeRounds !== undefined
    ? grill.steps.filter(step =>
        grill.activeRounds!.includes(roundOf(grill, step.question)),
      )
    : grill.steps.some(step => step.question.round !== undefined)
      ? grill.steps.filter(step => (step.question.round ?? 1) === grill.round)
      : grill.steps

export const tally = (
  grill: Grill,
  answers: Answers,
  skipped: ReadonlyArray<string> = [],
  steps: ReadonlyArray<Step> = grill.steps,
): Tally =>
  Array.reduce(
    steps,
    { total: 0, answered: 0, open: 0, waiting: 0, notNeeded: 0 },
    (counts, step) => {
      const status = statusOf(grill, answers, step.question.id, skipped)
      return {
        total: counts.total + 1,
        answered: counts.answered + (status._tag === 'Answered' ? 1 : 0),
        open: counts.open + (status._tag === 'Open' ? 1 : 0),
        waiting: counts.waiting + (status._tag === 'Waiting' ? 1 : 0),
        notNeeded: counts.notNeeded + (status._tag === 'NotNeeded' ? 1 : 0),
      }
    },
  )

// REPLY

const isRecommended = (question: Question, key: string): boolean =>
  Array.some(
    question.options,
    option => option.key === key && option.recommended,
  )

const withNote = (text: string, notes: Notes, id: string): string =>
  Option.match(
    pipe(
      Record.get(notes, id),
      Option.map(note => note.trim()),
      Option.filter(note => note !== ''),
    ),
    {
      onNone: () => text,
      onSome: note => `${text} (${note})`,
    },
  )

const answerText = (id: string, key: string, own: Notes): string =>
  key === OWN
    ? `${id} other: ${Option.getOrElse(Record.get(own, id), () => '').trim() || '(not written yet)'}`
    : `${id} ${key}`

/** Each answered question's line in the reply, as Send writes it. */
export const answerLines = (
  grill: Grill,
  answers: Answers,
  notes: Notes,
  own: Notes = {},
  steps: ReadonlyArray<Step> = grill.steps,
): Readonly<Record<string, string>> =>
  Record.fromEntries(
    Array.flatMap(steps, (step): ReadonlyArray<readonly [string, string]> => {
      const status = statusOf(grill, answers, step.question.id)
      return status._tag === 'Answered'
        ? [
            [
              step.question.id,
              withNote(
                answerText(step.question.id, status.key, own),
                notes,
                step.question.id,
              ),
            ],
          ]
        : []
    }),
  )

export const sendableLines = (
  grill: Grill,
  answers: Answers,
  notes: Notes,
  own: Notes = {},
): Readonly<Record<string, string>> => {
  const listed = answerLines(grill, answers, notes, own)
  return Record.fromEntries(
    Object.entries(answers).flatMap(
      ([id, key]): ReadonlyArray<readonly [string, string]> => {
        const step = grill.steps.find(item => item.question.id === id)
        if (key === OWN && (own[id] ?? '').trim() === '') return []
        if (step !== undefined) {
          return listed[id] !== undefined &&
            (key === OWN ||
              step.question.options.some(option => option.key === key))
            ? [[id, listed[id]]]
            : []
        }
        // Answers were validated when saved; a later load can remove their question metadata.
        return [[id, withNote(answerText(id, key, own), notes, id)]]
      },
    ),
  )
}

export const answerRoundLabel = (grill: Grill, step: Step): string => {
  const round =
    step.question.round ??
    (grill.steps.some(item => item.question.round !== undefined)
      ? 1
      : grill.round)
  if (grill.squad?.id === grill.id) return roundLabel(grill, round)
  return `Round ${round}${round < grill.round ? ' (sent late)' : ''}`
}

const answerGroups = (
  grill: Grill,
  lines: Readonly<Record<string, string>>,
): ReadonlyArray<Readonly<{ title: string; ids: ReadonlyArray<string> }>> => {
  const listed = grill.steps.filter(
    step => lines[step.question.id] !== undefined,
  )
  const grouped = Array.groupBy(listed, step => answerRoundLabel(grill, step))
  const unlisted = Object.keys(lines).filter(
    id => !grill.steps.some(step => step.question.id === id),
  )
  return [
    ...Object.entries(grouped).map(([title, steps]) => ({
      title,
      ids: steps.map(step => step.question.id),
    })),
    ...(Array.isArrayEmpty(unlisted)
      ? []
      : [
          {
            title: 'Round unavailable (question no longer listed)',
            ids: unlisted,
          },
        ]),
  ]
}

export const groupedAnswerText = (
  grill: Grill,
  lines: Readonly<Record<string, string>>,
): string =>
  answerGroups(grill, lines)
    .map(group =>
      [`${group.title}:`, ...group.ids.map(id => lines[id])].join('\n'),
    )
    .join('\n')

/** Whether a question's answer went out, word for word, in an earlier send. */
export const isSent = (
  sent: Readonly<Record<string, string>>,
  lines: Readonly<Record<string, string>>,
  id: string,
): boolean => lines[id] !== undefined && sent[id] === lines[id]

const currentRoundReply = (
  grill: Grill,
  answers: Answers,
  notes: Notes,
  own: Notes = {},
  sent: Readonly<Record<string, string>> = {},
): string => {
  const statuses = Array.map(roundSteps(grill), step => ({
    question: step.question,
    status: statusOf(grill, answers, step.question.id),
  }))
  const lines = sendableLines(grill, answers, notes, own)
  const answered = Array.flatMap(statuses, ({ question, status }) =>
    status._tag === 'Answered' && lines[question.id] !== undefined
      ? [{ question, key: status.key }]
      : [],
  )
  const fresh = Array.filter(
    answered,
    ({ question }) => !isSent(sent, lines, question.id),
  )
  const resent = answered.length - fresh.length
  const unanswered = Array.filter(
    statuses,
    ({ status }) => status._tag === 'Open' || status._tag === 'Waiting',
  )
  const skipped = Array.flatMap(statuses, ({ question, status }) =>
    status._tag === 'NotNeeded' ? [`${question.id} (${status.because})`] : [],
  )
  const anyNotes = Array.some(fresh, ({ question }) =>
    pipe(
      Record.get(notes, question.id),
      Option.exists(note => note.trim() !== ''),
    ),
  )
  const allRecommended = Array.every(fresh, ({ question, key }) =>
    isRecommended(question, key),
  )
  const skippedLine = Array.isArrayNonEmpty(skipped)
    ? [`Not needed: ${Array.join(skipped, ', ')}`]
    : []
  const sentNote = resent > 0 ? `; ${resent} sent before, left out` : ''
  if (
    Array.isArrayEmpty(unanswered) &&
    allRecommended &&
    !anyNotes &&
    Array.isArrayNonEmpty(fresh)
  ) {
    const picks = Array.join(
      Array.map(fresh, ({ question, key }) => `${question.id} ${key}`),
      ', ',
    )
    return Array.join(
      [
        `Round ${grill.round}: all recommended (${picks})${sentNote}`,
        ...skippedLine,
      ],
      '\n',
    )
  }
  const counts = Array.isArrayEmpty(unanswered)
    ? sentNote === ''
      ? ''
      : ` (${sentNote.slice(2)})`
    : ` (${answered.length} of ${answered.length + unanswered.length} answered${sentNote})`
  const header = `Round ${grill.round}${counts}:`
  const freshLines = Array.map(
    fresh,
    ({ question }) => lines[question.id] ?? question.id,
  )
  const openLine = Array.isArrayNonEmpty(unanswered)
    ? [
        `Open: ${Array.join(
          Array.map(unanswered, ({ question }) =>
            withNote(question.id, notes, question.id),
          ),
          ', ',
        )}`,
      ]
    : []
  return Array.join([header, ...freshLines, ...openLine, ...skippedLine], '\n')
}

export const replyText = (
  grill: Grill,
  answers: Answers,
  notes: Notes,
  own: Notes = {},
  sent: Readonly<Record<string, string>> = {},
): string => {
  const current = new Set(roundSteps(grill).map(step => step.question.id))
  const all = sendableLines(grill, answers, notes, own)
  const earlier = Record.fromEntries(
    Object.entries(all).filter(
      ([id]) => !current.has(id) && !isSent(sent, all, id),
    ),
  )
  return [
    groupedAnswerText(grill, earlier),
    currentRoundReply(grill, answers, notes, own, sent),
  ]
    .filter(text => text !== '')
    .join('\n')
}

/** What Send delivers inside its instructions to the agent: the answers, then the message. */
export const sentAnswers = (reply: string, message: string): string =>
  Array.join(
    [reply, ...(message.trim() === '' ? [] : [`Message: ${message.trim()}`])],
    '\n',
  )

// PROSE

export type Segment =
  | Readonly<{ _tag: 'Text' | 'Code'; text: string }>
  | Readonly<{ _tag: 'Entity'; text: string; entity: Entity }>
  | Readonly<{ _tag: 'Term'; text: string; term: Term }>
  | Readonly<{ _tag: 'Ref'; text: string; ref: Ref }>
  | Readonly<{ _tag: 'Question'; text: string }>
  | Readonly<{ _tag: 'Link'; text: string; url: string }>
  | Readonly<{
      _tag: 'Strong' | 'Emphasis'
      text: string
      parts: ReadonlyArray<Segment>
    }>

const escapeRegExp = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const entityFor = (
  entities: ReadonlyArray<Entity>,
  text: string,
): Option.Option<Entity> =>
  Array.findFirst(entities, entity => Array.contains(entity.aliases, text))

const patternCache = new WeakMap<ReadonlyArray<Entity>, RegExp>()

const entityPattern = (entities: ReadonlyArray<Entity>): RegExp => {
  const cached = patternCache.get(entities)
  if (cached) {
    return cached
  }
  const aliases = pipe(
    Array.flatMap(entities, entity => entity.aliases),
    Array.sort((a: string, b: string) => (b.length - a.length) as -1 | 0 | 1),
  )
  const pattern = new RegExp(
    `(?<![\\w-])(${Array.join(Array.map(aliases, escapeRegExp), '|')})(?![\\w-])`,
  )
  patternCache.set(entities, pattern)
  return pattern
}

const splitEntities = (
  text: string,
  entities: ReadonlyArray<Entity>,
): ReadonlyArray<Segment> => {
  if (text === '') {
    return []
  }
  if (!Array.some(entities, entity => entity.aliases.length > 0)) {
    return [{ _tag: 'Text', text }]
  }
  const pattern = entityPattern(entities)
  return pipe(
    text.split(pattern),
    Array.map((part, index): Segment =>
      index % 2 === 1
        ? Option.match(entityFor(entities, part), {
            onNone: () => ({ _tag: 'Text', text: part }),
            onSome: entity => ({ _tag: 'Entity', text: part, entity }),
          })
        : { _tag: 'Text', text: part },
    ),
    Array.filter(segment => segment.text !== ''),
  )
}

// http(s) only, so agent text can't hand the page a javascript: href. A bare address leaves
// trailing punctuation to the sentence.
const LINK =
  /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"’”])/g

const splitLinks = (
  text: string,
  entities: ReadonlyArray<Entity>,
): ReadonlyArray<Segment> => {
  const parts: Array<Segment> = []
  let last = 0
  for (const match of text.matchAll(LINK)) {
    const [whole, label, url, bare] = match
    parts.push(...splitEntities(text.slice(last, match.index), entities))
    parts.push(
      bare === undefined
        ? { _tag: 'Link', text: label ?? whole, url: url ?? whole }
        : { _tag: 'Link', text: bare, url: bare },
    )
    last = match.index + whole.length
  }
  parts.push(...splitEntities(text.slice(last), entities))
  return parts
}

export const segments = (
  paragraph: string,
  entities: ReadonlyArray<Entity> = [],
): ReadonlyArray<Segment> =>
  pipe(
    paragraph.split('`'),
    Array.flatMap((text, index): ReadonlyArray<Segment> =>
      index % 2 === 1
        ? [
            Option.match(entityFor(entities, text), {
              onNone: (): Segment => ({ _tag: 'Code', text }),
              onSome: (entity): Segment => ({ _tag: 'Entity', text, entity }),
            }),
          ]
        : splitLinks(text, entities),
    ),
    Array.filter(segment => segment.text !== ''),
  )

const mapTextSegments = (
  parts: ReadonlyArray<Segment>,
  mark: (text: string) => ReadonlyArray<Segment>,
): ReadonlyArray<Segment> =>
  Array.flatMap(parts, (part): ReadonlyArray<Segment> =>
    part._tag === 'Text'
      ? mark(part.text)
      : part._tag === 'Strong' || part._tag === 'Emphasis'
        ? [
            {
              _tag: part._tag,
              text: part.text,
              parts: mapTextSegments(part.parts, mark),
            },
          ]
        : [part],
  )

export const withEmphasis = (
  parts: ReadonlyArray<Segment>,
  entities: ReadonlyArray<Entity> = [],
): ReadonlyArray<Segment> => {
  const tokens = Array.flatMap(
    parts,
    (part): ReadonlyArray<string | Segment> =>
      part._tag === 'Text'
        ? part.text
            .split(/((?<!\\)\*{1,3}|(?<!\\)_{1,3})/g)
            .filter(text => text !== '')
            .map(text =>
              /^(?:\*{1,3}|_{1,3})$/.test(text) ? text : { _tag: 'Text', text },
            )
        : [part],
  )
  const textAt = (index: number): string => {
    const token = tokens[index]
    return typeof token === 'string' ? token : (token?.text ?? '')
  }
  const flanks = (index: number, opening: boolean): boolean => {
    const before = textAt(index - 1).slice(-1)
    const after = textAt(index + 1).slice(0, 1)
    const inside = opening ? after : before
    return (
      inside !== '' &&
      !/\s/.test(inside) &&
      !(textAt(index).startsWith('_') && /\w/.test(before) && /\w/.test(after))
    )
  }
  const parse = (start: number, end: number): ReadonlyArray<Segment> => {
    const token = tokens[start]
    if (start >= end || token === undefined) {
      return []
    }
    if (typeof token !== 'string') {
      return [token, ...parse(start + 1, end)]
    }
    const closing =
      start + 1 < end && flanks(start, true)
        ? Array.findFirst(
            Array.range(start + 1, end - 1),
            index => tokens[index] === token && flanks(index, false),
          )
        : Option.none()
    return Option.match(closing, {
      onNone: () => [{ _tag: 'Text', text: token }, ...parse(start + 1, end)],
      onSome: index => {
        const children = parse(start + 1, index)
        const text = children.map(part => part.text).join('')
        const emphasized: Segment = { _tag: 'Emphasis', text, parts: children }
        const formatted: Segment =
          token.length === 1
            ? emphasized
            : {
                _tag: 'Strong',
                text,
                parts: token.length === 3 ? [emphasized] : children,
              }
        return [formatted, ...parse(index + 1, end)]
      },
    })
  }
  return mapTextSegments(parse(0, tokens.length), text =>
    splitEntities(text.replace(/\\([*_])/g, '$1'), entities),
  )
}

const refPatternCache = new WeakMap<Readonly<Record<string, Ref>>, RegExp>()

const refPattern = (refs: Readonly<Record<string, Ref>>): RegExp => {
  const cached = refPatternCache.get(refs)
  if (cached) {
    return cached
  }
  const keys = pipe(
    Record.keys(refs),
    Array.sort((a: string, b: string) => (b.length - a.length) as -1 | 0 | 1),
  )
  const pattern = new RegExp(
    `(?<![\\w-])(${Array.join(Array.map(keys, escapeRegExp), '|')})(?![\\w-])`,
  )
  refPatternCache.set(refs, pattern)
  return pattern
}

/** Marks every mention of a `refs` key in plain text, so it can link out. */
export const withRefs = (
  parts: ReadonlyArray<Segment>,
  refs: Readonly<Record<string, Ref>> = {},
): ReadonlyArray<Segment> => {
  if (Record.isEmptyRecord(refs)) {
    return parts
  }
  const pattern = refPattern(refs)
  return mapTextSegments(parts, text =>
    pipe(
      text.split(pattern),
      Array.map((text, index): Segment => {
        const ref = refs[text]
        return index % 2 === 1 && ref !== undefined
          ? { _tag: 'Ref', text, ref }
          : { _tag: 'Text', text }
      }),
      Array.filter(part => part.text !== ''),
    ),
  )
}

/** Marks every mention of one of the grill's question ids in plain text, so it can jump there. */
export const withQuestions = (
  parts: ReadonlyArray<Segment>,
  grill: Grill,
): ReadonlyArray<Segment> => {
  const ids = Array.map(grill.steps, step => step.question.id)
  if (Array.isArrayEmpty(ids)) {
    return parts
  }
  const pattern = new RegExp(
    `(?<![\\w-])(${Array.join(Array.map(ids, escapeRegExp), '|')})(?![\\w-])`,
  )
  return mapTextSegments(parts, text =>
    pipe(
      text.split(pattern),
      Array.map((text, index): Segment =>
        index % 2 === 1 ? { _tag: 'Question', text } : { _tag: 'Text', text },
      ),
      Array.filter(part => part.text !== ''),
    ),
  )
}

/** Entity marks for diff text, where backticks stay as typed. */
export const entityParts = (
  text: string,
  entities: ReadonlyArray<Entity>,
): ReadonlyArray<Segment> =>
  splitEntities(
    Array.reduce(
      Array.flatMap(entities, entity => entity.aliases),
      text,
      (current, alias) => current.split(`\`${alias}\``).join(alias),
    ),
    entities,
  )

const ITEM = /^\s*- /
const FENCE = /^\s*```/

const isFigure = (paragraph: string): boolean => FENCE.test(paragraph)

/** Splits text on blank lines, keeping a ``` block whole, its blank lines and spacing too. */
export const splitParagraphs = (text: string): ReadonlyArray<string> => {
  const paragraphs: Array<string> = []
  let lines: Array<string> = []
  let inFence = false
  const close = () => {
    if (lines.some(line => line.trim() !== '')) {
      paragraphs.push(lines.join('\n'))
    }
    lines = []
  }
  for (const line of text.split('\n')) {
    if (FENCE.test(line)) {
      if (!inFence) {
        close()
      }
      lines.push(line)
      if (inFence) {
        close()
      }
      inFence = !inFence
    } else if (!inFence && line.trim() === '') {
      close()
    } else {
      lines.push(line)
    }
  }
  close()
  return paragraphs
}

const joinParagraphLines = (paragraph: string): string =>
  paragraph.split('\n').some(line => ITEM.test(line))
    ? Array.join(
        Array.map(paragraph.split('\n'), line => line.trim()),
        '\n',
      ).trim()
    : paragraph.replace(/\s*\n\s*/g, ' ').trim()

// A paragraph with `- ` lines keeps its line breaks, so its items stay a list; a ``` block keeps
// every line as written; a `### ` title keeps its own line.
export const paragraphsOf = (text: string): ReadonlyArray<string> =>
  pipe(
    splitParagraphs(text),
    Array.map(paragraph => {
      if (isFigure(paragraph)) {
        return paragraph.replace(/^\n+|\s+$/g, '')
      }
      const titled = titleOf(paragraph)
      return Option.match(titled.title, {
        onNone: () => joinParagraphLines(paragraph),
        onSome: title =>
          titled.text === ''
            ? `### ${title}`
            : `### ${title}\n${joinParagraphLines(titled.text)}`,
      })
    }),
    Array.filter(paragraph => paragraph !== ''),
  )

export type Block =
  | Readonly<{ _tag: 'Paragraph'; text: string }>
  | Readonly<{ _tag: 'Figure'; text: string }>
  | Readonly<{
      _tag: 'List'
      lead: Option.Option<string>
      items: ReadonlyArray<string>
    }>

/** A paragraph as plain text, a ``` block (a diagram or timeline), or a lead line and `- ` items. */
export const blockOf = (paragraph: string): Block => {
  const lines = paragraph.split('\n')
  if (isFigure(paragraph)) {
    const body = Array.drop(lines, 1)
    return {
      _tag: 'Figure',
      text: Array.join(
        Option.exists(Array.last(body), line => FENCE.test(line))
          ? Array.dropRight(body, 1)
          : body,
        '\n',
      ),
    }
  }
  const firstItem = lines.findIndex(line => ITEM.test(line))
  if (firstItem < 0) {
    return { _tag: 'Paragraph', text: paragraph.replace(/\s*\n\s*/g, ' ') }
  }
  const lead = Array.join(Array.take(lines, firstItem), ' ').trim()
  const items = Array.reduce(
    Array.drop(lines, firstItem),
    [] as ReadonlyArray<string>,
    (built, line) =>
      ITEM.test(line)
        ? Array.append(built, line.replace(ITEM, '').trim())
        : Option.match(Array.last(built), {
            onNone: () => built,
            onSome: last =>
              Array.append(Array.dropRight(built, 1), `${last} ${line.trim()}`),
          }),
  )
  return {
    _tag: 'List',
    lead: lead === '' ? Option.none() : Option.some(lead),
    items,
  }
}

export type ProseVersion = Readonly<{
  paragraphs: ReadonlyArray<string>
  previous: Option.Option<ReadonlyArray<string>>
  revisedAt: Option.Option<number>
}>

export const proseOf = (snapshot: Snapshot, step: Step): ProseVersion => {
  const rewrites = Array.filter(
    snapshot.revisions,
    revision => revision.stepId === step.id && revision.kind === 'rewrite',
  )
  return Array.match(rewrites, {
    onEmpty: () => ({
      paragraphs: Array.flatMap(step.prose, paragraphsOf),
      previous: Option.none(),
      revisedAt: Option.none(),
    }),
    onNonEmpty: nonEmpty => {
      const latest = Array.lastNonEmpty(nonEmpty)
      const before = Array.dropRight(nonEmpty, 1)
      return {
        paragraphs: paragraphsOf(latest.text),
        previous: Option.some(
          Array.match(before, {
            onEmpty: () => Array.flatMap(step.prose, paragraphsOf),
            onNonEmpty: earlier =>
              paragraphsOf(Array.lastNonEmpty(earlier).text),
          }),
        ),
        revisedAt: Option.some(latest.at),
      }
    },
  })
}

// DIFF

export type DiffPart = Readonly<{
  _tag: 'Same' | 'Added' | 'Removed'
  text: string
}>

// Punctuation is its own token, so `wiki,` to `wiki` marks only the comma.
const tokens = (text: string): ReadonlyArray<string> =>
  Array.filter(text.split(/(\s+|[.,;:!?()])/), token => token !== '')

// NOTE: a mutable table and loops, because this runs on every render; the immutable version
// took about 15 ms per diff and made typing lag.
const lcsTable = (
  before: ReadonlyArray<string>,
  after: ReadonlyArray<string>,
): Int32Array => {
  const width = after.length + 1
  const table = new Int32Array((before.length + 1) * width)
  for (let row = before.length - 1; row >= 0; row--) {
    for (let column = after.length - 1; column >= 0; column--) {
      table[row * width + column] =
        before[row] === after[column]
          ? (table[(row + 1) * width + column + 1] ?? 0) + 1
          : Math.max(
              table[(row + 1) * width + column] ?? 0,
              table[row * width + column + 1] ?? 0,
            )
    }
  }
  return table
}

const mergeParts = (parts: ReadonlyArray<DiffPart>): ReadonlyArray<DiffPart> =>
  Array.reduce(parts, [] as ReadonlyArray<DiffPart>, (merged, part) =>
    Option.match(Array.last(merged), {
      onNone: () => [part],
      onSome: last =>
        last._tag === part._tag
          ? Array.append(Array.dropRight(merged, 1), {
              _tag: part._tag,
              text: last.text + part.text,
            })
          : Array.append(merged, part),
    }),
  )

const tokenCache = new Map<string, ReadonlyArray<DiffPart>>()

const diffTokens = (
  beforeText: string,
  afterText: string,
): ReadonlyArray<DiffPart> => {
  const cacheKey = `${beforeText}\u0000${afterText}`
  const cached = tokenCache.get(cacheKey)
  if (cached) {
    return cached
  }
  const before = tokens(beforeText)
  const after = tokens(afterText)
  const width = after.length + 1
  const table = lcsTable(before, after)
  const cell = (row: number, column: number): number =>
    table[row * width + column] ?? 0
  const parts: Array<DiffPart> = []
  let row = 0
  let column = 0
  while (row < before.length || column < after.length) {
    if (row >= before.length) {
      parts.push({ _tag: 'Added', text: after[column++] ?? '' })
    } else if (column >= after.length) {
      parts.push({ _tag: 'Removed', text: before[row++] ?? '' })
    } else if (before[row] === after[column]) {
      parts.push({ _tag: 'Same', text: before[row] ?? '' })
      row++
      column++
    } else if (cell(row + 1, column) >= cell(row, column + 1)) {
      parts.push({ _tag: 'Removed', text: before[row++] ?? '' })
    } else {
      parts.push({ _tag: 'Added', text: after[column++] ?? '' })
    }
  }
  tokenCache.set(cacheKey, parts)
  return parts
}

export const diffWords = (
  beforeText: string,
  afterText: string,
): ReadonlyArray<DiffPart> => mergeParts(diffTokens(beforeText, afterText))

export type DiffLine = ReadonlyArray<DiffPart>

export type DiffBlock =
  | Readonly<{ _tag: 'Paragraph'; parts: DiffLine }>
  | Readonly<{ _tag: 'List'; lead: DiffLine; items: ReadonlyArray<DiffLine> }>

const isSpace = (text: string): boolean => /^\s+$/.test(text)

const joinLines = (lines: ReadonlyArray<DiffLine>): DiffLine =>
  mergeParts(
    Array.flatMap(lines, (line, index) =>
      index === 0
        ? line
        : Array.prepend(line, { _tag: 'Same', text: ' ' } as DiffPart),
    ),
  )

// A line is a list item when it starts with a dash the new text keeps.
const itemBody = (line: DiffLine): Option.Option<DiffLine> => {
  const first = line[0]
  const second = line[1]
  return first &&
    first._tag !== 'Removed' &&
    first.text === '-' &&
    second &&
    isSpace(second.text)
    ? Option.some(Array.drop(line, 2))
    : Option.none()
}

const blockFromLines = (lines: ReadonlyArray<DiffLine>): DiffBlock => {
  const firstItem = lines.findIndex(line => Option.isSome(itemBody(line)))
  if (firstItem < 0) {
    return { _tag: 'Paragraph', parts: joinLines(lines) }
  }
  const items = Array.reduce(
    Array.drop(lines, firstItem),
    [] as ReadonlyArray<DiffLine>,
    (built, line) =>
      Option.match(itemBody(line), {
        onSome: body => Array.append(built, mergeParts(body)),
        onNone: () =>
          Option.match(Array.last(built), {
            onNone: () => built,
            onSome: last =>
              Array.append(Array.dropRight(built, 1), joinLines([last, line])),
          }),
      }),
  )
  return { _tag: 'List', lead: joinLines(Array.take(lines, firstItem)), items }
}

/** The word diff laid out in the new text's paragraphs and lists; removed line breaks don't split. */
export const diffBlocks = (
  beforeText: string,
  afterText: string,
): ReadonlyArray<DiffBlock> => {
  const paragraphs: Array<Array<Array<DiffPart>>> = [[[]]]
  for (const part of diffTokens(beforeText, afterText)) {
    const paragraph = paragraphs[paragraphs.length - 1] ?? []
    const line = paragraph[paragraph.length - 1] ?? []
    if (isSpace(part.text) && part.text.includes('\n')) {
      if (part._tag === 'Removed') {
        line.push({ _tag: 'Removed', text: ' ' })
      } else if ((part.text.match(/\n/g) ?? []).length >= 2) {
        paragraphs.push([[]])
      } else {
        paragraph.push([])
      }
    } else {
      line.push(part)
    }
  }
  return pipe(
    paragraphs,
    Array.map(lines =>
      Array.filter(lines, line => Array.isArrayNonEmpty(line)),
    ),
    Array.filter(lines => Array.isArrayNonEmpty(lines)),
    Array.map(blockFromLines),
  )
}

// TERMS

const termCache = new WeakMap<ReadonlyArray<Term>, RegExp>()

const termPattern = (terms: ReadonlyArray<Term>): RegExp => {
  const cached = termCache.get(terms)
  if (cached) {
    return cached
  }
  const aliases = pipe(
    Array.flatMap(terms, term => term.aliases),
    Array.sort((a: string, b: string) => (b.length - a.length) as -1 | 0 | 1),
  )
  const pattern = new RegExp(
    `(?<![\\w-])(${Array.join(Array.map(aliases, escapeRegExp), '|')})(?![\\w-])`,
    'i',
  )
  termCache.set(terms, pattern)
  return pattern
}

/** Marks each glossary term once per text, in the plain-text parts only. */
export const withTerms = (
  parts: ReadonlyArray<Segment>,
  terms: ReadonlyArray<Term>,
): ReadonlyArray<Segment> => {
  if (!terms.some(term => term.aliases.length > 0)) {
    return parts
  }
  const pattern = termPattern(terms)
  const marked = new Set<string>()
  return mapTextSegments(parts, text =>
    Array.flatMap(
      text.split(pattern),
      (piece, index): ReadonlyArray<Segment> => {
        if (piece === '') {
          return []
        }
        if (index % 2 === 0) {
          return [{ _tag: 'Text', text: piece }]
        }
        const term = terms.find(candidate =>
          candidate.aliases.some(
            alias => alias.toLowerCase() === piece.toLowerCase(),
          ),
        )
        if (!term || marked.has(term.term)) {
          return [{ _tag: 'Text', text: piece }]
        }
        marked.add(term.term)
        return [{ _tag: 'Term', text: piece, term }]
      },
    ),
  )
}

// RELATIONS

export type Relation = Readonly<{
  from: string
  to: string
  kind: 'waits' | 'mentions'
}>

const QUESTION_ID = /\bQ\d+\b/g

/** Question ids a step's current text names, its own left out. */
export const mentionsOf = (
  snapshot: Snapshot,
  step: Step,
): ReadonlyArray<string> => {
  const known = new Set(
    snapshot.grill.steps.map(candidate => candidate.question.id),
  )
  const text = [
    ...proseOf(snapshot, step).paragraphs,
    step.question.ask,
    ...step.question.options.flatMap(option => [option.label, option.effect]),
  ].join(' ')
  return Array.dedupe(
    Array.filter(
      text.match(QUESTION_ID) ?? [],
      id => known.has(id) && id !== step.question.id,
    ),
  )
}

export const upstreamOf = (question: Question): ReadonlyArray<string> =>
  Array.dedupe(
    Array.appendAll(
      question.dependsOn,
      Array.map(question.when, condition => condition.question),
    ),
  )

/** Every link between questions: waiting on an answer, or naming it in the text. */
export const relationsOf = (snapshot: Snapshot): ReadonlyArray<Relation> =>
  Array.flatMap(snapshot.grill.steps, step => {
    const waits = upstreamOf(step.question)
    return [
      ...Array.map(waits, from => ({
        from,
        to: step.question.id,
        kind: 'waits' as const,
      })),
      ...pipe(
        mentionsOf(snapshot, step),
        Array.filter(from => !waits.includes(from)),
        Array.map(from => ({
          from,
          to: step.question.id,
          kind: 'mentions' as const,
        })),
      ),
    ]
  })
