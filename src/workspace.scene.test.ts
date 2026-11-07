import { Option, Schema } from 'effect'
import { Url } from 'foldkit'
import {
  Command,
  Mount,
  Subscription,
  all,
  change,
  click,
  expect,
  expectAll,
  given,
  role,
  scene,
  selector,
  within,
} from 'foldkit/scene'
import { readFileSync } from 'node:fs'
import { describe, it } from 'vitest'

import { Grill, type Snapshot } from './domain'
import {
  CloseWorkspaceSettings,
  FillBox,
  FocusTalkBox,
  Message,
  OpenWorkspaceSettings,
  PageData,
  PushPage,
  RestoreDiscussionPosition,
  RestoreDiscussionScroll,
  SaveWorkspaceSettings,
  ScrollToTop,
  init,
  update,
} from './main'
import { view } from './view'
import { CONVERSATIONS, REVIEW, initialWorkspace } from './workspace'

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
const loaded = { ...start, page: PageData.Success({ data: snapshot }) }

describe('the question workspace', () => {
  it('shows interrupted saved sends instead of silently treating their request replay as delivered', () => {
    scene(
      { update, view },
      given({
        ...loaded,
        page: PageData.Success({
          data: {
            ...snapshot,
            unconfirmedSends: [{ source: 'member-grill', send: 72 }],
          },
        }),
      }),
      expect(role('alert')).toContainText('Delivery is unconfirmed'),
      expect(role('alert')).toContainText('member-grill #72'),
      click(role('button', { name: 'Review drafts before sending again' })),
      Command.resolve(PushPage, Message.CompletedNavigate()),
      Command.resolve(ScrollToTop, Message.CompletedScroll()),
      Mount.resolve(FillBox, Message.CompletedFillBox()),
      expect(selector('.f-review')).toExist(),
    )
  })
  it('shows the full question, consequences and inline reasoning with accessible arrow controls', () => {
    scene(
      { update, view },
      given(loaded),
      expect(selector('.f-question-title')).toHaveText(
        grill.steps[0]!.question.ask,
      ),
      expectAll(all.selector('.f-reading .f-option-effect')).toHaveCount(3),
      expect(selector('#workspace-reasoning')).toContainText(
        'Why this question',
      ),
      expect(role('button', { name: 'Previous question' })).toBeDisabled(),
      expect(role('button', { name: 'Next question' })).toBeEnabled(),
      expect(selector('.f-current-question')).toHaveText('Q1'),
    )
  })

  it('shows human-readable answers in Review and updates the selected count with the checkbox', () => {
    const review = {
      ...loaded,
      currentPart: REVIEW,
      answers: { Q1: 'a', Q2: 'b' },
    }
    scene(
      { update, view },
      given(review),
      Mount.resolveAll([FillBox, Message.CompletedFillBox()]),
      expect(selector('.f-current-question')).toHaveText('Review & send'),
      expect(selector('.f-review .f-table')).toContainText(
        grill.steps[0]!.question.options[0]!.label,
      ),
      expect(role('button', { name: 'Send 2 answers' })).toBeEnabled(),
      click(role('checkbox', { name: 'Send Q2' })),
      expect(role('button', { name: 'Send 1 answer' })).toBeEnabled(),
      expect(selector('#send-message')).toExist(),
      expect(role('button', { name: 'Discuss' })).toExist(),
    )
  })

  it('marks an earlier answered question as not sent on its concept page', () => {
    const earlier = {
      ...snapshot,
      grill: {
        ...grill,
        round: 2,
        steps: grill.steps.map(step => ({
          ...step,
          question: {
            ...step.question,
            round: step.question.id === 'Q1' ? 1 : 2,
          },
        })),
      },
    }
    scene(
      { update, view },
      given({
        ...loaded,
        currentPart: 'part-1',
        answers: { Q1: 'a' },
        page: PageData.Success({ data: earlier }),
      }),
      expect(selector('#q-Q1 .unsent-tag')).toHaveText('not sent'),
    )
    scene(
      { update, view },
      given({
        ...loaded,
        currentPart: 'part-1',
        answers: { Q1: 'a' },
        page: PageData.Success({ data: { ...earlier, sent: { Q1: 'Q1 a' } } }),
      }),
      expect(selector('#q-Q1 .sent-tag')).toHaveText('sent'),
    )
  })

  it('includes older and unlisted picks in Review with visible round information and selectable delivery', () => {
    const earlier = {
      ...snapshot,
      grill: {
        ...grill,
        round: 2,
        steps: grill.steps.map(step => ({
          ...step,
          question: { ...step.question, round: 1 },
        })),
      },
    }
    scene(
      { update, view },
      given({
        ...loaded,
        currentPart: REVIEW,
        answers: { Q1: 'a', Q99: 'b' },
        page: PageData.Success({ data: earlier }),
      }),
      Mount.resolveAll([FillBox, Message.CompletedFillBox()]),
      expect(selector('.f-review-table')).toContainText('Round 1 (sent late)'),
      expect(selector('.f-review-table')).toContainText(
        'Question no longer listed · round unavailable',
      ),
      expect(selector('.f-review-table')).toContainText('Q99 b'),
      expect(role('button', { name: 'Send 2 answers' })).toBeEnabled(),
      click(role('checkbox', { name: 'Send Q99' })),
      expect(role('button', { name: 'Send 1 answer' })).toBeEnabled(),
    )
  })

  it('lets the legacy Send dialog send an older pick when the current round has no answers', () => {
    const earlier = {
      ...snapshot,
      grill: {
        ...grill,
        round: 2,
        steps: grill.steps.map(step => ({
          ...step,
          question: { ...step.question, round: 1 },
        })),
      },
    }
    scene(
      { update, view },
      given({
        ...loaded,
        currentPart: 'part-1',
        isSendOpen: true,
        answers: { Q1: 'a' },
        page: PageData.Success({ data: earlier }),
      }),
      Mount.resolveAll([FillBox, Message.CompletedFillBox()]),
      expect(selector('.send-counts')).toContainText(
        '1 answer ready to send across rounds',
      ),
      expect(selector('.send-preview')).toContainText('Round 1 (sent late):'),
      expect(selector('.send-actions .send-button')).toBeEnabled(),
    )
  })

  it('keeps the authored explanation headings visible in the reading flow', () => {
    const titled = {
      ...snapshot,
      grill: {
        ...grill,
        steps: grill.steps.map(step => ({
          ...step,
          prose: ['### The choice\nOnly this run is included.'],
        })),
      },
    }
    scene(
      { update, view },
      given({ ...loaded, page: PageData.Success({ data: titled }) }),
      expect(selector('.f-reasoning .has-visible-title h3')).toHaveText(
        'The choice',
      ),
      expect(selector('.f-reasoning .has-visible-title p')).toHaveText(
        'Only this run is included.',
      ),
    )
  })

  it('opens Review details without losing the composer or selected answers', () => {
    scene(
      { update, view },
      given({ ...loaded, currentPart: REVIEW, answers: { Q1: 'a' } }),
      Mount.resolveAll([FillBox, Message.CompletedFillBox()]),
      click(role('button', { name: 'Show details for Q1' })),
      expect(selector('.f-review-detail')).toContainText(
        grill.steps[0]!.question.ask,
      ),
      expect(selector('#send-message')).toExist(),
      expect(role('button', { name: 'Send 1 answer' })).toBeEnabled(),
      click(role('button', { name: 'Hide details for Q1' })),
      expectAll(all.selector('.f-review-detail')).toHaveCount(0),
    )
  })

  it('keeps the question and its answer choices available in the full conversation', () => {
    scene(
      { update, view },
      given({
        ...loaded,
        currentPart: CONVERSATIONS,
        workspace: {
          ...initialWorkspace,
          maybeDiscussionTarget: Option.some('step-q1'),
        },
      }),
      Mount.resolveAll(
        [FillBox, Message.CompletedFillBox()],
        [RestoreDiscussionScroll, Message.CompletedRestoreDiscussionScroll()],
      ),
      expect(selector('.f-context h3')).toContainText('Q1'),
      expect(selector('.f-context')).toContainText(
        grill.steps[0]!.question.ask,
      ),
      expect(selector('.f-context summary')).toHaveText(
        'What were the answers?',
      ),
      expect(selector('.f-context dl')).toContainText(
        grill.steps[0]!.question.options[0]!.label,
      ),
      expect(selector('#talk-box')).toExist(),
    )
  })

  it('lists both run replies and answers from question discussions', () => {
    const replies = {
      ...snapshot,
      replies: [{ id: 1, at: 2, text: 'The run is ready.' }],
      revisions: [
        {
          id: 7,
          at: 3,
          stepId: 'step-q1',
          askId: 6,
          kind: 'comment' satisfies 'comment',
          text: 'Here is why the first choice fits.',
        },
      ],
    }
    scene(
      { update, view },
      given({
        ...loaded,
        currentPart: 'replies',
        page: PageData.Success({ data: replies }),
      }),
      expect(selector('#agent-reply-1')).toContainText('The run is ready.'),
      expect(selector('#agent-answer-7')).toContainText(
        'Here is why the first choice fits.',
      ),
      expect(role('button', { name: 'Open discussion' })).toExist(),
    )
  })

  it.each([30, 60])('keeps %s questions available in separate rounds', size => {
    const first = grill.steps[0]!
    const steps = Array.from({ length: size }, (_, index) => ({
      ...first,
      id: `step-${index}`,
      question: {
        ...first.question,
        id: `Q${index + 1}`,
        title: `Question ${index + 1}`,
        ask: `Choose a scope for item ${index + 1}?`,
        round: Math.floor(index / 10) + 1,
        dependsOn: [],
        when: [],
      },
    }))
    const many = { ...snapshot, grill: { ...grill, steps } }
    scene(
      { update, view },
      given({ ...loaded, page: PageData.Success({ data: many }) }),
      expectAll(all.selector('.f-question-item')).toHaveCount(size),
      expectAll(all.selector('.f-round')).toHaveCount(size / 10),
      expect(role('button', { name: 'Next question' })).toBeEnabled(),
    )
  })

  it('wires clicking outside Settings to its close command', () => {
    scene(
      { update, view },
      given(loaded),
      click(role('button', { name: 'Settings' })),
      Command.resolve(OpenWorkspaceSettings, Message.CompletedFocus()),
      click(selector('.f-settings-backdrop')),
      Command.expectExact(CloseWorkspaceSettings()),
      Command.resolve(CloseWorkspaceSettings, Message.CompletedFocus()),
    )
  })
})

it('opens this question discussion from between the note and skip actions', () => {
  scene(
    { update, view },
    given(loaded),
    expect(selector('.f-answer-actions')).toContainText(
      'Add a noteDiscussSkip for now',
    ),
    click(
      within(
        selector('.f-answer-actions'),
        role('button', { name: 'Discuss' }),
      ),
    ),
    Mount.resolveAll(
      [FillBox, Message.CompletedFillBox()],
      [RestoreDiscussionScroll, Message.CompletedRestoreDiscussionScroll()],
    ),
    Command.resolve(FocusTalkBox, Message.CompletedFocus()),
    expect(selector('.f-discussion')).toExist(),
    expect(role('textbox', { name: 'Ask about Q1' })).toExist(),
  )
})

it('returns to the composer and restores thread position when switching discussion scope', () => {
  scene(
    { update, view },
    given({
      ...loaded,
      side: 'Talk',
      workspace: {
        ...loaded.workspace,
        maybeDiscussionTarget: Option.some('step-q1'),
        discussionScroll: { run: 240 },
      },
    }),
    Mount.resolveAll(
      [FillBox, Message.CompletedFillBox()],
      [RestoreDiscussionScroll, Message.CompletedRestoreDiscussionScroll()],
    ),
    click(role('button', { name: 'Whole run' })),
    expect(role('textbox', { name: 'Ask about the run' })).toExist(),
    Command.expectExact(
      RestoreDiscussionPosition({ top: 240 }),
      FocusTalkBox(),
    ),
    Command.resolve(
      RestoreDiscussionPosition,
      Message.CompletedRestoreDiscussionPosition(),
    ),
    Command.resolve(FocusTalkBox, Message.CompletedFocus()),
  )
})

it('shows the effective send count while Command is held and restores the review label', () => {
  scene(
    { update, view },
    given({
      ...loaded,
      answers: { Q1: 'a', Q2: 'b' },
      workspace: { ...loaded.workspace, excluded: ['Q2'] },
      isCommandHeld: true,
    }),
    expect(role('button', { name: 'Send · 1', exact: true })).toExist(),
    expect(selector('.f-header-send-reserve')).toHaveAttr(
      'aria-hidden',
      'true',
    ),
    Subscription.emit(Message.UpdatedCommandHeld({ held: false })),
    expect(
      role('button', { name: 'Review & send · 2', exact: true }),
    ).toExist(),
  )
})

it('shows a failed quick-send on the question page with a path to the remaining drafts', () => {
  scene(
    { update, view },
    given({ ...loaded, send: 'Failed', sendDetail: 'Agent unavailable' }),
    expect(role('alert')).toContainText('Not sent: Agent unavailable'),
    expect(role('button', { name: 'Review drafts' })).toExist(),
  )
})

it('filters sidebar questions by urgency and preserves an explicit unspecified choice', () => {
  const state = {
    ...snapshot,
    grill: {
      ...grill,
      steps: grill.steps.slice(0, 2).map((step, index) => ({
        ...step,
        question: {
          ...step.question,
          ...(index === 0 ? { urgency: 'blocking' satisfies 'blocking' } : {}),
        },
      })),
    },
  }
  scene(
    { update, view },
    given({ ...loaded, page: PageData.Success({ data: state }) }),
    click(role('button', { name: 'Custom filters' })),
    expect(role('combobox', { name: 'Urgency filter' })).toHaveValue('All'),
    change(role('combobox', { name: 'Urgency filter' }), 'blocking'),
    Command.resolve(
      SaveWorkspaceSettings,
      Message.CompletedSaveWorkspaceSettings(),
    ),
    expectAll(all.selector('.f-question-item')).toHaveCount(1),
    expect(selector('.f-question-item')).toContainText('Q1'),
    change(role('combobox', { name: 'Urgency filter' }), 'unspecified'),
    Command.resolve(
      SaveWorkspaceSettings,
      Message.CompletedSaveWorkspaceSettings(),
    ),
    expect(selector('.f-question-item')).toContainText('Q2'),
  )
})
