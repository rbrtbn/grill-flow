import { Option, Schema } from 'effect'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

import { Grill, type Snapshot } from './domain'
import {
  type QuestionUrgencyFilter,
  adjacentQuestion,
  initialWorkspace,
  questionFilterFrom,
  questionGroups,
  questionSortFrom,
  questionUrgencyFilterFrom,
  revealQuestion,
  roundScopesFrom,
  sidebarRoundName,
  visibleQuestions,
} from './workspace'

const fixture = JSON.parse(readFileSync('src/fixtures/grill.json', 'utf8'))
const levels = [
  'blocking',
  'soon',
  'wait',
  'fyi',
  undefined,
  'blocking',
  'blocking',
]
const grill = Schema.decodeUnknownSync(Grill)({
  ...fixture,
  steps: levels.map((urgency, index) => ({
    ...fixture.steps[0],
    id: `step-${index + 1}`,
    question: {
      id: `Q${index + 1}`,
      title: `Filter question ${index + 1}`,
      scope: 'This choice',
      ask: `Choose item ${index + 1}?`,
      options: fixture.steps[0].question.options,
      dependsOn: [],
      when: [],
      ...(urgency === undefined ? {} : { urgency }),
    },
  })),
})
const snapshot: Snapshot = {
  grill,
  answers: { Q6: 'a', Q7: 'a' },
  notes: {},
  own: {},
  asks: [],
  revisions: [],
  sends: [],
  sent: { Q7: 'Q7 a' },
}
const visible = (urgencyFilter: QuestionUrgencyFilter) =>
  visibleQuestions(
    { ...initialWorkspace, filter: 'All', urgencyFilter },
    snapshot,
    snapshot.answers,
    {},
    {},
  ).map(step => step.question.id)

it.each([
  { level: 'blocking', ids: ['Q1', 'Q6', 'Q7'] },
  { level: 'soon', ids: ['Q2'] },
  { level: 'wait', ids: ['Q3'] },
  { level: 'fyi', ids: ['Q4'] },
  { level: 'unspecified', ids: ['Q5'] },
] satisfies ReadonlyArray<{
  level: QuestionUrgencyFilter
  ids: ReadonlyArray<string>
}>)(
  'filters $level without assigning missing urgency to another level',
  ({ level, ids }) => {
    expect(visible(level)).toEqual(ids)
    expect(visible('All')).toHaveLength(7)
  },
)

it('intersects urgency with status and search', () => {
  const workspace = {
    ...initialWorkspace,
    urgencyFilter: questionUrgencyFilterFrom('blocking'),
  }
  expect(
    visibleQuestions(
      { ...workspace, filter: 'Draft' },
      snapshot,
      snapshot.answers,
      {},
      {},
    ).map(step => step.question.id),
  ).toEqual(['Q6'])
  expect(
    visibleQuestions(
      { ...workspace, filter: 'Sent' },
      snapshot,
      snapshot.answers,
      {},
      {},
    ).map(step => step.question.id),
  ).toEqual(['Q7'])
  expect(
    visibleQuestions(
      { ...workspace, filter: 'Open', search: 'no matching words' },
      snapshot,
      snapshot.answers,
      {},
      {},
    ),
  ).toEqual([])
})

it('locates filtered-out current questions for navigation and group reveal', () => {
  const workspace = {
    ...initialWorkspace,
    urgencyFilter: questionUrgencyFilterFrom('soon'),
    foldedRounds: [1],
  }
  expect(
    Option.getOrThrow(
      adjacentQuestion(
        workspace,
        snapshot,
        snapshot.answers,
        {},
        {},
        'question:Q1',
        'Next',
      ),
    ).question.id,
  ).toBe('Q2')
  const revealed = revealQuestion(
    workspace,
    snapshot,
    snapshot.answers,
    {},
    {},
    'Q1',
  )
  expect(revealed.foldedRounds).toEqual([])
  expect(revealed.urgencyFilter).toBe('soon')
})

it.each([undefined, null, 123, false, {}, [], 'invalid', ''])(
  'defaults invalid saved filters %j safely',
  value => {
    expect(questionFilterFrom(value)).toBe(value === undefined ? 'Open' : 'All')
    expect(questionUrgencyFilterFrom(value)).toBe('All')
  },
)

it('keeps valid saved status and urgency values', () => {
  expect(questionFilterFrom('Sent')).toBe('Sent')
  expect(questionUrgencyFilterFrom('unspecified')).toBe('unspecified')
  expect(questionUrgencyFilterFrom('blocking')).toBe('blocking')
})

it('combines the attention view with the selected round and search', () => {
  const state = {
    ...snapshot,
    grill: {
      ...grill,
      steps: grill.steps.map((step, index) => ({
        ...step,
        question: { ...step.question, round: index < 2 ? 1 : 2 },
      })),
    },
  }
  const workspace = {
    ...initialWorkspace,
    filter: questionFilterFrom('Open'),
    urgencyFilter: questionUrgencyFilterFrom('urgent'),
    roundScopes: { [grill.id]: [1] },
  }
  expect(
    visibleQuestions(workspace, state, state.answers, {}, {}).map(
      step => step.question.id,
    ),
  ).toEqual(['Q1', 'Q2'])
  expect(
    visibleQuestions(
      { ...workspace, search: 'question 2' },
      state,
      state.answers,
      {},
      {},
    ).map(step => step.question.id),
  ).toEqual(['Q2'])
  expect(
    visibleQuestions(
      { ...workspace, roundScopes: { [grill.id]: [2] } },
      state,
      state.answers,
      {},
      {},
    ),
  ).toEqual([])
  expect(
    visibleQuestions(
      { ...workspace, roundScopes: { [grill.id]: [999] } },
      state,
      state.answers,
      {},
      {},
    ).map(step => step.question.id),
  ).toEqual(['Q1', 'Q2'])
})

it('uses round scope for arrows and reveals the target round without discarding filters', () => {
  const state = {
    ...snapshot,
    grill: {
      ...grill,
      steps: grill.steps.map((step, index) => ({
        ...step,
        question: { ...step.question, round: index < 2 ? 1 : 2 },
      })),
    },
  }
  const workspace = {
    ...initialWorkspace,
    roundScopes: { [grill.id]: [2], 'another-grill': [4] },
    search: 'Filter question',
  }
  expect(
    Option.getOrThrow(
      adjacentQuestion(
        workspace,
        state,
        state.answers,
        {},
        {},
        'question:Q1',
        'Next',
      ),
    ).question.id,
  ).toBe('Q3')
  expect(
    Option.isNone(
      adjacentQuestion(
        workspace,
        state,
        state.answers,
        {},
        {},
        'question:Q3',
        'Previous',
      ),
    ),
  ).toBe(true)
  const revealed = revealQuestion(workspace, state, state.answers, {}, {}, 'Q2')
  expect(revealed.roundScopes).toEqual({
    [grill.id]: [2, 1],
    'another-grill': [4],
  })
  expect(revealed.search).toBe(workspace.search)
})

it('validates persisted round scopes and uses trimmed names with a numbered fallback', () => {
  expect(
    roundScopesFrom({
      alpha: 2,
      negative: -1,
      fractional: 1.5,
      huge: Infinity,
    }),
  ).toEqual({ alpha: [2] })
  expect(roundScopesFrom({ alpha: '2' })).toEqual({})
  expect(roundScopesFrom(null)).toEqual({})
  const state = {
    ...snapshot,
    grill: {
      ...grill,
      roundNames: { '1': '  Feature choices  ', '2': '  ' },
      roundNumbers: { '2': 7 },
    },
  }
  expect(sidebarRoundName(state, 1)).toBe('Feature choices')
  expect(sidebarRoundName(state, 2)).toBe('Round 7')
})

it('migrates single rounds and normalizes multiselect preferences', () => {
  expect(
    roundScopesFrom({ legacy: 2, multi: [3, 1, 3, -1, 2.5], empty: [] }),
  ).toEqual({ legacy: [2], multi: [3, 1] })
  expect(questionSortFrom('Recency')).toBe('Recency')
  expect(questionSortFrom('invalid')).toBe('Round')
})

it('sorts globally by urgency or newest question number while retaining round order as the default', () => {
  const state = {
    ...snapshot,
    grill: {
      ...grill,
      steps: [
        {
          ...grill.steps[3]!,
          question: { ...grill.steps[3]!.question, id: 'Q9', round: 1 },
        },
        {
          ...grill.steps[0]!,
          question: { ...grill.steps[0]!.question, id: 'Q2', round: 2 },
        },
        {
          ...grill.steps[1]!,
          question: { ...grill.steps[1]!.question, id: 'Q8', round: 1 },
        },
        {
          ...grill.steps[2]!,
          question: { ...grill.steps[2]!.question, id: 'Q4', round: 2 },
        },
      ],
    },
  }
  const ids = (sort: 'Urgency' | 'Round' | 'Recency') =>
    questionGroups(
      { ...initialWorkspace, filter: 'All', sort },
      state,
      {},
      {},
      {},
    ).flatMap(group => group.steps.map(step => step.question.id))
  expect(ids('Urgency')).toEqual(['Q2', 'Q8', 'Q4', 'Q9'])
  expect(ids('Recency')).toEqual(['Q9', 'Q8', 'Q4', 'Q2'])
  expect(ids('Round')).toEqual(['Q9', 'Q8', 'Q2', 'Q4'])
  const dependent = {
    ...state,
    grill: {
      ...state.grill,
      steps: state.grill.steps.map(step =>
        step.question.id === 'Q2'
          ? { ...step, question: { ...step.question, dependsOn: ['Q4'] } }
          : step,
      ),
    },
  }
  expect(
    questionGroups(
      { ...initialWorkspace, sort: 'Urgency' },
      dependent,
      {},
      {},
      {},
    ).flatMap(group => group.steps.map(step => step.question.id)),
  ).toEqual(['Q4', 'Q2', 'Q8', 'Q9'])
})
