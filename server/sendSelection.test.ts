import { Database } from 'bun:sqlite'
import { describe, expect, it } from 'bun:test'
import { Schema } from 'effect'
import { readFileSync } from 'node:fs'

import { Grill, type Snapshot, hasTarget } from '../src/domain'
import { askMessage } from './messages'
import { selectSend } from './sendSelection'
import { appendEvent, loadGrill, reviseGrill, snapshot } from './store'

const grill = Schema.decodeUnknownSync(Grill)(
  JSON.parse(readFileSync('src/fixtures/grill.json', 'utf8')),
)
const state: Snapshot = {
  grill,
  answers: { Q1: 'a', Q2: 'b' },
  notes: { Q2: 'Keep the fallback.' },
  own: {},
  asks: [],
  revisions: [],
  sends: [],
  sent: {},
}

describe('selective answer delivery', () => {
  it('includes only selected answers and records only those lines as sent', () => {
    const selection = selectSend(state, {
      questions: ['Q2'],
      expectedLines: { Q2: 'Q2 b (Keep the fallback.)' },
      message: '  Explain what happens next.  ',
    })
    expect(selection).toEqual({
      ok: true,
      reply: 'Selected answers:\nQ2 b (Keep the fallback.)',
      message: 'Explain what happens next.',
      lines: { Q2: 'Q2 b (Keep the fallback.)' },
    })
  })

  it('can send a draft from an earlier round without marking the current round sent', () => {
    const earlier = {
      ...state,
      grill: {
        ...grill,
        round: 2,
        steps: grill.steps.map(step => ({
          ...step,
          question: { ...step.question, round: 1 },
        })),
      },
    }
    const selection = selectSend(earlier, { questions: ['Q1'] })
    expect(selection.ok && selection.lines).toEqual({ Q1: 'Q1 a' })
  })

  it.each([
    null,
    { questions: 'Q1' },
    { questions: [] },
    { questions: ['unknown'] },
    { questions: ['Q1', 'Q1'] },
    { questions: [42] },
  ])('rejects an invalid selection %j', body => {
    const selection = selectSend(state, body)
    expect(selection.ok).toBe(false)
  })

  it('rejects a stale review rather than sending a different answer', () => {
    const selection = selectSend(state, {
      questions: ['Q2'],
      expectedLines: { Q2: 'Q2 a' },
    })
    expect(selection.ok === false && selection.status).toBe(409)
  })

  it('leaves unchanged sent answers out and rejects resending an entirely completed selection', () => {
    const selection = selectSend(
      { ...state, sent: { Q1: 'Q1 a' } },
      { questions: ['Q1', 'Q2'] },
    )
    expect(selection.ok && Object.keys(selection.lines)).toEqual(['Q2'])
    expect(
      selectSend({ ...state, sent: { Q1: 'Q1 a' } }, { questions: ['Q1'] }).ok,
    ).toBe(false)
  })

  it('rejects an answer key removed by the agent', () => {
    expect(
      selectSend(
        { ...state, answers: { Q1: 'removed' } },
        { questions: ['Q1'] },
      ).ok,
    ).toBe(false)
  })

  it('rejects an unwritten custom answer', () => {
    expect(
      selectSend({ ...state, answers: { Q1: 'other' } }, { questions: ['Q1'] })
        .ok,
    ).toBe(false)
  })

  it('preserves the legacy send request used by existing pages', () => {
    const selection = selectSend(state, { message: 'Hello' })
    expect(selection.ok && Object.keys(selection.lines)).toEqual(['Q1', 'Q2'])
    expect(selection.ok && selection.reply).toContain(
      'Q2 b (Keep the fallback.)',
    )
  })
})

describe('whole-run discussion delivery', () => {
  it('gives the agent the exact reply target and accepts a comment through the saved ask path', () => {
    const db = new Database(':memory:')
    db.exec(
      'CREATE TABLE grills (id TEXT PRIMARY KEY, json TEXT, loaded_at INTEGER); CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, grill_id TEXT, at INTEGER, kind TEXT, payload TEXT);',
    )
    try {
      loadGrill(db, grill)
      expect(hasTarget(grill, 'run')).toBe(true)
      const id = appendEvent(db, grill.id, 'asked', {
        stepId: 'run',
        text: 'What is the run waiting on?',
      })
      expect(
        askMessage(grill.id, 'run', id, 'What is the run waiting on?', 'gf'),
      ).toContain(`gf revise fixture run --ask ${id} --kind comment`)
      expect(
        askMessage(grill.id, 'run', id, 'What is the run waiting on?', 'gf'),
      ).toContain('the whole run')
      expect(
        reviseGrill(db, grill, {
          stepId: 'run',
          askId: id,
          kind: 'comment',
          text: 'Waiting on the design decision.',
        }).ok,
      ).toBe(true)
      expect(snapshot(db, grill).asks[0]?.answered).toBe(true)
      expect(
        reviseGrill(db, grill, {
          stepId: 'run',
          askId: id,
          kind: 'rewrite',
          text: 'Replace all reasoning.',
        }).ok,
      ).toBe(false)
    } finally {
      db.close()
    }
  })
})
