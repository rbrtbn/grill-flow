import { Option, Schema } from 'effect'
import { Url } from 'foldkit'
import {
  Mount,
  all,
  expect,
  expectAll,
  given,
  scene,
  selector,
} from 'foldkit/scene'
import { readFileSync } from 'node:fs'
import { it } from 'vitest'

import { Snapshot } from './domain'
import { FillBox, Message, PageData, init, update } from './main'
import { view } from './view'

const fixture = JSON.parse(readFileSync('src/fixtures/grill.json', 'utf8'))
const base = Schema.decodeUnknownSync(Snapshot)({
  grill: {
    ...fixture,
    refs: {
      PR100: {
        text: 'Routing · Primary github · Checked 2026-11-07T23:00:00.000Z',
        url: 'https://github.com/rbrtbn/squad/pull/100',
        state: 'merged · checks failed',
        type: 'pr',
      },
      'LAB-1280': {
        text: 'Old issue · Primary linear · Checked 2026-11-07T22:00:00.000Z · Last known: Done',
        url: 'https://linear.app/rbrtbn/issue/LAB-1280',
        state: 'Stale',
      },
      PR7: {
        text: 'Choose the source for this reference.',
        state: 'Ambiguous',
      },
    },
    steps: fixture.steps.map((step: object, index: number) =>
      index === 0
        ? { ...step, prose: ['Inspect PR100, LAB-1280 and PR7.'] }
        : step,
    ),
  },
  answers: {},
  notes: {},
  own: {},
  asks: [],
  revisions: [],
  sends: [],
})
const fillOne = Mount.resolveAll([FillBox, Message.CompletedFillBox()])
const start = init(
  Option.getOrThrow(Url.fromString('http://localhost/g/fixture/question/Q1')),
).model

it('shows primary status and checked context while keeping stale and ambiguous references honest', () => {
  scene(
    { update, view },
    given({ ...start, page: PageData.Success({ data: base }) }),
    fillOne,
    expect(selector('a.ref-link')).toContainText('merged · checks failed'),
    expect(selector('a.ref-link')).toHaveAttr(
      'href',
      'https://github.com/rbrtbn/squad/pull/100',
    ),
    expect(selector('a.ref-link')).toHaveAttr(
      'title',
      'PR100 · merged · checks failed · Routing · Primary github · Checked 2026-11-07T23:00:00.000Z',
    ),
    expect(selector('a.ref-link')).toHaveAttr(
      'aria-label',
      'PR100 · merged · checks failed · Routing · Primary github · Checked 2026-11-07T23:00:00.000Z',
    ),
    expectAll(all.selector('.ref-state')).toHaveCount(3),
    expect(selector('span.ref-link')).toContainText('PR7Ambiguous'),
    expect(selector('span.ref-link')).not.toHaveAttr('href'),
  )
})

it('keeps legacy references without readings or status readable', () => {
  const legacy = Schema.decodeUnknownSync(Snapshot)({
    ...base,
    grill: {
      ...base.grill,
      refs: {
        PR100: {
          text: 'Original reference',
          url: 'https://example.test/reference',
        },
      },
      steps: base.grill.steps.map((step, index) =>
        index === 0 ? { ...step, prose: ['Inspect PR100.'] } : step,
      ),
    },
  })
  scene(
    { update, view },
    given({ ...start, page: PageData.Success({ data: legacy }) }),
    fillOne,
    expect(selector('a.ref-link')).toHaveText('PR100'),
    expect(selector('a.ref-link')).toHaveAttr(
      'title',
      'PR100 · Original reference',
    ),
    expectAll(all.selector('.ref-state')).toHaveCount(0),
  )
})
