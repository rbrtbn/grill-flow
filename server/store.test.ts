import { Database } from 'bun:sqlite'
import { afterEach, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

import { appendEvent, getGrill, loadGrill, snapshot } from './store'

const fixture = JSON.parse(readFileSync('src/fixtures/grill.json', 'utf8'))
const databases = new Set<Database>()

afterEach(() => {
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
