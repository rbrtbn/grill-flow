import { Array, Option, Record, Schema, pipe } from 'effect'

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
  urgency: Schema.optionalKey(Urgency),
  // A `refs` key: the issue the question is mainly about.
  issue: Schema.optionalKey(Schema.String),
  // A `sources` key, and the question's id in that asker's own rows.
  from: Schema.optionalKey(Schema.String),
  row: Schema.optionalKey(Schema.String),
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

export const Grill = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  entities: Schema.Array(Entity),
  terms: Schema.Array(Term),
  round: Schema.Number,
  session: Schema.String,
  intro: Schema.Array(Schema.String),
  parts: Schema.Array(Part),
  steps: Schema.Array(Step),
  next: Schema.Array(Schema.String),
  refs: Schema.optionalKey(Schema.Record(Schema.String, Ref)),
  // When the refs' states were looked up.
  refsAt: Schema.optionalKey(Schema.String),
  sources: Schema.optionalKey(Schema.Record(Schema.String, Source)),
  decided: Schema.optionalKey(Schema.Array(Decision)),
})
export type Grill = typeof Grill.Type

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
  grill.steps.some(step => step.question.urgency !== undefined)

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

export const Send = Schema.Struct({
  at: Schema.Number,
  ok: Schema.Boolean,
  detail: Schema.String,
})
export type Send = typeof Send.Type

export const Snapshot = Schema.Struct({
  grill: Grill,
  answers: Schema.Record(Schema.String, Schema.String),
  notes: Schema.Record(Schema.String, Schema.String),
  own: Schema.Record(Schema.String, Schema.String),
  asks: Schema.Array(Ask),
  revisions: Schema.Array(Revision),
  sends: Schema.Array(Send),
})
export type Snapshot = typeof Snapshot.Type

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

export const tally = (
  grill: Grill,
  answers: Answers,
  skipped: ReadonlyArray<string> = [],
): Tally =>
  Array.reduce(
    grill.steps,
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

export const replyText = (
  grill: Grill,
  answers: Answers,
  notes: Notes,
  own: Notes = {},
): string => {
  const statuses = Array.map(grill.steps, step => ({
    question: step.question,
    status: statusOf(grill, answers, step.question.id),
  }))
  const answered = Array.flatMap(statuses, ({ question, status }) =>
    status._tag === 'Answered' ? [{ question, key: status.key }] : [],
  )
  const unanswered = Array.filter(
    statuses,
    ({ status }) => status._tag === 'Open' || status._tag === 'Waiting',
  )
  const skipped = Array.flatMap(statuses, ({ question, status }) =>
    status._tag === 'NotNeeded' ? [`${question.id} (${status.because})`] : [],
  )
  const anyNotes = Array.some(answered, ({ question }) =>
    pipe(
      Record.get(notes, question.id),
      Option.exists(note => note.trim() !== ''),
    ),
  )
  const allRecommended = Array.every(answered, ({ question, key }) =>
    isRecommended(question, key),
  )
  const skippedLine = Array.isArrayNonEmpty(skipped)
    ? [`Not needed: ${Array.join(skipped, ', ')}`]
    : []
  if (
    Array.isArrayEmpty(unanswered) &&
    allRecommended &&
    !anyNotes &&
    Array.isArrayNonEmpty(answered)
  ) {
    const picks = Array.join(
      Array.map(answered, ({ question, key }) => `${question.id} ${key}`),
      ', ',
    )
    return Array.join(
      [`Round ${grill.round}: all recommended (${picks})`, ...skippedLine],
      '\n',
    )
  }
  const header = Array.isArrayEmpty(unanswered)
    ? `Round ${grill.round}:`
    : `Round ${grill.round} (${answered.length} of ${answered.length + unanswered.length} answered):`
  const lines = Array.map(answered, ({ question, key }) =>
    withNote(answerText(question.id, key, own), notes, question.id),
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
  return Array.join([header, ...lines, ...openLine, ...skippedLine], '\n')
}

// PROSE

export type Segment =
  | Readonly<{ _tag: 'Text' | 'Code'; text: string }>
  | Readonly<{ _tag: 'Entity'; text: string; entity: Entity }>
  | Readonly<{ _tag: 'Term'; text: string; term: Term }>
  | Readonly<{ _tag: 'Ref'; text: string; ref: Ref }>

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
        : splitEntities(text, entities),
    ),
    Array.filter(segment => segment.text !== ''),
  )

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
  return Array.flatMap(parts, (segment): ReadonlyArray<Segment> =>
    segment._tag !== 'Text'
      ? [segment]
      : pipe(
          segment.text.split(pattern),
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

// A paragraph with `- ` lines keeps its line breaks, so its items stay a list.
export const paragraphsOf = (text: string): ReadonlyArray<string> =>
  pipe(
    text.split(/\n\s*\n/),
    Array.map(paragraph =>
      paragraph.split('\n').some(line => ITEM.test(line))
        ? Array.join(
            Array.map(paragraph.split('\n'), line => line.trim()),
            '\n',
          ).trim()
        : paragraph.replace(/\s*\n\s*/g, ' ').trim(),
    ),
    Array.filter(paragraph => paragraph !== ''),
  )

export type Block =
  | Readonly<{ _tag: 'Paragraph'; text: string }>
  | Readonly<{
      _tag: 'List'
      lead: Option.Option<string>
      items: ReadonlyArray<string>
    }>

/** A paragraph as plain text, or as an optional lead line and its `- ` items. */
export const blockOf = (paragraph: string): Block => {
  const lines = paragraph.split('\n')
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
      paragraphs: step.prose,
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
            onEmpty: () => step.prose,
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
  return Array.flatMap(parts, (part): ReadonlyArray<Segment> => {
    if (part._tag !== 'Text') {
      return [part]
    }
    return Array.flatMap(
      part.text.split(pattern),
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
    )
  })
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
