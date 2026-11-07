import { Option, Result, Schema } from 'effect'
import { Url } from 'foldkit'
import {
  Command,
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

import { Snapshot } from './domain'
import { Message, PageData, RequestDrawing, init, update } from './main'
import { view } from './view'

const fixture = JSON.parse(readFileSync('src/fixtures/grill.json', 'utf8'))
const snapshot = Schema.decodeUnknownSync(Snapshot)({
  grill: fixture,
  answers: {},
  notes: {},
  own: {},
  asks: [],
  revisions: [],
  sends: [],
  questionRevisions: { Q1: 'wording-one' },
})
const start = init(
  Option.getOrThrow(Url.fromString('http://localhost/g/fixture/question/Q1')),
).model
const loaded = { ...start, page: PageData.Success({ data: snapshot }) }
const drawing = {
  source: 'canonical-owner',
  question: 'Q71',
  displayQuestion: 'Q1',
  request: 31,
  at: 1000,
  recipient: 't-owner',
  delivery: 'pending',
  detail: 'Saved before transport.',
  stale: false,
  context: {
    revision: 'wording-one',
    displayPage: 'fixture',
    displayQuestion: 'Q1',
    round: 1,
    title: 'Original title',
    scope: 'Original scope',
    ask: 'Original question?',
    options: [
      {
        key: 'a',
        label: 'Original choice',
        effect: 'Original consequence',
        recommended: true,
      },
    ],
  },
}
const withDrawing = (changes: object = {}) =>
  Schema.decodeUnknownSync(Snapshot)({
    ...snapshot,
    drawings: [{ ...drawing, ...changes }],
  })
const response = (diagram: unknown) => ({
  version: 1,
  event: 32,
  at: 2000,
  revision: 1,
  diagram,
})

it('requests the published revision without answering and keeps network failure retryable', () => {
  const requested = withDrawing()
  scene(
    { update, view },
    given(loaded),
    click(role('button', { name: 'Draw this' })),
    Command.expectExact(
      RequestDrawing({
        grillId: 'fixture',
        question: 'Q1',
        contextRevision: 'wording-one',
        previous: 0,
      }),
    ),
    expect(role('button', { name: 'Drawing requested' })).toBeDisabled(),
    Command.resolve(
      RequestDrawing,
      Message.CompletedRequestDrawing({
        grillId: 'fixture',
        question: 'Q1',
        previous: 0,
        result: Result.fail('Mock network unavailable'),
      }),
    ),
    expect(role('alert')).toContainText('Mock network unavailable'),
    click(role('button', { name: 'Retry drawing request' })),
    Command.resolve(
      RequestDrawing,
      Message.CompletedRequestDrawing({
        grillId: 'fixture',
        question: 'Q1',
        previous: 0,
        result: Result.succeed(requested),
      }),
    ),
    expect(selector('.f-drawing-meta')).toContainText(
      'canonical-owner · Q71 · request 31',
    ),
    expect(selector('.f-drawing-state')).toContainText(
      'delivery is unconfirmed',
    ),
    expect(role('button', { name: 'Drawing requested' })).toBeDisabled(),
    expectAll(all.selector('.f-option')).toHaveCount(3),
  )
  assert(
    update(loaded, Message.ClickedDrawing({ question: 'Q1' })).model.answers,
  ).toEqual({})
})

it('redraws failed delivery or stale pending wording using the saved request identity', () => {
  ;[{ delivery: 'failed' }, { stale: true }].forEach(changes => {
    const incoming = withDrawing(changes)
    scene(
      { update, view },
      given({ ...loaded, page: PageData.Success({ data: incoming }) }),
      click(
        role('button', {
          name:
            changes.delivery === 'failed'
              ? 'Retry drawing request'
              : 'Draw this',
        }),
      ),
      Command.expectExact(
        RequestDrawing({
          grillId: 'fixture',
          question: 'Q1',
          contextRevision: 'wording-one',
          previous: 31,
        }),
      ),
      Command.resolve(
        RequestDrawing,
        Message.CompletedRequestDrawing({
          grillId: 'fixture',
          question: 'Q1',
          previous: 31,
          result: Result.fail('Try later'),
        }),
      ),
      expect(role('alert')).toContainText('Try later'),
    )
  })
})

it('renders a stale table with its original options and keeps current answer controls', () => {
  const incoming = withDrawing({
    stale: true,
    response: response({
      kind: 'compare',
      now: 'Today',
      rows: [
        {
          label: 'Responsibility',
          cells: { now: 'Unknown owner', a: 'Named owner' },
        },
      ],
    }),
  })
  scene(
    { update, view },
    given({ ...loaded, page: PageData.Success({ data: incoming }) }),
    expect(selector('.f-drawing-stale')).toContainText('earlier wording'),
    expect(selector('.f-drawing-response')).toContainText('Original choice'),
    expect(selector('.f-drawing-response')).toContainText('Named owner'),
    expect(selector('.f-question-title')).toHaveText(
      fixture.steps[0].question.ask,
    ),
    expectAll(all.selector('.f-option')).toHaveCount(3),
    expect(role('button', { name: 'Redraw' })).toBeEnabled(),
  )
  const current = withDrawing({
    stale: false,
    response: incoming.drawings?.[0]?.response,
  })
  scene(
    { update, view },
    given({
      ...loaded,
      answers: { Q1: '?' },
      page: PageData.Success({ data: current }),
    }),
    expectAll(all.selector('.f-drawing-response .has-pick')).toHaveCount(0),
  )
})

it('renders a typed flow and keeps legacy snapshots safe', () => {
  const incoming = withDrawing({
    response: response({
      kind: 'flow',
      title: 'Request to response',
      lanes: [{ id: 'owner', label: 'Question owner' }],
      steps: ['Read', 'Reply'],
      states: {
        a: { nodes: { owner: ['Read frozen wording', 'Publish response'] } },
      },
    }),
  })
  scene(
    { update, view },
    given({ ...loaded, page: PageData.Success({ data: incoming }) }),
    expect(selector('.f-drawing-response .is-flow')).toContainText(
      'Read frozen wording',
    ),
    expect(selector('.f-drawing-response')).toContainText('Publish response'),
    expect(role('button', { name: 'Redraw' })).toBeEnabled(),
  )
  const { questionRevisions: _omitted, ...legacy } = snapshot
  scene(
    { update, view },
    given({
      ...loaded,
      page: PageData.Success({ data: legacy }),
    }),
    expect(role('button', { name: 'Draw this' })).toBeDisabled(),
    expectAll(all.selector('.f-question-drawing')).toHaveCount(0),
  )
})

it('ignores an old page request completion after navigation to another grill', () => {
  const pending = update(
    loaded,
    Message.ClickedDrawing({ question: 'Q1' }),
  ).model
  const next = {
    ...pending,
    page: PageData.Success({
      data: { ...snapshot, grill: { ...snapshot.grill, id: 'other' } },
    }),
  }
  const completed = update(
    next,
    Message.CompletedRequestDrawing({
      grillId: 'fixture',
      question: 'Q1',
      previous: 0,
      result: Result.succeed(withDrawing()),
    }),
  )
  assert(completed.model).toBe(next)
  scene(
    { update, view },
    given(next),
    expect(role('button', { name: 'Draw this' })).toBeEnabled(),
  )
})
