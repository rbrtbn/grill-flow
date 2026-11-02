import { Database } from 'bun:sqlite'
import { Schema } from 'effect'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { Grill, OWN, type Snapshot } from '../src/domain'

export const ROOT = join(import.meta.dir, '..')
const DB_PATH = process.env.GF_DB ?? join(ROOT, 'data', 'grill-flow.sqlite')

export type EventKind =
  | 'loaded'
  | 'answered'
  | 'cleared'
  | 'noted'
  | 'asked'
  | 'revised'
  | 'sent'

type EventRow = Readonly<{
  id: number
  grill_id: string
  at: number
  kind: EventKind
  payload: string
}>

export const open = (): Database => {
  mkdirSync(dirname(DB_PATH), { recursive: true, mode: 0o700 })
  const db = new Database(DB_PATH, { create: true })
  db.exec('PRAGMA journal_mode = WAL')
  db.exec(`CREATE TABLE IF NOT EXISTS grills (
    id TEXT PRIMARY KEY,
    json TEXT NOT NULL,
    loaded_at INTEGER NOT NULL
  )`)
  // Every interaction is kept as an event, so later pages can be tuned from how earlier ones were used.
  db.exec(`CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    grill_id TEXT NOT NULL,
    at INTEGER NOT NULL,
    kind TEXT NOT NULL,
    payload TEXT NOT NULL
  )`)
  db.exec('CREATE INDEX IF NOT EXISTS events_grill ON events (grill_id, id)')
  return db
}

export const decodeGrill = Schema.decodeUnknownSync(Grill)

export const loadGrill = (db: Database, raw: unknown): Grill => {
  const grill = decodeGrill(raw)
  db.run(
    'INSERT INTO grills (id, json, loaded_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json, loaded_at = excluded.loaded_at',
    [grill.id, JSON.stringify(grill), Date.now()],
  )
  appendEvent(db, grill.id, 'loaded', {
    round: grill.round,
    steps: grill.steps.length,
  })
  return grill
}

export const getGrill = (db: Database, id: string): Grill | undefined => {
  const row = db
    .query<{ json: string }, [string]>('SELECT json FROM grills WHERE id = ?')
    .get(id)
  return row ? decodeGrill(JSON.parse(row.json)) : undefined
}

export const listGrills = (
  db: Database,
): ReadonlyArray<{ id: string; title: string; loadedAt: number }> =>
  db
    .query<{ id: string; json: string; loaded_at: number }, []>(
      'SELECT id, json, loaded_at FROM grills ORDER BY loaded_at DESC',
    )
    .all()
    .map(row => ({
      id: row.id,
      title: (JSON.parse(row.json) as { title: string }).title,
      loadedAt: row.loaded_at,
    }))

export const appendEvent = (
  db: Database,
  grillId: string,
  kind: EventKind,
  payload: unknown,
): number => {
  const result = db.run(
    'INSERT INTO events (grill_id, at, kind, payload) VALUES (?, ?, ?, ?)',
    [grillId, Date.now(), kind, JSON.stringify(payload)],
  )
  return Number(result.lastInsertRowid)
}

export const events = (
  db: Database,
  grillId: string,
  sinceId = 0,
): ReadonlyArray<EventRow> =>
  db
    .query<EventRow, [string, number]>(
      'SELECT id, grill_id, at, kind, payload FROM events WHERE grill_id = ? AND id > ? ORDER BY id',
    )
    .all(grillId, sinceId)

export const snapshot = (db: Database, grill: Grill): Snapshot => {
  const answers: Record<string, string> = {}
  const notes: Record<string, string> = {}
  const own: Record<string, string> = {}
  const asks: Array<Snapshot['asks'][number]> = []
  const revisions: Array<Snapshot['revisions'][number]> = []
  const sends: Array<Snapshot['sends'][number]> = []
  for (const event of events(db, grill.id)) {
    const p = JSON.parse(event.payload) as Record<string, unknown>
    switch (event.kind) {
      case 'answered':
        answers[String(p.question)] = String(p.key)
        if (p.key === OWN) {
          own[String(p.question)] = String(p.text ?? '')
        }
        break
      case 'cleared':
        delete answers[String(p.question)]
        break
      case 'noted':
        notes[String(p.question)] = String(p.text)
        break
      case 'asked':
        asks.push({
          id: event.id,
          stepId: String(p.stepId),
          text: String(p.text),
          at: event.at,
          answered: false,
        })
        break
      case 'revised': {
        const askId = typeof p.askId === 'number' ? p.askId : null
        revisions.push({
          id: event.id,
          stepId: String(p.stepId),
          askId,
          kind: p.kind === 'comment' ? 'comment' : 'rewrite',
          text: String(p.text),
          at: event.at,
        })
        const ask = asks.find(a => a.id === askId)
        if (ask) {
          asks[asks.indexOf(ask)] = { ...ask, answered: true }
        }
        break
      }
      case 'sent':
        if (p.what === 'ask') {
          break
        }
        sends.push({
          at: event.at,
          ok: p.ok === true,
          detail: String(p.detail ?? ''),
        })
        break
      case 'loaded':
        break
    }
  }
  return { grill, answers, notes, own, asks, revisions, sends }
}
