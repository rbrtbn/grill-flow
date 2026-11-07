import { Schema } from 'effect'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

import { Grill, OWN, type Snapshot } from './domain'
import { workspaceLines } from './workspace'

const snapshot: Snapshot = {
  grill: Schema.decodeUnknownSync(Grill)(
    JSON.parse(readFileSync('src/fixtures/grill.json', 'utf8')),
  ),
  answers: {},
  notes: {},
  own: {},
  asks: [],
  revisions: [],
  sends: [],
}

it('refreshes reply lines after choices, notes and custom text change', () => {
  const answers = { Q1: 'a' }
  const notes = {}
  const own = {}
  expect(workspaceLines(snapshot, answers, notes, own).Q1).toBe('Q1 a')
  expect(workspaceLines(snapshot, answers, notes, own).Q1).toBe('Q1 a')
  expect(workspaceLines(snapshot, { Q1: 'b' }, notes, own).Q1).toBe('Q1 b')
  expect(workspaceLines(snapshot, answers, { Q1: 'Because' }, own).Q1).toBe(
    'Q1 a (Because)',
  )
  const custom = { Q1: OWN }
  expect(workspaceLines(snapshot, custom, notes, own).Q1).toBeUndefined()
  expect(workspaceLines(snapshot, custom, notes, { Q1: 'My words' }).Q1).toBe(
    'Q1 other: My words',
  )
  expect(workspaceLines(snapshot, custom, notes, { Q1: 'New words' }).Q1).toBe(
    'Q1 other: New words',
  )
})

it('refreshes eligibility when a poll replaces the question definition', () => {
  const answers = { Q1: 'a' }
  const notes = {}
  const own = {}
  expect(workspaceLines(snapshot, answers, notes, own).Q1).toBe('Q1 a')
  const revised = {
    ...snapshot,
    grill: {
      ...snapshot.grill,
      steps: snapshot.grill.steps.map(step => ({
        ...step,
        question: {
          ...step.question,
          options: step.question.options.filter(option => option.key !== 'a'),
        },
      })),
    },
  }
  expect(workspaceLines(revised, answers, notes, own).Q1).toBeUndefined()
  expect(workspaceLines(snapshot, answers, notes, own).Q1).toBe('Q1 a')
})
