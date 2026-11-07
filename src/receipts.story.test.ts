import { Option, Result, Schema } from 'effect'
import { Url } from 'foldkit'
import { Command, given, message, model, story } from 'foldkit/story'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

import { Grill, type Snapshot } from './domain'
import { Message, PageData, PostEvent, init, update } from './main'

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
  questionRevisions: { Q1: 'shown-revision' },
}
const loaded = {
  ...init(
    Option.getOrThrow(Url.fromString('http://localhost/g/fixture/question/Q1')),
  ).model,
  page: PageData.Success({ data: snapshot }),
}

it('submits the shown revision and preserves a rejected choice until it is reviewed again', () => {
  const body = JSON.stringify({
    kind: 'answered',
    question: 'Q1',
    key: 'a',
    contextRevision: 'shown-revision',
  })
  const reviewed = JSON.stringify({
    kind: 'answered',
    question: 'Q1',
    key: 'b',
    contextRevision: 'new-revision',
  })
  const incoming = { ...snapshot, questionRevisions: { Q1: 'new-revision' } }
  story(
    update,
    given(loaded),
    message(Message.SelectedOption({ question: 'Q1', key: 'a' })),
    Command.expectExact(PostEvent({ grillId: 'fixture', body })),
    Command.resolve(
      PostEvent,
      Message.CompletedPostEvent({
        result: Result.fail('Question wording changed'),
        body,
      }),
    ),
    model(current => {
      expect(current.answers.Q1).toBe('a')
      expect(current.failedWrites).toEqual([body])
    }),
    message(Message.CompletedLoadGrill({ result: Result.succeed(incoming) })),
    model(current => expect(current.failedWrites).toEqual([body])),
    message(Message.SelectedOption({ question: 'Q1', key: 'b' })),
    Command.expectExact(PostEvent({ grillId: 'fixture', body: reviewed })),
    Command.resolve(
      PostEvent,
      Message.CompletedPostEvent({
        result: Result.succeed({ ...incoming, answers: { Q1: 'b' } }),
        body: reviewed,
      }),
    ),
    model(current => {
      expect(current.answers.Q1).toBe('b')
      expect(current.failedWrites).toEqual([])
      expect(current.maybeSaveError).toEqual(Option.none())
    }),
  )
})
