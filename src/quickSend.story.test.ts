import { Option, Result, Schema } from 'effect'
import { Url } from 'foldkit'
import { Command, given, message, model, story } from 'foldkit/story'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

import { Grill, type Snapshot } from './domain'
import {
  Message,
  PageData,
  PostEvent,
  ReadQuickSendEditors,
  SendAnswers,
  init,
  update,
} from './main'

const fixture = Schema.decodeUnknownSync(Grill)(
  JSON.parse(readFileSync('src/fixtures/grill.json', 'utf8')),
)
const grill = {
  ...fixture,
  round: 2,
  steps: fixture.steps.slice(0, 2).map((step, index) => ({
    ...step,
    question: { ...step.question, dependsOn: [], when: [], round: index + 1 },
  })),
}
const snapshot: Snapshot = {
  grill,
  answers: { Q1: 'a', Q2: 'b' },
  notes: {},
  own: {},
  asks: [],
  revisions: [],
  sends: [],
}
const start = init(
  Option.getOrThrow(Url.fromString('http://localhost/g/fixture/question/Q1')),
).model
const loaded = {
  ...start,
  page: PageData.Success({ data: snapshot }),
  answers: snapshot.answers,
  sendMessage: 'Keep this message',
}
const captured = Message.CompletedReadQuickSendEditors({
  own: {},
  notes: {},
  message: loaded.sendMessage,
})

it('sends selected drafts across rounds from the question without opening review', () => {
  const selected = {
    ...loaded,
    workspace: { ...loaded.workspace, excluded: ['Q2'] },
  }
  story(
    update,
    given(selected),
    message(Message.ClickedQuickSend()),
    Command.expectExact(
      ReadQuickSendEditors({
        questions: ['Q1', 'Q2'],
        message: 'Keep this message',
      }),
    ),
    model(current =>
      expect(
        update(current, Message.ClickedQuickSend()).commands,
      ).toBeUndefined(),
    ),
    Command.resolve(ReadQuickSendEditors, captured),
    Command.expectExact(
      SendAnswers({
        grillId: grill.id,
        message: 'Keep this message',
        maybeQuestions: Option.some(['Q1']),
        expectedLines: { Q1: 'Q1 a', Q2: 'Q2 b' },
      }),
    ),
    model(current => {
      expect(current.currentPart).toBe('question:Q1')
      expect(
        update(current, Message.ClickedQuickSend()).commands,
      ).toBeUndefined()
    }),
    Command.resolve(
      SendAnswers,
      Message.CompletedSendAnswers({ result: Result.fail('Offline') }),
    ),
    model(current => {
      expect(current.answers).toEqual(selected.answers)
      expect(current.workspace.excluded).toEqual(['Q2'])
      expect(current.sendMessage).toBe('Keep this message')
    }),
  )
})

it('waits for blur writes, saves captured DOM text, then sends the matching lines', () => {
  const saved: Snapshot = {
    ...snapshot,
    answers: { Q1: 'other', Q2: 'b' },
    own: { Q1: 'Saved own' },
  }
  const initial = {
    ...loaded,
    page: PageData.Success({ data: saved }),
    answers: saved.answers,
    own: saved.own,
    pendingEvents: 1,
  }
  const answerBody = JSON.stringify({
    kind: 'answered',
    question: 'Q1',
    key: 'other',
    text: 'New choice',
  })
  const noteBody = JSON.stringify({
    kind: 'noted',
    question: 'Q1',
    text: 'New note',
  })
  const answerSaved = { ...saved, own: { Q1: 'New choice' } }
  story(
    update,
    given(initial),
    message(Message.ClickedQuickSend()),
    Command.resolve(
      ReadQuickSendEditors,
      Message.CompletedReadQuickSendEditors({
        own: { Q1: 'New choice' },
        notes: { Q1: 'New note' },
        message: loaded.sendMessage,
      }),
    ),
    Command.expectNone(),
    model(current => expect(current.quickSend).toBe('Saving')),
    message(Message.CompletedPostEvent({ result: Result.succeed(saved) })),
    Command.expectExact(
      PostEvent({ grillId: grill.id, body: answerBody }),
      PostEvent({ grillId: grill.id, body: noteBody }),
    ),
    Command.resolve(
      PostEvent({ grillId: grill.id, body: answerBody }),
      Message.CompletedPostEvent({
        result: Result.succeed(answerSaved),
        body: answerBody,
      }),
    ),
    Command.expectExact(PostEvent({ grillId: grill.id, body: noteBody })),
    Command.resolve(
      PostEvent,
      Message.CompletedPostEvent({
        result: Result.succeed({ ...answerSaved, notes: { Q1: 'New note' } }),
        body: noteBody,
      }),
    ),
    Command.expectExact(
      SendAnswers({
        grillId: grill.id,
        message: 'Keep this message',
        maybeQuestions: Option.some(['Q1', 'Q2']),
        expectedLines: { Q1: 'Q1 other: New choice (New note)', Q2: 'Q2 b' },
      }),
    ),
    Command.resolve(
      SendAnswers,
      Message.CompletedSendAnswers({ result: Result.succeed(snapshot) }),
    ),
  )
})

it('aborts a queued send on save failure and keeps the captured drafts', () => {
  story(
    update,
    given({ ...loaded, pendingEvents: 1 }),
    message(Message.ClickedQuickSend()),
    Command.resolve(ReadQuickSendEditors, captured),
    message(Message.CompletedPostEvent({ result: Result.fail('Offline') })),
    Command.expectNone(),
    model(current => {
      expect(current.quickSend).toBe('Idle')
      expect(current.sendMessage).toBe('Keep this message')
      expect(current.answers).toEqual(loaded.answers)
      expect(current.maybeSaveError).toEqual(Option.some('Offline'))
    }),
  )
})

it.each([{}, { Q1: 'a' }])(
  'never sends an empty effective selection %j',
  answers => {
    const reading = update(
      {
        ...loaded,
        answers,
        workspace: { ...loaded.workspace, excluded: ['Q1', 'Q2'] },
      },
      Message.ClickedQuickSend(),
    )
    const empty = update(reading.model, captured)
    expect(empty.commands).toBeUndefined()
    expect(empty.model.quickSend).toBe('Idle')
    expect(empty.model.currentPart).toBe(loaded.currentPart)
  },
)

it('keeps oversized editor text instead of repeatedly saving a clipped value', () => {
  const own = { Q1: 'x'.repeat(4001) }
  const reading = update(
    { ...loaded, answers: { Q1: 'other' } },
    Message.ClickedQuickSend(),
  )
  const failed = update(
    reading.model,
    Message.CompletedReadQuickSendEditors({ own, notes: {}, message: '' }),
  )
  expect(failed.commands).toBeUndefined()
  expect(failed.model.quickSend).toBe('Idle')
  expect(failed.model.own).toEqual(own)
  expect(failed.model.sendDetail).toContain('4,000 characters')
})
