import { Option, Result, Schema } from 'effect'
import { Url } from 'foldkit'
import { Command, given, message, model, story } from 'foldkit/story'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { Grill, OWN, type Snapshot } from './domain'
import {
  ClearSendBox,
  InsertPastedText,
  Message,
  PageData,
  PostEvent,
  ReadNoteBox,
  ReadOwnBox,
  ReloadPage,
  init,
  update,
} from './main'
import { QUESTION_PAGE, REVIEW } from './workspace'

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
}
const start = init(
  Option.getOrThrow(
    Url.fromString('http://127.0.0.1:4330/g/fixture/question/Q1'),
  ),
).model
const loaded = {
  ...start,
  page: PageData.Success({ data: snapshot }),
  currentPart: `${QUESTION_PAGE}Q1`,
}
const noted = (text: string): string =>
  JSON.stringify({ kind: 'noted', question: 'Q1', text })
const answered = (text: string): string =>
  JSON.stringify({ kind: 'answered', question: 'Q1', key: OWN, text })

describe('text that reaches a box with no input event', () => {
  it('saves the note the box holds when it blurs', () => {
    story(
      update,
      given({ ...loaded, notes: { Q1: 'typed before' } }),
      message(Message.BlurredNote({ question: 'Q1' })),
      Command.expectExact(ReadNoteBox({ question: 'Q1' })),
      Command.resolve(
        ReadNoteBox,
        Message.CompletedReadNoteBox({
          question: 'Q1',
          maybeText: Option.some('dictated note'),
        }),
      ),
      model(current => expect(current.notes.Q1).toBe('dictated note')),
      Command.expectExact(
        PostEvent({ grillId: 'fixture', body: noted('dictated note') }),
      ),
      Command.resolve(
        PostEvent,
        Message.CompletedPostEvent({
          result: Result.succeed(snapshot),
          body: noted('dictated note'),
        }),
      ),
    )
  })

  it('saves the note the Model holds when the box left the page before it could be read', () => {
    story(
      update,
      given({ ...loaded, notes: { Q1: 'typed before' } }),
      message(
        Message.CompletedReadNoteBox({
          question: 'Q1',
          maybeText: Option.none(),
        }),
      ),
      Command.expectExact(
        PostEvent({ grillId: 'fixture', body: noted('typed before') }),
      ),
      Command.resolve(
        PostEvent,
        Message.CompletedPostEvent({
          result: Result.succeed(snapshot),
          body: noted('typed before'),
        }),
      ),
    )
  })

  it('saves the own answer the box holds when it blurs', () => {
    story(
      update,
      given({ ...loaded, answers: { Q1: OWN }, own: { Q1: '' } }),
      message(Message.BlurredOwnAnswer({ question: 'Q1' })),
      Command.expectExact(ReadOwnBox({ question: 'Q1' })),
      Command.resolve(
        ReadOwnBox,
        Message.CompletedReadOwnBox({
          question: 'Q1',
          maybeText: Option.some('dictated answer'),
        }),
      ),
      model(current => expect(current.own.Q1).toBe('dictated answer')),
      Command.expectExact(
        PostEvent({ grillId: 'fixture', body: answered('dictated answer') }),
      ),
      Command.resolve(
        PostEvent,
        Message.CompletedPostEvent({
          result: Result.succeed(snapshot),
          body: answered('dictated answer'),
        }),
      ),
    )
  })

  it('keeps the own text the box holds without saving it while another option is picked', () => {
    story(
      update,
      given({ ...loaded, answers: { Q1: 'a' } }),
      message(
        Message.CompletedReadOwnBox({
          question: 'Q1',
          maybeText: Option.some('dictated answer'),
        }),
      ),
      model(current => {
        expect(current.own.Q1).toBe('dictated answer')
        expect(current.pendingEvents).toBe(0)
      }),
      Command.expectNone(),
    )
  })

  it('empties the Review message box once the send went out', () => {
    const sent: Snapshot = {
      ...snapshot,
      answers: { Q1: 'a' },
      sends: [{ at: 1, ok: true, detail: 'sent' }],
    }
    story(
      update,
      given({
        ...loaded,
        currentPart: REVIEW,
        answers: { Q1: 'a' },
        send: 'Sending' as const,
        sendMessage: 'dictated message',
      }),
      message(Message.CompletedSendAnswers({ result: Result.succeed(sent) })),
      model(current => expect(current.sendMessage).toBe('')),
      Command.expectExact(ClearSendBox()),
      Command.resolve(ClearSendBox, Message.CompletedClearSendBox()),
    )
  })

  it('leaves the Review message box alone when the send failed', () => {
    story(
      update,
      given({
        ...loaded,
        currentPart: REVIEW,
        answers: { Q1: 'a' },
        send: 'Sending' as const,
        sendMessage: 'dictated message',
      }),
      message(
        Message.CompletedSendAnswers({ result: Result.fail('Not delivered') }),
      ),
      model(current => expect(current.sendMessage).toBe('dictated message')),
      Command.expectNone(),
    )
  })

  it('carries the Review message and every draft into a reload for a new build', () => {
    story(
      update,
      given({
        ...loaded,
        maybeBuild: Option.some('old-build'),
        sendMessage: 'unsent message',
        notes: { Q1: 'a note' },
        own: { Q1: 'an answer' },
        talkDrafts: { 'ask:step-q1': 'a question' },
      }),
      message(
        Message.CompletedCheckBuild({ maybeBuild: Option.some('new-build') }),
      ),
      Command.expectExact(
        ReloadPage({
          talkDrafts: { 'ask:step-q1': 'a question' },
          notes: { Q1: 'a note' },
          own: { Q1: 'an answer' },
          skipped: [],
          expanded: {},
          currentPart: `${QUESTION_PAGE}Q1`,
          sendMessage: 'unsent message',
        }),
      ),
      Command.resolve(ReloadPage, Message.CompletedReloadPage()),
    )
  })

  it('restores the Review message after the reload unless a newer one was typed', () => {
    const restored = Message.CompletedRestoreDrafts({
      talkDrafts: {},
      notes: {},
      own: {},
      skipped: [],
      expanded: {},
      currentPart: '',
      sendMessage: 'unsent message',
    })
    expect(update(loaded, restored).model.sendMessage).toBe('unsent message')
    expect(
      update({ ...loaded, sendMessage: 'newer' }, restored).model.sendMessage,
    ).toBe('newer')
  })

  it('inserts a pasted text itself instead of leaving it to the browser', () => {
    story(
      update,
      given(loaded),
      message(Message.PastedText({ text: 'dictated words' })),
      Command.expectExact(InsertPastedText({ text: 'dictated words' })),
      Command.resolve(InsertPastedText, Message.CompletedInsertPastedText()),
    )
  })
})
