import { Option, Schema } from 'effect'
import { Url } from 'foldkit'
import { given, message, model, story } from 'foldkit/story'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

import { Grill, type Snapshot, TEXT_LIMIT } from './domain'
import { Message, PageData, init, threadDraftKey, update } from './main'

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
const tooLong = 'x'.repeat(TEXT_LIMIT + 1)
const loaded = {
  ...init(
    Option.getOrThrow(Url.fromString('http://localhost/g/fixture/question/Q1')),
  ).model,
  page: PageData.Success({ data: snapshot }),
  talkDrafts: {
    [threadDraftKey('run')]: tooLong,
    [threadDraftKey('step-q1')]: tooLong,
    concept: tooLong,
  },
}

it.each([
  Message.ReadWorkspaceDiscussion({ target: 'run', text: tooLong }),
  Message.ReadThreadBox({ stepId: 'step-q1', text: tooLong }),
  Message.ReadTalkBox({ partId: 'concept', about: 'concept', text: tooLong }),
])('keeps an ask over the limit as a draft instead of posting it', read => {
  story(
    update,
    given(loaded),
    message(read),
    model(current => {
      expect(current.talkDrafts).toEqual(loaded.talkDrafts)
      expect(current.pendingEvents).toBe(0)
    }),
  )
  expect(update(loaded, read).commands).toBeUndefined()
})
