import { Schema } from 'effect'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { Grill, replyText } from './domain'

const fixture = Schema.decodeUnknownSync(Grill)(
  JSON.parse(readFileSync('src/fixtures/grill.json', 'utf8')),
)
const template = fixture.steps[0]!
const grill = {
  ...fixture,
  round: 7,
  steps: [
    { id: 'Q11', round: 2 },
    { id: 'Q14', round: 3 },
    { id: 'Q35', round: 7 },
  ].map(question => ({
    ...template,
    id: `step-${question.id}`,
    question: { ...template.question, ...question },
  })),
}

describe('sending picks across rounds', () => {
  it('includes old non-recommended picks with their rounds and scopes all recommended to the current round', () => {
    const reply = replyText(grill, { Q11: 'b', Q14: 'a', Q35: 'a' }, {})
    expect(reply).toContain('Round 2 (sent late):\nQ11 b')
    expect(reply).toContain('Round 3 (sent late):\nQ14 a')
    expect(reply).toContain('Round 7: all recommended (Q35 a)')
    expect(reply).not.toContain('Round 2: all recommended')
    expect(reply).not.toContain('Round 3: all recommended')
  })

  it('includes a changed old note while leaving unchanged sent answers out', () => {
    const reply = replyText(
      grill,
      { Q11: 'b', Q14: 'a' },
      { Q11: 'After review' },
      {},
      { Q11: 'Q11 b', Q14: 'Q14 a' },
    )
    expect(reply).toContain('Round 2 (sent late):\nQ11 b (After review)')
    expect(reply).not.toContain('Q14 a')
  })

  it('recovers a saved pick whose question is no longer listed without inventing its round', () => {
    const reply = replyText(grill, { Q10: 'b' }, { Q10: 'Keep the fallback' })
    expect(reply).toContain(
      'Round unavailable (question no longer listed):\nQ10 b (Keep the fallback)',
    )
  })
})
