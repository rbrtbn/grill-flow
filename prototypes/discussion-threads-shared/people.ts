// PROTOTYPE round 2 (ask 9656): pieces the messaging side of E, F and G share, so their
// differences stay in how sessions are found, not in how a conversation reads.
import type { Html } from 'foldkit/html'

import {
  GENERAL,
  type Member,
  roster,
  session,
  threadAbout,
  threadKey,
  threadWith,
} from './data'
import {
  composeBox,
  type H,
  lineView,
  linesBox,
  Message,
  type Model,
  unreadCount,
} from './shell'

export const dmKey = (address: string) => threadKey(GENERAL, address)

export const matches = (member: Member, query: string) =>
  `${member.name} ${member.address} ${member.role} ${member.issue} ${member.work} ${member.squad}`
    .toLowerCase()
    .includes(query.trim().toLowerCase())

export const member = (address: string): Member | undefined =>
  roster.find(item => item.address === address)

export const directThreads = (model: Model) =>
  Object.keys(model.threads)
    .filter(key => threadAbout(key) === GENERAL)
    .sort(
      (a, b) =>
        (model.threads[b]?.at(-1)?.id ?? 0) -
        (model.threads[a]?.at(-1)?.id ?? 0),
    )

export const stateDot = (item: Member, h: H): Html =>
  h.span(
    [
      h.Class(`state state-${item.state}`),
      h.Title(item.state === 'waiting' ? 'Waiting on you' : item.state),
    ],
    [],
  )

export const searchBox = (model: Model, placeholder: string, h: H): Html =>
  h.input([
    h.Class('people-search'),
    h.Type('search'),
    h.Value(model.ui.query ?? ''),
    h.Placeholder(placeholder),
    h.OnInput(value => Message.SetUi({ name: 'query', value })),
  ])

/** One person row: who, what they work on, and the last line of your conversation. */
export const personRow = (
  model: Model,
  address: string,
  h: H,
  detail?: string,
): Html => {
  const who = session(address)
  const info = member(address)
  const key = dmKey(address)
  const last = model.threads[key]?.at(-1)
  const unread = unreadCount(model, key)
  return h.button(
    [
      h.Class(
        `person${model.ui.side === key ? ' is-active' : ''}${unread > 0 ? ' is-unread' : ''}`,
      ),
      h.OnClick(Message.OpenedSide({ key })),
    ],
    [
      h.span(
        [h.Class('person-top')],
        [
          h.span(
            [h.Class('person-avatar'), h.Style({ background: who.color })],
            [who.name.slice(0, 1)],
          ),
          h.strong([], [who.name]),
          info === undefined ? h.empty : stateDot(info, h),
          h.small([h.Class('person-addr')], [address]),
          unread > 0
            ? h.span([h.Class('person-badge')], [String(unread)])
            : h.empty,
        ],
      ),
      h.small(
        [h.Class('person-sub')],
        [
          detail ??
            (last !== undefined
              ? `${last.from === 'rob' ? 'You: ' : ''}${last.text}`
              : info === undefined
                ? who.role
                : `${info.role} · ${info.issue === '' ? '' : `${info.issue} · `}${info.work}`),
        ],
      ),
    ],
  )
}

/** The open side conversation: who it goes to, the thread, and a composer naming them. */
export const sideThread = (
  model: Model,
  key: string,
  h: H,
  onBack: Message,
  backLabel: string,
): Html => {
  const who = session(threadWith(key))
  const info = member(threadWith(key))
  const lines = model.threads[key] ?? []
  return h.section(
    [h.Class('side-thread')],
    [
      h.button([h.Class('side-back'), h.OnClick(onBack)], [`← ${backLabel}`]),
      h.header(
        [h.Class('side-who'), h.Style({ borderTopColor: who.color })],
        [
          h.span(
            [h.Class('person-avatar big'), h.Style({ background: who.color })],
            [who.name.slice(0, 1)],
          ),
          h.div(
            [],
            [
              h.strong([], [who.name]),
              h.small(
                [],
                [
                  `${who.role} · ${who.address}${info === undefined ? '' : ` · ${info.squad}`}`,
                ],
              ),
              info === undefined
                ? h.empty
                : h.small(
                    [],
                    [
                      `${info.issue === '' ? '' : `${info.issue} · `}${info.work}`,
                    ],
                  ),
            ],
          ),
        ],
      ),
      linesBox(
        'side-lines',
        lines.length === 0
          ? [
              h.p(
                [h.Class('empty-thread')],
                [`A new conversation with ${who.name}, outside any question.`],
              ),
            ]
          : lines.map(line => lineView(line, h)),
        h,
      ),
      h.form(
        [h.Class('side-compose'), h.OnSubmit(Message.SentMessage({ key }))],
        [
          composeBox(model, key, `Message ${who.name}…`, h),
          h.div(
            [h.Class('send-row')],
            [
              h.span([h.Class('hint')], [`To ${who.name} · ${who.address}`]),
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
