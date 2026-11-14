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
  type,
  within,
} from 'foldkit/scene'
import { readFileSync } from 'node:fs'
import { it } from 'vitest'

import { Grill, type Snapshot } from './domain'
import {
  CopyQuestionKey,
  FillBox,
  Message,
  PageData,
  PushPage,
  ScrollToTop,
  init,
  update,
} from './main'
import { view } from './view'

const fixture = Schema.decodeUnknownSync(Grill)(
  JSON.parse(readFileSync('src/fixtures/grill.json', 'utf8')),
)
const grill: Grill = {
  ...fixture,
  steps: fixture.steps.slice(0, 3).map((step, index) => ({
    ...step,
    prose:
      index === 0
        ? ['This settles [[squad/rollout-window]] and names [[nowhere]].']
        : step.prose,
    question: {
      ...step.question,
      dependsOn: [],
      when: [],
      ...(index === 0
        ? {
            key: 'deploy-order',
            context:
              'Two services ship this week; their order decides who waits.',
          }
        : index === 1
          ? { key: 'squad/rollout-window' }
          : {}),
    },
  })),
}
const snapshot: Snapshot = {
  grill,
  answers: {},
  notes: {},
  own: {},
  asks: [],
  revisions: [],
  sends: [],
}
const loaded = {
  ...init(
    Option.getOrThrow(
      Url.fromString('http://127.0.0.1:4330/g/fixture/question/Q1'),
    ),
  ).model,
  page: PageData.Success({ data: snapshot }),
}

const fillOne = Mount.resolveAll([FillBox, Message.CompletedFillBox()])

it('shows the key beside the question number and copies it on click', () => {
  scene(
    { update, view },
    given(loaded),
    fillOne,
    expect(
      within(
        selector('.f-question-meta'),
        role('button', { name: 'Copy key deploy-order' }),
      ),
    ).toHaveText('deploy-order'),
    click(role('button', { name: 'Copy key deploy-order' })),
    Command.expectHas(CopyQuestionKey({ key: 'deploy-order' })),
    Command.resolve(
      CopyQuestionKey,
      Message.CompletedCopyQuestionKey({ key: 'deploy-order', copied: true }),
    ),
    expect(role('button', { name: 'Copied deploy-order' })).toExist(),
  )
})

it('opens the question with its title, then the ask, then its context', () => {
  scene(
    { update, view },
    given(loaded),
    fillOne,
    expect(selector('.f-question-reference .f-question-title')).toHaveText(
      grill.steps[0]!.question.title,
    ),
    expect(selector('.f-question-reference #ask-text-Q1')).toHaveText(
      grill.steps[0]!.question.ask,
    ),
    expect(selector('.f-question-reference .f-question-lead')).toHaveText(
      'Two services ship this week; their order decides who waits.',
    ),
  )
})

it('shows no context line or key button for a question without them', () => {
  scene(
    { update, view },
    given({
      ...loaded,
      page: PageData.Success({
        data: { ...snapshot, grill: { ...grill, steps: grill.steps.slice(2) } },
      }),
    }),
    expect(selector('.f-question-lead')).not.toExist(),
    expect(selector('.f-question-key')).not.toExist(),
  )
})

it('names the key in sidebar rows and finds a question by its key', () => {
  scene(
    { update, view },
    given({ ...loaded, currentPart: 'overview' }),
    expect(selector('#question-node-Q1 .f-question-context')).toContainText(
      'deploy-order · ',
    ),
    type(
      role('searchbox', { name: 'Find question or issue' }),
      'rollout-window',
    ),
    expectAll(all.selector('.f-question-item')).toHaveCount(1),
    expect(selector('.f-question-item')).toContainText('Q2'),
  )
})

it('finds a question by its key from the question filter strip', () => {
  scene(
    { update, view },
    given(loaded),
    fillOne,
    type(
      role('searchbox', { name: 'Find a question or issue' }),
      'rollout-window',
    ),
    click(selector('.f-question-list-toggle')),
    expectAll(all.selector('.f-question-list-row')).toHaveCount(1),
    expect(selector('.f-question-list-row')).toContainText('Q2'),
  )
})

it('links a [[key]] reference to its question and leaves an unknown one as typed', () => {
  scene(
    { update, view },
    given(loaded),
    fillOne,
    expect(selector('#workspace-reasoning')).toContainText('[[nowhere]]'),
    click(
      within(
        selector('#workspace-reasoning'),
        role('button', { name: 'Go to Q2 (squad/rollout-window)' }),
      ),
    ),
    Command.resolve(PushPage, Message.CompletedNavigate()),
    Command.resolve(ScrollToTop, Message.CompletedScroll()),
    expect(selector('.f-question-meta')).toContainText('Q2'),
  )
})
