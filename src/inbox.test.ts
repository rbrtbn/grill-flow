import { Option, Schema } from 'effect'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { Snapshot } from './domain'
import {
  dueCount,
  entriesOf,
  filtersFrom,
  inboxData,
  passes,
  queryOf,
  questionQueryFrom,
  questionQueryString,
  toggleFacet,
} from './inbox'

const grill = JSON.parse(readFileSync('src/fixtures/grill.json', 'utf8'))
const step = (id: string, state: 'open' | 'completed', urgency: string) => ({
  source: 'alpha',
  event: 1,
  at: 1000,
  item: {
    version: 1,
    previous: 0,
    revision: 1,
    session: 't-owner',
    body: 'Why.',
    kind: 'owner-step',
    id,
    title: id,
    host: 'GitHub',
    destination: 'https://github.com/o/r/pull/1',
    action: 'Merge it.',
    urgency,
    blockers: [],
    progress:
      state === 'open'
        ? { state }
        : { state, proof: 'https://github.com/o/r/pull/1', checkedAt: 2000 },
  },
})
const snapshot = Schema.decodeUnknownSync(Snapshot)({
  grill,
  answers: {},
  notes: {},
  own: {},
  asks: [],
  revisions: [],
  sends: [],
  ownerSteps: [
    step('merge-now', 'open', 'soon'),
    step('merge-later', 'open', 'fyi'),
    step('merged', 'completed', 'soon'),
  ],
})

describe('Inbox filters in the address', () => {
  it('round-trips facets and group-by, keeping the default grouping out', () => {
    const filters = toggleFacet(
      toggleFacet(filtersFrom('group=place'), 'kind', 'merge'),
      'session',
      't2hq',
    )
    expect(queryOf(filters)).toBe('kind=merge&run=t2hq&group=place')
    expect(filtersFrom(queryOf(filters))).toEqual(filters)
    expect(queryOf(filtersFrom('group=urgency'))).toBe('')
    expect(filtersFrom('group=nonsense').groupBy).toBe('urgency')
  })

  it('reads the Questions filters, ignoring a round that is not a number', () => {
    const query = questionQueryFrom('run=t2j8,t2j6&urgency=now&round=80')
    expect(query.session).toEqual(['t2j8', 't2j6'])
    expect(query.maybeRound).toEqual(Option.some(80))
    expect(questionQueryString(query)).toBe(
      'run=t2j8%2Ct2j6&urgency=now&round=80',
    )
    expect(questionQueryFrom('round=x').maybeRound).toEqual(Option.none())
  })
})

describe('Inbox entries', () => {
  it('lists open tasks and open questions, and counts only Now and Next', () => {
    const data = inboxData(snapshot, {}, 0, false)
    const tasks = entriesOf(data).filter(entry => entry._tag === 'Task')
    expect(tasks.map(entry => entry.bucket)).toEqual(['now', 'later'])
    expect(tasks.every(entry => entry.kind === 'merge')).toBe(true)
    const questions = data.questions.length
    expect(questions).toBeGreaterThan(0)
    expect(dueCount(data)).toBe(
      entriesOf(data).filter(entry => entry.bucket !== 'later').length,
    )
  })

  it('filters by kind and urgency together', () => {
    const data = inboxData(snapshot, {}, 0, false)
    const filters = { ...filtersFrom('kind=merge&urgency=now') }
    expect(
      entriesOf(data)
        .filter(entry => passes(filters, entry))
        .map(entry => (entry._tag === 'Task' ? entry.task.id : '')),
    ).toEqual(['merge-now'])
  })

  it('merges the preview fixture only when asked', () => {
    expect(inboxData(snapshot, {}, 0, false).freezes).toEqual([])
    const fixture = inboxData(snapshot, {}, 0, true)
    expect(fixture.freezes.length).toBe(1)
    expect(fixture.tasks.some(task => task.state._tag === 'Promised')).toBe(
      true,
    )
  })
})
