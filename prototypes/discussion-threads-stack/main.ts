// PROTOTYPE D · Thread cards on the question (ask 9656). Every conversation about a question is
// a card pinned under it: the asker's card first, then side threads (the lead, grill-flow…).
// One card is open at a time and carries its own reply box, so where a message goes is where
// you typed it. Direct messages live in a dock at the bottom and open as a drawer.
import type { Html } from 'foldkit/html'

import {
  GENERAL,
  askerThread,
  question,
  session,
  sessions,
  threadAbout,
  threadKey,
  threadWith,
} from '../discussion-threads-shared/data'
import {
  composeBox,
  dot,
  type H,
  lineView,
  linesBox,
  Message,
  type Model,
  start,
  unreadCount,
} from '../discussion-threads-shared/shell'
import './styles.css'

const cardsFor = (model: Model) => {
  const about = model.question
  const keys = Object.keys(model.threads).filter(
    key => threadAbout(key) === about,
  )
  return [
    ...new Set([
      askerThread(about),
      ...keys,
      ...(threadAbout(model.active) === about ? [model.active] : []),
    ]),
  ]
}

const replyBox = (model: Model, key: string, h: H): Html => {
  const who = session(threadWith(key))
  return h.form(
    [h.Class('card-reply'), h.OnSubmit(Message.SentMessage({ key }))],
    [
      composeBox(model, key, `Reply to ${who.name}…`, h),
      h.div(
        [h.Class('send-row')],
        [
          h.span(
            [h.Class('hint')],
            [`Goes to ${who.name} · ${who.address} only`],
          ),
          h.button(
            [
              h.Type('submit'),
              h.Class('send-button'),
              h.Style({ background: who.color }),
            ],
            [`Reply to ${who.name}`],
          ),
        ],
      ),
    ],
  )
}

const card = (model: Model, key: string, h: H): Html => {
  const who = session(threadWith(key))
  const lines = model.threads[key] ?? []
  const open = model.active === key
  const unread = unreadCount(model, key)
  const last = lines.at(-1)
  const asker = key === askerThread(threadAbout(key))
  return h.section(
    [
      h.Class(`card${open ? ' is-open' : ''}`),
      h.Style({ borderLeftColor: who.color }),
    ],
    [
      h.button(
        [
          h.Class('card-head'),
          h.AriaExpanded(open),
          h.OnClick(Message.OpenedThread({ key })),
        ],
        [
          dot(who.color, h),
          h.strong([h.Style({ color: who.color })], [who.name]),
          h.small(
            [],
            [
              asker
                ? 'asked this question'
                : threadAbout(key) === GENERAL
                  ? `direct · ${who.address}`
                  : `${who.role} · ${who.address}`,
            ],
          ),
          h.span(
            [h.Class('card-count')],
            [lines.length === 0 ? 'new' : `${lines.length} messages`],
          ),
          unread > 0
            ? h.span([h.Class('card-badge')], [`${unread} new`])
            : h.empty,
        ],
      ),
      open
        ? h.div(
            [h.Class('card-body')],
            [
              linesBox(
                'card-lines',
                lines.length === 0
                  ? [
                      h.p(
                        [h.Class('empty-thread')],
                        [
                          `Ask ${who.name} about this question. Only ${who.name} sees this card's messages.`,
                        ],
                      ),
                    ]
                  : lines.map(line => lineView(line, h)),
                h,
              ),
              replyBox(model, key, h),
            ],
          )
        : last === undefined
          ? h.empty
          : h.button(
              [h.Class('card-peek'), h.OnClick(Message.OpenedThread({ key }))],
              [`${last.from === 'rob' ? 'You' : who.name}: ${last.text}`],
            ),
    ],
  )
}

const dock = (model: Model, h: H): Html => {
  const direct = Object.keys(model.threads).filter(
    key => threadAbout(key) === GENERAL,
  )
  return h.div(
    [h.Class('dock')],
    [
      h.span([h.Class('dock-title')], ['Direct']),
      ...direct.map(key => {
        const who = session(threadWith(key))
        const unread = unreadCount(model, key)
        return h.button(
          [h.Class('dock-chip'), h.OnClick(Message.OpenedThread({ key }))],
          [
            dot(who.color, h),
            who.name,
            unread > 0
              ? h.span([h.Class('card-badge')], [String(unread)])
              : h.empty,
          ],
        )
      }),
      h.button(
        [
          h.Class('dock-chip dock-new'),
          h.OnClick(
            Message.SetUi({
              name: 'menu',
              value: model.ui.menu === 'direct' ? '' : 'direct',
            }),
          ),
        ],
        ['+ New'],
      ),
      model.ui.menu === 'direct'
        ? h.div(
            [h.Class('chooser dock-chooser')],
            sessions.map(item =>
              h.button(
                [
                  h.Class('chooser-item'),
                  h.OnClick(
                    Message.OpenedThread({
                      key: threadKey(GENERAL, item.address),
                    }),
                  ),
                ],
                [
                  dot(item.color, h),
                  h.span([], [item.name]),
                  h.small([], [item.address]),
                ],
              ),
            ),
          )
        : h.empty,
    ],
  )
}

const lastQuestionCard = (model: Model) =>
  cardsFor(model)
    .map(key => ({
      key,
      id: Math.max(0, ...(model.threads[key] ?? []).map(line => line.id)),
    }))
    .sort((a, b) => b.id - a.id)[0]?.key ?? askerThread(model.question)

const panel = (model: Model, h: H): Html => {
  const about = model.question
  const drawer = threadAbout(model.active) === GENERAL
  return h.aside(
    [h.Class('panel'), h.AriaLabel('Discussion')],
    [
      h.header(
        [h.Class('d-head')],
        [
          h.h2([], [`Conversations about ${about}`]),
          h.span([h.Class('hint')], [question(about).title]),
        ],
      ),
      h.div(
        [h.Class('cards')],
        [
          ...cardsFor(model).map(key => card(model, key, h)),
          h.button(
            [
              h.Class('add-card'),
              h.OnClick(
                Message.SetUi({
                  name: 'menu',
                  value: model.ui.menu === 'here' ? '' : 'here',
                }),
              ),
            ],
            [`+ Ask someone else about ${about}`],
          ),
          model.ui.menu === 'here'
            ? h.div(
                [h.Class('chooser')],
                sessions.map(item =>
                  h.button(
                    [
                      h.Class('chooser-item'),
                      h.OnClick(
                        Message.OpenedThread({
                          key: threadKey(about, item.address),
                        }),
                      ),
                    ],
                    [
                      dot(item.color, h),
                      h.span([], [`${item.name} · ${item.role}`]),
                      h.small([], [item.address]),
                    ],
                  ),
                ),
              )
            : h.empty,
        ],
      ),
      dock(model, h),
      drawer
        ? h.div(
            [h.Class('drawer')],
            [
              h.button(
                [
                  h.Class('drawer-back'),
                  h.OnClick(
                    Message.OpenedThread({ key: lastQuestionCard(model) }),
                  ),
                ],
                [`← Back to ${about}`],
              ),
              card(model, model.active, h),
            ],
          )
        : h.empty,
    ],
  )
}

start({
  variant: 'stack',
  description:
    'Each conversation about a question is a card under it with its own reply box. One card open at a time, remembered per question. Direct messages sit in a dock.',
  panel,
})
