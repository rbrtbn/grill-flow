// PROTOTYPE round 3 (ask 9656): G's question page with Rob's refinements. Short answers in the
// header (plus "Write my own"), a summary-first background whose fold holds the trade-offs and
// a comparison table, quick starters that send on click, and passage threads that stay in the
// conversation when the question is rewritten. Variants supply only the answer controls.
import type { Html } from 'foldkit/html'

import {
  askerThread,
  type Line,
  longProse,
  question,
  session,
  sessions,
  threadAbout,
  threadKey,
  threadWith,
} from './data'
import {
  compares,
  currentLead,
  detailsAt,
  rosterAt,
  summaries,
} from './scenario'
import {
  anchorText,
  composeBox,
  dot,
  type H,
  lineView,
  linkify,
  Message,
  type Model,
  passageThreads,
  proseView,
  unreadCount,
} from './shell'
import './page3.css'

export type AnswerControls = (model: Model, h: H) => Html

const STARTERS: ReadonlyArray<readonly [string, string]> = [
  ['Contextualize this for me', 'Contextualize this for me.'],
  ['Give me an example', 'Give me an example.'],
  ['Compare the choices', 'Compare the choices.'],
  [
    'Ask for a clearer rewrite',
    'Please rewrite this question and its reasoning more clearly.',
  ],
  [
    'What would you pick?',
    'What would you pick, and what would change your mind?',
  ],
]

const paragraphsOf = (model: Model) => {
  const key = model.question
  const details = detailsAt(
    key,
    model.step,
    longProse[key] ?? [question(key).why],
  )
  return { summary: summaries[key] ?? details[0] ?? '', details }
}

const isOrphan = (model: Model, key: string) => {
  const text = anchorText(model, key)
  return (
    text !== '' &&
    !paragraphsOf(model).details.some(paragraph => paragraph.includes(text))
  )
}

const nested = (model: Model, key: string, title: Html, h: H): Html => {
  const who = session(threadWith(key))
  const lines = model.threads[key] ?? []
  const open = model.active === key
  const unread = unreadCount(model, key)
  return h.div(
    [
      h.Class(
        `g-nested${open ? ' is-open' : ''}${unread > 0 ? ' has-unread' : ''}`,
      ),
      h.Style({ borderLeftColor: who.color }),
      h.DataAttribute('thread', key),
    ],
    [
      h.div(
        [h.Class('g-nested-title')],
        [
          title,
          unread > 0
            ? h.span([h.Class('person-badge')], [`${unread} new`])
            : h.empty,
        ],
      ),
      ...(open ? lines : lines.slice(-1)).map(line => lineView(line, h)),
      open
        ? h.form(
            [
              h.Class('g-inline-reply'),
              h.OnSubmit(Message.SentMessage({ key })),
            ],
            [
              composeBox(model, key, `Reply to ${who.name} in this thread…`, h),
              h.div(
                [h.Class('send-row')],
                [
                  h.button(
                    [
                      h.Type('button'),
                      h.Class('g-link'),
                      h.OnClick(
                        Message.OpenedThread({
                          key: askerThread(model.question),
                        }),
                      ),
                    ],
                    ['Collapse'],
                  ),
                  h.button(
                    [
                      h.Type('submit'),
                      h.Class('send-button'),
                      h.Style({ background: who.color }),
                    ],
                    [`Reply to ${who.name} in thread`],
                  ),
                ],
              ),
            ],
          )
        : h.button(
            [h.Class('g-link'), h.OnClick(Message.OpenedThread({ key }))],
            [
              lines.length > 1
                ? `Show all ${lines.length} · reply in thread`
                : 'Reply in thread',
            ],
          ),
    ],
  )
}

const compareTable = (model: Model, h: H): Html => {
  const table = compares[model.question]
  const item = question(model.question)
  if (table === undefined) return h.empty
  const pick = model.ui[`pick:${model.question}`] ?? ''
  return h.table(
    [h.Class('p3-compare')],
    [
      h.thead(
        [],
        [
          h.tr(
            [],
            [
              h.th([], ['']),
              h.th([h.Class('is-now')], [table.now]),
              ...item.options.map(option =>
                h.th(
                  [h.Class(option.key === pick ? 'is-picked' : '')],
                  [`${option.key} · ${option.label}`],
                ),
              ),
            ],
          ),
        ],
      ),
      h.tbody(
        [],
        table.rows.map(row =>
          h.tr(
            [],
            [
              h.th([], [row.label]),
              h.td([h.Class('is-now')], [row.cells.now ?? '']),
              ...item.options.map(option =>
                h.td(
                  [h.Class(option.key === pick ? 'is-picked' : '')],
                  linkify(row.cells[option.key] ?? '', h),
                ),
              ),
            ],
          ),
        ),
      ),
    ],
  )
}

/** Where the asker's thread delivers now: a closed asker's messages go to the lead (ADR 0030). */
const route = (model: Model, address: string) => {
  const closed =
    rosterAt(model.step).find(member => member.address === address)
      ?.terminal === 'closed'
  const lead = currentLead(model.step)
  return closed && lead !== address
    ? {
        to: lead,
        note: `${address} is closed; messages go to the lead, ${lead}`,
      }
    : { to: address, note: '' }
}

export const questionPage = (
  model: Model,
  h: H,
  answers: AnswerControls,
): Html => {
  const item = question(model.question)
  const asker = session(item.asker)
  const routed = route(model, item.asker)
  const main = askerThread(model.question)
  const { summary, details } = paragraphsOf(model)
  const expanded = model.ui[`more:${model.question}`] === 'open'
  const firstId = (key: string) =>
    (model.threads[key] ?? [])[0]?.id ?? Number.MAX_SAFE_INTEGER
  const passages = passageThreads(model, model.question)
  const sides = Object.keys(model.threads)
    .concat(model.active)
    .filter(
      (key, i, all) =>
        all.indexOf(key) === i &&
        threadAbout(key) === model.question &&
        key !== main,
    )
  const items = [
    ...(model.threads[main] ?? []).map((line: Line) => ({
      at: line.id,
      view: lineView(line, h),
    })),
    ...passages.map(entry => {
      const orphan = isOrphan(model, entry.key)
      return {
        at: firstId(entry.key),
        view: nested(
          model,
          entry.key,
          h.span(
            [h.Class(orphan ? 'is-orphan' : '')],
            [
              h.span([h.Class('g-quote-mark')], ['❝']),
              h.em([], [anchorText(model, entry.key)]),
              orphan
                ? h.small(
                    [h.Class('orphan-note')],
                    [
                      ' · this passage changed in revision 2; the thread stays here',
                    ],
                  )
                : h.empty,
            ],
          ),
          h,
        ),
      }
    }),
    ...sides.map(key => {
      const who = session(threadWith(key))
      return {
        at: firstId(key),
        view: nested(
          model,
          key,
          h.span(
            [],
            [
              dot(who.color, h),
              ` Side thread with ${who.name} · ${who.address}`,
            ],
          ),
          h,
        ),
      }
    }),
  ]
  return h.main(
    [h.Class('g-page')],
    [
      h.header(
        [h.Class('g-header')],
        [
          h.p(
            [h.Class('shell-meta')],
            [
              `${item.key} · ${item.round} · asked by ${asker.name} (${asker.address})`,
            ],
          ),
          h.h1([], [item.title]),
          h.p([h.Class('g-ask')], [item.ask]),
          answers(model, h),
        ],
      ),
      h.section(
        [h.Class('g-background')],
        [
          h.h2([], ['Summary']),
          h.p([h.Class('q-prose p3-summary')], linkify(summary, h)),
          h.button(
            [
              h.Class('g-link'),
              h.OnClick(
                Message.SetUi({
                  name: `more:${model.question}`,
                  value: expanded ? '' : 'open',
                }),
              ),
            ],
            [
              expanded
                ? 'Hide trade-offs and details'
                : `Trade-offs and details · comparison table${passages.length > 0 ? ` · ${passages.length} quoted passages` : ''}`,
            ],
          ),
          ...(expanded
            ? [
                h.h3([h.Class('p3-sub')], ['How the answers compare']),
                compareTable(model, h),
                h.h3([h.Class('p3-sub')], ['Details']),
                ...proseView(model, model.question, h, undefined, details),
                h.p(
                  [h.Class('hint')],
                  ['Select a sentence to quote it into a new thread below.'],
                ),
              ]
            : []),
        ],
      ),
      h.section(
        [h.Class('g-timeline')],
        [
          h.h2([], ['Conversation']),
          h.div(
            [h.Class('p3-starters')],
            [
              h.span([h.Class('hint')], [`Ask ${asker.name}, sent on click:`]),
              ...STARTERS.map(([label, text]) =>
                h.button(
                  [
                    h.Class('p3-starter'),
                    h.OnClick(Message.SentText({ key: main, text })),
                  ],
                  [label],
                ),
              ),
            ],
          ),
          ...[...items].sort((a, b) => a.at - b.at).map(entry => entry.view),
          h.button(
            [
              h.Class('g-link g-bring'),
              h.OnClick(
                Message.SetUi({
                  name: 'menu',
                  value: model.ui.menu === 'bring' ? '' : 'bring',
                }),
              ),
            ],
            ['+ Start a side thread with someone else about this question'],
          ),
          model.ui.menu === 'bring'
            ? h.div(
                [h.Class('g-bring-list')],
                sessions.map(person =>
                  h.button(
                    [
                      h.Class('g-bring-item'),
                      h.OnClick(
                        Message.OpenedThread({
                          key: threadKey(model.question, person.address),
                        }),
                      ),
                    ],
                    [
                      dot(person.color, h),
                      h.span([], [`${person.name} · ${person.role}`]),
                      h.small([], [person.address]),
                    ],
                  ),
                ),
              )
            : h.empty,
        ],
      ),
      h.form(
        [
          h.Class('g-compose'),
          h.Style({ borderTopColor: asker.color }),
          h.OnSubmit(Message.SentMessage({ key: main })),
        ],
        [
          h.div(
            [h.Class('g-compose-to')],
            [
              h.span([], ['Reply to']),
              dot(asker.color, h),
              h.strong([], [`${asker.name} · ${routed.to}`]),
              h.small(
                [h.Class(routed.note === '' ? '' : 'p3-routed')],
                [routed.note === '' ? 'asked this question' : routed.note],
              ),
            ],
          ),
          composeBox(model, main, `Reply to ${asker.name}…`, h),
          h.div(
            [h.Class('send-row')],
            [
              h.span(
                [h.Class('hint')],
                ['Thread replies go in their thread above'],
              ),
              h.button(
                [
                  h.Type('submit'),
                  h.Class('send-button'),
                  h.Style({ background: asker.color }),
                ],
                [`Send to ${asker.name}`],
              ),
            ],
          ),
        ],
      ),
    ],
  )
}

/** The note or own-answer box under the answers, shared by both answer styles. */
export const answerBox = (model: Model, h: H, focusHint: string): Html => {
  const q = model.question
  const pick = model.ui[`pick:${q}`] ?? ''
  const own = pick === 'own'
  const label = own
    ? 'your own answer'
    : (question(q).options.find(option => option.key === pick)?.label ?? '')
  return h.form(
    [h.Class('p3-note'), h.OnSubmit(Message.SentAnswer({ q }))],
    [
      h.keyed('textarea')(`note-${q}`, [
        h.Class('compose-box note-box'),
        h.Rows(own ? 3 : 2),
        h.Value(model.drafts[`note:${q}`] ?? ''),
        h.Placeholder(
          own
            ? 'Write your answer…'
            : `Add a note to ${pick} · ${label} (optional)…`,
        ),
        h.OnInput(value => Message.UpdatedDraft({ key: `note:${q}`, value })),
      ]),
      h.div(
        [h.Class('send-row')],
        [
          h.span([h.Class('hint')], [focusHint]),
          h.button(
            [h.Type('submit'), h.Class('send-button')],
            [
              own
                ? 'Send my answer'
                : `Send ${pick}${(model.drafts[`note:${q}`] ?? '').trim() === '' ? '' : ' with note'}`,
            ],
          ),
        ],
      ),
    ],
  )
}

export const sentLine = (model: Model, h: H): Html => {
  const q = model.question
  const sent = model.ui[`sent:${q}`] ?? ''
  if (sent === '') return h.empty
  const option = question(q).options.find(item => item.key === sent)
  const note = model.ui[`sentNote:${q}`] ?? ''
  return h.p(
    [h.Class('p3-sent')],
    [
      h.strong(
        [],
        [
          sent === 'own'
            ? 'Sent your own answer'
            : `Sent ${sent} · ${option?.label ?? ''}`,
        ],
      ),
      note === '' ? '' : ` with note: “${note}”`,
      ' · ',
      h.button(
        [
          h.Class('g-link'),
          h.OnClick(Message.SetUi({ name: `sent:${q}`, value: '' })),
        ],
        ['Change'],
      ),
    ],
  )
}
