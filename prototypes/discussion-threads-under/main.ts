// PROTOTYPE E · Conversation under the question (ask 9656, round 2). The question page holds
// every conversation about the question: a thread on a quoted passage opens right under its
// paragraph, and the conversation with the asker runs under the answers. The right-hand panel
// is only for sessions you message outside a question: pinned, recent, then a directory by
// squad with what each session works on, and search.
import type { Html } from 'foldkit/html'

import {
  askerThread,
  longProse,
  question,
  roster,
  session,
  sessions,
  threadAbout,
  threadKey,
  threadWith,
} from '../discussion-threads-shared/data'
import {
  directThreads,
  matches,
  personRow,
  searchBox,
  sideThread,
} from '../discussion-threads-shared/people'
import {
  anchorText,
  composeBox,
  dot,
  type H,
  lineView,
  Message,
  type Model,
  passageThreads,
  proseView,
  sidebar,
  start,
  unreadCount,
} from '../discussion-threads-shared/shell'
import '../discussion-threads-shared/people.css'
import './styles.css'

const reply = (model: Model, key: string, label: string, h: H): Html => {
  const who = session(threadWith(key))
  return h.form(
    [h.Class('e-reply'), h.OnSubmit(Message.SentMessage({ key }))],
    [
      composeBox(model, key, `${label}…`, h),
      h.div(
        [h.Class('send-row')],
        [
          h.span(
            [h.Class('hint')],
            [
              `Goes to ${who.name} · ${who.address}, with the question attached`,
            ],
          ),
          h.button(
            [
              h.Type('submit'),
              h.Class('send-button'),
              h.Style({ background: who.color }),
            ],
            [label],
          ),
        ],
      ),
    ],
  )
}

const passageBlock = (model: Model, key: string, h: H): Html => {
  const lines = model.threads[key] ?? []
  const open = model.active === key
  const who = session(threadWith(key))
  const unread = unreadCount(model, key)
  return h.div(
    [
      h.Class(`e-passage${open ? ' is-open' : ''}`),
      h.DataAttribute('thread', key),
    ],
    [
      h.button(
        [
          h.Class('e-passage-head'),
          h.OnClick(
            Message.OpenedThread({
              key: open ? askerThread(model.question) : key,
            }),
          ),
        ],
        [
          h.span([h.Class('e-quote')], [`“${anchorText(model, key)}”`]),
          h.small(
            [],
            [
              `${lines.length === 0 ? 'new thread' : `${lines.length} messages`} with ${who.name}`,
              unread > 0 ? ` · ${unread} new` : '',
              open ? ' · close' : '',
            ],
          ),
        ],
      ),
      open
        ? h.div(
            [h.Class('e-passage-body')],
            [
              ...lines.map(line => lineView(line, h)),
              reply(model, key, `Reply to ${who.name} on this passage`, h),
            ],
          )
        : h.empty,
    ],
  )
}

const questionPage = (model: Model, h: H): Html => {
  const item = question(model.question)
  const asker = session(item.asker)
  const main = askerThread(model.question)
  const paragraphs = proseView(model, model.question, h)
  const texts = longProse[model.question] ?? [item.why]
  const passages = passageThreads(model, model.question)
  const mainLines = model.threads[main] ?? []
  const sides = Object.keys(model.threads)
    .concat(model.active)
    .filter(
      (key, i, all) =>
        all.indexOf(key) === i &&
        threadAbout(key) === model.question &&
        key !== main,
    )
  return h.main(
    [h.Class('e-page')],
    [
      h.div(
        [h.Class('e-jump')],
        [
          h.strong([], [item.key]),
          h.a(
            [h.Href('#conversation')],
            [`Conversation with ${asker.name} · ${mainLines.length}`],
          ),
          h.span([], [`${passages.length} passage threads`]),
          h.a([h.Href('#answer')], ['Answer']),
        ],
      ),
      h.p(
        [h.Class('shell-meta')],
        [`${item.round} · asked by ${asker.name} (${asker.address})`],
      ),
      h.h1([], [item.title]),
      ...paragraphs.flatMap((paragraph, index) => [
        paragraph,
        ...passages
          .filter(entry => (texts[index] ?? '').includes(entry.anchor.text))
          .map(entry => passageBlock(model, entry.key, h)),
      ]),
      h.p(
        [h.Class('hint e-tip')],
        ['Select any sentence above to start a thread on it.'],
      ),
      h.p([h.Class('shell-ask'), h.Id('answer')], [item.ask]),
      h.div(
        [h.Class('shell-options')],
        item.options.map(option =>
          h.button(
            [h.Class('shell-option')],
            [
              h.strong([], [`${option.key} · ${option.label}`]),
              h.span([], [option.effect]),
            ],
          ),
        ),
      ),
      h.section(
        [
          h.Class('e-conversation'),
          h.Id('conversation'),
          h.Style({ borderTopColor: asker.color }),
        ],
        [
          h.h2(
            [],
            [
              dot(asker.color, h),
              `Conversation with ${asker.name}`,
              h.small([], [` · asked this question · ${asker.address}`]),
            ],
          ),
          ...mainLines.map(line => lineView(line, h)),
          reply(model, main, `Send to ${asker.name}`, h),
        ],
      ),
      ...sides.map(key => {
        const who = session(threadWith(key))
        return h.section(
          [
            h.Class('e-conversation is-side'),
            h.Style({ borderTopColor: who.color }),
          ],
          [
            h.h2(
              [],
              [
                dot(who.color, h),
                `${who.name} about this question`,
                h.small([], [` · ${who.address}`]),
              ],
            ),
            ...(model.threads[key] ?? []).map(line => lineView(line, h)),
            reply(model, key, `Send to ${who.name}`, h),
          ],
        )
      }),
      h.button(
        [
          h.Class('e-add'),
          h.OnClick(
            Message.SetUi({
              name: 'menu',
              value: model.ui.menu === 'bring' ? '' : 'bring',
            }),
          ),
        ],
        ['+ Ask someone else about this question'],
      ),
      model.ui.menu === 'bring'
        ? h.div(
            [h.Class('e-bring')],
            sessions.map(person =>
              h.button(
                [
                  h.Class('e-bring-item'),
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
  )
}

const directory = (model: Model, h: H): Html => {
  const query = model.ui.query ?? ''
  const pinned = ['t2hw', 't2cr']
  const recent = directThreads(model)
    .map(threadWith)
    .filter(address => !pinned.includes(address))
  const squads = [...new Set(roster.map(item => item.squad))].filter(
    squad => squad !== 'Tools',
  )
  if (query.trim() !== '') {
    const found = roster.filter(item => matches(item, query))
    return h.div(
      [h.Class('people-list')],
      [
        h.p([h.Class('people-title')], [`${found.length} matching “${query}”`]),
        ...found.map(item =>
          personRow(
            model,
            item.address,
            h,
            `${item.squad} · ${item.role} · ${item.issue} ${item.work}`,
          ),
        ),
      ],
    )
  }
  return h.div(
    [h.Class('people-list')],
    [
      h.p([h.Class('people-title')], ['Pinned']),
      ...pinned.map(address => personRow(model, address, h)),
      recent.length === 0
        ? h.empty
        : h.p([h.Class('people-title')], ['Recent']),
      ...recent.map(address => personRow(model, address, h)),
      ...squads.flatMap(squad => {
        const folded =
          (model.ui[`fold-${squad}`] ??
            (squad === 'Efficiency' ? '' : 'yes')) === 'yes'
        const members = roster.filter(item => item.squad === squad)
        return [
          h.button(
            [
              h.Class('people-title people-fold'),
              h.OnClick(
                Message.SetUi({
                  name: `fold-${squad}`,
                  value: folded ? '' : 'yes',
                }),
              ),
            ],
            [`${folded ? '▸' : '▾'} ${squad} squad · ${members.length}`],
          ),
          ...(folded
            ? []
            : [...members]
                .sort(
                  (a, b) => Number(b.lead ?? false) - Number(a.lead ?? false),
                )
                .map(item =>
                  personRow(
                    model,
                    item.address,
                    h,
                    `${item.role} · ${item.issue} · ${item.work}`,
                  ),
                )),
        ]
      }),
    ],
  )
}

const messages = (model: Model, h: H): Html => {
  const side = model.ui.side ?? ''
  return h.aside(
    [h.Class('panel e-messages'), h.AriaLabel('Messages')],
    side === ''
      ? [
          h.header(
            [h.Class('people-head')],
            [
              h.h2([], ['Messages']),
              h.small([], ['Sessions outside this question']),
            ],
          ),
          searchBox(model, 'Find a session: name, issue, work, t2…', h),
          directory(model, h),
        ]
      : [
          sideThread(
            model,
            side,
            h,
            Message.SetUi({ name: 'side', value: '' }),
            'All sessions',
          ),
        ],
  )
}

start({
  variant: 'under',
  description:
    'Question conversations live on the question page: passage threads under their paragraph, the asker conversation under the answers. The panel is a directory of sessions.',
  body: (model, h) =>
    h.div(
      [h.Class('e-body')],
      [sidebar(model, h), questionPage(model, h), messages(model, h)],
    ),
})
