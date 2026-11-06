import { Option, Schema } from 'effect'
import { Url } from 'foldkit'
import {
  Command,
  Mount,
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
import { describe, it } from 'vitest'

import { Grill, type Snapshot } from './domain'
import {
  CloseWorkspaceSettings,
  FillBox,
  Message,
  OpenWorkspaceSettings,
  PageData,
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
  it('shows the full question, consequences and inline reasoning with accessible arrow controls', () => {
    scene(
      { update, view },
      given(loaded),
      expect(selector('.f-question-title')).toHaveText(
        grill.steps[0]!.question.ask,
      ),
      expectAll(all.selector('.f-reading .option-effect')).toHaveCount(2),
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
      expect(selector('.f-current-question')).toHaveText(''),
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
      Mount.resolveAll([FillBox, Message.CompletedFillBox()]),
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
