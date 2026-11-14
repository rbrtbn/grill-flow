import type { Html } from 'foldkit/html'

// PROTOTYPE A · Thread tabs (ask 9656). Each question shows its own row of thread tabs: the
// asker first, then anyone else you talked to about it, then your recent direct threads. The
// tab you used last is the one the question reopens. "+" reaches everyone else.
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

const tabsFor = (model: Model): ReadonlyArray<string> => {
  const about = model.question
  const keys = Object.keys(model.threads)
  const aboutThis = keys.filter(
    key => threadAbout(key) === about && key !== askerThread(about),
  )
  const direct = keys.filter(key => threadAbout(key) === GENERAL)
  const extra = model.active
  return [
    ...new Set([askerThread(about), ...aboutThis, ...direct, extra]),
  ].filter(key => threadAbout(key) === about || threadAbout(key) === GENERAL)
}

const tab = (model: Model, key: string, h: H): Html => {
  const who = session(threadWith(key))
  const asker = key === askerThread(model.question)
  const unread = unreadCount(model, key)
  const active = key === model.active
  return h.button(
    [
      h.Class(
        `tab${active ? ' is-active' : ''}${threadAbout(key) === GENERAL ? ' is-direct' : ''}`,
      ),
      h.Style(active ? { borderColor: who.color, color: who.color } : {}),
      h.OnClick(Message.OpenedThread({ key })),
      h.Title(
        threadAbout(key) === GENERAL
          ? `Direct thread with ${who.name} (${who.address}), not about a question`
          : `${who.name} (${who.address}) about ${model.question}`,
      ),
    ],
    [
      dot(who.color, h),
      h.span([], [asker ? `${who.name} · asked this` : who.name]),
      threadAbout(key) === GENERAL ? h.small([], ['direct']) : h.empty,
      unread > 0 ? h.span([h.Class('tab-badge')], [String(unread)]) : h.empty,
    ],
  )
}

const addMenu = (model: Model, h: H): Html =>
  model.ui.menu === 'open'
    ? h.div(
        [h.Class('add-menu')],
        [
          h.p([h.Class('add-title')], [`Ask someone about ${model.question}`]),
          ...sessions.map(item =>
            h.button(
              [
                h.Class('add-item'),
                h.OnClick(
                  Message.OpenedThread({
                    key: threadKey(model.question, item.address),
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
          h.p(
            [h.Class('add-title')],
            ['Or message directly, not about this question'],
          ),
          ...sessions.map(item =>
            h.button(
              [
                h.Class('add-item'),
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
        ],
      )
    : h.empty

const panel = (model: Model, h: H): Html => {
  const key = model.active
  const who = session(threadWith(key))
  const about = threadAbout(key)
  const lines = model.threads[key] ?? []
  return h.aside(
    [h.Class('panel'), h.AriaLabel('Discussion')],
    [
      h.header(
        [h.Class('tabs-head')],
        [
          h.h2([], ['Discussion']),
          h.span([h.Class('hint')], [question(model.question).title]),
        ],
      ),
      h.div(
        [h.Class('tabs'), h.Role('tablist')],
        [
          ...tabsFor(model).map(item => tab(model, item, h)),
          h.button(
            [
              h.Class('tab tab-add'),
              h.AriaLabel('Message someone else'),
              h.OnClick(
                Message.SetUi({
                  name: 'menu',
                  value: model.ui.menu === 'open' ? '' : 'open',
                }),
              ),
            ],
            ['+'],
          ),
        ],
      ),
      addMenu(model, h),
      linesBox(
        '',
        lines.length === 0
          ? [
              h.p(
                [h.Class('empty-thread')],
                [
                  about === GENERAL
                    ? `A new direct thread with ${who.name}. It stays in your tabs on every question.`
                    : `A new thread with ${who.name} about ${about}. It stays on this question's tabs.`,
                ],
              ),
            ]
          : lines.map(line => lineView(line, h)),
        h,
      ),
      h.form(
        [
          h.Class('compose'),
          h.Style({ borderTopColor: who.color }),
          h.OnSubmit(Message.SentMessage({ key })),
        ],
        [
          h.div(
            [
              h.Class('to-bar'),
              h.Style({ background: `${who.color}14`, color: who.color }),
            ],
            [
              h.span([h.Class('to-word')], ['To']),
              dot(who.color, h),
              h.strong([], [`${who.name} · ${who.address}`]),
              h.span(
                [h.Class('to-about')],
                [
                  about === GENERAL
                    ? 'direct, not about a question'
                    : `about ${about}`,
                ],
              ),
            ],
          ),
          composeBox(model, key, `Message ${who.name}…`, h),
          h.div(
            [h.Class('send-row')],
            [
              h.span(
                [h.Class('hint')],
                ['Enter sends · this question reopens on this tab'],
              ),
              h.button(
                [
                  h.Type('submit'),
                  h.Class('send-button'),
                  h.Style({ background: who.color }),
                ],
                [`Send to ${who.name}`],
              ),
            ],
          ),
        ],
      ),
    ],
  )
}

start({
  variant: 'tabs',
  description:
    'Tabs per question: the asker first, then others about this question, then recent direct threads. The tab you used last is remembered per question.',
  panel,
})
