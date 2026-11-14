// PROTOTYPE I (ask 9656, round 3): G's question page where clicking an answer picks it and
// opens an optional note under the answers at once (send without typing, or type then send),
// and the sessions panel grouped by squad with recent conversations on top, as E had.
import { question } from '../discussion-threads-shared/data'
import {
  answerBox,
  questionPage,
  sentLine,
} from '../discussion-threads-shared/page3'
import { sessionsPanel } from '../discussion-threads-shared/sessions3'
import {
  type H,
  Message,
  type Model,
  sidebar,
  start,
} from '../discussion-threads-shared/shell'
import '../discussion-threads-shared/people.css'
import './styles.css'

const ISSUES = {
  'cache-budget': 'LAB-1412',
  'night-grant': 'LAB-1398',
  'pr-order': 'LAB-1400',
  'old-pages': 'LAB-1405',
}

const answers = (model: Model, h: H) => {
  const q = model.question
  const pick = model.ui[`pick:${q}`] ?? ''
  const sent = model.ui[`sent:${q}`] ?? ''
  return h.div(
    [],
    [
      h.div(
        [h.Class('i-answers'), h.Role('radiogroup')],
        [
          ...question(q).options.map(option =>
            h.button(
              [
                h.Class(`i-answer${pick === option.key ? ' is-picked' : ''}`),
                h.Role('radio'),
                h.AriaChecked(pick === option.key),
                h.Title(option.effect),
                h.OnClick(
                  Message.PickedAnswer({ q, key: option.key, note: false }),
                ),
              ],
              [
                h.span([h.Class('i-radio')], []),
                h.strong([], [option.key]),
                ` ${option.label}`,
              ],
            ),
          ),
          h.button(
            [
              h.Class(`i-answer is-own${pick === 'own' ? ' is-picked' : ''}`),
              h.OnClick(Message.PickedAnswer({ q, key: 'own', note: true })),
            ],
            [h.span([h.Class('i-radio')], []), 'Write my own…'],
          ),
        ],
      ),
      sent !== ''
        ? sentLine(model, h)
        : pick !== ''
          ? answerBox(model, h, 'The note is optional: send now, or type first')
          : h.empty,
    ],
  )
}

start({
  variant: 'directory',
  description:
    'G’s page: click an answer and an optional note opens under it, summary first, trade-offs and table folded, starters send on click. Sessions: pinned, recent, by squad. Step the scenario bottom-left.',
  body: (model, h) =>
    h.div(
      [h.Class('g-body')],
      [
        sidebar(model, h),
        questionPage(model, h, answers),
        sessionsPanel(model, h, {
          grouping: 'squad',
          ordering: 'recent',
          fixed: 'recent',
          issueOf: ISSUES,
        }),
      ],
    ),
})
