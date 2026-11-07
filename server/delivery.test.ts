import { Database } from 'bun:sqlite'
import { describe, expect, it } from 'bun:test'
import { Schema } from 'effect'
import { readFileSync } from 'node:fs'

import { Grill, type Snapshot } from '../src/domain'
import { sendAnswerBatches } from './delivery'
import { selectSend } from './sendSelection'
import { appendEvent, snapshot } from './store'

const fixture = Schema.decodeUnknownSync(Grill)(
  JSON.parse(readFileSync('src/fixtures/grill.json', 'utf8')),
)
const grill = {
  ...fixture,
  session: 'lead',
  round: 2,
  steps: fixture.steps.map((step, index) => ({
    ...step,
    question: {
      ...step.question,
      round: 1,
      ...(index === 0 ? { session: 'worker' } : {}),
    },
  })),
}
const state: Snapshot = {
  grill,
  answers: { Q1: 'a', Q2: 'b' },
  notes: {},
  own: {},
  asks: [],
  revisions: [],
  sends: [],
  sent: {},
}

describe('delivery to asking sessions', () => {
  it('sends each answer only to its asking session with fallback and round labels', async () => {
    const selection = selectSend(state, {
      questions: ['Q1', 'Q2'],
      message: 'Shared context',
    })
    if (!selection.ok) {
      throw new Error(selection.error)
    }
    const received: Array<{ session: string; text: string }> = []
    const result = await sendAnswerBatches(
      grill,
      selection,
      async (session, text) => {
        received.push({ session, text })
        return { ok: true, detail: 'received' }
      },
      'gf',
    )
    expect(result.ok).toBe(true)
    expect(received.map(item => item.session)).toEqual(['worker', 'lead'])
    expect(received[0]?.text).toContain('Q1 a')
    expect(received[0]?.text).not.toContain('Q2 b')
    expect(received[1]?.text).toContain('Q2 b')
    expect(received[1]?.text).not.toContain('Q1 a')
    expect(
      received.every(item => item.text.includes('Round 1 (sent late):')),
    ).toBe(true)
    expect(received.every(item => item.text.includes('Shared context'))).toBe(
      true,
    )
  })

  it('records successful recipients during a partial failure and retries only failures', async () => {
    const db = new Database(':memory:')
    db.exec(
      'CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, grill_id TEXT, at INTEGER, kind TEXT, payload TEXT)',
    )
    appendEvent(db, grill.id, 'answered', { question: 'Q1', key: 'a' })
    appendEvent(db, grill.id, 'answered', { question: 'Q2', key: 'b' })
    const selection = selectSend(state, { questions: ['Q1', 'Q2'] })
    if (!selection.ok) {
      throw new Error(selection.error)
    }
    const result = await sendAnswerBatches(
      grill,
      selection,
      async session => ({
        ok: session === 'worker',
        detail: session === 'worker' ? 'received' : 'unavailable',
      }),
      'gf',
    )
    appendEvent(db, grill.id, 'sent', { ...result, what: 'answers' })
    const after = snapshot(db, grill)
    expect(after.sent).toEqual({ Q1: 'Q1 a' })
    expect(after.sends.at(-1)?.ok).toBe(false)
    expect(after.sends.at(-1)?.detail).toContain('lead: unavailable')
    const retry = selectSend(after, { questions: ['Q1', 'Q2'] })
    if (!retry.ok) {
      throw new Error(retry.error)
    }
    expect(retry.lines).toEqual({ Q2: 'Q2 b' })
    db.close()
  })
})
