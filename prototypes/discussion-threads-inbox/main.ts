// PROTOTYPE C · Thread list beside the panel (ask 9656). A wider panel splits into an inbox of
// threads and the open thread. The current question's threads sit on top, then direct threads,
// then other questions' threads with activity. Switching questions reorders the list and
// reopens the thread you last used on that question.
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

const lastLine = (model: Model, key: string) =>
  (model.threads[key] ?? []).at(-1)

const row = (
  model: Model,
  key: string,
  label: string,
  h: H,
  sub?: string,
): Html => {
  const who = session(threadWith(key))
  const last = lastLine(model, key)
  const unread = unreadCount(model, key)
  const otherQuestion =
    threadAbout(key) !== GENERAL && threadAbout(key) !== model.question
  return h.button(
    [
      h.Class(
        `row${model.active === key ? ' is-active' : ''}${unread > 0 ? ' is-unread' : ''}`,
      ),
      h.Style(
        model.active === key ? { boxShadow: `inset 3px 0 0 ${who.color}` } : {},
      ),
      h.OnClick(
        otherQuestion
          ? Message.OpenedQuestionThread({ key })
          : Message.OpenedThread({ key }),
      ),
    ],
    [
      h.span(
        [h.Class('row-top')],
        [
          dot(who.color, h),
          h.strong([], [label]),
          unread > 0
            ? h.span([h.Class('row-badge')], [String(unread)])
            : h.empty,
        ],
      ),
      sub === undefined ? h.empty : h.small([h.Class('row-sub')], [sub]),
      last === undefined
        ? h.small([h.Class('row-last')], ['New thread'])
        : h.small(
            [h.Class('row-last')],
            [`${last.from === 'rob' ? 'You: ' : ''}${last.text}`],
          ),
    ],
  )
}

const picker = (model: Model, name: string, about: string, h: H): Html =>
  model.ui.menu === name
    ? h.div(
        [h.Class('picker')],
        sessions.map(item =>
          h.button(
            [
              h.Class('picker-item'),
              h.OnClick(
                Message.OpenedThread({ key: threadKey(about, item.address) }),
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
    : h.empty

const list = (model: Model, h: H): Html => {
  const keys = Object.keys(model.threads)
  const about = model.question
  const here = [
    ...new Set([
      askerThread(about),
      ...keys.filter(key => threadAbout(key) === about),
    ]),
  ]
  if (threadAbout(model.active) === about && !here.includes(model.active))
    here.push(model.active)
  const direct = keys.filter(key => threadAbout(key) === GENERAL)
  if (threadAbout(model.active) === GENERAL && !direct.includes(model.active))
    direct.push(model.active)
  const elsewhere = keys
    .filter(key => threadAbout(key) !== GENERAL && threadAbout(key) !== about)
    .sort(
      (a, b) =>
        unreadCount(model, b) - unreadCount(model, a) ||
        (lastLine(model, b)?.id ?? 0) - (lastLine(model, a)?.id ?? 0),
    )
  const toggle = (name: string) =>
    Message.SetUi({ name: 'menu', value: model.ui.menu === name ? '' : name })
  return h.nav(
    [h.Class('inbox'), h.AriaLabel('Threads')],
    [
      h.p([h.Class('inbox-title')], [`This question · ${about}`]),
      ...here.map(key =>
        row(
          model,
          key,
          key === askerThread(about)
            ? `${session(threadWith(key)).name} · asked this`
            : session(threadWith(key)).name,
          h,
        ),
      ),
      h.button(
        [h.Class('row-add'), h.OnClick(toggle('here'))],
        ['+ Ask someone else about this'],
      ),
      picker(model, 'here', about, h),
      h.p([h.Class('inbox-title')], ['Direct']),
      ...direct.map(key => row(model, key, session(threadWith(key)).name, h)),
      h.button(
        [h.Class('row-add'), h.OnClick(toggle('direct'))],
        ['+ New direct message'],
      ),
      picker(model, 'direct', GENERAL, h),
      elsewhere.length === 0
        ? h.empty
        : h.p([h.Class('inbox-title')], ['Other questions']),
      ...elsewhere.map(key =>
        row(
          model,
          key,
          session(threadWith(key)).name,
          h,
          `about ${threadAbout(key)}`,
        ),
      ),
    ],
  )
}

const panel = (model: Model, h: H): Html => {
  const key = model.active
  const who = session(threadWith(key))
  const about = threadAbout(key)
  const lines = model.threads[key] ?? []
  return h.aside(
    [h.Class('panel'), h.AriaLabel('Discussion')],
    [
      h.div(
        [h.Class('split')],
        [
          list(model, h),
          h.section(
            [h.Class('thread')],
            [
              h.header(
                [h.Class('who-card'), h.Style({ borderTopColor: who.color })],
                [
                  h.span(
                    [h.Class('avatar'), h.Style({ background: who.color })],
                    [who.name.slice(0, 1)],
                  ),
                  h.div(
                    [],
                    [
                      h.strong([], [who.name]),
                      h.small([], [`${who.role} · ${who.address}`]),
                      h.span(
                        [h.Class('who-about')],
                        [
                          about === GENERAL
                            ? 'Direct thread, not about a question'
                            : `About ${about} · ${question(about).title}`,
                        ],
                      ),
                    ],
                  ),
                ],
              ),
              linesBox(
                '',
                lines.length === 0
                  ? [
                      h.p(
                        [h.Class('empty-thread')],
                        [
                          `Start a thread with ${who.name}. It stays in the list on the left.`,
                        ],
                      ),
                    ]
                  : lines.map(line => lineView(line, h)),
                h,
              ),
              h.form(
                [
                  h.Class('c-compose'),
                  h.OnSubmit(Message.SentMessage({ key })),
                ],
                [
                  composeBox(model, key, `Message ${who.name}…`, h),
                  h.div(
                    [h.Class('send-row')],
                    [
                      h.span(
                        [h.Class('hint')],
                        [`To ${who.name} · ${who.address}`],
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
          ),
        ],
      ),
    ],
  )
}

start({
  variant: 'inbox',
  description:
    'A wider panel: thread list on the left (this question first, then direct, then other questions), the open thread on the right. Each question reopens its last thread.',
  panel,
  panelClass: 'wide-panel',
})
