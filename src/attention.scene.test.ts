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
  within,
} from 'foldkit/scene'
import { readFileSync } from 'node:fs'
import { it } from 'vitest'

import { channelItemKey } from './channel'
import { Snapshot } from './domain'
import {
  CopyOwnerStep,
  Message,
  OpenOwnerDestination,
  PageData,
  PostVeto,
  init,
  update,
} from './main'
import { view } from './view'
import { CatalogData, GRILLS } from './workspace'

const grill = JSON.parse(readFileSync('src/fixtures/grill.json', 'utf8'))
const base = {
  version: 1,
  previous: 0,
  revision: 1,
  session: 't-owner',
  body: 'Why this needs doing.',
}
const owner = {
  source: 'alpha',
  event: 10,
  at: 1000,
  item: {
    ...base,
    kind: 'owner-step',
    id: 'typed-line',
    title: 'Set the concurrency',
    host: 'rob-mbp',
    destination: 'https://example.test/session/t-owner',
    action: 'use concurrency 4',
    urgency: 'soon',
    blockers: [],
    progress: { state: 'open' },
  },
}
const decision = {
  source: 'alpha',
  event: 11,
  at: 1000,
  window: 'open',
  vetoes: [],
  item: {
    ...base,
    kind: 'decision',
    id: 'nightly',
    title: 'Run tonight',
    body: 'The exact provisional words.',
    affected: ['Nightly work'],
    deadline: 4000,
    resolution: { state: 'provisional' },
  },
}
const receipt = {
  version: 1,
  source: 'alpha',
  event: 72,
  at: 2000,
  item: 'nightly',
  revision: 1,
  decision: 'The exact provisional words.',
  deadline: 4000,
  session: 't-owner',
  late: false,
  delivery: 'pending',
  detail: 'Delivery is unconfirmed.',
  acknowledgment: 'none',
  response: '',
}
const snapshot = Schema.decodeUnknownSync(Snapshot)({
  grill: { ...grill, kind: 'squad' },
  answers: {},
  notes: {},
  own: {},
  asks: [],
  revisions: [],
  sends: [],
  channelNow: 3000,
  ownerSteps: [
    owner,
    {
      ...owner,
      event: 9,
      item: {
        ...owner.item,
        id: 'finished',
        title: 'Completed setup',
        progress: {
          state: 'completed',
          proof: 'https://example.test/proof',
          checkedAt: 1000,
          validUntil: 2000,
        },
      },
    },
  ],
  decisions: [decision],
  blockers: ['clear', 'blocked', 'unknown'].map((state, index) => ({
    source: 'alpha',
    event: 20 + index,
    at: 1000,
    item: {
      ...base,
      kind: 'blocker',
      id: `condition-${index}`,
      title: `Named condition ${index}`,
      condition: {
        kind: 'question',
        source: 'alpha',
        question: 'Q1',
        oneOf: ['a'],
      },
    },
    state,
    checkedAt: state === 'unknown' ? null : 1000,
    detail: `Evidence is ${state}.`,
  })),
})
const start = init(
  Option.getOrThrow(Url.fromString('http://localhost/g/fixture/decision/alpha%2Fnightly')),
).model
const loaded = { ...start, page: PageData.Success({ data: snapshot }) }

it('keeps a failed page request retryable and records the canonical decision identity', () => {
  const pending = Schema.decodeUnknownSync(Snapshot)({
    ...snapshot,
    decisions: [{ ...decision, vetoes: [receipt] }],
  })
  scene(
    { update, view },
    given(loaded),
    click(role('button', { name: 'Veto' })),
    Command.expectExact(
      PostVeto({
        grillId: 'fixture',
        source: 'alpha',
        item: 'nightly',
        revision: 1,
      }),
    ),
    expect(role('button', { name: 'Requesting veto…' })).toBeDisabled(),
    Command.resolve(
      PostVeto,
      Message.CompletedPostVeto({
        source: 'alpha',
        item: 'nightly',
        revision: 1,
        result: Result.fail('Server unavailable'),
      }),
    ),
    expect(role('alert')).toContainText('Server unavailable'),
    expect(role('button', { name: 'Veto' })).toBeEnabled(),
    click(role('button', { name: 'Veto' })),
    Command.resolve(
      PostVeto,
      Message.CompletedPostVeto({
        source: 'alpha',
        item: 'nightly',
        revision: 1,
        result: Result.succeed(pending),
      }),
    ),
    expect(role('button', { name: 'Veto requested' })).toBeDisabled(),
    expect(selector('.f-veto-receipt')).toContainText('alpha#72'),
    expect(selector('.f-veto-delivery')).toContainText('Delivery unconfirmed'),
    expect(selector('.f-veto-outcome')).toContainText(
      'Owner acknowledgment pending',
    ),
  )
})

it.each([
  {
    delivery: 'delivered',
    acknowledgment: 'none',
    transport: 'Delivered to terminal',
    outcome: 'Owner acknowledgment pending',
  },
  {
    delivery: 'failed',
    acknowledgment: 'acknowledged',
    transport: 'Delivery failed',
    outcome: 'Owner acknowledged',
  },
  {
    delivery: 'pending',
    acknowledgment: 'stopped',
    transport: 'Delivery unconfirmed',
    outcome: 'Owner reports action stopped',
  },
  {
    delivery: 'delivered',
    acknowledgment: 'continued',
    transport: 'Delivered to terminal',
    outcome: 'Owner reports action continued',
  },
])('keeps $delivery separate from the $acknowledgment owner report', state => {
  const incoming = Schema.decodeUnknownSync(Snapshot)({
    ...snapshot,
    decisions: [
      {
        ...decision,
        item: {
          ...decision.item,
          previous: 1,
          revision: 2,
          body: 'Later wording.',
        },
        vetoes: [
          {
            ...receipt,
            delivery: state.delivery,
            acknowledgment: state.acknowledgment,
            response: 'Exact owner response.',
            late: true,
          },
        ],
      },
    ],
  })
  scene(
    { update, view },
    given({ ...loaded, page: PageData.Success({ data: incoming }) }),
    expect(selector('.f-decision-words')).toHaveText('Later wording.'),
    expect(selector('.f-veto-receipt')).toContainText(
      'The exact provisional words.',
    ),
    expect(selector('.f-veto-receipt')).toContainText('Late request'),
    expect(selector('.f-veto-delivery')).toContainText(state.transport),
    expect(selector('.f-veto-outcome')).toContainText(state.outcome),
  )
})

it('uses the server window and offers a late request on the decision page', () => {
  const incoming = Schema.decodeUnknownSync(Snapshot)({
    ...snapshot,
    decisions: [{ ...decision, window: 'expired' }],
  })
  scene(
    { update, view },
    given({ ...loaded, page: PageData.Success({ data: incoming }) }),
    expect(role('button', { name: 'Request a late veto' })).toBeEnabled(),
    expect(selector('.f-provisional-decision')).toContainText(
      'Veto window expired',
    ),
  )
})

it('counts owner work even without unanswered questions and keeps its grill out of the archive', () => {
  const incoming = Schema.decodeUnknownSync(Snapshot)({
    ...snapshot,
    grill: { ...snapshot.grill, steps: [] },
  })
  scene(
    { update, view },
    given({ ...loaded, page: PageData.Success({ data: incoming }) }),
    expect(role('button', { name: 'Inbox1' })).toHaveAttr(
      'title',
      '1 tasks and 0 questions in Now and Next',
    ),
  )
  scene(
    { update, view },
    given({
      ...loaded,
      currentPart: GRILLS,
      page: PageData.Success({ data: incoming }),
      workspace: {
        ...loaded.workspace,
        catalog: CatalogData.Success({ data: [incoming] }),
      },
    }),
    expect(selector('.f-grill-row')).toContainText('2 items need attention'),
    expect(selector('.f-archive summary')).toHaveText('Archived · 0'),
  )
})

it('labels a single pending owner item accurately in the catalog', () => {
  const incoming = Schema.decodeUnknownSync(Snapshot)({
    ...snapshot,
    grill: { ...snapshot.grill, steps: [] },
    decisions: [],
  })
  scene(
    { update, view },
    given({
      ...loaded,
      currentPart: GRILLS,
      page: PageData.Success({ data: incoming }),
      workspace: {
        ...loaded.workspace,
        catalog: CatalogData.Success({ data: [incoming] }),
      },
    }),
    expect(selector('.f-grill-row')).toContainText('1 item needs attention'),
  )
})
