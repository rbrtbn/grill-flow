import { Option, Result, Schema } from 'effect'
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
  LoadWorkspaceCatalog,
  Message,
  OpenWorkspaceSettings,
  PageData,
  PostEvent,
  PushPage,
  RestoreBrowserNotices,
  RestoreDiscussionPosition,
  RestoreDiscussionScroll,
  SaveWorkspaceSettings,
  ScrollToQuestion,
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
const filled = Message.CompletedFillBox()
const fillOne = Mount.resolveAll([FillBox, filled])
const fillTwo = Mount.resolveAll([FillBox, filled], [FillBox, filled])

describe('the question workspace', () => {
  it('puts Updates under More and retains the named home destination', () => {
    scene(
      { update, view },
      given({
        ...loaded,
        talkDrafts: { 'ask:step-q1': 'Keep this unsent discussion draft' },
        page: PageData.Success({
          data: {
            ...snapshot,
            grill: { ...grill, title: 'My run - Open for you' },
          },
        }),
      }),
      Mount.resolveAll([FillBox, Message.CompletedFillBox()]),
      expect(role('button', { name: 'Session Board overview' })).toExist(),
      expect(selector('.f-run-name')).toHaveText('My run'),
      expect(selector('.f-primary-nav')).not.toContainText('Updates'),
      expect(selector('.f-primary-nav')).not.toContainText('Conversations'),
      expect(selector('.f-header-start')).toHaveText(
        /^Board\s*Inbox.*Questions.*Runs\s*More ▾/,
      ),
      expect(selector('.f-header-actions')).toHaveText(
        /Sessions.*Review & send.*Not in this design yet/,
      ),
      click(role('button', { name: 'Updates (old)' })),
      Command.resolve(PushPage, Message.CompletedNavigate()),
      Command.resolve(ScrollToTop, Message.CompletedScroll()),
      Mount.expectEnded(FillBox),
      expect(selector('.f-updates h1')).toHaveText('Updates'),
      click(role('button', { name: 'Session Board overview' })),
      Command.resolve(PushPage, Message.CompletedNavigate()),
      Command.resolve(ScrollToTop, Message.CompletedScroll()),
      Command.resolve(
        LoadWorkspaceCatalog,
        Message.CompletedLoadCatalog({ result: Result.succeed([]) }),
      ),
      expect(selector('.f-page h1')).toHaveText('Your grills'),
      click(
        within(
          role('navigation', { name: 'Workspace destinations' }),
          role('button', { name: /^Questions/ }),
        ),
      ),
      Command.resolve(PushPage, Message.CompletedNavigate()),
      Command.resolve(ScrollToTop, Message.CompletedScroll()),
      Mount.expectHas(FillBox({ text: 'Keep this unsent discussion draft' })),
      Mount.resolve(FillBox, Message.CompletedFillBox()),
    )
  })

  it('keeps urgency and draft status visible above the question', () => {
    scene(
      { update, view },
      given({
        ...loaded,
        answers: { Q1: 'a' },
        page: PageData.Success({
          data: {
            ...snapshot,
            grill: {
              ...grill,
              steps: grill.steps.map(step => ({
                ...step,
                question: { ...step.question, urgency: 'wait' },
              })),
            },
          },
        }),
      }),
      fillTwo,
      expect(selector('.f-question-meta')).toContainText('Can wait'),
      expect(selector('.f-question-meta')).toContainText('Draft · not sent'),
      click(role('button', { name: 'Next question' })),
      Command.resolve(PushPage, Message.CompletedNavigate()),
      Command.resolve(ScrollToTop, Message.CompletedScroll()),
      Mount.expectEnded(FillBox),
      expect(selector('.f-question-meta')).toContainText('Q2'),
    )
  })

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
      fillOne,
      expect(role('alert')).toContainText('Delivery is unconfirmed'),
      expect(role('alert')).toContainText('member-grill #72'),
      click(role('button', { name: 'Review drafts before sending again' })),
      Command.resolve(PushPage, Message.CompletedNavigate()),
      Command.resolve(ScrollToTop, Message.CompletedScroll()),
      expect(selector('.f-review')).toExist(),
    )
  })
  it('shows the title, ask, answer pills and summary with accessible arrow controls', () => {
    scene(
      { update, view },
      given(loaded),
      fillOne,
      expect(selector('.f-question-title')).toHaveText(
        grill.steps[0]!.question.title,
      ),
      expect(selector('#ask-text-Q1')).toHaveText(grill.steps[0]!.question.ask),
      expectAll(all.selector('.f-answer-row .f-answer-pill')).toHaveCount(3),
      expect(role('radio', { name: /Write my own/ })).toExist(),
      expect(selector('#workspace-reasoning')).toContainText('Summary'),
      expect(selector('#workspace-reasoning')).toContainText(
        'The reasoning behind',
      ),
      expect(role('button', { name: /^Trade-offs and details/ })).toExist(),
      expect(role('button', { name: 'Previous question' })).toBeDisabled(),
      expect(role('button', { name: 'Next question' })).toBeEnabled(),
      expect(selector('.f-question-meta')).toContainText('Q1'),
      expect(selector('.f-questions-bar .f-question-position')).toExist(),
      expect(selector('.f-question-list-toggle')).toContainText('1 of 21'),
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
      expect(selector('.f-review h1')).toHaveText('Review & send'),
      expect(selector('.f-review .f-table')).toContainText(
        grill.steps[0]!.question.options[0]!.label,
      ),
      expect(role('button', { name: 'Send 2 answers' })).toBeEnabled(),
      click(role('checkbox', { name: 'Send Q2' })),
      expect(role('button', { name: 'Send 1 answer' })).toBeEnabled(),
      expect(selector('#send-message')).toExist(),
      expect(role('button', { name: 'Discuss' })).not.toExist(),
      expect(role('button', { name: /^Sessions/ })).toExist(),
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
      fillOne,
      click(role('button', { name: /^Trade-offs and details/ })),
      Command.resolve(ScrollToQuestion, Message.CompletedScroll()),
      expect(selector('#workspace-reasoning .has-visible-title h3')).toHaveText(
        'The choice',
      ),
      expect(selector('#workspace-reasoning .has-visible-title p')).toHaveText(
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
      fillOne,
      click(selector('.f-question-list-toggle')),
      expectAll(all.selector('.f-question-list-row')).toHaveCount(size),
      expect(role('button', { name: 'Next question' })).toBeEnabled(),
    )
    scene(
      { update, view },
      given({
        ...loaded,
        currentPart: 'overview',
        page: PageData.Success({ data: many }),
      }),
      expectAll(all.selector('.f-question-item')).toHaveCount(size),
      expectAll(all.selector('.f-round')).toHaveCount(size / 10),
    )
  })

  it('wires clicking outside Settings to its close command', () => {
    scene(
      { update, view },
      given(loaded),
      fillOne,
      click(role('button', { name: 'Settings' })),
      Command.resolve(OpenWorkspaceSettings, Message.CompletedFocus()),
      Command.resolve(
        RestoreBrowserNotices,
        Message.CompletedRestoreBrowserNotices({
          result: { enabled: false, status: 'Default' },
        }),
      ),
      click(selector('.f-settings-backdrop')),
      Command.expectExact(CloseWorkspaceSettings()),
      Command.resolve(CloseWorkspaceSettings, Message.CompletedFocus()),
    )
  })
})

it('opens the sessions panel from the header without a Discuss link on the question', () => {
  scene(
    { update, view },
    given(loaded),
    fillOne,
    expect(role('button', { name: 'Discuss' })).not.toExist(),
    expectAll(all.selector('aside.f-sessions')).toHaveCount(0),
    click(role('button', { name: /^Sessions/ })),
    expect(selector('aside.f-sessions')).toExist(),
    expect(role('complementary', { name: 'Sessions' })).toExist(),
    expect(selector('aside.f-sessions h2')).toHaveText('Sessions'),
  )
})

it('sends a conversation starter on click without filling a draft', () => {
  scene(
    { update, view },
    given(loaded),
    fillOne,
    expect(role('region', { name: 'Conversation' })).toExist(),
    click(selector('.f-starters .f-starter')),
    Command.resolve(
      PostEvent,
      Message.CompletedPostEvent({ result: Result.fail('offline') }),
    ),
  )
})

it('returns to the composer and restores thread position when opening an existing run conversation', () => {
  scene(
    { update, view },
    given({
      ...loaded,
      side: 'Talk',
      inbox: { ...loaded.inbox, isSessionDirectory: false },
      workspace: {
        ...loaded.workspace,
        maybeDiscussionTarget: Option.some('step-q1'),
        discussionScroll: { run: 240 },
      },
    }),
    Mount.resolveAll(
      [FillBox, Message.CompletedFillBox()],
      [FillBox, Message.CompletedFillBox()],
      [RestoreDiscussionScroll, Message.CompletedRestoreDiscussionScroll()],
    ),
    expectAll(all.role('button', { name: 'Whole run' })).toHaveCount(0),
    Subscription.emit(Message.SelectedDiscussionTarget({ target: 'run' })),
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
    fillTwo,
    expect(role('button', { name: 'Send · 1', exact: true })).toExist(),
    expect(selector('.f-header-send-reserve')).toHaveAttr(
      'aria-hidden',
      'true',
    ),
    Subscription.emit(Message.UpdatedCommandHeld({ held: false })),
    expect(role('button', { name: '2 unsent', exact: true })).toExist(),
  )
})

it('shows a failed quick-send on the question page with a path to the remaining drafts', () => {
  scene(
    { update, view },
    given({ ...loaded, send: 'Failed', sendDetail: 'Agent unavailable' }),
    fillOne,
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
    given({
      ...loaded,
      currentPart: 'overview',
      page: PageData.Success({ data: state }),
    }),
    expect(role('button', { name: 'Filters' })).toHaveAttr(
      'popovertarget',
      'workspace-filters',
    ),
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

it('counts asks and replies beside a question with a discussion in the question list', () => {
  scene(
    { update, view },
    given({
      ...loaded,
      page: PageData.Success({
        data: {
          ...snapshot,
          discussions: {
            Q1: {
              target: 'step-q1',
              asks: 2,
              replies: 1,
              open: 1,
              lastAt: 3,
              firstAskId: 7,
            },
          },
        },
      }),
    }),
    fillOne,
    click(selector('.f-question-list-toggle')),
    expect(selector('.f-question-list .f-message-count')).toHaveText('3'),
    expect(selector('.f-question-list .f-message-count')).toHaveAttr(
      'title',
      '3 messages',
    ),
  )
})

it('shows no message count on a question without a discussion', () => {
  scene(
    { update, view },
    given(loaded),
    fillOne,
    click(selector('.f-question-list-toggle')),
    expectAll(all.selector('.f-question-list-row')).toHaveCount(21),
    expectAll(all.selector('.f-message-count')).toHaveCount(0),
  )
})

it('walks the filtered list with the arrows and shows the filter strip', () => {
  scene(
    { update, view },
    given(loaded),
    fillOne,
    expect(selector('.f-questions-bar')).toExist(),
    expect(role('searchbox', { name: 'Find a question or issue' })).toExist(),
    expect(role('group', { name: 'Show' })).toExist(),
    expect(selector('.f-question-filters')).toContainText('Session'),
    expect(selector('.f-question-filters')).toContainText('Urgency'),
    expect(selector('.f-question-filters')).toContainText('Round'),
    expectAll(all.selector('.f-question-list')).toHaveCount(0),
    click(selector('.f-question-list-toggle')),
    expect(selector('.f-question-list')).toExist(),
    click(role('button', { name: 'Next question' })),
    Command.resolve(PushPage, Message.CompletedNavigate()),
    Command.resolve(ScrollToTop, Message.CompletedScroll()),
    expect(selector('.f-question-meta')).toContainText('Q2'),
  )
})
