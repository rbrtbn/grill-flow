// PROTOTYPE H (ask 9656, round 3): G's question page with split answer chips (the answer
// itself, or ✎ for the same answer with a note, one click either way) and the sessions panel
// grouped by issue with "Waiting on you" on top.
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
  const noteOpen = model.ui[`note:${q}`] === 'open'
  return h.div(
    [],
    [
      h.div(
        [h.Class('p3-answers')],
        [
          ...question(q).options.map(option =>
            h.span(
              [h.Class(`h-chip${pick === option.key ? ' is-picked' : ''}`)],
              [
                h.button(
                  [
                    h.Class('h-main'),
                    h.Title(option.effect),
                    h.OnClick(
                      Message.PickedAnswer({ q, key: option.key, note: false }),
                    ),
                  ],
                  [h.strong([], [option.key]), ` ${option.label}`],
                ),
                h.button(
                  [
                    h.Class('h-note'),
                    h.Title(`Answer ${option.key} with a note`),
                    h.AriaLabel(`Answer ${option.key} with a note`),
                    h.OnClick(
                      Message.PickedAnswer({ q, key: option.key, note: true }),
                    ),
                  ],
                  ['✎'],
                ),
              ],
            ),
          ),
          h.button(
            [
              h.Class(`h-own${pick === 'own' ? ' is-picked' : ''}`),
              h.OnClick(Message.PickedAnswer({ q, key: 'own', note: true })),
            ],
            ['✎ Write my own'],
          ),
        ],
      ),
      sent !== ''
        ? sentLine(model, h)
        : noteOpen
          ? answerBox(
              model,
              h,
              'Enter in the note adds a line · the answer is picked either way',
            )
          : pick !== ''
            ? h.p(
                [h.Class('h-picked')],
                [
                  `${pick} picked · goes with your next send · `,
                  h.button(
                    [h.Class('g-link'), h.OnClick(Message.SentAnswer({ q }))],
                    [`Send ${pick} now`],
                  ),
                ],
              )
            : h.p(
                [h.Class('hint h-hint')],
                ['Click an answer to pick it, or ✎ to pick it with a note.'],
              ),
    ],
  )
}

start({
  variant: 'board',
  description:
    'G’s page: short answers (✎ = same answer with a note), summary first, trade-offs and table folded, starters send on click. Sessions: pinned, waiting on you, by issue. Step the scenario bottom-left.',
  body: (model, h) =>
    h.div(
      [h.Class('g-body')],
      [
        sidebar(model, h),
        questionPage(model, h, answers),
        sessionsPanel(model, h, {
          grouping: 'work',
          ordering: 'waiting',
          fixed: 'waiting',
          issueOf: ISSUES,
        }),
      ],
    ),
})
