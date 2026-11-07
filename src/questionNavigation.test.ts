import { Option, Schema } from 'effect'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { Grill, questionTopic, urgencyDetail } from './domain'
import {
  adjacentQuestion,
  flattenQuestions,
  initialWorkspace,
  questionForest,
  questionGroups,
  questionParents,
  revealQuestion,
} from './workspace'

const fixture = Schema.decodeUnknownSync(Grill)(
  JSON.parse(readFileSync('src/fixtures/grill.json', 'utf8')),
)
const first = fixture.steps[0]!
const grill = {
  ...fixture,
  steps: fixture.steps.slice(0, 3).map((step, index) => ({
    ...step,
    part: first.part,
    question: {
      ...step.question,
      dependsOn: [],
      when: [],
      ...(index === 1 ? {} : { topic: 'Grants' }),
    },
  })),
}
const snapshot = {
  grill,
  answers: {},
  notes: {},
  own: {},
  asks: [],
  revisions: [],
  sends: [],
}

describe('topic grouping and urgency', () => {
  it('uses explicit topics, part titles and an unassigned fallback', () => {
    expect(
      questionTopic(grill, {
        ...first,
        question: { ...first.question, topic: '  Grants  ' },
      }),
    ).toBe('Grants')
    expect(
      questionTopic(grill, {
        ...first,
        question: { ...first.question, topic: '  ' },
      }),
    ).toBe(grill.parts.find(part => part.id === first.part)?.title)
    expect(questionTopic(grill, { ...first, part: 'missing' })).toBe(
      'Other questions',
    )
  })

  it('shows blocking urgency and a supplied time without inferring a time', () => {
    expect(
      Option.getOrThrow(
        urgencyDetail({
          ...first.question,
          urgency: 'soon',
          blocksAt: '2026-11-07T14:00:00+01:00',
        }),
      ),
    ).toBe('Blocks soon · Starts blocking 2026-11-07T14:00:00+01:00')
    expect(
      Option.getOrThrow(
        urgencyDetail({ ...first.question, urgency: 'blocking' }),
      ),
    ).toBe('Blocking')
    expect(
      Option.getOrThrow(urgencyDetail({ ...first.question, urgency: 'fyi' })),
    ).toBe('For information')
    expect(Option.isNone(urgencyDetail(first.question))).toBe(true)
  })

  it('keeps topic order stable through filtering and uses it for question navigation', () => {
    const workspace = {
      ...initialWorkspace,
      grouping: 'Topic' satisfies typeof initialWorkspace.grouping,
    }
    const labels = questionGroups(workspace, snapshot, {}, {}, {}).map(
      group => group.label,
    )
    expect(labels).toEqual(['Grants', questionTopic(grill, grill.steps[1]!)])
    expect(
      questionGroups(
        { ...workspace, filter: 'Open' },
        snapshot,
        { Q1: 'a' },
        {},
        {},
      ).map(group => group.label),
    ).toEqual(labels)
    expect(
      Option.getOrThrow(
        adjacentQuestion(
          workspace,
          snapshot,
          {},
          {},
          {},
          'question:Q1',
          'Next',
        ),
      ).question.id,
    ).toBe('Q3')
    expect(
      Option.getOrThrow(
        adjacentQuestion(
          workspace,
          snapshot,
          {},
          {},
          {},
          'question:Q3',
          'Next',
        ),
      ).question.id,
    ).toBe('Q2')
  })
})

const linked = (
  dependencies: ReadonlyArray<ReadonlyArray<string>>,
  conditions = false,
) => ({
  ...snapshot,
  grill: {
    ...grill,
    steps: grill.steps.map((step, index) => ({
      ...step,
      question: {
        ...step.question,
        round: index + 1,
        session: `worker-${index}`,
        dependsOn: conditions ? [] : (dependencies[index] ?? []),
        when: conditions
          ? (dependencies[index] ?? []).map(question => ({
              question,
              oneOf: ['a'],
            }))
          : [],
      },
    })),
  },
})

describe('the unblocking forest', () => {
  it.each([false, true])(
    'uses the first open blocker and moves on after an answer (conditions=%s)',
    conditions => {
      const state = linked([[], [], ['Q1', 'Q2']], conditions)
      expect(questionParents(state, {}).get('Q3')).toBe('Q1')
      expect(questionParents(state, { Q1: 'a' }).get('Q3')).toBe('Q2')
      expect(questionParents(state, { Q1: 'a', Q2: 'a' }).has('Q3')).toBe(false)
    },
  )

  it.each(['Round', 'Agent', 'Topic'] satisfies ReadonlyArray<
    typeof initialWorkspace.grouping
  >)('keeps each dependent under its blocker across %s groups', grouping => {
    const state = linked([[], ['Q1'], ['Q2', 'Q1']])
    const groups = questionGroups(
      { ...initialWorkspace, grouping },
      state,
      {},
      {},
      {},
    )
    expect(groups).toHaveLength(1)
    expect(groups[0]?.roots[0]?.step.question.id).toBe('Q1')
    expect(
      groups[0]?.roots[0]?.children[0]?.children[0]?.step.question.id,
    ).toBe('Q3')
    expect(
      groups.flatMap(group => group.steps.map(step => step.question.id)),
    ).toEqual(['Q1', 'Q2', 'Q3'])
  })

  it('keeps cycles, self references and missing blockers from hiding questions', () => {
    const state = linked([['Q2'], ['Q1'], ['Q3', 'missing']])
    const forest = questionForest(initialWorkspace, state, {}, {}, {})
    const ids = flattenQuestions(forest).map(step => step.question.id)
    expect(new Set(ids).size).toBe(3)
    expect(ids).toHaveLength(3)
    expect(questionParents(state, {}).has('Q3')).toBe(false)
  })

  it('promotes matching descendants when filters hide their blocker', () => {
    const state = linked([[], ['Q1'], ['Q2']])
    const forest = questionForest(
      { ...initialWorkspace, search: 'Q3' },
      state,
      {},
      {},
      {},
    )
    expect(forest.map(node => node.step.question.id)).toEqual(['Q3'])
  })

  it('does not nest a question whose condition is ruled out', () => {
    const state = linked([[], [], ['Q1', 'Q2']], true)
    expect(questionParents(state, { Q1: 'b' }).has('Q3')).toBe(false)
  })

  it('opens a selected descendant’s collapsed ancestors and topic group', () => {
    const state = linked([[], ['Q1'], ['Q2']])
    const workspace = {
      ...initialWorkspace,
      grouping: 'Topic' satisfies typeof initialWorkspace.grouping,
      foldedTopics: ['Grants'],
      foldedQuestions: ['Q1', 'Q2'],
    }
    const revealed = revealQuestion(workspace, state, {}, {}, {}, 'Q3')
    expect(revealed.foldedQuestions).toEqual([])
    expect(revealed.foldedTopics).toEqual([])
  })
})
