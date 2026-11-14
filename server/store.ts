import { Database } from 'bun:sqlite'
import { Schema } from 'effect'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

import {
  Grill,
  OWN,
  type QuestionTimes,
  Retirement,
  type Snapshot,
  hasTarget,
  isWholeTarget,
  roundOf,
} from '../src/domain'
import { DeliveryReceipt } from './delivery'
import { assertPickedOptionsRetained } from './reloadSafety'

export const ROOT = join(import.meta.dir, '..')
const DB_PATH = process.env.GF_DB ?? join(ROOT, 'data', 'grill-flow.sqlite')

export type EventKind =
  | 'squad-registered'
  | 'renamed-round'
  | 'loaded'
  | 'answered'
  | 'cleared'
  | 'noted'
  | 'asked'
  | 'revised'
  | 'sent'
  | 'submitted'
  | 'item-published'
  | 'veto-requested'
  | 'veto-delivery'
  | 'drawing-requested'
  | 'drawing-delivery'
  | 'drawing-published'
  | 'reference-checked'
  | 'authoring-warning'
  | 'replied'
  | 'retired'
  | 'restored'

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
  db.exec('PRAGMA busy_timeout = 5000')
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

// Source loads and shared identity allocation commit together (docs/adr/0008).
export const loadGrill = (db: Database, raw: unknown): Grill =>
  db
    .transaction(() => {
      const decoded = decodeGrill(raw)
      if (decoded.squad?.id === decoded.id) {
        throw new Error(
          'A member grill must have its own ID, distinct from its squad page.',
        )
      }
      if (decoded.squad !== undefined && !/^[a-zA-Z0-9_-]+$/.test(decoded.id)) {
        throw new Error(
          'Squad member IDs use letters, numbers, underscores or hyphens.',
        )
      }
      if (
        decoded.squad?.openForYou !== undefined &&
        (!decoded.squad.lead ||
          !decoded.steps.some(step => step.id === decoded.squad?.openForYou))
      ) {
        throw new Error(
          'Open for you names an existing step in the lead member.',
        )
      }
      const existing = listGrills(db).map(row => getGrill(db, row.id)!)
      if (
        existing.some(grill => grill.squad?.id === decoded.id) ||
        (decoded.squad !== undefined &&
          getGrill(db, decoded.squad.id) !== undefined)
      ) {
        throw new Error('A squad page ID cannot also be a source grill ID.')
      }
      if (hasOtherActiveLead(db, decoded)) {
        throw new Error(
          'A squad page has one lead; update the existing lead member instead.',
        )
      }
      const previous = getGrill(db, decoded.id)
      if (previous !== undefined) {
        assertPickedOptionsRetained(snapshot(db, previous), decoded)
      }
      const hasTitle = (key: string, text: string): boolean =>
        text.trim() !== '' && text.trim() !== key
      const grill =
        decoded.refs === undefined
          ? decoded
          : {
              ...decoded,
              refs: Object.fromEntries(
                Object.entries(decoded.refs).map(([key, ref]) => {
                  const title = previous?.refs?.[key]?.text
                  return [
                    key,
                    !hasTitle(key, ref.text) &&
                    title !== undefined &&
                    hasTitle(key, title)
                      ? { ...ref, text: title }
                      : ref,
                  ]
                }),
              ),
            }
      db.run(
        'INSERT INTO grills (id, json, loaded_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json, loaded_at = excluded.loaded_at',
        [grill.id, JSON.stringify(grill), Date.now()],
      )
      appendEvent(db, grill.id, 'loaded', {
        round: grill.round,
        steps: grill.steps.length,
        pageChanged: JSON.stringify(previous) !== JSON.stringify(grill),
        questions: {
          added: grill.steps
            .filter(
              step =>
                !previous?.steps.some(
                  old => old.question.id === step.question.id,
                ),
            )
            .map(step => step.question.id),
          changed: grill.steps
            .filter(step => {
              const old = previous?.steps.find(
                old => old.question.id === step.question.id,
              )
              return (
                old !== undefined &&
                JSON.stringify(old) !== JSON.stringify(step)
              )
            })
            .map(step => step.question.id),
          removed: (previous?.steps ?? [])
            .filter(
              step =>
                !grill.steps.some(
                  next => next.question.id === step.question.id,
                ),
            )
            .map(step => step.question.id),
        },
      })
      if (grill.squad !== undefined) {
        registerSquadMember(db, grill)
      }
      return grill
    })
    .immediate()

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
/** The agent's word back after a Send, shown on the page as a reply to it. */
export const replyToGrill = (
  db: Database,
  grill: Grill,
  text: string,
): { ok: true; id: number } | { ok: false; reason: string } =>
  text.trim() === ''
    ? { ok: false, reason: 'the reply is empty' }
    : {
        ok: true,
        id: appendEvent(db, grill.id, 'replied', { text: text.trim() }),
      }

export const reviseGrill = (
  db: Database,
  grill: Grill,
  revision: Revision,
): { ok: true; id: number } | { ok: false; reason: string } => {
  if (!hasTarget(grill, revision.stepId)) {
    return {
      ok: false,
      reason: `no step, concept, card or run ${revision.stepId} in ${grill.id}`,
    }
  }
  if (isWholeTarget(revision.stepId) && revision.kind === 'rewrite') {
    return {
      ok: false,
      reason:
        'a run, concept or card takes a comment; rewrite a step by its own id',
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

// Source reloads cannot revive retired grills (docs/adr/0009).
export const retirementOf = (
  db: Database,
  grillId: string,
): Snapshot['retirement'] => {
  const row = db
    .query<EventRow, [string]>(
      "SELECT * FROM events WHERE grill_id = ? AND kind IN ('retired', 'restored') ORDER BY id DESC LIMIT 1",
    )
    .get(grillId)
  return row?.kind === 'retired'
    ? Schema.decodeUnknownSync(Retirement)({
        ...JSON.parse(row.payload),
        id: row.id,
        at: row.at,
      })
    : undefined
}

const hasOtherActiveLead = (db: Database, grill: Grill): boolean =>
  grill.squad?.lead === true &&
  listGrills(db).some(row => {
    const other = getGrill(db, row.id)
    return (
      row.id !== grill.id &&
      other?.squad?.id === grill.squad?.id &&
      other?.squad?.lead === true &&
      retirementOf(db, row.id) === undefined
    )
  })

export const retireGrill = (
  db: Database,
  grill: Grill,
  reason: string,
): { ok: true } | { ok: false; reason: string } => {
  if (reason.trim() === '' || reason.trim().length > 1000) {
    return { ok: false, reason: 'give a reason of 1 to 1000 characters' }
  }
  return db
    .transaction((): { ok: true } => {
      if (retirementOf(db, grill.id) === undefined) {
        appendEvent(db, grill.id, 'retired', { reason: reason.trim() })
      }
      return { ok: true }
    })
    .immediate()
}

export const restoreGrill = (
  db: Database,
  grill: Grill,
): { ok: true } | { ok: false; reason: string } =>
  db
    .transaction((): { ok: true } | { ok: false; reason: string } => {
      if (retirementOf(db, grill.id) !== undefined) {
        if (hasOtherActiveLead(db, grill)) {
          return {
            ok: false,
            reason:
              'Another active source is the squad lead; retire it before restoring this lead.',
          }
        }
        appendEvent(db, grill.id, 'restored', {})
      }
      return { ok: true }
    })
    .immediate()

const REPLY_LINE = /^(Q\d+) (?:other: |[^\s(]+)/

/**
 * The answer lines a send delivered. Sends record them; older ones only kept the message, so its
 * `Q<n> …` lines, or the picks in an all-recommended line, stand in.
 */
export const sentLines = (
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
  const roundNames: Record<string, string> = { ...grill.roundNames }
  const answers: Record<string, string> = {}
  const notes: Record<string, string> = {}
  const own: Record<string, string> = {}
  const asks: Array<Snapshot['asks'][number]> = []
  const revisions: Array<Snapshot['revisions'][number]> = []
  const sends: Array<Snapshot['sends'][number]> = []
  const sent: Record<string, string> = {}
  const replies: Array<NonNullable<Snapshot['replies']>[number]> = []
  const times = questionTimeline()
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
        times.revised(event.at, p)
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
          const index = asks.findIndex(ask => ask.id === p.askId)
          if (index !== -1) {
            asks[index] = {
              ...asks[index]!,
              delivery: {
                state: p.ok === true ? 'delivered' : 'failed',
                to: String(p.to ?? ''),
                detail: String(p.detail ?? ''),
              },
            }
          }
          break
        }
        if (p.ok === true) {
          Object.assign(sent, sentLines(p))
        } else if (p.deliveries !== undefined) {
          const receipts = Schema.decodeUnknownResult(
            Schema.Array(DeliveryReceipt),
          )(p.deliveries)
          if (receipts._tag === 'Success') {
            receipts.success
              .filter(receipt => receipt.ok)
              .forEach(receipt => Object.assign(sent, receipt.lines))
          }
        }
        sends.push({
          at: event.at,
          ok: p.ok === true,
          detail: String(p.detail ?? ''),
        })
        break
      case 'replied':
        replies.push({ id: event.id, text: String(p.text), at: event.at })
        break
      case 'renamed-round':
        roundNames[String(p.round)] = String(p.name)
        break
      case 'loaded':
        times.loaded(event.at, p)
        break
      case 'submitted':
      case 'item-published':
      case 'squad-registered':
      case 'retired':
      case 'restored':
        break
    }
  }
  const retirement = retirementOf(db, grill.id)
  return {
    grill: { ...grill, roundNames },
    ...(retirement === undefined ? {} : { retirement }),
    answers,
    notes,
    own,
    asks,
    revisions,
    sends,
    sent,
    replies,
    questionTimes: times.of(grill),
  }
}

// Loads from before question diffs were recorded carry no `questions`; a question they added is
// dated by the grill's first load.
const questionTimeline = () => {
  const firstAdded = new Map<string, number>()
  const lastChanged = new Map<string, number>()
  const lastRewrite = new Map<string, number>()
  let maybeFirstLoad: number | undefined
  const ids = (value: unknown): ReadonlyArray<string> =>
    Array.isArray(value) ? value.map(String) : []
  return {
    loaded: (at: number, payload: Record<string, unknown>): void => {
      maybeFirstLoad ??= at
      const questions = (payload.questions ?? {}) as Record<string, unknown>
      ids(questions.added).forEach(id => {
        if (!firstAdded.has(id)) firstAdded.set(id, at)
      })
      ids(questions.changed).forEach(id => lastChanged.set(id, at))
    },
    revised: (at: number, payload: Record<string, unknown>): void => {
      if (payload.kind !== 'comment') {
        lastRewrite.set(String(payload.stepId), at)
      }
    },
    of: (grill: Grill): Record<string, QuestionTimes> =>
      Object.fromEntries(
        grill.steps.flatMap(step => {
          const posted = firstAdded.get(step.question.id) ?? maybeFirstLoad
          if (posted === undefined) return []
          const edited = Math.max(
            lastChanged.get(step.question.id) ?? 0,
            lastRewrite.get(step.id) ?? 0,
          )
          return [
            [
              step.question.id,
              edited > posted ? { posted, edited } : { posted },
            ],
          ]
        }),
      ),
  }
}

export const SquadRegistration = Schema.Struct({
  source: Schema.String,
  questions: Schema.Record(Schema.String, Schema.String),
  rounds: Schema.Record(Schema.String, Schema.Number),
})
export type SquadRegistration = typeof SquadRegistration.Type

export const squadRegistrations = (
  db: Database,
  id: string,
): ReadonlyArray<SquadRegistration> => {
  const registrations = new Map<string, SquadRegistration>()
  events(db, id)
    .filter(event => event.kind === 'squad-registered')
    .forEach(event => {
      const registration = Schema.decodeUnknownSync(SquadRegistration)(
        JSON.parse(event.payload),
      )
      registrations.set(registration.source, registration)
    })
  return [...registrations.values()]
}

const registerSquadMember = (db: Database, grill: Grill): void => {
  const id = grill.squad!.id
  const registrations = squadRegistrations(db, id)
  const previous = registrations.find(member => member.source === grill.id)
  const questions = { ...previous?.questions }
  const rounds = { ...previous?.rounds }
  const maxQuestion = Math.max(
    0,
    ...registrations.flatMap(member =>
      Object.values(member.questions).map(value => Number(value.slice(1))),
    ),
  )
  const maxRound = Math.max(
    0,
    ...registrations.flatMap(member => Object.values(member.rounds)),
  )
  const state = snapshot(db, grill)
  const localQuestions = [
    ...new Set([
      ...grill.steps.map(step => step.question.id),
      ...Object.keys(state.answers),
      ...Object.keys(state.notes),
      ...Object.keys(state.own),
      ...Object.keys(state.sent ?? {}),
    ]),
  ]
  const missingQuestions = localQuestions.filter(
    id => questions[id] === undefined,
  )
  missingQuestions.forEach((id, index) => {
    questions[id] = `Q${maxQuestion + index + 1}`
  })
  const missingRounds = [
    ...new Set(grill.steps.map(step => roundOf(grill, step.question))),
  ].filter(round => rounds[String(round)] === undefined)
  missingRounds.forEach((round, index) => {
    rounds[String(round)] = maxRound + index + 1
  })
  if (
    previous === undefined ||
    missingQuestions.length > 0 ||
    missingRounds.length > 0
  ) {
    appendEvent(db, id, 'squad-registered', {
      source: grill.id,
      questions,
      rounds,
    })
  }
}
