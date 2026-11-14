// PROTOTYPE F · Margin threads + message palette (ask 9656, round 2). The question reads in
// one column; its conversations sit in a margin beside it, like comments on a document: the
// asker's thread pinned on top, then one card per quoted passage. There is no sessions
// sidebar: "Message…" (⌘K) opens a palette that finds any session by name, issue or work,
// and the conversation opens as a chat window that stays put while you change questions.
import { Option } from 'effect'
import type { Html } from 'foldkit/html'

import {
  askerThread,
  question,
  roster,
  session,
  threadWith,
} from '../discussion-threads-shared/data'
import {
  directThreads,
  dmKey,
  matches,
  member,
  sideThread,
  stateDot,
} from '../discussion-threads-shared/people'
import {
  anchorText,
  composeBox,
  dot,
  type H,
  lineView,
  linesBox,
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

const marginCard = (
  model: Model,
  key: string,
  title: Html,
  h: H,
  pinned = false,
): Html => {
  const who = session(threadWith(key))
  const lines = model.threads[key] ?? []
  const open = model.active === key
  const unread = unreadCount(model, key)
  const last = lines.at(-1)
  return h.section(
    [
      h.Class(`m-card${open ? ' is-open' : ''}${pinned ? ' is-pinned' : ''}`),
      h.Style({ borderLeftColor: who.color }),
      h.DataAttribute('thread', key),
    ],
    [
      h.button(
        [h.Class('m-card-head'), h.OnClick(Message.OpenedThread({ key }))],
        [
          title,
          h.small(
            [],
            [
              `${who.name} · ${lines.length === 0 ? 'new' : `${lines.length} messages`}${unread > 0 ? ` · ${unread} new` : ''}`,
            ],
          ),
          !open && last !== undefined
            ? h.span(
                [h.Class('m-peek')],
                [`${last.from === 'rob' ? 'You' : who.name}: ${last.text}`],
              )
            : h.empty,
        ],
      ),
      open
        ? h.div(
            [h.Class('m-card-body')],
            [
              linesBox(
                'm-lines',
                lines.map(line => lineView(line, h)),
                h,
              ),
              h.form(
                [h.Class('m-reply'), h.OnSubmit(Message.SentMessage({ key }))],
                [
                  composeBox(model, key, `Reply to ${who.name}…`, h),
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
        : h.empty,
    ],
  )
}

const page = (model: Model, h: H): Html => {
  const item = question(model.question)
  const asker = session(item.asker)
  const main = askerThread(model.question)
  const totalUnread = directThreads(model).reduce(
    (sum, key) => sum + unreadCount(model, key),
    0,
  )
  return h.div(
    [h.Class('m-page')],
    [
      h.div(
        [h.Class('m-topbar')],
        [
          h.span([h.Class('m-key')], [item.key]),
          h.button(
            [
              h.Class('m-message'),
              h.OnClick(Message.SetUi({ name: 'palette', value: 'open' })),
            ],
            [
              'Message…',
              h.kbd([], ['⌘K']),
              totalUnread > 0
                ? h.span([h.Class('person-badge')], [String(totalUnread)])
                : h.empty,
            ],
          ),
        ],
      ),
      h.div(
        [h.Class('m-grid')],
        [
          h.article(
            [h.Class('m-read')],
            [
              h.p(
                [h.Class('shell-meta')],
                [`${item.round} · asked by ${asker.name} (${asker.address})`],
              ),
              h.h1([], [item.title]),
              ...proseView(model, model.question, h),
              h.p(
                [h.Class('hint m-tip')],
                ['Select any sentence to start a thread on it in the margin.'],
              ),
              h.p([h.Class('shell-ask')], [item.ask]),
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
            ],
          ),
          h.aside(
            [
              h.Class('m-margin'),
              h.AriaLabel('Conversations on this question'),
            ],
            [
              marginCard(
                model,
                main,
                h.strong(
                  [],
                  [dot(asker.color, h), `${asker.name} · asked this`],
                ),
                h,
                true,
              ),
              ...passageThreads(model, model.question).map(entry =>
                marginCard(
                  model,
                  entry.key,
                  h.span(
                    [h.Class('m-quote')],
                    [`“${anchorText(model, entry.key)}”`],
                  ),
                  h,
                ),
              ),
            ],
          ),
        ],
      ),
    ],
  )
}

const palette = (model: Model, h: H): Html => {
  if (model.ui.palette !== 'open') return h.empty
  const query = model.ui.query ?? ''
  const recent = directThreads(model).map(threadWith)
  const found = roster.filter(item => matches(item, query))
  const row = (address: string, hint: string) => {
    const who = session(address)
    const info = member(address)
    const unread = unreadCount(model, dmKey(address))
    return h.button(
      [
        h.Class('p-row'),
        h.OnClick(Message.OpenedSide({ key: dmKey(address) })),
      ],
      [
        h.span(
          [h.Class('person-avatar'), h.Style({ background: who.color })],
          [who.name.slice(0, 1)],
        ),
        h.strong([], [who.name]),
        info === undefined ? h.empty : stateDot(info, h),
        h.small([], [hint]),
        unread > 0
          ? h.span([h.Class('person-badge')], [String(unread)])
          : h.empty,
        h.small([h.Class('person-addr')], [address]),
      ],
    )
  }
  return h.div(
    [h.Class('p-layer')],
    [
      h.div(
        [
          h.Class('p-backdrop'),
          h.OnClick(Message.SetUi({ name: 'palette', value: '' })),
        ],
        [],
      ),
      h.div(
        [h.Class('p-box')],
        [
          h.input([
            h.Class('p-input'),
            h.Type('search'),
            h.Autofocus(true),
            h.Value(query),
            h.Placeholder(
              'Message… name, issue (LAB-1412), work, squad or t2…',
            ),
            h.OnInput(value => Message.SetUi({ name: 'query', value })),
            h.OnKeyDownPreventDefault(key =>
              key === 'Enter' && found[0] !== undefined
                ? Option.some(
                    Message.OpenedSide({ key: dmKey(found[0].address) }),
                  )
                : Option.none(),
            ),
          ]),
          query.trim() === ''
            ? h.div(
                [h.Class('p-list')],
                [
                  h.p([h.Class('people-title')], ['Recent']),
                  ...recent.map(address =>
                    row(
                      address,
                      model.threads[dmKey(address)]?.at(-1)?.text ?? '',
                    ),
                  ),
                  h.p([h.Class('people-title')], ['Waiting on you']),
                  ...roster
                    .filter(item => item.state === 'waiting')
                    .map(item =>
                      row(item.address, `${item.issue} · ${item.work}`),
                    ),
                  h.p([h.Class('people-title')], ['Everyone · type to filter']),
                  ...roster
                    .filter(item => !recent.includes(item.address))
                    .map(item =>
                      row(
                        item.address,
                        `${item.squad} · ${item.role} · ${item.work}`,
                      ),
                    ),
                ],
              )
            : h.div(
                [h.Class('p-list')],
                found.length === 0
                  ? [h.p([h.Class('empty-thread')], ['No session matches.'])]
                  : found.map(item =>
                      row(
                        item.address,
                        `${item.squad} · ${item.role} · ${item.issue} ${item.work}`,
                      ),
                    ),
              ),
          h.p(
            [h.Class('hint p-foot')],
            ['Enter opens the first match · Esc closes'],
          ),
        ],
      ),
    ],
  )
}

const chatWindow = (model: Model, h: H): Html => {
  const side = model.ui.side ?? ''
  const known = directThreads(model)
  const open = (known.includes(side) ? known : [side, ...known]).slice(0, 4)
  return side === ''
    ? h.empty
    : h.div(
        [h.Class('m-chat')],
        [
          h.div(
            [h.Class('m-chat-tabs')],
            [
              ...open.map(key => {
                const who = session(threadWith(key))
                return h.button(
                  [
                    h.Class(`m-chat-tab${key === side ? ' is-active' : ''}`),
                    h.OnClick(Message.OpenedSide({ key })),
                  ],
                  [dot(who.color, h), who.name],
                )
              }),
              h.button(
                [
                  h.Class('m-chat-close'),
                  h.AriaLabel('Close'),
                  h.OnClick(Message.SetUi({ name: 'side', value: '' })),
                ],
                ['×'],
              ),
            ],
          ),
          sideThread(
            model,
            side,
            h,
            Message.SetUi({ name: 'palette', value: 'open' }),
            'Message someone else',
          ),
        ],
      )
}

start({
  variant: 'margin',
  description:
    'Conversations sit in a margin beside the question, like document comments. No sessions sidebar: ⌘K finds anyone by name, issue or work and opens a chat window.',
  body: (model, h) =>
    h.div(
      [h.Class('m-body')],
      [
        sidebar(model, h),
        page(model, h),
        palette(model, h),
        chatWindow(model, h),
      ],
    ),
})
