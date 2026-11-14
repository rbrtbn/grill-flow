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

import { Grill, type Snapshot } from './domain'
import {
  Message,
  type Model,
  PageData,
  PushPage,
  ReplacePage,
  ScrollToTop,
  init,
  update,
} from './main'
import { view } from './view'

const grill = Schema.decodeUnknownSync(Grill)(
  JSON.parse(readFileSync('src/fixtures/grill.json', 'utf8')),
)
const squad: Snapshot = {
  grill: { ...grill, kind: 'squad', squad: { id: grill.id, section: 'Squad' } },
  answers: {},
  notes: {},
  own: {},
  asks: [],
  revisions: [],
  sends: [],
}

const start = (path: string, isFixture = true): Model => {
  const model = init(
    Option.getOrThrow(Url.fromString(`http://localhost${path}`)),
  ).model
  return {
    ...model,
    page: PageData.Success({ data: squad }),
    inbox: { ...model.inbox, isFixture },
  }
}

it('opens Work from the header, next to Runs', () => {
  scene(
    { update, view },
    given(start('/g/fixture/inbox')),
    click(role('button', { name: 'Work' })),
    Command.expectHas(PushPage({ url: '/g/fixture/work' })),
    Command.resolve(PushPage, Message.CompletedNavigate()),
    Command.resolve(ScrollToTop, Message.CompletedScroll()),
    expect(selector('.f-work h1')).toHaveText('Work'),
  )
})

it('says there is no work log yet without the preview fixture', () => {
  scene(
    { update, view },
    given(start('/g/fixture/work', false)),
    expect(selector('.f-work .f-lead')).toContainText('don’t log their moves'),
    expect(selector('.f-work-timeline')).toBeAbsent(),
  )
})

it('reopens the rows a link names and opens more by their header', () => {
  scene(
    { update, view },
    given(start('/g/fixture/work?open=LAB-1426')),
    expect(selector('#work-track-LAB-1426')).toContainText('Merge-ready'),
    expect(selector('#work-track-LAB-1411')).toBeAbsent(),
    click(role('button', { name: /^Pickup allows a stacked draft/ })),
    Command.expectHas(
      ReplacePage({ url: '/g/fixture/work?open=LAB-1426,LAB-1411' }),
    ),
    Command.resolve(ReplacePage, Message.CompletedNavigate()),
    expect(selector('#work-track-LAB-1411')).toContainText('After LAB-1372'),
  )
})

it('folds done and planned work until asked', () => {
  scene(
    { update, view },
    given(start('/g/fixture/work')),
    expect(role('region', { name: 'Timeline' })).not.toContainText('LAB-1368'),
    click(role('button', { name: /Done earlier · 7/ })),
    Command.resolve(ReplacePage, Message.CompletedNavigate()),
    expect(role('region', { name: 'Timeline' })).toContainText('LAB-1368'),
    click(role('button', { name: /Planned next · 5/ })),
    Command.resolve(ReplacePage, Message.CompletedNavigate()),
    expect(role('region', { name: 'Timeline' })).toContainText('LAB-1444'),
  )
})

it('opens the work an issue waits on, unfolding it', () => {
  scene(
    { update, view },
    given(start('/g/fixture/work?open=LAB-1411')),
    click(role('button', { name: 'LAB-1372' })),
    Command.expectHas(
      ReplacePage({ url: '/g/fixture/work?open=LAB-1411,LAB-1372&done=1' }),
    ),
    Command.resolve(ReplacePage, Message.CompletedNavigate()),
    expect(selector('#work-track-LAB-1372')).toContainText('Merged'),
  )
})
