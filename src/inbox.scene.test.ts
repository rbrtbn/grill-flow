import { Option, Schema } from 'effect'
import { Url } from 'foldkit'
import {
  Command,
  click,
  expect,
  given,
  role,
  scene,
  selector,
} from 'foldkit/scene'
import { readFileSync } from 'node:fs'
import { it } from 'vitest'

import { Snapshot } from './domain'
import {
  Message,
  PageData,
  PushPage,
  ReplacePage,
  ScrollToTop,
  init,
  update,
} from './main'
import { view } from './view'

const grill = JSON.parse(readFileSync('src/fixtures/grill.json', 'utf8'))
const snapshot = Schema.decodeUnknownSync(Snapshot)({
  grill,
  answers: {},
  notes: {},
  own: {},
  asks: [],
  revisions: [],
  sends: [],
  ownerSteps: [
    {
      source: 'alpha',
      event: 1,
      at: 1000,
      item: {
        version: 1,
        previous: 0,
        revision: 1,
        session: 't-owner',
        body: 'Why this is yours.',
        kind: 'owner-step',
        id: 'merge-it',
        title: 'Merge the PR',
        host: 'GitHub',
        destination: 'https://github.com/o/r/pull/1',
        action: 'Merge it.',
        urgency: 'soon',
        blockers: [],
        progress: { state: 'open' },
      },
    },
  ],
})
const loaded = (path: string) => ({
  ...init(Option.getOrThrow(Url.fromString(`http://localhost${path}`))).model,
  page: PageData.Success({ data: snapshot }),
})

it('filters the Inbox from its address and keeps the filter there', () => {
  scene(
    { update, view },
    given(loaded('/g/fixture/inbox')),
    expect(selector('.f-inbox h1')).toHaveText('Inbox'),
    expect(role('group', { name: 'Views' })).toExist(),
    expect(role('button', { name: 'Clear filters' })).toBeDisabled(),
    expect(role('button', { name: 'Copy link' })).toExist(),
    expect(selector('.f-facet.is-urgency .f-urgency-dot.is-now')).toExist(),
    expect(selector('.f-inbox-filters')).toHaveText(
      /Kind.*Urgency.*Group by.*Session/,
    ),
    expect(selector('.f-facet.is-session .f-ref-card')).toContainText(
      'Squad lead',
    ),
    expect(role('button', { name: 'Merge the PR' })).toExist(),
    click(role('button', { name: /^Lines to type/ })),
    Command.expectExact(ReplacePage({ url: '/g/fixture/inbox?kind=type' })),
    Command.resolve(ReplacePage, Message.CompletedNavigate()),
    expect(role('button', { name: 'Merge the PR' })).not.toExist(),
    click(role('button', { name: 'Clear filters' })),
    Command.resolve(ReplacePage, Message.CompletedNavigate()),
    expect(role('button', { name: 'Merge the PR' })).toExist(),
  )
})

it('opens a task on its own page with a thread to its session', () => {
  scene(
    { update, view },
    given(loaded('/g/fixture/inbox')),
    click(role('button', { name: 'Merge the PR' })),
    Command.expectExact(
      PushPage({ url: '/g/fixture/item/merge-it' }),
      ScrollToTop(),
    ),
    Command.resolve(PushPage, Message.CompletedNavigate()),
    Command.resolve(ScrollToTop, Message.CompletedScroll()),
    expect(selector('.f-item-sheet h1')).toHaveText('Merge the PR'),
    expect(role('complementary', { name: 'Thread' })).toContainText(
      'Thread with t-owner',
    ),
  )
})

it('toggles the quick look from the header', () => {
  scene(
    { update, view },
    given(loaded('/g/fixture/runs')),
    click(role('button', { name: 'Quick look' })),
    expect(role('dialog', { name: 'Quick look' })).toContainText(
      'Merge the PR',
    ),
    click(role('button', { name: 'Quick look' })),
    expect(role('dialog', { name: 'Quick look' })).not.toExist(),
  )
})
