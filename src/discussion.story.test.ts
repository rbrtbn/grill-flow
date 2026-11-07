import { Option, Result, Schema } from 'effect'
import { Url } from 'foldkit'
import { Command, given, message, story } from 'foldkit/story'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

import { Grill, type Revision, type Snapshot } from './domain'
import { Message, PageData, ScrollDiscussion, init, update } from './main'

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
const loaded = {
  ...init(
    Option.getOrThrow(Url.fromString('http://localhost/g/fixture/question/Q1')),
  ).model,
  page: PageData.Success({ data: snapshot }),
}
const answer: Revision = {
  id: 42,
  at: 100,
  stepId: 'step-q1',
  askId: 41,
  kind: 'comment',
  text: 'A new explanation',
}

it('follows a new answer in the visible thread only when already at the bottom', () => {
  story(
    update,
    given(loaded),
    message(
      Message.CompletedLoadGrill({
        result: Result.succeed({ ...snapshot, revisions: [answer] }),
        discussion: { target: 'step-q1', atBottom: true },
      }),
    ),
    Command.expectExact(
      ScrollDiscussion({
        target: 'step-q1',
        maybeMessage: Option.some('answer-42'),
      }),
    ),
    Command.resolve(ScrollDiscussion, Message.CompletedScroll()),
  )
})

it.each([
  { target: 'step-q1', atBottom: false },
  { target: 'run', atBottom: true },
])('does not move a reader at $target, bottom=$atBottom', discussion => {
  const next = update(
    loaded,
    Message.CompletedLoadGrill({
      result: Result.succeed({ ...snapshot, revisions: [answer] }),
      discussion,
    }),
  )
  expect(next.commands).toBeUndefined()
})

it('does not follow an answer again on the next poll', () => {
  const incoming = { ...snapshot, revisions: [answer] }
  const next = update(
    { ...loaded, page: PageData.Success({ data: incoming }) },
    Message.CompletedLoadGrill({
      result: Result.succeed(incoming),
      discussion: { target: 'step-q1', atBottom: true },
    }),
  )
  expect(next.commands).toBeUndefined()
})

it('preserves the reading position when sending fails', () => {
  const next = update(
    loaded,
    Message.CompletedPostEvent({
      result: Result.fail('Offline'),
      body: JSON.stringify({ kind: 'asked', stepId: 'run', text: 'Question' }),
    }),
  )
  expect(next.commands ?? []).toEqual([])
})
