import { Option, Result, Schema } from 'effect'
import { Url } from 'foldkit'
import {
  Command,
  Mount,
  all,
  click,
  expect,
  expectAll,
  given,
  role,
  scene,
  selector,
} from 'foldkit/scene'
import { readFileSync } from 'node:fs'
import { expect as assert, it } from 'vitest'

import {
  activityReadFrom,
  activityUnreadCount,
  answerAnchor,
  itemAnchor,
  revealAnchorFrom,
} from './activity'
import { Snapshot } from './domain'
import {
  ChannelReveal,
  Message,
  PageData,
  RevealChannelItem,
  SaveWorkspaceSettings,
  init,
  update,
} from './main'
import { view } from './view'

const fixture = JSON.parse(readFileSync('src/fixtures/grill.json', 'utf8'))
const feed = {
  entries: [
    {
      source: 'alpha',
      member: 'Alpha work',
      event: 10,
      at: 1000,
      kind: 'item-published',
      label: 'Owner step changed',
      summary: 'Recorded words.',
      needsAction: true,
      target: 'needs-you',
      item: 'manual',
      anchor: itemAnchor('alpha', 'manual'),
    },
    {
      source: 'beta',
      member: 'Beta work',
      event: 10,
      at: 1000,
      kind: 'revised',
      label: 'Agent replied',
      summary: 'Exact response.',
      needsAction: false,
      target: 'question',
      question: 'Q1',
    },
  ],
  highWater: { alpha: 10, beta: 10 },
  total: 2,
  truncated: false,
}
const snapshot = Schema.decodeUnknownSync(Snapshot)({
  grill: fixture,
  answers: {},
  notes: {},
  own: {},
  asks: [],
  revisions: [],
  sends: [],
  activity: feed,
})
const start = init(
  Option.getOrThrow(Url.fromString('http://localhost/g/fixture/changes')),
).model
const loaded = { ...start, page: PageData.Success({ data: snapshot }) }

it('groups source-qualified unread changes and only saves a local cursor when explicitly marked seen', () => {
  scene(
    { update, view },
    given(loaded),
    expect(selector('.f-activity-count')).toHaveText('2 unread · 2 shown'),
    expectAll(all.selector('.f-activity-source')).toHaveCount(2),
    expect(role('link', { name: 'Agent replied' })).toHaveAttr(
      'href',
      '/g/fixture/question/Q1?source=beta',
    ),
    expect(role('link', { name: 'Owner step changed' })).toHaveAttr(
      'href',
      '/g/alpha/needs-you#' + itemAnchor('alpha', 'manual'),
    ),
    click(role('button', { name: 'Mark all seen' })),
    Command.resolve(
      SaveWorkspaceSettings,
      Message.CompletedSaveWorkspaceSettings(),
    ),
    expect(selector('.f-activity-count')).toHaveText('0 unread · 0 shown'),
    click(role('button', { name: 'Needs action', exact: true })),
    expectAll(all.selector('.f-activity-entry')).toHaveCount(1),
    expect(selector('.f-activity-read')).toHaveText('Seen'),
    click(role('button', { name: 'All', exact: true })),
    expectAll(all.selector('.f-activity-entry')).toHaveCount(2),
  )
  const marked = update(loaded, Message.ClickedMarkActivitySeen())
  assert(marked.commands).toHaveLength(1)
  assert(marked.commands?.[0]?.name).toBe('SaveWorkspaceSettings')
  assert(marked.model.answers).toEqual(loaded.answers)
  assert(marked.model.readIds).toEqual(loaded.readIds)
  assert(marked.model.vetoAttempts).toEqual(loaded.vetoAttempts)
  assert(marked.model.page).toEqual(loaded.page)
})

it('restores browser cursors and treats a later event from another source independently', () => {
  const restored = update(
    loaded,
    Message.RestoredWorkspaceSettings({
      filter: 'All',
      urgencyFilter: 'All',
      grouping: 'Round',
      highlightTerms: false,
      collapseSentRounds: true,
      activityRead: { alpha: 10 },
    }),
  )
  scene(
    { update, view },
    given(restored.model),
    expect(selector('.f-activity-count')).toHaveText('1 unread · 1 shown'),
    expect(selector('.f-activity-entry')).toContainText('Exact response.'),
  )
  const read = update(loaded, Message.ClickedMarkActivitySeen()).model
  const incoming = Schema.decodeUnknownSync(Snapshot)({
    ...snapshot,
    activity: {
      ...feed,
      entries: [
        {
          ...feed.entries[0],
          source: 'beta',
          event: 11,
          label: 'Later beta event',
        },
        ...feed.entries,
      ],
      highWater: { alpha: 10, beta: 11 },
      total: 3,
    },
  })
  const polled = update(
    read,
    Message.CompletedLoadGrill({ result: Result.succeed(incoming) }),
  )
  scene(
    { update, view },
    given(polled.model),
    expect(selector('.f-activity-count')).toHaveText('1 unread · 1 shown'),
    expect(selector('.f-activity-entry')).toContainText('Later beta event'),
  )
})

it('reveals only the exact canonical item and prevents late settings restore from scrolling over it', () => {
  const id = itemAnchor('alpha', 'update')
  const target = init(
    Option.getOrThrow(
      Url.fromString('http://localhost/g/fixture/updates#' + id),
    ),
  ).model
  const incoming = Schema.decodeUnknownSync(Snapshot)({
    ...snapshot,
    updates: [
      {
        source: 'alpha',
        event: 30,
        at: 1000,
        item: {
          version: 1,
          kind: 'update',
          id: 'update',
          previous: 0,
          revision: 1,
          session: 't1',
          body: 'Target update.',
        },
        supersededBy: 'later',
      },
    ],
  })
  scene(
    { update, view },
    given({ ...target, page: PageData.Success({ data: incoming }) }),
    expect(selector('.f-channel-entry')).toHaveAttr('id', id),
    Mount.expectExact(RevealChannelItem({ id })),
    Mount.resolve(
      RevealChannelItem,
      Message.CompletedRevealChannelItem({ id }),
    ),
    Mount.expectEnded(RevealChannelItem),
    expect(selector('.f-channel-entry')).toContainText('Target update.'),
  )
  const completed = update(
    { ...target, page: PageData.Success({ data: incoming }) },
    Message.CompletedRevealChannelItem({ id }),
  ).model
  assert(completed.channelReveal).toEqual(ChannelReveal.Completed({ id }))
  const restored = update(
    completed,
    Message.RestoredWorkspaceSettings({
      filter: 'All',
      urgencyFilter: 'All',
      grouping: 'Round',
      highlightTerms: false,
      collapseSentRounds: true,
    }),
  )
  assert(restored.commands).toBeUndefined()
})

it('reports truncated unread counts as lower bounds and legacy absence without inventing a feed', () => {
  const truncated = Schema.decodeUnknownSync(Snapshot)({
    ...snapshot,
    activity: { ...feed, total: 500, truncated: true },
  })
  scene(
    { update, view },
    given({ ...loaded, page: PageData.Success({ data: truncated }) }),
    expect(selector('.f-activity-count')).toHaveText('2+ unread · 2 shown'),
    expect(selector('.f-activity-truncated')).toContainText('latest 2 of 500'),
  )
  const { activity: _activity, ...legacy } = snapshot
  scene(
    { update, view },
    given({ ...loaded, page: PageData.Success({ data: legacy }) }),
    expect(selector('.f-activity')).toContainText('older snapshot'),
    expect(role('button', { name: 'Mark all seen' })).toBeDisabled(),
  )
})

it('preserves numeric own-key cursors without prototype lookup or authority changes', () => {
  const raw = JSON.parse('{"__proto__":4,"constructor":2,"toString":6}')
  assert(activityReadFrom(raw)).toEqual(raw)
  assert(activityReadFrom({ bad: -1, fractional: 1.5 })).toEqual({})
  assert(activityReadFrom('bad')).toEqual({})
  const special = Schema.decodeUnknownSync(Snapshot)({
    ...snapshot,
    activity: {
      entries: Object.entries(raw).map(([source, event]) => ({
        ...feed.entries[0],
        source,
        event,
      })),
      highWater: raw,
      total: 3,
      truncated: false,
    },
  })
  const current = { ...loaded, page: PageData.Success({ data: special }) }
  assert(
    activityUnreadCount(special.activity, current.workspace.activityRead),
  ).toBe('3')
  const marked = update(current, Message.ClickedMarkActivitySeen())
  assert(Object.hasOwn(marked.model.workspace.activityRead, '__proto__')).toBe(
    true,
  )
  assert(JSON.stringify(marked.model.workspace.activityRead)).toBe(
    JSON.stringify(raw),
  )
  assert(
    activityUnreadCount(special.activity, marked.model.workspace.activityRead),
  ).toBe('0')
  assert(Object.getPrototypeOf(marked.model.workspace.activityRead)).toBe(
    Object.prototype,
  )
  assert(
    Option.isSome(revealAnchorFrom(Option.some(answerAnchor('alpha', 10)))),
  ).toBe(true)
  assert(Option.isNone(revealAnchorFrom(Option.some('body > textarea')))).toBe(
    true,
  )
  assert(itemAnchor('a-b', 'c')).not.toBe(itemAnchor('a', 'b-c'))
})
