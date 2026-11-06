import { Option, Result, Schema } from 'effect'
import { Url } from 'foldkit'
import { Command, given, message, model, story } from 'foldkit/story'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { Grill, type Snapshot, answerLines } from './domain'
import {
  Message,
  PageData,
  PostEvent,
  PushPage,
  ScrollToTop,
  SendAnswers,
  init,
  pageOfPath,
  pathOfPage,
  update,
} from './main'
import {
  CONVERSATIONS,
  NEEDS,
  QUESTION_PAGE,
  REVIEW,
  adjacentQuestion,
  draftQuestions,
  initialWorkspace,
  questionState,
  roundIsCollapsed,
  visibleQuestions,
} from './workspace'

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

describe('workspace navigation and drafts', () => {
  it.each([`${QUESTION_PAGE}Q1`, REVIEW, CONVERSATIONS, NEEDS])(
    'keeps a shareable address for %s',
    page => {
      expect(pageOfPath(pathOfPage('fixture', page))).toBe(page)
    },
  )

  it('moves to the next matching question after the current answer leaves the Open filter', () => {
    const workspace = {
      ...initialWorkspace,
      filter: 'Open' satisfies typeof initialWorkspace.filter,
    }
    expect(
      Option.getOrThrow(
        adjacentQuestion(
          workspace,
          snapshot,
          { Q1: 'a' },
          {},
          {},
          `${QUESTION_PAGE}Q1`,
          'Next',
        ),
      ).question.id,
    ).toBe('Q2')
    story(
      update,
      given({ ...loaded, answers: { Q1: 'a' }, workspace }),
      message(Message.ClickedQuestionArrow({ direction: 'Next' })),
      model(current => {
        expect(current.currentPart).toBe(`${QUESTION_PAGE}Q2`)
        expect(current.workspace.maybeDiscussionTarget).toEqual(
          Option.some('step-q2'),
        )
      }),
      Command.expectExact(
        PushPage({ url: '/g/fixture/question/Q2' }),
        ScrollToTop(),
      ),
      Command.resolve(PushPage, Message.CompletedNavigate()),
      Command.resolve(ScrollToTop, Message.CompletedScroll()),
    )
  })

  it('keeps conversation drafts separate and preserves the question when expanding into Conversations', () => {
    const draft = update(
      loaded,
      Message.UpdatedTalkDraft({
        partId: 'ask:step-q1',
        value: 'What would change?',
      }),
    ).model
    const moved = update(
      draft,
      Message.ClickedWorkspacePage({ page: CONVERSATIONS }),
    ).model
    expect(moved.talkDrafts['ask:step-q1']).toBe('What would change?')
    expect(moved.workspace.maybeDiscussionTarget).toEqual(
      Option.some('step-q1'),
    )
    expect(moved.currentPart).toBe(CONVERSATIONS)
  })

  it('leaves a skipped question open and navigates to the next question route', () => {
    const moved = update(loaded, Message.ClickedSkip({ question: 'Q1' }))
    expect(moved.model.skipped).toContain('Q1')
    expect(moved.model.answers.Q1).toBeUndefined()
    expect(moved.model.currentPart).toBe(`${QUESTION_PAGE}Q2`)
  })

  it('treats a changed note as a draft even when its option was already sent', () => {
    const answers = { Q1: 'a' }
    const sent = answerLines(grill, answers, {})
    const prior = { ...snapshot, sent }
    const step = grill.steps[0]!
    expect(questionState(prior, step, answers, {}, {})).toBe('Sent')
    expect(
      questionState(prior, step, answers, { Q1: 'Only after review' }, {}),
    ).toBe('Draft')
  })

  it('does not count a ruled-out question or a removed answer key as a sendable draft', () => {
    const changed = { ...snapshot, answers: { Q1: 'removed' } }
    expect(
      questionState(changed, grill.steps[0]!, changed.answers, {}, {}),
    ).toBe('Open')
    expect(draftQuestions(changed, changed.answers, {}, {})).toEqual([])
    const open = visibleQuestions(
      { ...initialWorkspace, filter: 'Open' },
      snapshot,
      { Q1: 'b' },
      {},
      {},
    )
    expect(open.some(step => step.question.id === 'Q2')).toBe(false)
  })

  it('finds an issue or question regardless of state and does not offer an empty own answer for sending', () => {
    const answers = { Q1: 'other' }
    expect(
      visibleQuestions(
        { ...initialWorkspace, search: 'Q1' },
        snapshot,
        answers,
        {},
        {},
      ).some(step => step.question.id === 'Q1'),
    ).toBe(true)
    expect(draftQuestions(snapshot, answers, {}, {})).toEqual([])
  })

  it('lets a completed round be expanded after the automatic collapse', () => {
    const one = {
      ...snapshot,
      grill: { ...grill, steps: [grill.steps[0]!] },
      sent: { Q1: 'Q1 a' },
    }
    const current = {
      ...loaded,
      answers: { Q1: 'a' },
      page: PageData.Success({ data: one }),
    }
    expect(
      roundIsCollapsed(current.workspace, one, 1, current.answers, {}, {}),
    ).toBe(true)
    const expanded = update(current, Message.ClickedRound({ round: 1 })).model
    expect(
      roundIsCollapsed(expanded.workspace, one, 1, current.answers, {}, {}),
    ).toBe(false)
  })
})

describe('reviewing and sending real answers', () => {
  it('saves custom text and a note before keyboard navigation removes their editors', () => {
    const ownText = 'Use a narrower scope.'
    const note = 'Only for this run.'
    story(
      update,
      given({
        ...loaded,
        answers: { Q1: 'other' },
        own: { Q1: ownText },
        notes: { Q1: note },
      }),
      message(Message.PressedWorkspaceShortcut()),
      model(current => {
        expect(current.currentPart).toBe(REVIEW)
        expect(current.pendingEvents).toBe(2)
      }),
      Command.expectExact(
        PostEvent({
          grillId: 'fixture',
          body: JSON.stringify({
            kind: 'answered',
            question: 'Q1',
            key: 'other',
            text: ownText,
          }),
        }),
        PostEvent({
          grillId: 'fixture',
          body: JSON.stringify({ kind: 'noted', question: 'Q1', text: note }),
        }),
        PushPage({ url: '/g/fixture/review' }),
        ScrollToTop(),
      ),
      Command.resolve(
        PostEvent({
          grillId: 'fixture',
          body: JSON.stringify({
            kind: 'answered',
            question: 'Q1',
            key: 'other',
            text: ownText,
          }),
        }),
        Message.CompletedPostEvent({
          result: Result.succeed(snapshot),
          body: JSON.stringify({
            kind: 'answered',
            question: 'Q1',
            key: 'other',
            text: ownText,
          }),
        }),
      ),
      Command.resolve(
        PostEvent({
          grillId: 'fixture',
          body: JSON.stringify({ kind: 'noted', question: 'Q1', text: note }),
        }),
        Message.CompletedPostEvent({
          result: Result.succeed(snapshot),
          body: JSON.stringify({ kind: 'noted', question: 'Q1', text: note }),
        }),
      ),
      Command.resolve(PushPage, Message.CompletedNavigate()),
      Command.resolve(ScrollToTop, Message.CompletedScroll()),
    )
  })

  it('sends just the checked draft and guards against a second send while it is in flight', () => {
    const answers = { Q1: 'a', Q2: 'b' }
    const lines = answerLines(grill, answers, {}, {}, grill.steps)
    const review = {
      ...loaded,
      currentPart: REVIEW,
      answers,
      workspace: { ...initialWorkspace, excluded: ['Q2'] },
    }
    story(
      update,
      given(review),
      message(Message.ReadSendBox({ text: 'Use this as the default.' })),
      model(current => {
        expect(current.send).toBe('Sending')
        expect(
          update(
            current,
            Message.ReadSendBox({ text: 'Use this as the default.' }),
          ).commands,
        ).toBeUndefined()
      }),
      Command.expectExact(
        SendAnswers({
          grillId: 'fixture',
          message: 'Use this as the default.',
          maybeQuestions: Option.some(['Q1']),
          expectedLines: lines,
        }),
      ),
      Command.resolve(
        SendAnswers,
        Message.CompletedSendAnswers({ result: Result.fail('Not delivered') }),
      ),
    )
  })

  it('keeps drafts, exclusions and the message after a failed send', () => {
    const review = {
      ...loaded,
      currentPart: REVIEW,
      answers: { Q1: 'a' },
      sendMessage: 'Please explain the result.',
      workspace: { ...initialWorkspace, excluded: ['Q2'] },
    }
    const failed = update(
      review,
      Message.CompletedSendAnswers({
        result: Result.fail('Agent session unavailable'),
      }),
    ).model
    expect(failed.answers).toEqual(review.answers)
    expect(failed.sendMessage).toBe(review.sendMessage)
    expect(failed.workspace.excluded).toEqual(['Q2'])
    expect(failed.send).toBe('Failed')
  })

  it('keeps an unsent draft after successfully sending another answer', () => {
    const answers = { Q1: 'a', Q2: 'b' }
    const sent = {
      ...snapshot,
      answers,
      sent: { Q1: 'Q1 a' },
      sends: [{ at: 1, ok: true, detail: 'sent' }],
    }
    const review = { ...loaded, currentPart: REVIEW, answers }
    const after = update(
      review,
      Message.CompletedSendAnswers({ result: Result.succeed(sent) }),
    ).model
    expect(
      draftQuestions(sent, after.answers, after.notes, after.own).map(
        step => step.question.id,
      ),
    ).toEqual(['Q2'])
    expect(after.currentPart).toBe(REVIEW)
  })

  it('clears a failed write when a newer answer to the same question saves successfully', () => {
    const body = JSON.stringify({ kind: 'answered', question: 'Q1', key: 'a' })
    const failed = update(
      loaded,
      Message.CompletedPostEvent({ result: Result.fail('Offline'), body }),
    ).model
    const changed = update(
      failed,
      Message.SelectedOption({ question: 'Q1', key: 'b' }),
    ).model
    const saved = update(
      changed,
      Message.CompletedPostEvent({
        result: Result.succeed({ ...snapshot, answers: { Q1: 'b' } }),
        body: JSON.stringify({ kind: 'answered', question: 'Q1', key: 'b' }),
      }),
    ).model
    expect(saved.failedWrites).toEqual([])
    expect(saved.maybeSaveError).toEqual(Option.none())
  })

  it('does not send while saving and offers a retry after a write failure', () => {
    const answered = update(
      loaded,
      Message.SelectedOption({ question: 'Q1', key: 'a' }),
    ).model
    expect(answered.pendingEvents).toBe(1)
    expect(
      update(answered, Message.ReadSendBox({ text: '' })).commands,
    ).toBeUndefined()
    const body = JSON.stringify({ kind: 'answered', question: 'Q1', key: 'a' })
    const failed = update(
      answered,
      Message.CompletedPostEvent({ result: Result.fail('Offline'), body }),
    ).model
    expect(failed.answers.Q1).toBe('a')
    expect(failed.failedWrites).toEqual([body])
    const polled = update(
      failed,
      Message.CompletedLoadGrill({ result: Result.succeed(snapshot) }),
    ).model
    expect(polled.maybeSaveError).toEqual(Option.some('Offline'))
    expect(polled.failedWrites).toEqual([body])
    story(
      update,
      given(failed),
      message(Message.ClickedRetrySaves()),
      Command.expectExact(PostEvent({ grillId: 'fixture', body })),
      Command.resolve(
        PostEvent,
        Message.CompletedPostEvent({
          result: Result.succeed({ ...snapshot, answers: { Q1: 'a' } }),
          body,
        }),
      ),
      model(current => {
        expect(current.pendingEvents).toBe(0)
        expect(current.failedWrites).toEqual([])
        expect(current.maybeSaveError).toEqual(Option.none())
      }),
    )
  })
})
