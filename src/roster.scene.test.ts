import { Option, Schema } from 'effect'
import { Url } from 'foldkit'
import {
  all,
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

import { Snapshot } from './domain'
import { PageData, init, update } from './main'
import { view } from './view'
import { CatalogData } from './workspace'

const fixture = JSON.parse(readFileSync('src/fixtures/grill.json', 'utf8'))
const member = {
  address: 't1',
  profile: 'team',
  role: 'helper',
  run: 'worker',
  host: 'mbp',
  terminal: 'live',
  coreStatus: 'blocked',
  checkedAt: 1000,
  detail: 'ready',
}
const roster = {
  profile: 'team',
  state: 'ready',
  checkedAt: 1000,
  members: [member],
  unavailableHosts: [],
  omitted: 0,
  unverified: 0,
  error: '',
}
const base = {
  grill: fixture,
  answers: {},
  notes: {},
  own: {},
  asks: [],
  revisions: [],
  sends: [],
}
const worker = Schema.decodeUnknownSync(Snapshot)({
  ...base,
  grill: {
    ...fixture,
    id: 'worker',
    title: 'Published worker',
    session: 't1',
    squad: { id: 'team', section: 'Worker' },
    steps: fixture.steps
      .slice(0, 2)
      .map((step: object, index: number) => ({
        ...step,
        question: { ...fixture.steps[index].question, dependsOn: [], when: [] },
      })),
  },
  answers: { Q2: 'a' },
  ownerSteps: [
    {
      source: 'worker',
      event: 10,
      at: 1000,
      item: {
        version: 1,
        kind: 'owner-step',
        id: 'manual',
        previous: 0,
        revision: 1,
        session: 't1',
        body: 'Exact published reason',
        host: 'mbp',
        destination: 'https://example.test/owner',
        action: 'Exact manual action',
        urgency: 'soon',
        blockers: [],
        progress: { state: 'open' },
      },
    },
  ],
})
const page = (changes: object = {}) =>
  Schema.decodeUnknownSync(Snapshot)({
    ...base,
    grill: {
      ...fixture,
      id: 'team',
      kind: 'squad',
      squad: { id: 'team', section: 'Team' },
    },
    roster: { ...roster, ...changes },
  })
const start = init(
  Option.getOrThrow(Url.fromString('http://localhost/g/team/squad')),
).model
const loaded = (snapshot: Snapshot) => ({
  ...start,
  page: PageData.Success({ data: snapshot }),
  workspace: {
    ...start.workspace,
    catalog: CatalogData.Success({ data: [worker] }),
  },
})

it('keeps Core blocked separate from explicit questions, drafts and owner actions without invented budgets', () => {
  scene(
    { update, view },
    given(loaded(page())),
    expect(selector('.f-roster-core')).toContainText('blocked'),
    expect(selector('.f-roster-waits')).toHaveText(
      '1 question · 1 draft · 1 action',
    ),
    expect(selector('.f-roster-budget')).toHaveText('Not reported'),
    expect(
      within(selector('.f-roster'), role('link', { name: 'Published worker' })),
    ).toHaveAttr('href', '/g/worker/plan'),
    expectAll(all.selector('.f-roster button')).toHaveCount(0),
  )
  scene(
    { update, view },
    given(loaded(page({ members: [{ ...member, run: 'not-published' }] }))),
    expect(selector('.f-roster-core')).toContainText('blocked'),
    expect(selector('.f-roster-waits')).toHaveText('None published'),
    expect(selector('.f-roster-work')).toHaveText('not-published'),
    expectAll(all.selector('.f-roster-work a')).toHaveCount(0),
  )
})

it('matches route-only question and owner work, while foreign membership never supplies page waits', () => {
  const snapshot = page({ members: [{ ...member, run: null }] })
  const foreign = Schema.decodeUnknownSync(Snapshot)({
    ...worker,
    grill: {
      ...worker.grill,
      id: 'foreign',
      squad: { id: 'other', section: 'Other' },
    },
  })
  const model = loaded(snapshot)
  scene(
    { update, view },
    given({
      ...model,
      workspace: {
        ...model.workspace,
        catalog: CatalogData.Success({ data: [worker, foreign] }),
      },
    }),
    expect(selector('.f-roster-waits')).toHaveText(
      '1 question · 1 draft · 1 action',
    ),
    expectAll(all.selector('.f-roster-work a')).toHaveCount(1),
  )
})

it('shows ended residual work and unavailable metadata without turning it into current execution', () => {
  scene(
    { update, view },
    given(
      loaded(
        page({
          state: 'stale',
          unavailableHosts: ['lab'],
          omitted: 4,
          unverified: 2,
          members: [
            {
              ...member,
              terminal: 'finished',
              detail: 'unavailable',
              role: null,
              host: null,
            },
          ],
        }),
      ),
    ),
    expect(selector('.f-roster')).toContainText('Host unavailable: lab'),
    expect(selector('.f-roster')).toContainText('4 sessions outside'),
    expect(selector('.f-roster')).toContainText(
      '2 label/detail readings unavailable',
    ),
    expect(selector('.f-roster-ended')).toContainText('Ended sessions · 1'),
    expect(selector('.f-roster-core')).toContainText('Ended'),
    expect(selector('.f-roster-core')).toContainText(
      'Stale · detail unavailable',
    ),
    expect(selector('.f-roster-waits')).toContainText(
      'Page items remain after session ended',
    ),
    expect(selector('.f-roster')).toContainText('Role not labelled'),
  )
})

it.each([
  { state: 'loading', error: '', text: 'Checking Herdr roster…' },
  {
    state: 'unavailable',
    error: 'Herdr could not be checked.',
    text: 'Herdr could not be checked.',
  },
  {
    state: 'ready',
    error: '',
    text: 'No live sessions carry this profile label.',
  },
])('renders the $state roster without fabricating members', status => {
  scene(
    { update, view },
    given(loaded(page({ ...status, members: [] }))),
    expect(selector('.f-roster')).toContainText(status.text),
    expectAll(all.selector('.f-roster-table')).toHaveCount(0),
  )
})

it('keeps legacy snapshots free of a misleading empty roster', () => {
  const { roster: _roster, ...legacy } = page()
  scene(
    { update, view },
    given(loaded(legacy)),
    expectAll(all.selector('.f-roster')).toHaveCount(0),
  )
})
