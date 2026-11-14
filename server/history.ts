import type { Database } from 'bun:sqlite'
import { Schema } from 'effect'

import { Grill } from '../src/domain'

// Revision history is for retros and audits only (docs/adr/0031): page snapshots, polls and
// deliveries never read this table.

export type WriteProvenance = Readonly<{ author: string; reason: string }>

export type GrillRevision = Readonly<{
  grillId: string
  rev: number
  at: number
  author: string
  reason: string
  parentRev: number | null
  grill: Grill
}>

type RevisionRow = Readonly<{
  grill_id: string
  rev: number
  at: number
  author_session: string
  reason: string
  json: string
  parent_rev: number | null
}>

const ready = new WeakSet<Database>()

// Test databases build their own tables, so the first load on any connection creates this one.
// Creation inside a transaction is not remembered, since a rollback undoes it.
export const ensureHistory = (db: Database): void => {
  if (ready.has(db)) {
    return
  }
  db.exec(`CREATE TABLE IF NOT EXISTS grill_revisions (
    grill_id TEXT NOT NULL,
    rev INTEGER NOT NULL,
    at INTEGER NOT NULL,
    author_session TEXT NOT NULL,
    reason TEXT NOT NULL,
    json TEXT NOT NULL,
    parent_rev INTEGER,
    PRIMARY KEY (grill_id, rev)
  )`)
  if (!db.inTransaction) {
    ready.add(db)
  }
}

/** The newest revision number of a grill; 0 before its first recorded load. */
export const currentRev = (db: Database, grillId: string): number => {
  ensureHistory(db)
  return (
    db
      .query<{ rev: number | null }, [string]>(
        'SELECT MAX(rev) AS rev FROM grill_revisions WHERE grill_id = ?',
      )
      .get(grillId)?.rev ?? 0
  )
}

/**
 * Appends a load's grill as the next revision, inside the caller's load transaction. A grill
 * stored before history existed first gets its stored JSON as rev 1, copied in SQL.
 */
export const recordRevision = (
  db: Database,
  grillId: string,
  json: string,
  provenance: WriteProvenance,
  now: number,
): number => {
  const latest = currentRev(db, grillId)
  const base =
    latest > 0
      ? latest
      : db.run(
            "INSERT INTO grill_revisions (grill_id, rev, at, author_session, reason, json, parent_rev) SELECT id, 1, loaded_at, '', '', json, NULL FROM grills WHERE id = ?",
            [grillId],
          ).changes > 0
        ? 1
        : 0
  db.run(
    'INSERT INTO grill_revisions (grill_id, rev, at, author_session, reason, json, parent_rev) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [
      grillId,
      base + 1,
      now,
      provenance.author,
      provenance.reason,
      json,
      base === 0 ? null : base,
    ],
  )
  return base + 1
}

const decodeGrill = Schema.decodeUnknownSync(Grill)

export const grillRevisions = (
  db: Database,
  grillId: string,
): ReadonlyArray<GrillRevision> => {
  ensureHistory(db)
  return db
    .query<RevisionRow, [string]>(
      'SELECT * FROM grill_revisions WHERE grill_id = ? ORDER BY rev',
    )
    .all(grillId)
    .map(row => ({
      grillId: row.grill_id,
      rev: row.rev,
      at: row.at,
      author: row.author_session,
      reason: row.reason,
      parentRev: row.parent_rev,
      grill: decodeGrill(JSON.parse(row.json)),
    }))
}

export type FieldChange = Readonly<{
  field: string
  change: 'added' | 'removed' | 'changed'
  before?: unknown
  after?: unknown
}>

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

// Options and similar lists diff by their key or id, so a reorder or one edited option reads
// as that option's change rather than the whole list's.
const keyOf = (value: unknown): string | undefined =>
  isRecord(value)
    ? typeof value.key === 'string'
      ? value.key
      : typeof value.id === 'string'
        ? value.id
        : undefined
    : undefined

const keyed = (
  list: ReadonlyArray<unknown>,
): ReadonlyMap<string, unknown> | undefined => {
  const keys = list.map(keyOf)
  return keys.every(key => key !== undefined) &&
    new Set(keys).size === keys.length
    ? new Map(list.map((item, index) => [keys[index]!, item]))
    : undefined
}

export const fieldChanges = (
  before: unknown,
  after: unknown,
  path = '',
): ReadonlyArray<FieldChange> => {
  if (JSON.stringify(before) === JSON.stringify(after)) {
    return []
  }
  const at = (key: string, bracket: boolean) =>
    bracket ? `${path}[${key}]` : path === '' ? key : `${path}.${key}`
  const nested = (
    a: ReadonlyMap<string, unknown>,
    b: ReadonlyMap<string, unknown>,
    bracket: boolean,
  ): ReadonlyArray<FieldChange> =>
    [...new Set([...a.keys(), ...b.keys()])].flatMap(key =>
      !a.has(key)
        ? [{ field: at(key, bracket), change: 'added', after: b.get(key) }]
        : !b.has(key)
          ? [{ field: at(key, bracket), change: 'removed', before: a.get(key) }]
          : fieldChanges(a.get(key), b.get(key), at(key, bracket)),
    )
  if (isRecord(before) && isRecord(after)) {
    return nested(
      new Map(Object.entries(before)),
      new Map(Object.entries(after)),
      false,
    )
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    const a = keyed(before)
    const b = keyed(after)
    if (a !== undefined && b !== undefined) {
      return nested(a, b, true)
    }
  }
  return [{ field: path, change: 'changed', before, after }]
}

/** A question as one flat record: its step's heading and prose beside its own fields. */
const questionView = (
  grill: Grill,
  questionId: string,
): Readonly<Record<string, unknown>> | undefined => {
  const step = grill.steps.find(
    candidate =>
      candidate.question.id === questionId || candidate.id === questionId,
  )
  const decided = grill.decided?.find(
    outcome => outcome.id === (step?.question.id ?? questionId),
  )
  if (step === undefined && decided === undefined) {
    return undefined
  }
  const fields = (): Readonly<Record<string, unknown>> => {
    if (step === undefined) {
      return {}
    }
    const { question, id, ...rest } = step
    const { id: _question, ...own } = question
    return { step: id, ...rest, ...own }
  }
  return {
    ...fields(),
    ...(decided === undefined ? {} : { decided: decided.text }),
  }
}

export type QuestionChange = Readonly<{
  rev: number
  parentRev: number | null
  at: number
  author: string
  reason: string
  change: 'added' | 'removed' | 'changed'
  fields: ReadonlyArray<FieldChange>
}>

/** Each revision where a question (by question or step id) differs from the one before it. */
export const questionHistory = (
  revisions: ReadonlyArray<GrillRevision>,
  questionId: string,
): ReadonlyArray<QuestionChange> =>
  revisions.flatMap((revision, index) => {
    const before =
      index === 0
        ? undefined
        : questionView(revisions[index - 1]!.grill, questionId)
    const after = questionView(revision.grill, questionId)
    const fields = fieldChanges(before ?? {}, after ?? {})
    if (fields.length === 0) {
      return []
    }
    const { grill: _grill, grillId: _id, ...meta } = revision
    return [
      {
        ...meta,
        change:
          before === undefined
            ? 'added'
            : after === undefined
              ? 'removed'
              : 'changed',
        fields,
      },
    ]
  })

const when = (at: number) => new Date(at).toISOString().replace('.000Z', 'Z')
const shown = (value: unknown) => {
  const text = JSON.stringify(value) ?? ''
  return text.length > 200 ? `${text.slice(0, 197)}...` : text
}

export const revisionLines = (
  revisions: ReadonlyArray<GrillRevision>,
): ReadonlyArray<string> =>
  revisions.map(
    revision =>
      `rev ${revision.rev}  ${when(revision.at)}  ${revision.author || '-'}  ${revision.reason || '(no reason given)'}`,
  )

export const fieldLine = (field: FieldChange): string =>
  field.change === 'added'
    ? `  + ${field.field}: ${shown(field.after)}`
    : field.change === 'removed'
      ? `  - ${field.field}: ${shown(field.before)}`
      : `  ~ ${field.field}: ${shown(field.before)} -> ${shown(field.after)}`

export const questionLines = (
  changes: ReadonlyArray<QuestionChange>,
): ReadonlyArray<string> =>
  changes.flatMap(change => [
    `rev ${change.rev}  ${when(change.at)}  ${change.author || '-'}  ${change.reason || '(no reason given)'}  [${change.change}]`,
    ...change.fields.map(fieldLine),
  ])
