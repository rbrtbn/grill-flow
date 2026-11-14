// PROTOTYPE round 3 (ask 9656): the sessions panel that replaces the Discussion panel. Pinned
// sessions stay on top (the lead pin follows whoever leads now); the rest group and order as
// Rob chooses. Finished work and closed sessions sink into folded sections instead of
// vanishing, and replies about a question show on its asker's row as well as in the sidebar.
import type { Html } from 'foldkit/html'

import {
  GENERAL,
  questionOf,
  questions,
  session,
  threadAbout,
  threadKey,
  threadWith,
} from './data'
import { changedAt, currentLead, type Live, refUrl, rosterAt } from './scenario'
import {
  composeBox,
  type H,
  lineView,
  linesBox,
  linkify,
  Message,
  type Model,
  unreadCount,
} from './shell'
import './sessions3.css'

export type Grouping = 'work' | 'squad' | 'status' | 'none'
export type Ordering = 'recent' | 'waiting' | 'name'

const dm = (address: string) => threadKey(GENERAL, address)
const lastId = (model: Model, address: string) =>
  Math.max(
    0,
    ...Object.keys(model.threads)
      .filter(key => threadWith(key) === address)
      .flatMap(key => (model.threads[key] ?? []).map(line => line.id)),
  )

/** Unread replies about questions from this session, per question. */
const questionUnread = (model: Model, address: string) =>
  questions
    .map(item => ({
      key: item.key,
      count: Object.keys(model.threads)
        .filter(
          key =>
            threadWith(key) === address &&
            questionOf(key) === item.key &&
            threadAbout(key) !== GENERAL,
        )
        .reduce((sum, key) => sum + unreadCount(model, key), 0),
    }))
    .filter(item => item.count > 0)

const isGone = (item: Live) =>
  item.terminal === 'closed' || item.issueState === 'done'

const statusOf = (item: Live) =>
  item.terminal === 'closed'
    ? 'Closed'
    : item.issueState === 'done'
      ? 'Work done'
      : item.state === 'waiting'
        ? 'Waiting on you'
        : item.state === 'working'
          ? 'Working'
          : 'Idle'

const row = (model: Model, item: Live, h: H, pinned = false): Html => {
  const key = dm(item.address)
  const unread = unreadCount(model, key)
  const onQuestions = questionUnread(model, item.address)
  const changed = (changedAt[model.step] ?? []).includes(item.address)
  const last = model.threads[key]?.at(-1)
  const issueUrl = refUrl(item.issue)
  return h.div(
    [
      h.Class(
        `s3-row${model.ui.side === key ? ' is-active' : ''}${unread > 0 ? ' is-unread' : ''}${item.terminal === 'closed' ? ' is-closed' : ''}${item.issueState === 'done' ? ' is-done' : ''}${changed ? ' just-changed' : ''}`,
      ),
    ],
    [
      h.button(
        [h.Class('s3-main'), h.OnClick(Message.OpenedSide({ key }))],
        [
          h.span(
            [h.Class('s3-top')],
            [
              h.span(
                [h.Class('person-avatar'), h.Style({ background: item.color })],
                [item.name.slice(0, 1)],
              ),
              h.strong([], [item.name]),
              h.span(
                [
                  h.Class(
                    `state state-${item.terminal === 'closed' ? 'closed' : item.state}`,
                  ),
                  h.Title(statusOf(item)),
                ],
                [],
              ),
              item.joinedAt === model.step
                ? h.span([h.Class('s3-tag is-new')], ['joined'])
                : h.empty,
              item.terminal === 'closed'
                ? h.span([h.Class('s3-tag')], ['closed'])
                : h.empty,
              h.small([h.Class('person-addr')], [item.address]),
              unread > 0
                ? h.span([h.Class('person-badge')], [String(unread)])
                : h.empty,
            ],
          ),
          h.small(
            [h.Class('s3-sub')],
            [
              last !== undefined && unread > 0
                ? `${last.text}`
                : `${item.role}${item.issue === '' ? '' : ` · ${item.issue}`} · ${item.work}`,
            ],
          ),
        ],
      ),
      h.div(
        [h.Class('s3-facts')],
        [
          issueUrl === undefined
            ? h.empty
            : h.a(
                [
                  h.Href(issueUrl),
                  h.Target('_blank'),
                  h.Class(
                    `s3-chip${item.issueState === 'done' ? ' is-done' : ''}`,
                  ),
                ],
                [`${item.issue}${item.issueState === 'done' ? ' · done' : ''}`],
              ),
          item.pr === undefined
            ? h.empty
            : h.a(
                [
                  h.Href(refUrl(`PR #${item.pr.number}`) ?? '#'),
                  h.Target('_blank'),
                  h.Class(
                    `s3-chip${item.pr.state === 'merged' ? ' is-merged' : ''}`,
                  ),
                ],
                [`PR #${item.pr.number} · ${item.pr.state}`],
              ),
          ...onQuestions.map(entry =>
            h.button(
              [
                h.Class('s3-chip is-reply'),
                h.OnClick(
                  Message.OpenedQuestionThread({
                    key: firstUnread(model, item.address, entry.key),
                  }),
                ),
              ],
              [`${entry.count} new on ${entry.key} ›`],
            ),
          ),
          pinned
            ? h.empty
            : h.button(
                [
                  h.Class('s3-pin'),
                  h.Title('Pin'),
                  h.OnClick(
                    Message.SetUi({
                      name: 'pins',
                      value: togglePin(model, item.address),
                    }),
                  ),
                ],
                ['☆'],
              ),
        ],
      ),
    ],
  )
}

const firstUnread = (model: Model, address: string, questionKey: string) =>
  Object.keys(model.threads).find(
    key =>
      threadWith(key) === address &&
      questionOf(key) === questionKey &&
      unreadCount(model, key) > 0,
  ) ?? threadKey(questionKey, address)

const pinsOf = (model: Model) =>
  (model.ui.pins ?? 'lead,t2hw').split(',').filter(Boolean)
const togglePin = (model: Model, address: string) => {
  const pins = pinsOf(model)
  return (
    pins.includes(address)
      ? pins.filter(pin => pin !== address)
      : [...pins, address]
  ).join(',')
}

const order = (model: Model, ordering: Ordering, items: ReadonlyArray<Live>) =>
  [...items].sort((a, b) =>
    ordering === 'name'
      ? a.name.localeCompare(b.name)
      : ordering === 'waiting'
        ? Number(b.state === 'waiting') - Number(a.state === 'waiting') ||
          lastId(model, b.address) - lastId(model, a.address)
        : lastId(model, b.address) - lastId(model, a.address) ||
          Number(b.state === 'waiting') - Number(a.state === 'waiting'),
  )

const section = (
  model: Model,
  h: H,
  id: string,
  title: Html | string,
  members: ReadonlyArray<Live>,
  foldedByDefault = false,
  highlight = false,
): ReadonlyArray<Html> => {
  if (members.length === 0) return []
  const items = members.map(item => row(model, item, h))
  // A section holding a row this scenario step changed opens, so the move is visible.
  const changedHere = members.some(item =>
    (changedAt[model.step] ?? []).includes(item.address),
  )
  const folded =
    (model.ui[`fold:${id}`] ??
      (foldedByDefault && !changedHere ? 'yes' : '')) === 'yes'
  return [
    h.div(
      [h.Class(`s3-section${highlight ? ' is-here' : ''}`)],
      [
        h.button(
          [
            h.Class('s3-section-title'),
            h.OnClick(
              Message.SetUi({ name: `fold:${id}`, value: folded ? '' : 'yes' }),
            ),
          ],
          [
            `${folded ? '▸' : '▾'} `,
            title,
            h.span([h.Class('s3-count')], [String(items.length)]),
          ],
        ),
        ...(folded ? [] : items),
      ],
    ),
  ]
}

const groups = (
  model: Model,
  h: H,
  grouping: Grouping,
  ordering: Ordering,
  rest: ReadonlyArray<Live>,
  hereIssue: string,
): ReadonlyArray<Html> => {
  const active = rest.filter(item => !isGone(item))
  const gone = rest.filter(isGone)
  const goneSection = section(
    model,
    h,
    'gone',
    'Finished or closed · history only',
    order(model, ordering, gone),
    true,
  )
  if (grouping === 'none')
    return [
      ...order(model, ordering, active).map(item => row(model, item, h)),
      ...goneSection,
    ]
  if (grouping === 'status') {
    const names = ['Waiting on you', 'Working', 'Idle', 'Work done', 'Closed']
    return names.flatMap(name =>
      section(
        model,
        h,
        `status:${name}`,
        name,
        order(
          model,
          ordering,
          rest.filter(item => statusOf(item) === name),
        ),
        name === 'Work done' || name === 'Closed',
      ),
    )
  }
  const keyOf = (item: Live) =>
    grouping === 'work' ? item.issue || 'No issue' : item.squad
  const keys = [...new Set(active.map(keyOf))].sort(
    (a, b) => Number(b === hereIssue) - Number(a === hereIssue),
  )
  return [
    ...keys.flatMap(key => {
      const members = active.filter(item => keyOf(item) === key)
      const url = refUrl(key)
      const title =
        grouping === 'work'
          ? h.span(
              [],
              [
                url === undefined
                  ? key
                  : h.a([h.Href(url), h.Target('_blank')], [key]),
                ` ${members[0]?.work ?? ''}`,
                key === hereIssue
                  ? h.span([h.Class('g-here')], [' · this question'])
                  : '',
              ],
            )
          : `${key} squad`
      return section(
        model,
        h,
        `${grouping}:${key}`,
        title,
        order(model, ordering, members),
        false,
        key === hereIssue,
      )
    }),
    ...goneSection,
  ]
}

const controls = (
  model: Model,
  h: H,
  grouping: Grouping,
  ordering: Ordering,
): Html =>
  h.div(
    [h.Class('s3-controls')],
    [
      h.label(
        [],
        [
          'Group ',
          h.select(
            [h.OnChange(value => Message.SetUi({ name: 'group', value }))],
            (['work', 'squad', 'status', 'none'] as const).map(value =>
              h.option(
                [h.Value(value), h.Selected(value === grouping)],
                [
                  {
                    work: 'By issue',
                    squad: 'By squad',
                    status: 'By status',
                    none: 'No groups',
                  }[value],
                ],
              ),
            ),
          ),
        ],
      ),
      h.label(
        [],
        [
          'Order ',
          h.select(
            [h.OnChange(value => Message.SetUi({ name: 'order', value }))],
            (['recent', 'waiting', 'name'] as const).map(value =>
              h.option(
                [h.Value(value), h.Selected(value === ordering)],
                [
                  { recent: 'Recent', waiting: 'Waiting first', name: 'Name' }[
                    value
                  ],
                ],
              ),
            ),
          ),
        ],
      ),
    ],
  )

const sideView = (model: Model, h: H, key: string): Html => {
  const address = threadWith(key)
  const item = rosterAt(model.step).find(member => member.address === address)
  const who = session(address)
  const lines = model.threads[key] ?? []
  const closed = item?.terminal === 'closed'
  const lead = currentLead(model.step)
  return h.section(
    [h.Class('side-thread')],
    [
      h.button(
        [
          h.Class('side-back'),
          h.OnClick(Message.SetUi({ name: 'side', value: '' })),
        ],
        ['← All sessions'],
      ),
      h.header(
        [
          h.Class('side-who'),
          h.Style({ borderTopColor: item?.color ?? who.color }),
        ],
        [
          h.span(
            [
              h.Class('person-avatar big'),
              h.Style({ background: item?.color ?? who.color }),
            ],
            [(item?.name ?? who.name).slice(0, 1)],
          ),
          h.div(
            [],
            [
              h.strong([], [item?.name ?? who.name]),
              h.small(
                [],
                [
                  `${item?.role ?? who.role} · ${address}${item === undefined ? '' : ` · ${statusOf(item)}`}`,
                ],
              ),
              item === undefined || item.issue === ''
                ? h.empty
                : h.small([], linkify(`${item.issue} · ${item.work}`, h)),
            ],
          ),
        ],
      ),
      closed
        ? h.div(
            [h.Class('s3-banner')],
            [
              `${address} is closed, so messages here won't reach it. Its history stays.`,
              ' ',
              h.button(
                [
                  h.Class('g-link'),
                  h.OnClick(Message.OpenedSide({ key: dm(lead) })),
                ],
                [`Message the lead (${lead}) instead`],
              ),
            ],
          )
        : item?.issueState === 'done'
          ? h.div(
              [h.Class('s3-banner is-soft')],
              [`${item.issue} is done; this session may close soon.`],
            )
          : h.empty,
      linesBox(
        'side-lines',
        lines.length === 0
          ? [
              h.p(
                [h.Class('empty-thread')],
                [`A conversation with ${who.name}, outside any question.`],
              ),
            ]
          : lines.map(line => lineView(line, h)),
        h,
      ),
      closed
        ? h.empty
        : h.form(
            [h.Class('side-compose'), h.OnSubmit(Message.SentMessage({ key }))],
            [
              composeBox(model, key, `Message ${item?.name ?? who.name}…`, h),
              h.div(
                [h.Class('send-row')],
                [
                  h.span(
                    [h.Class('hint')],
                    [`To ${item?.name ?? who.name} · ${address}`],
                  ),
                  h.button(
                    [
                      h.Type('submit'),
                      h.Class('send-button'),
                      h.Style({ background: item?.color ?? who.color }),
                    ],
                    [`Send to ${item?.name ?? who.name}`],
                  ),
                ],
              ),
            ],
          ),
    ],
  )
}

export const sessionsPanel = (
  model: Model,
  h: H,
  defaults: Readonly<{
    grouping: Grouping
    ordering: Ordering
    fixed: 'waiting' | 'recent'
    issueOf: Record<string, string>
  }>,
): Html => {
  const side = model.ui.side ?? ''
  if (side !== '')
    return h.aside(
      [h.Class('panel s3-panel'), h.AriaLabel('Sessions')],
      [sideView(model, h, side)],
    )
  const grouping = (model.ui.group as Grouping | undefined) ?? defaults.grouping
  const ordering = (model.ui.order as Ordering | undefined) ?? defaults.ordering
  const roster = rosterAt(model.step)
  const lead = currentLead(model.step)
  const pins = pinsOf(model).map(pin => (pin === 'lead' ? lead : pin))
  const pinned = pins
    .map(address => roster.find(item => item.address === address))
    .filter((item): item is Live => item !== undefined)
  const query = (model.ui.query ?? '').trim().toLowerCase()
  const rest = roster.filter(item => !pins.includes(item.address))
  const fixed =
    defaults.fixed === 'waiting'
      ? rest.filter(item => item.state === 'waiting' && !isGone(item))
      : rest.filter(
          item =>
            model.threads[dm(item.address)] !== undefined && !isGone(item),
        )
  const found = roster.filter(item =>
    `${item.name} ${item.address} ${item.role} ${item.issue} ${item.work} ${item.squad}`
      .toLowerCase()
      .includes(query),
  )
  return h.aside(
    [h.Class('panel s3-panel'), h.AriaLabel('Sessions')],
    [
      h.header(
        [h.Class('people-head')],
        [
          h.h2([], ['Sessions']),
          h.small([], ['Pinned, then grouped your way']),
        ],
      ),
      h.input([
        h.Class('people-search'),
        h.Type('search'),
        h.Value(model.ui.query ?? ''),
        h.Placeholder('Search name, LAB-…, work, t2…'),
        h.OnInput(value => Message.SetUi({ name: 'query', value })),
      ]),
      query !== ''
        ? h.div(
            [h.Class('people-list')],
            [
              h.p([h.Class('people-title')], [`${found.length} matching`]),
              ...found.map(item => row(model, item, h)),
            ],
          )
        : h.div(
            [h.Class('people-list')],
            [
              h.p([h.Class('people-title')], ['Pinned']),
              ...pinned.map(item => row(model, item, h, true)),
              ...(roster.some(item => item.previousLead)
                ? [
                    h.p(
                      [h.Class('hint s3-hint')],
                      [
                        'The lead pin moved to the new lead; the previous lead’s history is under Finished or closed.',
                      ],
                    ),
                  ]
                : []),
              ...section(
                model,
                h,
                'fixed',
                defaults.fixed === 'waiting'
                  ? 'Waiting on you'
                  : 'Recent conversations',
                order(model, ordering, fixed),
              ),
              controls(model, h, grouping, ordering),
              ...groups(
                model,
                h,
                grouping,
                ordering,
                rest.filter(item => !fixed.includes(item)),
                defaults.issueOf[model.question] ?? '',
              ),
            ],
          ),
    ],
  )
}
