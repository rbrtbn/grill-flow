import { Option, Schema } from 'effect'
import { Url } from 'foldkit'
import {
  Command,
  Mount,
  click,
  expect,
  given,
  role,
  scene,
  selector,
} from 'foldkit/scene'
import { readFileSync } from 'node:fs'
import { describe, it } from 'vitest'

import { Grill, type Snapshot } from './domain'
import {
  FillBox,
  FocusTalkBox,
  Message,
  PageData,
  RestoreDiscussionScroll,
  init,
  update,
} from './main'
import { view } from './view'
import { CONVERSATIONS, REVIEW, initialWorkspace } from './workspace'

const fixture = Schema.decodeUnknownSync(Grill)(
  JSON.parse(readFileSync('src/fixtures/grill.json', 'utf8')),
)
const grill = {
  ...fixture,
  session: 'lead',
  steps: fixture.steps.slice(0, 3).map((step, index) => ({
    ...step,
    question: {
      ...step.question,
      dependsOn: [],
      when: [],
      round: index + 1,
      ...(index === 0 ? { session: 'worker' } : {}),
    },
  })),
}
const snapshot: Snapshot = {
  grill,
  maintainerSession: 'builder',
  answers: {},
  notes: {},
  own: {},
  asks: [],
  revisions: [],
  sends: [],
}
const start = init(
  Option.getOrThrow(
    Url.fromString('http://127.0.0.1:4317/g/fixture/question/Q1'),
  ),
).model
const loaded = { ...start, page: PageData.Success({ data: snapshot }) }

describe('asking agents in the workspace', () => {
  it('shows the asking session on the question and each review answer', () => {
    scene(
      { update, view },
      given(loaded),
      Mount.resolveAll([FillBox, Message.CompletedFillBox()]),
      expect(selector('.f-question-meta')).toContainText('worker'),
    )
    scene(
      { update, view },
      given({ ...loaded, currentPart: REVIEW, answers: { Q1: 'a', Q2: 'b' } }),
      Mount.resolveAll([FillBox, Message.CompletedFillBox()]),
      expect(selector('.f-review-summary')).toContainText('2 recipients'),
      expect(selector('.f-review-table')).toContainText('To worker'),
      expect(selector('.f-review-table')).toContainText('To lead'),
      expect(selector('.f-review-compose label')).toHaveText(
        'Message to the selected recipients',
      ),
      click(role('checkbox', { name: 'Send Q1' })),
      expect(selector('.f-review-summary')).toContainText('1 recipient'),
    )
  })

  it('opens a distinct grill-flow conversation without changing the question thread', () => {
    scene(
      { update, view },
      given({
        ...loaded,
        currentPart: CONVERSATIONS,
        maybePrevious: Option.some('question:Q1'),
        workspace: {
          ...initialWorkspace,
          maybeDiscussionTarget: Option.some('step-q1'),
        },
      }),
      Mount.resolveAll(
        [FillBox, Message.CompletedFillBox()],
        [RestoreDiscussionScroll, Message.CompletedRestoreDiscussionScroll()],
      ),
      expect(selector('.f-context')).toContainText('Q1'),
      click(role('button', { name: /^Board/ })),
      Command.resolve(FocusTalkBox, Message.CompletedFocus()),
      expect(selector('.f-identity')).toContainText('builder'),
      expect(role('textbox', { name: 'Ask about the board' })).toExist(),
    )
  })
})
