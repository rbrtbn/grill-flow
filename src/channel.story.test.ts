import { Option } from 'effect'
import { Schema } from 'effect'
import { Navigation, Url } from 'foldkit'
import { Command, given, message, story } from 'foldkit/story'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

import { Grill, type Snapshot } from './domain'
import {
  LoadUrl,
  Message,
  PageData,
  init,
  pageOfPath,
  pathOfPage,
  update,
} from './main'

const snapshot: Snapshot = {
  grill: Schema.decodeUnknownSync(Grill)(
    JSON.parse(readFileSync('src/fixtures/grill.json', 'utf8')),
  ),
  answers: {},
  notes: {},
  own: {},
  asks: [],
  revisions: [],
  sends: [],
}
const url = Option.getOrThrow(
  Url.fromString('http://localhost/g/fixture/question/Q1?source=member'),
)

it('resolves a qualified local ID at the server instead of treating it as a shared ID in the SPA', () => {
  story(
    update,
    given({ ...init(url).model, page: PageData.Success({ data: snapshot }) }),
    message(
      Message.RequestedUrl({
        request: Navigation.UrlRequest.Internal({ url }),
      }),
    ),
    Command.expectExact(LoadUrl({ href: Url.toString(url) })),
    Command.resolve(LoadUrl, Message.CompletedNavigate()),
  )
})
it.each(['updates', 'answer-history'])(
  'keeps %s shareable through page routing',
  page => {
    expect(pageOfPath(pathOfPage('fixture', page))).toBe(page)
  },
)
