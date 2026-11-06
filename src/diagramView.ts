import { Array, Option, Record, pipe } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import {
  type Compare,
  type CompareRow,
  type Diagram,
  type DiagramView,
  FLAG_LABELS,
  type FlowDiagram,
  type FlowNode,
  NOW,
  type ProseText,
  type Shown,
  type ZonesDiagram,
  cellOf,
  compareTable,
  flagCounts,
  flagOf,
  isChanged,
  proseItems,
  proseSections,
  shownOf,
  statesOf,
} from './diagram'
import type { AnswerOption, Entity, Tone } from './domain'
import type { Message as MessageType } from './main'
import { FollowPinnedDiagram, Message } from './main'

type H = HtmlBuilder<MessageType>

const TONES: ReadonlyArray<Tone> = ['teal', 'ochre', 'violet', 'olive', 'rust']

/** The tone of the first entity a label names, so a region or holder wears its entity's colour. */
const toneOf = (
  text: string,
  entities: ReadonlyArray<Entity>,
): Option.Option<Tone> =>
  pipe(
    Array.findFirst(entities, entity =>
      Array.some(Array.prepend(entity.aliases, entity.name), name =>
        text.includes(name),
      ),
    ),
    Option.map(entity => entity.tone),
  )

const regionTone = (
  label: string,
  index: number,
  entities: ReadonlyArray<Entity>,
): Tone =>
  Option.getOrElse(
    toneOf(label, entities),
    () => TONES[index % TONES.length] ?? 'teal',
  )

/** An option label as plain text: a switch or column head shows no code marks. */
export const plainLabel = (label: string): string => label.replaceAll('`', '')

/** What a diagram's state is called on its switch: the question's option, or today. */
export type StateLabel = (state: string) => string

export const stateLabelFor =
  (options: ReadonlyArray<AnswerOption>, now: string): StateLabel =>
  state =>
    state === NOW
      ? now
      : Option.match(
          Array.findFirst(options, option => option.key === state),
          {
            onNone: () => state,
            onSome: option => `${option.key} · ${plainLabel(option.label)}`,
          },
        )

// COMPARE

export type CompareColumn = Readonly<{
  key: string
  label: string
  recommended: boolean
}>

const flagBadge = (flag: string | undefined, h: H): Html =>
  Option.match(flagOf(flag), {
    onNone: () => h.empty,
    onSome: known =>
      h.span([h.Class(`flag flag-${known}`)], [FLAG_LABELS[known]]),
  })

const holders = (
  value: string,
  entities: ReadonlyArray<Entity>,
  h: H,
): ReadonlyArray<Html> =>
  value === '?'
    ? []
    : Array.map(value.split(' + '), holder =>
        Option.match(toneOf(holder, entities), {
          onNone: () => h.span([h.Class('holder')], [holder]),
          onSome: tone =>
            h.span([h.Class(`holder is-entity tone-${tone}`)], [holder]),
        }),
      )

const compareCell = (
  row: CompareRow,
  column: CompareColumn,
  position: number,
  picked: Option.Option<string>,
  entities: ReadonlyArray<Entity>,
  h: H,
): Html => {
  const cell = cellOf(row.cells[column.key])
  return h.td(
    [
      h.Class(
        Array.join(
          [
            Option.match(flagOf(cell.flag), {
              onNone: () => '',
              onSome: flag => `has-${flag}`,
            }),
            isChanged(row, column.key) ? 'is-changed' : '',
            Option.contains(picked, column.key) ? 'is-picked' : '',
          ],
          ' ',
        ),
      ),
      h.DataAttribute('col', String(position)),
    ],
    [
      flagBadge(cell.flag, h),
      ...holders(cell.value, entities, h),
      cell.note === undefined
        ? h.empty
        : h.span([h.Class('cell-note')], [cell.note]),
    ],
  )
}

const columnSummary = (
  rows: ReadonlyArray<CompareRow>,
  column: string,
  h: H,
): Html =>
  Array.match(flagCounts(rows, column), {
    onEmpty: () => h.span([h.Class('column-summary')], ['No problems flagged']),
    onNonEmpty: counts =>
      h.span(
        [h.Class('column-summary has-problems')],
        [
          Array.join(
            Array.map(
              counts,
              ({ flag, count }) =>
                `${count} ${FLAG_LABELS[flag].toLowerCase()}`,
            ),
            ' · ',
          ),
        ],
      ),
  })

const compareLegend = (
  rows: ReadonlyArray<CompareRow>,
  columns: ReadonlyArray<CompareColumn>,
  h: H,
): Html => {
  const raised = Array.dedupe(
    Array.flatMap(columns, column =>
      Array.map(flagCounts(rows, column.key), ({ flag }) => flag),
    ),
  )
  const meaning = {
    twice: 'two places hold it',
    gap: 'nothing covers it',
    risk: 'works, with a known failure',
    open: 'a later round decides',
  }
  return h.p(
    [h.Class('diagram-legend')],
    [
      ...Array.map(
        Array.filter(Record.keys(FLAG_LABELS), flag =>
          Array.contains(raised, flag),
        ),
        flag =>
          h.span(
            [],
            [
              h.span([h.Class(`flag flag-${flag}`)], [FLAG_LABELS[flag]]),
              meaning[flag],
            ],
          ),
      ),
      h.span(
        [],
        [h.span([h.Class('swatch is-changed')]), 'differs from today'],
      ),
    ],
  )
}

/**
 * A comparison table: today beside each answer, problems flagged, changes marked, and rows the
 * same everywhere folded into one line. Hovering an option lights its column (styles.css).
 */
export const compareView = (
  compare: Compare,
  columns: ReadonlyArray<CompareColumn>,
  picked: Option.Option<string>,
  entities: ReadonlyArray<Entity>,
  h: H,
): Html => {
  const table = compareTable(
    compare,
    Array.map(columns, column => column.key),
  )
  const all: ReadonlyArray<CompareColumn> = Array.prepend(columns, {
    key: NOW,
    label: compare.now,
    recommended: false,
  })
  return h.div(
    [h.Class(`compare${Option.isSome(picked) ? ' has-pick' : ''}`)],
    [
      h.table(
        [h.Class('compare-table')],
        [
          h.thead(
            [],
            [
              h.tr(
                [],
                [
                  h.th([h.Class('row-head')]),
                  ...Array.map(all, (column, position) =>
                    h.th(
                      [
                        h.Class(
                          Option.contains(picked, column.key)
                            ? 'is-picked'
                            : '',
                        ),
                        h.DataAttribute('col', String(position)),
                      ],
                      [
                        h.span([h.Class('column-label')], [column.label]),
                        column.recommended
                          ? h.span([h.Class('recommended')], ['Recommended'])
                          : h.empty,
                        columnSummary(table.rows, column.key, h),
                      ],
                    ),
                  ),
                ],
              ),
            ],
          ),
          h.tbody(
            [],
            Array.map(table.rows, row =>
              h.tr(
                [],
                [
                  h.th([h.Class('row-head')], [row.label]),
                  ...Array.map(all, (column, position) =>
                    compareCell(row, column, position, picked, entities, h),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
      Array.match(table.same, {
        onEmpty: () => h.empty,
        onNonEmpty: same =>
          h.p(
            [h.Class('compare-same')],
            [
              'Same in every answer: ',
              Array.join(
                Array.map(
                  same,
                  row => `${row.label} (${cellOf(row.cells[NOW]).value})`,
                ),
                '; ',
              ),
              '.',
            ],
          ),
      }),
      compareLegend(table.rows, all, h),
    ],
  )
}

// ZONES

const zoneChip = (
  label: string,
  note: string | undefined,
  flag: string | undefined,
  h: H,
): Html =>
  h.span(
    [
      h.Class(
        `chip${Option.match(flagOf(flag), {
          onNone: () => '',
          onSome: known => ` is-${known}`,
        })}`,
      ),
    ],
    [
      label,
      note === undefined && flag !== 'twice'
        ? h.empty
        : h.small(
            [],
            [
              Array.join(
                Array.filter(
                  [note ?? '', flag === 'twice' ? 'twice' : ''],
                  part => part !== '',
                ),
                ' · ',
              ),
            ],
          ),
    ],
  )

const LINE = 'line'

const zonesStage = (
  diagram: ZonesDiagram,
  state: string,
  entities: ReadonlyArray<Entity>,
  h: H,
): ReadonlyArray<Html> => {
  const items = diagram.states[state]?.items ?? []
  const inZone = (zone: string): ReadonlyArray<Html> =>
    Array.flatMap(items, item =>
      Array.contains(typeof item.in === 'string' ? [item.in] : item.in, zone) ||
      (zone === LINE &&
        !Array.some(diagram.zones, region =>
          Array.contains(
            typeof item.in === 'string' ? [item.in] : item.in,
            region.id,
          ),
        ))
        ? [zoneChip(item.label, item.note, item.flag, h)]
        : [],
    )
  const undecided = inZone(LINE)
  return Array.flatMap(diagram.zones, (zone, index) => [
    ...(index === 0
      ? []
      : [
          h.div(
            [h.Class('zone-line')],
            index === 1 && Array.isReadonlyArrayNonEmpty(undecided)
              ? [
                  h.span([h.Class('zone-line-label')], ['Undecided']),
                  ...undecided,
                ]
              : [],
          ),
        ]),
    h.div(
      [h.Class(`zone tone-${regionTone(zone.label, index, entities)}`)],
      [h.span([h.Class('zone-label')], [zone.label]), ...inZone(zone.id)],
    ),
  ])
}

// FLOW

const nodeOf = (
  node: FlowNode | undefined,
): Option.Option<Readonly<{ text: string; flag: string }>> =>
  node === undefined || node === null
    ? Option.none()
    : typeof node === 'string'
      ? Option.some({ text: node, flag: '' })
      : Option.some({ text: node.text, flag: node.flag ?? '' })

const NODE_FLAGS: Readonly<Record<string, string>> = {
  twice: 'is-twice',
  open: 'is-open',
  risk: 'is-risk',
  ghost: 'is-ghost',
  faint: 'is-faint',
  link: 'is-link',
}

const flowStage = (
  diagram: FlowDiagram,
  state: string,
  focus: Option.Option<string>,
  entities: ReadonlyArray<Entity>,
  h: H,
): ReadonlyArray<Html> => {
  const flowState = diagram.states[state]
  const lanes = Array.map(diagram.lanes, (lane, laneIndex) => {
    const nodes = Array.makeBy(diagram.steps.length, step =>
      nodeOf(flowState?.nodes[lane.id]?.[step]),
    )
    const isLive = (step: number): boolean =>
      Option.exists(
        Option.flatten(Array.get(nodes, step)),
        node => node.flag !== 'ghost',
      )
    const dimmed = Option.exists(focus, id => id !== lane.id)
    return [
      h.div(
        [
          h.Class(
            `lane-label tone-${regionTone(lane.label, laneIndex, entities)}`,
          ),
          h.Style({ 'grid-row': String(laneIndex + 2) }),
        ],
        [lane.label],
      ),
      ...Array.map(nodes, (maybeNode, step) =>
        h.div(
          [
            h.Class(
              Array.join(
                [
                  'lane-cell',
                  `tone-${regionTone(lane.label, laneIndex, entities)}`,
                  isLive(step) ? '' : 'is-empty',
                  step > 0 && isLive(step) && isLive(step - 1)
                    ? 'has-arrow'
                    : '',
                  dimmed ? 'is-dimmed' : '',
                ],
                ' ',
              ),
            ),
            h.Style({
              'grid-row': String(laneIndex + 2),
              'grid-column': String(step + 2),
            }),
          ],
          [
            Option.match(maybeNode, {
              onNone: () => h.empty,
              onSome: node =>
                h.span(
                  [h.Class(`node ${NODE_FLAGS[node.flag] ?? ''}`)],
                  [node.text],
                ),
            }),
          ],
        ),
      ),
    ]
  })
  const band = flowState?.band
  return [
    ...Array.map(diagram.steps, (step, index) =>
      h.div(
        [
          h.Class('step-label'),
          h.Style({ 'grid-row': '1', 'grid-column': String(index + 2) }),
        ],
        [step],
      ),
    ),
    ...Array.flatten(lanes),
    ...(band === undefined
      ? []
      : [
          h.div([
            h.Class(
              `band is-${flagOf(band.flag).pipe(Option.getOrElse(() => 'twice'))}`,
            ),
            h.Style({
              'grid-row': `2 / ${diagram.lanes.length + 2}`,
              'grid-column': `${band.from + 1} / ${band.to + 2}`,
            }),
          ]),
          h.div(
            [
              h.Class(
                `band-label is-${flagOf(band.flag).pipe(Option.getOrElse(() => 'twice'))}`,
              ),
              h.Style({
                'grid-row': String(diagram.lanes.length + 2),
                'grid-column': `${band.from + 1} / ${band.to + 2}`,
              }),
            ],
            [band.label],
          ),
        ]),
  ]
}

// DIAGRAM

const stageOf = (
  diagram: Diagram,
  state: string,
  focus: Option.Option<string>,
  entities: ReadonlyArray<Entity>,
  h: H,
): Html =>
  diagram.kind === 'zones'
    ? h.div([h.Class('zones')], [...zonesStage(diagram, state, entities, h)])
    : diagram.kind === 'flow'
      ? h.div(
          [
            h.Class('flow'),
            h.Style({
              'grid-template-columns': `minmax(56px, 84px) repeat(${diagram.steps.length}, minmax(0, 1fr))`,
            }),
          ],
          [...flowStage(diagram, state, focus, entities, h)],
        )
      : h.empty

const captionOf = (diagram: Diagram, state: string): string =>
  diagram.kind === 'compare' ? '' : (diagram.states[state]?.caption ?? '')

/**
 * A diagram with a switch between its states. Every state is drawn in the same grid cell and
 * only the shown one is visible, so the diagram keeps its tallest state's height and switching
 * never moves the text under it.
 */
export const diagramView = (
  key: string,
  diagram: Diagram,
  shown: Shown,
  label: StateLabel,
  entities: ReadonlyArray<Entity>,
  h: H,
): Html => {
  const states = statesOf(diagram)
  const hasCaption = Array.some(
    states,
    state => captionOf(diagram, state) !== '',
  )
  return h.figure(
    [h.Class(`diagram is-${diagram.kind}`)],
    [
      h.div(
        [h.Class('diagram-head')],
        [
          h.figcaption(
            [h.Class('diagram-title')],
            [
              diagram.title ?? '',
              ...Option.match(shown.following, {
                onNone: () => [],
                onSome: title => [
                  diagram.title === undefined ? '' : ' · ',
                  h.span([h.Class('diagram-following')], [title]),
                ],
              }),
            ],
          ),
          states.length < 2
            ? h.empty
            : h.div(
                [
                  h.Class('diagram-switch'),
                  h.Role('group'),
                  h.AriaLabel('Show'),
                ],
                Array.map(states, state =>
                  h.button(
                    [
                      h.Type('button'),
                      h.Class(state === shown.state ? 'is-active' : ''),
                      h.AriaPressed(state === shown.state ? 'true' : 'false'),
                      h.OnClick(
                        Message.ClickedDiagramState({ diagram: key, state }),
                      ),
                    ],
                    [label(state)],
                  ),
                ),
              ),
        ],
      ),
      diagram.kind === 'compare'
        ? compareView(
            diagram,
            Array.map(
              Array.dedupe(
                Array.flatMap(diagram.rows, row =>
                  Array.filter(Record.keys(row.cells), cell => cell !== NOW),
                ),
              ),
              cell => ({ key: cell, label: label(cell), recommended: false }),
            ),
            Option.none(),
            entities,
            h,
          )
        : h.div(
            [h.Class('diagram-states')],
            Array.map(states, state =>
              h.div(
                [
                  h.Class(
                    `diagram-state${state === shown.state ? ' is-shown' : ''}`,
                  ),
                  h.AriaHidden(state !== shown.state),
                ],
                [
                  stageOf(diagram, state, shown.focus, entities, h),
                  hasCaption
                    ? h.p(
                        [h.Class('diagram-caption')],
                        [captionOf(diagram, state)],
                      )
                    : h.empty,
                ],
              ),
            ),
          ),
    ],
  )
}

// PROSE

export type ProseContext = Readonly<{
  // Prefixes each diagram's key in the Model: a step id, or a reply's.
  key: string
  views: Readonly<Record<string, DiagramView>>
  maybeAnswer: Option.Option<string>
  label: StateLabel
  entities: ReadonlyArray<Entity>
  showTitles?: boolean
}>

export const diagramKey = (context: string, index: number): string =>
  `${context}#${index}`

const textView = (
  item: ProseText,
  render: (paragraph: string) => Html,
  follow: Option.Option<
    Readonly<{ diagram: string; following: Option.Option<string> }>
  >,
  showTitles: boolean,
  h: H,
): Html =>
  Option.match(item.title, {
    onNone: () => render(item.paragraph),
    onSome: title =>
      h.div(
        [
          h.Class(
            `titled${showTitles ? ' has-visible-title' : ''}${
              Option.exists(follow, ({ following }) =>
                Option.contains(following, title),
              )
                ? ' is-followed'
                : ''
            }`,
          ),
          h.DataAttribute('title', title),
          ...Option.match(follow, {
            onNone: () => [],
            onSome: ({ diagram }) => [
              h.DataAttribute('follow', title),
              h.OnMouseEnter(
                Message.HoveredDiagramParagraph({ diagram, title }),
              ),
            ],
          }),
        ],
        [showTitles ? h.h3([], [title]) : h.empty, render(item.paragraph)],
      ),
  })

/**
 * Prose with its diagrams and paragraph titles. A diagram that follows paragraphs stays pinned
 * over them; hovering one, or scrolling it under the diagram, makes the diagram show its state.
 */
export const proseView = (
  paragraphs: ReadonlyArray<string>,
  context: ProseContext,
  render: (paragraph: string) => Html,
  h: H,
): ReadonlyArray<Html> =>
  Array.map(proseSections(proseItems(paragraphs)), section => {
    if (section._tag === 'Plain') {
      const item = section.item
      if (item._tag === 'Text') {
        return textView(
          item,
          render,
          Option.none(),
          context.showTitles ?? false,
          h,
        )
      }
      const key = diagramKey(context.key, item.index)
      return diagramView(
        key,
        item.diagram,
        shownOf(
          item.diagram,
          Record.get(context.views, key),
          context.maybeAnswer,
        ),
        context.label,
        context.entities,
        h,
      )
    }
    const key = diagramKey(context.key, section.index)
    const shown = shownOf(
      section.diagram,
      Record.get(context.views, key),
      context.maybeAnswer,
    )
    return h.section(
      [h.Class('pinned'), h.OnMount(FollowPinnedDiagram({ diagram: key }))],
      [
        diagramView(
          key,
          section.diagram,
          shown,
          context.label,
          context.entities,
          h,
        ),
        ...Array.map(section.items, item =>
          textView(
            item,
            render,
            Option.exists(
              item.title,
              title => section.diagram.follow?.[title] !== undefined,
            )
              ? Option.some({ diagram: key, following: shown.following })
              : Option.none(),
            context.showTitles ?? false,
            h,
          ),
        ),
      ],
    )
  })
