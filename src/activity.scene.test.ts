import { Option, Schema } from 'effect'
import { Url } from 'foldkit'
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
import { Message, PageData, init, update } from './main'
import {} from './view'

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
