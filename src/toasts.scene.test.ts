import { Option, Schema } from 'effect'
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
import { expect as assert, describe, it } from 'vitest'

import { Grill, type Snapshot } from './domain'
import {
  Message,
  PageData,
  PushPage,
  ScrollToTop,
  init,
  unreadMessagesOf,
  update,
} from './main'
import { view } from './view'

const grill = Schema.decodeUnknownSync(Grill)(
  JSON.parse(readFileSync('src/fixtures/grill.json', 'utf8')),
)
const snapshot: Snapshot = {
  grill,
  answers: {},
  notes: {},
  own: {},
  asks: [],
  revisions: [],
  sends: [],
  replies: Array.from({ length: 5 }, (_, index) => ({
    id: index + 1,
    at: index + 1,
    text: `Agent reply ${index + 1}`,
  })),
}
const start = init(
  Option.getOrThrow(
    Url.fromString('http://127.0.0.1:4317/g/fixture/question/Q1'),
  ),
).model
const loaded = {
  ...start,
  readSince: Option.some(0),
  page: PageData.Success({ data: snapshot }),
}

describe('agent toast notifications', () => {
  it('hides expired countdowns without marking replies read or replaying older toasts', () => {
    scene(
      { update, view },
      given(loaded),
      expectAll(all.selector('.toast')).toHaveCount(3),
      expectAll(all.selector('.toast-progress')).toHaveCount(3),
      expect(role('button', { name: '2 more in Replies' })).toHaveHandler(
        'click',
      ),
      expect(selector('.toast-progress')).toHaveHandler('animationend'),
    )
    const expired = ['reply-5', 'reply-4', 'reply-3'].reduce(
      (model, id) => update(model, Message.EndedToastCountdown({ id })).model,
      loaded,
    )
    assert(expired.readIds).toEqual([])
    assert(unreadMessagesOf(expired)).toHaveLength(5)
    scene(
      { update, view },
      given(expired),
      expectAll(all.selector('.toast')).toHaveCount(0),
    )
  })

  it('opens the Replies page from the overflow button in the workspace', () => {
    scene(
      { update, view },
      given(loaded),
      click(role('button', { name: '2 more in Replies' })),
      Command.resolve(PushPage, Message.CompletedNavigate()),
      Command.resolve(ScrollToTop, Message.CompletedScroll()),
      expect(selector('.f-replies-page h1')).toHaveText('Replies & decisions'),
      expect(selector('#agent-reply-1')).toContainText('Agent reply 1'),
    )
  })

  it('opens the legacy Replies panel from the overflow button', () => {
    scene(
      { update, view },
      given({ ...loaded, currentPart: 'part-1' }),
      click(role('button', { name: '2 more in Replies' })),
      expect(selector('.replies-list')).toExist(),
    )
  })
})
