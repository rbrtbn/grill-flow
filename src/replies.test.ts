import { Schema } from 'effect'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

import { Snapshot } from './domain'
import { decidedLine, replyOnQuestion, replySession } from './replies'

const fixture = JSON.parse(readFileSync('src/fixtures/grill.json', 'utf8'))
const snapshot = Schema.decodeUnknownSync(Snapshot)({
  grill: {
    ...fixture,
    session: 't-lead',
    sources: { 'alpha::t-builder': { text: 'Alpha prototypes' } },
    decided: [{ id: 'alpha::Q7', text: 'Ship it behind a flag.' }],
    steps: fixture.steps.map(
      (step: { question: Record<string, unknown> }, index: number) =>
        index === 0
          ? {
              ...step,
              question: {
                ...step.question,
                key: 'flag-default',
                from: 'alpha::t-builder',
                session: 't-builder',
              },
            }
          : step,
    ),
  },
  answers: {},
  notes: {},
  own: {},
  asks: [],
  revisions: [],
  sends: [],
  questionOrigins: { Q1: { grill: 'alpha', question: 'Q7' } },
  replies: [
    { id: 1, at: 1, text: 'Alpha prototypes:\n\nTaken in: flag-default → a.' },
    { id: 2, at: 2, text: 'Summary for the run.' },
  ],
})
const step = snapshot.grill.steps[0]!

it('files a reply under the session whose section opens it, else the lead', () => {
  expect(replySession(snapshot, snapshot.replies![0]!)).toBe('t-builder')
  expect(replySession(snapshot, snapshot.replies![1]!)).toBe('t-lead')
})

it('finds the reply naming a question key and its decided line by origin', () => {
  expect(replyOnQuestion(snapshot, step)?.id).toBe(1)
  expect(decidedLine(snapshot, step)).toBe('Ship it behind a flag.')
})
