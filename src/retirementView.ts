import type { Html, HtmlBuilder } from 'foldkit/html'

import type { Message } from './main'
import { PARKED } from './parked'
import { type DecisionStatus, RETIRING, RETIRING_SUMMARY } from './retirement'

type H = HtmlBuilder<Message>

// One row of the decision panel, from either list.
type Row = Readonly<{
  group: string
  part: string
  verdict: string
  where: string
  why: string
  status: DecisionStatus
  usage?: string
}>

const PARKED_GROUP = 'Not in this design yet'

const ROWS: ReadonlyArray<Row> = [
  ...RETIRING.flatMap(page =>
    page.parts.map((part): Row => ({
      group: page.page,
      part: part.part,
      verdict: part.verdict,
      where: part.where,
      why: part.why,
      status: part.status,
      ...(part.usage === undefined ? {} : { usage: part.usage }),
    })),
  ),
  ...PARKED.map((item): Row => ({
    group: PARKED_GROUP,
    part: item.title,
    verdict: item.verdict,
    where: item.where,
    why: item.detail,
    status: item.status,
  })),
]

export const openDecisions = (): number =>
  ROWS.filter(row => row.status === 'Open').length

const VERDICT_TONES: Readonly<Record<string, string>> = {
  'Already in': 'done',
  'Move to': 'move',
  Keep: 'keep',
  Drop: 'drop',
  'Bring back': 'move',
  Open: 'keep',
}

const SECTIONS: ReadonlyArray<readonly [DecisionStatus, string, string]> = [
  ['Open', 'Open for you', 'Decide these; everything else follows from them.'],
  ['Building', 'Decided, building', 'Decided and on its way in.'],
  ['Done', 'Done', 'Moved, and the old copy is gone.'],
]

const rowView = (row: Row, h: H): Html =>
  h.tr(
    [],
    [
      h.th(
        [h.Scope('row')],
        [
          h.small([h.Class('f-retiring-group')], [row.group]),
          row.part,
          row.usage === undefined ? h.empty : h.small([], [row.usage]),
        ],
      ),
      h.td(
        [],
        [
          h.span(
            [h.Class(`f-verdict is-${VERDICT_TONES[row.verdict] ?? 'keep'}`)],
            [row.verdict],
          ),
        ],
      ),
      h.td([], [row.where === '' ? '—' : row.where]),
      h.td([h.Class('f-retiring-why')], [row.why]),
    ],
  )

const tableView = (rows: ReadonlyArray<Row>, h: H): Html =>
  h.table(
    [h.Class('f-retiring-table')],
    [
      h.thead(
        [],
        [
          h.tr(
            [],
            ['Part', 'Recommendation', 'Where', 'Why'].map(label =>
              h.th([h.Scope('col')], [label]),
            ),
          ),
        ],
      ),
      h.tbody(
        [],
        rows.map(row => rowView(row, h)),
      ),
    ],
  )

/**
 * The redesign's decision panel: every retiring part and every parked piece in one row
 * format, open decisions first, then what is building, then what is done (folded).
 */
export const decisionPanelView = (h: H): Html =>
  h.section(
    [h.Class('f-retiring'), h.AriaLabel('Redesign decisions')],
    [
      h.p([h.Class('f-retiring-summary')], [RETIRING_SUMMARY]),
      h.p(
        [h.Class('f-retiring-key')],
        [
          'Already in: the new design shows it. Move to: it needs a small change there. Keep: it stays. Drop: not needed. Bring back: a parked piece returns.',
        ],
      ),
      ...SECTIONS.map(([status, title, note]) => {
        const rows = ROWS.filter(row => row.status === status)
        const body = [h.p([h.Class('hint')], [note]), tableView(rows, h)]
        const heading = [
          `${title} `,
          h.span([h.Class('f-count')], [String(rows.length)]),
        ]
        return rows.length === 0
          ? h.empty
          : status === 'Done'
            ? h.details(
                [h.Class(`f-decision-group is-${status.toLowerCase()}`)],
                [h.summary([], heading), ...body],
              )
            : h.section(
                [
                  h.Class(`f-decision-group is-${status.toLowerCase()}`),
                  h.AriaLabel(title),
                ],
                [h.h2([], heading), ...body],
              )
      }),
    ],
  )
