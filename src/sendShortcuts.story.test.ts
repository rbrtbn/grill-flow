import { Option, Result, Schema } from 'effect'
import { Url } from 'foldkit'
import { Command, given, message, model, story } from 'foldkit/story'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

import { Grill, type Snapshot } from './domain'
import {
  LeavePage,
  Message,
  PageData,
  ReadQuickSendEditors,
  SaveKeptBack,
  SendAnswers,
  init,
  update,
} from './main'
import { HOLD_SECONDS } from './sendShortcuts'
import { workspaceLines } from './workspace'

const fixture = Schema.decodeUnknownSync(Grill)(
  JSON.parse(readFileSync('src/fixtures/grill.json', 'utf8')),
)
// Two asking sessions across two rounds: Q1 and Q2 in the current round, Q3 in the older one.
const grill = {
  ...fixture,
  round: 2,
  steps: fixture.steps.slice(0, 3).map((step, index) => ({
    ...step,
    question: {
      ...step.question,
      dependsOn: [],
      when: [],
      round: index < 2 ? 2 : 1,
      session: index === 1 ? 'homelab' : 'grants',
    },
  })),
}
const answers = { Q1: 'a', Q2: 'b', Q3: 'a' }
const snapshot: Snapshot = {
  grill,
  answers,
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
  answers,
  sendMessage: 'Keep this message',
}
const lines = workspaceLines(snapshot, answers, {}, {})
const allQuestions = ['Q1', 'Q2', 'Q3']
const captured = Message.CompletedReadQuickSendEditors({
  own: {},
  notes: {},
  message: loaded.sendMessage,
})
const ticks = (count: number) =>
  Array.from({ length: count }, () => message(Message.TickedHeldSend()))

it('holds ⌘↵ for the undo window, then sends only that answer without the Review message', () => {
  story(
    update,
    given(loaded),
    message(Message.PressedWorkspaceShortcut()),
    Command.expectNone(),
    model(current =>
      expect(current.maybeHeldSend).toEqual(
        Option.some({ questions: ['Q1'], left: HOLD_SECONDS }),
      ),
    ),
    ...ticks(HOLD_SECONDS - 1),
    Command.expectNone(),
    message(Message.TickedHeldSend()),
    Command.expectExact(
      ReadQuickSendEditors({
        questions: allQuestions,
        message: 'Keep this message',
      }),
    ),
    Command.resolve(ReadQuickSendEditors, captured),
    Command.expectExact(
      SendAnswers({
        grillId: grill.id,
        message: '',
        maybeQuestions: Option.some(['Q1']),
        expectedLines: lines,
      }),
    ),
    Command.resolve(
      SendAnswers,
      Message.CompletedSendAnswers({
        result: Result.succeed({
          ...snapshot,
          sent: { Q1: lines['Q1']! },
          sends: [{ at: 1, ok: true, detail: 'sent to grants' }],
        }),
      }),
    ),
    model(current => {
      expect(current.sendMessage).toBe('Keep this message')
      expect(current.maybeSendSubset).toEqual(Option.none())
      expect(current.maybeHeldSend).toEqual(Option.none())
    }),
  )
})

it('cancels a held send on Undo, so nothing leaves the page', () => {
  story(
    update,
    given(loaded),
    message(Message.ClickedSendQuestions({ questions: ['Q1'] })),
    message(Message.ClickedUndoSend()),
    ...ticks(HOLD_SECONDS),
    Command.expectNone(),
    model(current => expect(current.maybeHeldSend).toEqual(Option.none())),
  )
})

it('joins a second send to the held one and restarts the window', () => {
  story(
    update,
    given(loaded),
    message(Message.ClickedSendQuestions({ questions: ['Q1'] })),
    ...ticks(2),
    message(Message.ClickedSendQuestions({ questions: ['Q2', 'Q1'] })),
    model(current =>
      expect(current.maybeHeldSend).toEqual(
        Option.some({ questions: ['Q1', 'Q2'], left: HOLD_SECONDS }),
      ),
    ),
  )
})

it('waits for a send in flight, then sends the held answers once it settles', () => {
  story(
    update,
    given({
      ...loaded,
      send: 'Sending' as const,
      maybeHeldSend: Option.some({ questions: ['Q2'], left: 1 }),
    }),
    message(Message.TickedHeldSend()),
    Command.expectNone(),
    model(current =>
      expect(current.maybeHeldSend).toEqual(
        Option.some({ questions: ['Q2'], left: 0 }),
      ),
    ),
    message(Message.CompletedSendAnswers({ result: Result.fail('Offline') })),
    Command.expectExact(
      ReadQuickSendEditors({
        questions: allQuestions,
        message: 'Keep this message',
      }),
    ),
    Command.resolve(ReadQuickSendEditors, captured),
    Command.expectExact(
      SendAnswers({
        grillId: grill.id,
        message: '',
        maybeQuestions: Option.some(['Q2']),
        expectedLines: lines,
      }),
    ),
    Command.resolve(
      SendAnswers,
      Message.CompletedSendAnswers({ result: Result.fail('Offline') }),
    ),
  )
})

it('sends the current round on ⇧⌘↵, leaving older rounds and kept-back drafts', () => {
  story(
    update,
    given({ ...loaded, keptBack: ['Q2'] }),
    message(Message.PressedRoundSendShortcut()),
    model(current =>
      expect(current.maybeHeldSend).toEqual(
        Option.some({ questions: ['Q1'], left: HOLD_SECONDS }),
      ),
    ),
  )
})

it('keeps a draft back from the Review send until it is ticked again', () => {
  story(
    update,
    given({ ...loaded, currentPart: 'review' }),
    message(Message.ClickedKeepBack({ question: 'Q2', kept: true })),
    Command.expectExact(SaveKeptBack({ grillId: grill.id, questions: ['Q2'] })),
    Command.resolve(SaveKeptBack, Message.CompletedSaveKeptBack()),
    message(Message.ReadSendBox({ text: '' })),
    Command.expectExact(
      SendAnswers({
        grillId: grill.id,
        message: '',
        maybeQuestions: Option.some(['Q1', 'Q3']),
        expectedLines: lines,
      }),
    ),
    Command.resolve(
      SendAnswers,
      Message.CompletedSendAnswers({ result: Result.fail('Offline') }),
    ),
    message(Message.ToggledReviewAnswer({ question: 'Q2' })),
    Command.expectExact(SaveKeptBack({ grillId: grill.id, questions: [] })),
    Command.resolve(SaveKeptBack, Message.CompletedSaveKeptBack()),
    model(current => {
      expect(current.keptBack).toEqual([])
      expect(current.workspace.excluded).toEqual([])
    }),
  )
})

it('moves through the tray newest round first, unticks a row and sends the rest', () => {
  story(
    update,
    given(loaded),
    message(Message.ClickedUnsentTray()),
    message(Message.PressedTrayKey({ key: 'Down' })),
    message(Message.PressedTrayKey({ key: 'Toggle' })),
    model(current => expect(current.workspace.excluded).toEqual(['Q2'])),
    message(Message.PressedWorkspaceShortcut()),
    model(current => {
      expect(current.isTrayOpen).toBe(false)
      expect(current.maybeHeldSend).toEqual(
        Option.some({ questions: ['Q1', 'Q3'], left: HOLD_SECONDS }),
      )
    }),
  )
})

it('keeps the cursor row back from the tray', () => {
  story(
    update,
    given(loaded),
    message(Message.ClickedUnsentTray()),
    message(Message.PressedTrayKey({ key: 'Down' })),
    message(Message.PressedTrayKey({ key: 'Keep' })),
    Command.expectExact(SaveKeptBack({ grillId: grill.id, questions: ['Q2'] })),
    Command.resolve(SaveKeptBack, Message.CompletedSaveKeptBack()),
    message(Message.PressedTrayKey({ key: 'Send' })),
    model(current =>
      expect(current.maybeHeldSend).toEqual(
        Option.some({ questions: ['Q1', 'Q3'], left: HOLD_SECONDS }),
      ),
    ),
  )
})

it('nudges only after the latest answer edit has gone quiet', () => {
  story(
    update,
    given({ ...loaded, answerActivity: 3 }),
    message(Message.ElapsedAnswerIdle({ activity: 2 })),
    model(current => expect(current.isNudging).toBe(false)),
    message(Message.ElapsedAnswerIdle({ activity: 3 })),
    model(current => expect(current.isNudging).toBe(true)),
    message(Message.ClickedNotYet()),
    model(current => expect(current.isNudging).toBe(false)),
  )
})

it('does not nudge when every unsent draft is kept back', () => {
  story(
    update,
    given({ ...loaded, answerActivity: 1, keptBack: allQuestions }),
    message(Message.ElapsedAnswerIdle({ activity: 1 })),
    model(current => expect(current.isNudging).toBe(false)),
  )
})

it('leaves for another page only after the ready drafts were delivered', () => {
  const href = 'http://localhost/g/other'
  story(
    update,
    given(loaded),
    message(Message.ClickedLeaveLink({ href })),
    message(Message.ClickedSendAndLeave()),
    Command.resolve(ReadQuickSendEditors, captured),
    Command.expectExact(
      SendAnswers({
        grillId: grill.id,
        message: '',
        maybeQuestions: Option.some(allQuestions),
        expectedLines: lines,
      }),
    ),
    Command.resolve(
      SendAnswers,
      Message.CompletedSendAnswers({
        result: Result.succeed({
          ...snapshot,
          sent: lines,
          sends: [{ at: 1, ok: true, detail: 'sent' }],
        }),
      }),
    ),
    Command.expectExact(LeavePage({ href })),
    Command.resolve(LeavePage, Message.CompletedLeavePage()),
  )
})

it('stays on the page when a send before leaving fails', () => {
  story(
    update,
    given(loaded),
    message(Message.ClickedLeaveLink({ href: 'http://localhost/g/other' })),
    message(Message.ClickedSendAndLeave()),
    Command.resolve(ReadQuickSendEditors, captured),
    Command.resolve(
      SendAnswers,
      Message.CompletedSendAnswers({ result: Result.fail('Offline') }),
    ),
    Command.expectNone(),
    model(current => {
      expect(current.maybeLeaving).toEqual(Option.none())
      expect(current.send).toBe('Failed')
    }),
  )
})
