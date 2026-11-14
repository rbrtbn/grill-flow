// PROTOTYPE G · Question as an issue page (ask 9656, round 2). The question reads like an
// issue: a compact header with the answers, a background you can expand, then one timeline of
// everything said about it. Passage threads and side threads (the lead, grill-flow) nest in
// that timeline where they started; the reply box at the bottom always goes to the asker. The
// right panel finds sessions by the work they do: this question's issue first, then whoever
// waits on you, then every issue with its sessions.
import type { Html } from 'foldkit/html'

import {
  askerThread,
  type Line,
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

const questionIssue: Record<string, string> = {
  'cache-budget': 'LAB-1412',
  'night-grant': 'LAB-1398',
  'pr-order': 'LAB-1400',
  'old-pages': 'LAB-1405',
}

const nested = (model: Model, key: string, title: Html, h: H): Html => {
  const who = session(threadWith(key))
  const lines = model.threads[key] ?? []
  const open = model.active === key
  const unread = unreadCount(model, key)
  return h.div(
    [
      h.Class(`g-nested${open ? ' is-open' : ''}`),
      h.Style({ borderLeftColor: who.color }),
      h.DataAttribute('thread', key),
    ],
    [
      h.div([h.Class('g-nested-title')], [title]),
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
              unread > 0 ? ` · ${unread} new` : '',
            ],
          ),
    ],
  )
}

type Item = Readonly<{ at: number; view: Html }>

const page = (model: Model, h: H): Html => {
  const item = question(model.question)
  const asker = session(item.asker)
  const main = askerThread(model.question)
  const paragraphs = proseView(model, model.question, h)
  const expanded = model.ui.background === 'open'
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
  const items: ReadonlyArray<Item> = [
    ...(model.threads[main] ?? []).map((line: Line) => ({
      at: line.id,
      view: lineView(line, h),
    })),
    ...passages.map(entry => ({
      at: firstId(entry.key),
      view: nested(
        model,
        entry.key,
        h.span(
          [],
          [
            h.span([h.Class('g-quote-mark')], ['❝']),
            h.em([], [anchorText(model, entry.key)]),
          ],
        ),
        h,
      ),
    })),
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
              `${item.key} · ${item.round} · asked by ${asker.name} (${asker.address}) · ${questionIssue[item.key] ?? ''}`,
            ],
          ),
          h.h1([], [item.title]),
          h.p([h.Class('g-ask')], [item.ask]),
          h.div(
            [h.Class('g-options')],
            item.options.map(option =>
              h.button(
                [h.Class('g-option'), h.Title(option.effect)],
                [h.strong([], [option.key]), ` ${option.label}`],
              ),
            ),
          ),
        ],
      ),
      h.section(
        [h.Class('g-background')],
        [
          h.h2([], ['Background']),
          ...(expanded ? paragraphs : paragraphs.slice(0, 1)),
          (longProse[model.question] ?? []).length > 1
            ? h.button(
                [
                  h.Class('g-link'),
                  h.OnClick(
                    Message.SetUi({
                      name: 'background',
                      value: expanded ? '' : 'open',
                    }),
                  ),
                ],
                [
                  expanded
                    ? 'Show less'
                    : `Show all ${(longProse[model.question] ?? []).length} paragraphs · ${passages.length} quoted`,
                ],
              )
            : h.empty,
          h.p(
            [h.Class('hint')],
            ['Select a sentence to quote it into a new thread below.'],
          ),
        ],
      ),
      h.section(
        [h.Class('g-timeline')],
        [
          h.h2([], [`Conversation · ${items.length} entries`]),
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
              h.strong([], [`${asker.name} · ${asker.address}`]),
              h.small([], ['asked this question']),
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

const board = (model: Model, h: H): Html => {
  const query = model.ui.query ?? ''
  const here = questionIssue[model.question] ?? ''
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
            `${item.issue} · ${item.work} · ${item.squad}`,
          ),
        ),
      ],
    )
  }
  const issues = [
    ...new Set(
      roster.filter(item => item.issue !== '').map(item => item.issue),
    ),
  ].sort((a, b) => Number(b === here) - Number(a === here))
  return h.div(
    [h.Class('people-list')],
    [
      h.p([h.Class('people-title')], ['Pinned']),
      personRow(model, 't2cr', h),
      personRow(model, 't2hw', h),
      h.p([h.Class('people-title')], ['Waiting on you']),
      ...roster
        .filter(item => item.state === 'waiting')
        .map(item =>
          personRow(model, item.address, h, `${item.issue} · ${item.work}`),
        ),
      h.p([h.Class('people-title')], ['By work']),
      ...issues.map(issue => {
        const members = roster.filter(item => item.issue === issue)
        return h.div(
          [h.Class(`g-issue${issue === here ? ' is-here' : ''}`)],
          [
            h.p(
              [h.Class('g-issue-title')],
              [
                h.strong([], [issue]),
                ` ${members[0]?.work ?? ''}`,
                issue === here
                  ? h.span([h.Class('g-here')], ['this question'])
                  : h.empty,
              ],
            ),
            ...members.map(item =>
              personRow(model, item.address, h, `${item.role} · ${item.squad}`),
            ),
          ],
        )
      }),
    ],
  )
}

const panel = (model: Model, h: H): Html => {
  const side = model.ui.side ?? ''
  return h.aside(
    [h.Class('panel g-panel'), h.AriaLabel('Sessions')],
    side === ''
      ? [
          h.header(
            [h.Class('people-head')],
            [
              h.h2([], ['Sessions']),
              h.small([], ['Find someone by the work they do']),
            ],
          ),
          searchBox(model, 'Search name, LAB-…, work, t2…', h),
          board(model, h),
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
  variant: 'issue',
  description:
    'The question reads like an issue: header with answers, expandable background, one timeline where passage and side threads nest. Sessions are found by the work they do.',
  body: (model, h) =>
    h.div(
      [h.Class('g-body')],
      [sidebar(model, h), page(model, h), panel(model, h)],
    ),
})
