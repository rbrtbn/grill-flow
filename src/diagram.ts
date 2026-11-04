import { Array, Option, Record, Schema, pipe } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

// COMPARE

/** What holds one part of the problem under one answer, with a muted note and a problem flag. */
export const CellDetail = Schema.Struct({
  value: Schema.String,
  note: Schema.optionalKey(Schema.String),
  flag: Schema.optionalKey(Schema.String),
})
export type CellDetail = typeof CellDetail.Type

export const Cell = Schema.Union([Schema.String, CellDetail])
export type Cell = typeof Cell.Type

/** One part of the problem; `cells` is keyed by `now` and each option's key. */
export const CompareRow = Schema.Struct({
  label: Schema.String,
  cells: Schema.Record(Schema.String, Cell),
})
export type CompareRow = typeof CompareRow.Type

/**
 * A question's comparison: how today stands (`now`, named by `now`) and what each answer
 * changes, one row per part of the problem (docs/adr/0003-diagrams-from-data.md).
 */
export const Compare = Schema.Struct({
  now: Schema.String,
  rows: Schema.Array(CompareRow),
})
export type Compare = typeof Compare.Type

export const NOW = 'now'

// Open-ended so an agent's new flag shows as plain text on an older page.
export type Flag = 'twice' | 'gap' | 'risk' | 'open'

export const FLAG_LABELS: Readonly<Record<Flag, string>> = {
  twice: 'Twice',
  gap: 'Gap',
  risk: 'Risk',
  open: 'Undecided',
}

export const flagOf = (flag: string | undefined): Option.Option<Flag> =>
  flag === 'twice' || flag === 'gap' || flag === 'risk' || flag === 'open'
    ? Option.some(flag)
    : Option.none()

export const cellOf = (cell: Cell | undefined): CellDetail =>
  cell === undefined
    ? { value: '' }
    : typeof cell === 'string'
      ? { value: cell }
      : cell

const sameCell = (a: CellDetail, b: CellDetail): boolean =>
  a.value === b.value &&
  (a.note ?? '') === (b.note ?? '') &&
  (a.flag ?? '') === (b.flag ?? '')

export type CompareTable = Readonly<{
  columns: ReadonlyArray<string>
  rows: ReadonlyArray<CompareRow>
  // Rows every column holds alike, folded into one line under the table.
  same: ReadonlyArray<CompareRow>
}>

/** The columns are `now` and the option keys in the question's order, whatever the rows hold. */
export const compareTable = (
  compare: Compare,
  optionKeys: ReadonlyArray<string>,
): CompareTable => {
  const columns = Array.prepend(optionKeys, NOW)
  const isSame = (row: CompareRow): boolean =>
    Array.every(columns, column =>
      sameCell(cellOf(row.cells[column]), cellOf(row.cells[NOW])),
    )
  return {
    columns,
    rows: Array.filter(compare.rows, row => !isSame(row)),
    same: Array.filter(compare.rows, isSame),
  }
}

export const isChanged = (row: CompareRow, column: string): boolean =>
  column !== NOW && !sameCell(cellOf(row.cells[column]), cellOf(row.cells[NOW]))

/** Each flag a column's rows raise, with how often, in the order flags are listed. */
export const flagCounts = (
  rows: ReadonlyArray<CompareRow>,
  column: string,
): ReadonlyArray<Readonly<{ flag: Flag; count: number }>> =>
  Array.flatMap(Record.keys(FLAG_LABELS), flag => {
    const count = Array.length(
      Array.filter(rows, row =>
        Option.contains(flagOf(cellOf(row.cells[column]).flag), flag),
      ),
    )
    return count === 0 ? [] : [{ flag, count }]
  })

// DIAGRAMS

export const Region = Schema.Struct({ id: Schema.String, label: Schema.String })
export type Region = typeof Region.Type

/** What a paragraph titled with this key makes its diagram show while it is read. */
export const Follow = Schema.Struct({
  state: Schema.String,
  focus: Schema.optionalKey(Schema.String),
})
export type Follow = typeof Follow.Type

const shared = {
  title: Schema.optionalKey(Schema.String),
  follow: Schema.optionalKey(Schema.Record(Schema.String, Follow)),
}

// `in` names a zone, several zones (the part is held twice), or `line`: undecided.
export const ZoneItem = Schema.Struct({
  label: Schema.String,
  note: Schema.optionalKey(Schema.String),
  in: Schema.Union([Schema.String, Schema.Array(Schema.String)]),
  flag: Schema.optionalKey(Schema.String),
})
export type ZoneItem = typeof ZoneItem.Type

export const ZoneState = Schema.Struct({
  caption: Schema.optionalKey(Schema.String),
  items: Schema.Array(ZoneItem),
})
export type ZoneState = typeof ZoneState.Type

export const ZonesDiagram = Schema.Struct({
  kind: Schema.Literal('zones'),
  ...shared,
  zones: Schema.Array(Region),
  states: Schema.Record(Schema.String, ZoneState),
})
export type ZonesDiagram = typeof ZonesDiagram.Type

export const FlowNode = Schema.Union([
  Schema.String,
  Schema.Struct({
    text: Schema.String,
    flag: Schema.optionalKey(Schema.String),
  }),
  Schema.Null,
])
export type FlowNode = typeof FlowNode.Type

// `from` and `to` count steps from 1, both included.
export const FlowBand = Schema.Struct({
  from: Schema.Number,
  to: Schema.Number,
  label: Schema.String,
  flag: Schema.optionalKey(Schema.String),
})
export type FlowBand = typeof FlowBand.Type

export const FlowState = Schema.Struct({
  caption: Schema.optionalKey(Schema.String),
  nodes: Schema.Record(Schema.String, Schema.Array(FlowNode)),
  band: Schema.optionalKey(FlowBand),
})
export type FlowState = typeof FlowState.Type

export const FlowDiagram = Schema.Struct({
  kind: Schema.Literal('flow'),
  ...shared,
  lanes: Schema.Array(Region),
  steps: Schema.Array(Schema.String),
  states: Schema.Record(Schema.String, FlowState),
})
export type FlowDiagram = typeof FlowDiagram.Type

export const CompareDiagram = Schema.Struct({
  kind: Schema.Literal('compare'),
  ...shared,
  now: Schema.String,
  rows: Schema.Array(CompareRow),
})
export type CompareDiagram = typeof CompareDiagram.Type

export const Diagram = Schema.Union([ZonesDiagram, FlowDiagram, CompareDiagram])
export type Diagram = typeof Diagram.Type

const DIAGRAM_FENCE = /^\s*```diagram\s*$/
const FENCE_END = /^\s*```\s*$/

const decodeDiagram = Schema.decodeUnknownOption(Schema.fromJsonString(Diagram))

/**
 * A ```diagram block the page can draw. A block that isn't valid JSON or a known kind gives
 * none, and shows as the plain ``` figure it is.
 */
export const diagramOf = (paragraph: string): Option.Option<Diagram> => {
  const lines = paragraph.split('\n')
  if (!Option.exists(Array.head(lines), line => DIAGRAM_FENCE.test(line))) {
    return Option.none()
  }
  const body = Array.drop(lines, 1)
  return decodeDiagram(
    Array.join(
      Option.exists(Array.last(body), line => FENCE_END.test(line))
        ? Array.dropRight(body, 1)
        : body,
      '\n',
    ),
  )
}

/** The states a reader can switch between: none for a compare, whose columns show them all. */
export const statesOf = (diagram: Diagram): ReadonlyArray<string> =>
  diagram.kind === 'compare' ? [] : Object.keys(diagram.states)

// PROSE

const TITLE = /^\s*### (.+)$/

/** A paragraph's `### ` first line, and the paragraph without it. */
export const titleOf = (
  paragraph: string,
): Readonly<{ title: Option.Option<string>; text: string }> => {
  const [first = '', ...rest] = paragraph.split('\n')
  const title = TITLE.exec(first)?.[1]
  return title === undefined
    ? { title: Option.none(), text: paragraph }
    : {
        title: Option.some(title.trim()),
        text: Array.join(rest, '\n').trim(),
      }
}

export type ProseText = Readonly<{
  _tag: 'Text'
  paragraph: string
  title: Option.Option<string>
}>
export type ProseDiagram = Readonly<{
  _tag: 'Diagram'
  diagram: Diagram
  // Its place among the prose's diagrams, which keys its state in the Model.
  index: number
}>
export type ProseItem = ProseText | ProseDiagram

export type ProseSection =
  | Readonly<{ _tag: 'Plain'; item: ProseItem }>
  | Readonly<{
      _tag: 'Pinned'
      diagram: Diagram
      index: number
      items: ReadonlyArray<ProseText>
    }>

type Reading = Readonly<{
  items: ReadonlyArray<ProseItem>
  pendingTitle: Option.Option<string>
  diagrams: number
}>

const emptyReading: Reading = {
  items: [],
  pendingTitle: Option.none(),
  diagrams: 0,
}

/** Paragraphs as titled text and diagrams; a `### ` line on its own titles the next paragraph. */
export const proseItems = (
  paragraphs: ReadonlyArray<string>,
): ReadonlyArray<ProseItem> =>
  Array.reduce(paragraphs, emptyReading, (reading, paragraph): Reading =>
    Option.match(diagramOf(paragraph), {
      onSome: diagram => ({
        items: Array.append(reading.items, {
          _tag: 'Diagram',
          diagram,
          index: reading.diagrams,
        }),
        pendingTitle: Option.none(),
        diagrams: reading.diagrams + 1,
      }),
      onNone: () => {
        const titled = titleOf(paragraph)
        return titled.text === ''
          ? { ...reading, pendingTitle: titled.title }
          : {
              ...reading,
              items: Array.append(reading.items, {
                _tag: 'Text',
                paragraph: titled.text,
                title: Option.orElse(titled.title, () => reading.pendingTitle),
              }),
              pendingTitle: Option.none(),
            }
      },
    }),
  ).items

/**
 * Groups a diagram with the paragraphs it follows, so it can stay pinned while they're read:
 * from the diagram to the last later paragraph whose title its `follow` names.
 */
export const proseSections = (
  items: ReadonlyArray<ProseItem>,
): ReadonlyArray<ProseSection> => {
  const pinnedUntil = (item: ProseDiagram, at: number): Option.Option<number> =>
    pipe(
      Option.fromUndefinedOr(item.diagram.follow),
      Option.flatMap(follow =>
        Array.findLastIndex(
          items,
          (later, index) =>
            index > at &&
            later._tag === 'Text' &&
            Option.exists(later.title, title => title in follow),
        ),
      ),
    )
  const go = (at: number): ReadonlyArray<ProseSection> => {
    const maybeItem = Array.get(items, at)
    if (Option.isNone(maybeItem)) {
      return []
    }
    const item = maybeItem.value
    return item._tag === 'Diagram'
      ? Option.match(pinnedUntil(item, at), {
          onNone: () => Array.prepend(go(at + 1), { _tag: 'Plain', item }),
          onSome: last =>
            pipe(items.slice(at + 1, last + 1), followed =>
              Array.every(followed, later => later._tag === 'Text')
                ? Array.prepend(go(last + 1), {
                    _tag: 'Pinned',
                    diagram: item.diagram,
                    index: item.index,
                    items: Array.filter(
                      followed,
                      (later): later is ProseText => later._tag === 'Text',
                    ),
                  })
                : Array.prepend(go(at + 1), { _tag: 'Plain', item }),
            ),
        })
      : Array.prepend(go(at + 1), { _tag: 'Plain', item })
  }
  return go(0)
}

// VIEW STATE

/** What a reader made a diagram show: a state they picked, or the paragraph they're reading. */
export const DiagramView = defineTaggedUnion({
  Chosen: { state: Schema.String },
  Following: { title: Schema.String },
})
export type DiagramView = typeof DiagramView.Type

export type Shown = Readonly<{
  state: string
  focus: Option.Option<string>
  following: Option.Option<string>
}>

/**
 * The state a diagram draws: the reader's pick or followed paragraph, else the question's
 * answer when the diagram has that state, else its first.
 */
export const shownOf = (
  diagram: Diagram,
  maybeView: Option.Option<DiagramView>,
  maybeAnswer: Option.Option<string>,
): Shown => {
  const states = statesOf(diagram)
  const fallback = Option.getOrElse(
    Option.orElse(
      Option.filter(maybeAnswer, answer => Array.contains(states, answer)),
      () => Array.head(states),
    ),
    () => '',
  )
  const known = (state: string): string =>
    Array.contains(states, state) ? state : fallback
  return Option.match(maybeView, {
    onNone: () => ({
      state: fallback,
      focus: Option.none(),
      following: Option.none(),
    }),
    onSome: view =>
      DiagramView.match(view, {
        Chosen: ({ state }) => ({
          state: known(state),
          focus: Option.none(),
          following: Option.none(),
        }),
        Following: ({ title }) =>
          Option.match(Option.fromUndefinedOr(diagram.follow?.[title]), {
            onNone: () => ({
              state: fallback,
              focus: Option.none(),
              following: Option.none(),
            }),
            onSome: follow => ({
              state: known(follow.state),
              focus: Option.fromUndefinedOr(follow.focus),
              following: Option.some(title),
            }),
          }),
      }),
  })
}
