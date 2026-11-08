import { Option, Schema } from 'effect'
import { Url } from 'foldkit'
import { all, expect, expectAll, given, scene, selector } from 'foldkit/scene'
import { readFileSync } from 'node:fs'
import { it } from 'vitest'

import { Grill, type Snapshot } from './domain'
import { PageData, init, update } from './main'
import { view } from './view'
import { CatalogData, GRILLS, SQUAD } from './workspace'

const grill = Schema.decodeUnknownSync(Grill)(
  JSON.parse(readFileSync('src/fixtures/grill.json', 'utf8')),
)
const source = (id: string, membership?: string, kind?: 'squad'): Snapshot => ({
  grill: {
    ...grill,
    id,
    title: id,
    ...(kind === undefined ? {} : { kind }),
    ...(membership === undefined
      ? {}
      : { squad: { id: membership, section: id } }),
  },
  answers: {},
  notes: {},
  own: {},
  asks: [],
  revisions: [],
  sends: [],
})
const snapshot = source('squad', 'squad', 'squad')
const states = [
  snapshot,
  source('joined-run', 'squad', 'squad'),
  source('joined-decision', 'squad'),
  source('buddywise-lead-r1', undefined, 'squad'),
  source('foreign-member', 'another-squad', 'squad'),
]
const loaded = {
  ...init(Option.getOrThrow(Url.fromString('http://localhost/g/squad/squad')))
    .model,
  page: PageData.Success({ data: snapshot }),
}
const workspace = {
  ...loaded.workspace,
  catalog: CatalogData.Success({ data: states }),
}

it('lists and counts only this squad membership, independently of the grill kind', () => {
  scene(
    { update, view },
    given({ ...loaded, workspace, currentPart: SQUAD }),
    expectAll(all.selector('.f-runs-table tbody tr')).toHaveCount(2),
    expect(selector('.f-squad-overview')).toContainText('joined-run'),
    expect(selector('.f-squad-overview')).toContainText('joined-decision'),
    expect(selector('.f-squad-overview')).not.toContainText(
      'buddywise-lead-r1',
    ),
    expect(selector('.f-squad-overview')).not.toContainText('foreign-member'),
    expect(
      selector('.f-app-popdown button[aria-current="page"]'),
    ).toContainText('2 runs'),
  )
})

it('keeps other profiles in Your grills with their direct page links', () => {
  scene(
    { update, view },
    given({ ...loaded, workspace, currentPart: GRILLS }),
    expect(selector('.f-main .f-page')).toContainText('buddywise-lead-r1'),
    expect(selector('.f-main .f-page')).toContainText('foreign-member'),
    expect(selector('.f-main a[href="/g/buddywise-lead-r1"]')).toExist(),
  )
})
