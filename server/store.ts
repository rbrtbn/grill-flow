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
  // A grill an agent on another machine writes into its outbox, and the files already taken in.
  db.exec(`CREATE TABLE IF NOT EXISTS grill_remotes (
    grill_id TEXT PRIMARY KEY,
    machine TEXT NOT NULL,
    dir TEXT NOT NULL
  )`)
  db.exec(`CREATE TABLE IF NOT EXISTS remote_files (
    machine TEXT NOT NULL,
    path TEXT NOT NULL,
    stamp TEXT NOT NULL,
    PRIMARY KEY (machine, path)
  )`)
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

export type Revision = Readonly<{
  stepId: string
  askId: number | null
  kind: 'rewrite' | 'comment'
  text: string
}>

/** Checks a reply against the grill and records it; the reason when it doesn't fit. */
export const reviseGrill = (
  db: Database,
  grill: Grill,
  revision: Revision,
): { ok: true; id: number } | { ok: false; reason: string } => {
  const isConcept = revision.stepId.startsWith('part:')
  if (
    isConcept
      ? !grill.parts.some(part => `part:${part.id}` === revision.stepId)
      : !grill.steps.some(step => step.id === revision.stepId)
  ) {
    return {
      ok: false,
      reason: `no step or concept ${revision.stepId} in ${grill.id}`,
    }
  }
  if (isConcept && revision.kind === 'rewrite') {
    return {
      ok: false,
      reason: 'a concept takes a comment; rewrite a step by its own id',
    }
  }
  if (
    revision.askId !== null &&
    !snapshot(db, grill).asks.some(
      ask => ask.id === revision.askId && ask.stepId === revision.stepId,
    )
  ) {
    return {
      ok: false,
      reason: `no ask ${revision.askId} on ${revision.stepId}`,
    }
  }
  return {
    ok: true,
    id: appendEvent(db, grill.id, 'revised', {
      ...revision,
      text: revision.text.trim(),
    }),
  }
}

/** Where a grill pulled from another machine's outbox lives there, if it was. */
export const remoteOf = (
  db: Database,
  grillId: string,
): { machine: string; dir: string } | undefined =>
  db
    .query<{ machine: string; dir: string }, [string]>(
      'SELECT machine, dir FROM grill_remotes WHERE grill_id = ?',
    )
    .get(grillId) ?? undefined

export const lastEventId = (db: Database, grillId: string): number =>
  db
    .query<{ id: number | null }, [string]>(
      'SELECT MAX(id) AS id FROM events WHERE grill_id = ?',
    )
    .get(grillId)?.id ?? 0

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

/** When anything last happened on a grill, its load included. */
export const lastActivity = (db: Database, grillId: string): number =>
  db
    .query<{ at: number | null }, [string]>(
      'SELECT MAX(at) AS at FROM events WHERE grill_id = ?',
    )
    .get(grillId)?.at ?? 0

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

const REPLY_LINE = /^(Q\d+) (?:other: |[^\s(]+)/

/**
 * The answer lines a send delivered. Sends record them; older ones only kept the message, so its
 * `Q<n> …` lines, or the picks in an all-recommended line, stand in.
 */
const sentLines = (
  payload: Record<string, unknown>,
): Record<string, string> => {
  if (typeof payload.lines === 'object' && payload.lines !== null) {
    return Object.fromEntries(
      Object.entries(payload.lines).map(([id, line]) => [id, String(line)]),
    )
  }
  const text = String(payload.text ?? '')
  const picks = /all recommended \(([^)]*)\)/.exec(text)?.[1]
  const lines = [
    ...text.split('\n'),
    ...(picks === undefined ? [] : picks.split(', ')),
  ]
  return Object.fromEntries(
    lines.flatMap(line => {
      const id = REPLY_LINE.exec(line)?.[1]
      return id === undefined ? [] : [[id, line]]
    }),
  )
}

export const snapshot = (db: Database, grill: Grill): Snapshot => {
  const answers: Record<string, string> = {}
  const notes: Record<string, string> = {}
  const own: Record<string, string> = {}
  const asks: Array<Snapshot['asks'][number]> = []
  const revisions: Array<Snapshot['revisions'][number]> = []
  const sends: Array<Snapshot['sends'][number]> = []
  const sent: Record<string, string> = {}
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
        if (p.ok === true) {
          Object.assign(sent, sentLines(p))
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
  return { grill, answers, notes, own, asks, revisions, sends, sent }
}
