import { Database } from 'bun:sqlite'
import { afterEach, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

import { getGrill, loadGrill } from './store'

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
