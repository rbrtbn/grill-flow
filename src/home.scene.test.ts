import { Option, Result, Schema } from 'effect'
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
import { expect as expectValue, it } from 'vitest'

import { Grill, type Snapshot } from './domain'
import {
  LoadWorkspaceCatalog,
  Message,
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
const start = (path: string) =>
  init(Option.getOrThrow(Url.fromString(`http://localhost${path}`))).model

it('lands a bare board address on the Inbox', () => {
  const next = update(
    start('/g/fixture'),
    Message.CompletedLoadGrill({ result: Result.succeed(squad) }),
  )
  expectValue(next.model.currentPart).toBe('inbox')
  expectValue(
    next.commands
      .filter(command => command.name === ReplacePage.name)
      .map(command => command.args),
  ).toEqual([{ url: '/g/fixture/inbox' }])
})

it('opens Squad overview from the brand and ends it with the retirement list', () => {
  scene(
    { update, view },
    given({
      ...start('/g/fixture/inbox'),
      page: PageData.Success({ data: squad }),
    }),
    expect(selector('.f-run-name')).toHaveText(grill.title),
    click(role('button', { name: 'Squad Board overview' })),
    Command.resolve(PushPage, Message.CompletedNavigate()),
    Command.resolve(ScrollToTop, Message.CompletedScroll()),
    Command.resolve(
      LoadWorkspaceCatalog,
      Message.CompletedLoadCatalog({ result: Result.succeed([]) }),
    ),
    expect(selector('.f-squad-overview h1')).toHaveText('Squad Board'),
    expect(
      role('region', { name: 'Retiring: where each part goes' }),
    ).toContainText('Needs you (old)'),
    expect(selector('.f-retiring')).toContainText('All boards'),
  )
})
