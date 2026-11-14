import { Database } from 'bun:sqlite'
import { afterEach, describe, expect, it, setSystemTime } from 'bun:test'
import { readFileSync } from 'node:fs'

import { readPage } from './squad'
import {
  appendEvent,
  getGrill,
  loadGrill,
  reviseGrill,
  snapshot,
} from './store'

const fixture = JSON.parse(readFileSync('src/fixtures/grill.json', 'utf8'))
const databases = new Set<Database>()

afterEach(() => {
  setSystemTime()
  databases.forEach(db => db.close())
  databases.clear()
})

const database = (): Database => {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE grills (id TEXT PRIMARY KEY, json TEXT, loaded_at INTEGER);
    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      grill_id TEXT, at INTEGER, kind TEXT, payload TEXT
    );
  `)
  databases.add(db)
  return db
}

describe('reference titles on reload', () => {
  it.each(['LAB-1054', '   '])(
    'keeps a known issue title when a reload supplies %j',
    text => {
      const db = database()
      loadGrill(db, {
        ...fixture,
        refs: {
          'LAB-1054': {
            text: 'Lead wiki: grill the open ideas',
            state: 'Backlog',
          },
        },
      })
      loadGrill(db, {
        ...fixture,
        refs: { 'LAB-1054': { text, state: 'In Progress', type: 'started' } },
      })
      expect(getGrill(db, fixture.id)?.refs?.['LAB-1054']).toEqual({
        text: 'Lead wiki: grill the open ideas',
        state: 'In Progress',
        type: 'started',
      })
    },
  )

  it('accepts an updated title from the new load', () => {
    const db = database()
    loadGrill(db, { ...fixture, refs: { 'LAB-1054': { text: 'Old title' } } })
    loadGrill(db, { ...fixture, refs: { 'LAB-1054': { text: 'New title' } } })
    expect(getGrill(db, fixture.id)?.refs?.['LAB-1054']?.text).toBe('New title')
  })

  it('loads an ID-only reference when no title is known', () => {
    const db = database()
    loadGrill(db, { ...fixture, refs: { 'LAB-1054': { text: 'LAB-1054' } } })
    expect(getGrill(db, fixture.id)?.refs?.['LAB-1054']?.text).toBe('LAB-1054')
  })
})

it('keeps owner round names across a writer reload without changing round memberships', () => {
  const db = database()
  const grill = loadGrill(db, { ...fixture, roundNames: { '1': 'Stages' } })
  appendEvent(db, grill.id, 'renamed-round', {
    round: 1,
    name: 'Stage definitions',
  })
  loadGrill(db, { ...fixture, roundNames: { '1': 'Writer name' } })
  const state = snapshot(db, getGrill(db, grill.id)!)
  expect(state.grill.roundNames).toEqual({ '1': 'Stage definitions' })
  expect(
    state.grill.steps.map(step => [step.question.id, step.question.round]),
  ).toEqual(grill.steps.map(step => [step.question.id, step.question.round]))
})

describe('question times', () => {
  const at = (minute: number): number => Date.UTC(2026, 10, 13, 22, minute)
  const loadAt = (db: Database, minute: number, raw: unknown) => {
    setSystemTime(at(minute))
    return loadGrill(db, raw)
  }
  const retitled = (id: string, title: string) =>
    fixture.steps.map((step: { question: { id: string } }) =>
      step.question.id === id
        ? { ...step, question: { ...step.question, title } }
        : step,
    )

  it('dates a question by the load that added it and the latest load that changed it', () => {
    const db = database()
    const [first, ...rest] = fixture.steps
    loadAt(db, 0, { ...fixture, steps: rest })
    loadAt(db, 5, fixture)
    const grill = loadAt(db, 9, { ...fixture, steps: retitled('Q2', 'New') })
    const times = snapshot(db, grill).questionTimes!
    expect(times[first.question.id]).toEqual({ posted: at(5) })
    expect(times.Q2).toEqual({ posted: at(0), edited: at(9) })
    expect(times.Q3).toEqual({ posted: at(0) })
  })

  it('counts a rewrite of the step as an edit, and a comment as none', () => {
    const db = database()
    const grill = loadAt(db, 0, fixture)
    setSystemTime(at(3))
    reviseGrill(db, grill, {
      stepId: 'step-q2',
      askId: null,
      kind: 'rewrite',
      text: 'Clearer reasoning.',
    })
    setSystemTime(at(4))
    reviseGrill(db, grill, {
      stepId: 'step-q3',
      askId: null,
      kind: 'comment',
      text: 'Only a comment.',
    })
    const times = snapshot(db, grill).questionTimes!
    expect(times.Q2).toEqual({ posted: at(0), edited: at(3) })
    expect(times.Q3).toEqual({ posted: at(0) })
  })

  it('dates questions from loads that recorded no question changes by the first load', () => {
    const db = database()
    const grill = loadAt(db, 7, fixture)
    db.run("UPDATE events SET at = ?, payload = ? WHERE kind = 'loaded'", [
      at(1),
      JSON.stringify({ round: 1, steps: fixture.steps.length }),
    ])
    expect(snapshot(db, grill).questionTimes?.Q1).toEqual({ posted: at(1) })
  })

  it("keys a squad page's times by its shared question ids", () => {
    const db = database()
    const member = (id: string) => ({
      ...fixture,
      id,
      squad: { id: 'squad', section: id },
    })
    loadAt(db, 0, member('alpha'))
    loadAt(db, 2, member('beta'))
    loadAt(db, 6, { ...member('beta'), steps: retitled('Q1', 'Changed') })
    const page = readPage(db, 'squad')!
    const shared = page.members.find(entry => entry.state.grill.id === 'beta')!
      .registration.questions.Q1!
    expect(page.state.questionTimes?.[shared]).toEqual({
      posted: at(2),
      edited: at(6),
    })
  })
})
