// PROTOTYPE B · One addressed timeline (ask 9656). Everything said about a question, to
// anyone, reads as one conversation in time order; each message names who it went to. The
// composer's recipient chips decide who the next message goes to, and "Reply" on any message
// picks its sender. Direct messages (not about a question) sit behind a second tab.
import type { Html } from 'foldkit/html'

import {
  GENERAL,
  askerThread,
  type Line,
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

const aboutThis = (model: Model) =>
  Object.keys(model.threads).filter(key => threadAbout(key) === model.question)

const directThreads = (model: Model) =>
  Object.keys(model.threads).filter(key => threadAbout(key) === GENERAL)

/** The question tab reopens the last person you addressed about it. */
const lastQuestionThread = (model: Model) => {
  const keys = aboutThis(model)
  const latest = keys
    .map(key => ({
      key,
      id: Math.max(
        0,
        ...(model.threads[key] ?? [])
          .filter(l => l.from === 'rob')
          .map(l => l.id),
      ),
    }))
    .sort((a, b) => b.id - a.id)[0]
  return latest === undefined || latest.id === 0
    ? askerThread(model.question)
    : latest.key
}

const timelineLine = (model: Model, key: string, line: Line, h: H): Html => {
  const who = session(threadWith(key))
  return h.div(
    [
      h.Class(`t-line${line.from === 'rob' ? ' is-mine' : ''}`),
      h.Style({ borderLeftColor: who.color }),
    ],
    [
      lineView(line, h, who.name),
      line.from === 'rob' ||
      (model.threads[key] ?? []).filter(item => item.from !== 'rob').at(-1)
        ?.id !== line.id
        ? h.empty
        : h.button(
            [
              h.Class(`t-reply${model.active === key ? ' is-current' : ''}`),
              h.OnClick(Message.OpenedThread({ key })),
            ],
            [
              model.active === key
                ? `Replying to ${who.name}`
                : `Reply to ${who.name}`,
            ],
          ),
    ],
  )
}

const chip = (model: Model, key: string, label: string, h: H): Html => {
  const who = session(threadWith(key))
  const active = model.active === key
  const unread = unreadCount(model, key)
  return h.button(
    [
      h.Class(`chip${active ? ' is-active' : ''}`),
      h.Style(
        active
          ? { background: who.color, borderColor: who.color }
          : { borderColor: `${who.color}66` },
      ),
      h.AriaPressed(String(active)),
      h.OnClick(Message.OpenedThread({ key })),
    ],
    [
      active ? h.empty : dot(who.color, h),
      h.span([], [label]),
      unread > 0 ? h.span([h.Class('chip-badge')], [String(unread)]) : h.empty,
    ],
  )
}

const someoneElse = (model: Model, about: string, h: H): Html =>
  h.div(
    [h.Class('else')],
    [
      h.button(
        [
          h.Class('chip chip-more'),
          h.OnClick(
            Message.SetUi({
              name: 'menu',
              value: model.ui.menu === 'open' ? '' : 'open',
            }),
          ),
        ],
        ['@ Someone else ▾'],
      ),
      model.ui.menu === 'open'
        ? h.div(
            [h.Class('else-menu')],
            sessions.map(item =>
              h.button(
                [
                  h.Class('else-item'),
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
  )

const panel = (model: Model, h: H): Html => {
  const direct = threadAbout(model.active) === GENERAL
  const key = model.active
  const who = session(threadWith(key))
  const about = model.question
  const lines = direct
    ? (model.threads[key] ?? []).map(line => ({ key, line }))
    : aboutThis(model)
        .flatMap(item =>
          (model.threads[item] ?? []).map(line => ({ key: item, line })),
        )
        .sort((a, b) => a.line.id - b.line.id)
  const recipientKeys = direct
    ? directThreads(model)
    : [...new Set([askerThread(about), ...aboutThis(model), key])]
  const directUnread = directThreads(model).reduce(
    (sum, item) => sum + unreadCount(model, item),
    0,
  )
  return h.aside(
    [h.Class('panel'), h.AriaLabel('Discussion')],
    [
      h.header(
        [h.Class('t-head')],
        [
          h.button(
            [
              h.Class(`seg${direct ? '' : ' is-active'}`),
              h.OnClick(
                Message.OpenedThread({ key: lastQuestionThread(model) }),
              ),
            ],
            [`About ${about}`],
          ),
          h.button(
            [
              h.Class(`seg${direct ? ' is-active' : ''}`),
              h.OnClick(
                Message.OpenedThread({
                  key: directThreads(model)[0] ?? threadKey(GENERAL, 't2cr'),
                }),
              ),
            ],
            [
              `Direct messages${directUnread > 0 ? ` · ${directUnread} new` : ''}`,
            ],
          ),
        ],
      ),
      direct
        ? h.p(
            [h.Class('t-sub')],
            ['One conversation per person, outside any question.'],
          )
        : h.p(
            [h.Class('t-sub')],
            [
              `Everything said about “${question(about).title}”, to anyone, in order.`,
            ],
          ),
      linesBox(
        't-lines',
        lines.length === 0
          ? [
              h.p(
                [h.Class('empty-thread')],
                [`Nothing yet. Your first message goes to ${who.name}.`],
              ),
            ]
          : lines.map(item => timelineLine(model, item.key, item.line, h)),
        h,
      ),
      h.form(
        [h.Class('t-compose'), h.OnSubmit(Message.SentMessage({ key }))],
        [
          h.div(
            [h.Class('chips')],
            [
              h.span([h.Class('to-word')], ['To']),
              ...recipientKeys.map(item =>
                chip(
                  model,
                  item,
                  item === askerThread(about) && !direct
                    ? `${session(threadWith(item)).name} · asked this`
                    : session(threadWith(item)).name,
                  h,
                ),
              ),
              someoneElse(model, direct ? GENERAL : about, h),
            ],
          ),
          h.div(
            [h.Class('t-box'), h.Style({ borderColor: who.color })],
            [
              composeBox(
                model,
                key,
                `@${who.name}: ask, push back, or ask for a rewrite…`,
                h,
              ),
            ],
          ),
          h.div(
            [h.Class('send-row')],
            [
              h.span(
                [h.Class('hint')],
                [
                  direct
                    ? `Direct to ${who.address}`
                    : `${who.address} sees this question with your message`,
                ],
              ),
              h.button(
                [
                  h.Type('submit'),
                  h.Class('send-button'),
                  h.Style({ background: who.color }),
                ],
                [`Send to @${who.name}`],
              ),
            ],
          ),
        ],
      ),
    ],
  )
}

start({
  variant: 'timeline',
  description:
    'One conversation per question: every message names its recipient, replies interleave. Recipient chips stay on the last person you addressed here.',
  panel,
})
