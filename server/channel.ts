import type { Database } from 'bun:sqlite'
import { Schema } from 'effect'

import { UpdateItem, type Grill, type Snapshot } from '../src/domain'
import { appendEvent, events } from './store'

type PublishResult =
  | Readonly<{ ok: true; event: number }>
  | Readonly<{ ok: false; reason: string }>

export const updateHistory = (db: Database, source: string) =>
  events(db, source)
    .filter(event => event.kind === 'item-published')
    .map(event => ({
      source,
      event: event.id,
      at: event.at,
      item: Schema.decodeUnknownSync(UpdateItem)(JSON.parse(event.payload)),
    }))

export const publishedUpdates = (
  db: Database,
  sources: ReadonlyArray<string>,
): NonNullable<Snapshot['updates']> =>
  sources
    .flatMap(source => {
      const history = updateHistory(db, source)
      const latest = [
        ...new Map(
          history.map((entry): readonly [string, typeof entry] => [
            entry.item.id,
            entry,
          ]),
        ).values(),
      ].sort((a, b) => b.event - a.event)
      return latest.map(entry => {
        const replacement = latest.find(
          other => other.item.supersedes === entry.item.id,
        )
        return {
          ...entry,
          ...(replacement === undefined
            ? {}
            : { supersededBy: replacement.item.id }),
        }
      })
    })
    .sort((a, b) => b.event - a.event)

export const publishUpdate = (
  db: Database,
  grill: Grill,
  raw: unknown,
): PublishResult => {
  const decoded = Schema.decodeUnknownResult(UpdateItem)(raw)
  if (decoded._tag === 'Failure') {
    return { ok: false, reason: 'Invalid version-1 update record.' }
  }
  const item = decoded.success
  if (item.body.trim() === '' || item.revision !== item.previous + 1) {
    return {
      ok: false,
      reason:
        'An update needs text and the revision immediately after its expected previous revision.',
    }
  }
  return db
    .transaction((): PublishResult => {
      const history = updateHistory(db, grill.id)
      const accepted = history.find(
        entry =>
          entry.item.id === item.id && entry.item.revision === item.revision,
      )
      if (accepted !== undefined) {
        return JSON.stringify(accepted.item) === JSON.stringify(item)
          ? { ok: true, event: accepted.event }
          : {
              ok: false,
              reason: 'That update revision already has different content.',
            }
      }
      if (
        item.question !== undefined &&
        !grill.steps.some(step => step.question.id === item.question)
      ) {
        return {
          ok: false,
          reason: 'The related question must belong to this source grill.',
        }
      }
      const revisions = history
        .filter(entry => entry.item.id === item.id)
        .map(entry => entry.item.revision)
      if (Math.max(0, ...revisions) !== item.previous) {
        return {
          ok: false,
          reason:
            'The update changed; reread its latest revision before publishing.',
        }
      }
      if (
        item.supersedes !== undefined &&
        (item.supersedes === item.id ||
          !history.some(entry => entry.item.id === item.supersedes))
      ) {
        return {
          ok: false,
          reason:
            'Supersedes must name another published update in this source.',
        }
      }
      const newest = new Map(
        history.map((entry): readonly [string, typeof entry] => [
          entry.item.id,
          entry,
        ]),
      )
      const hasCycle = (id: string, seen: ReadonlyArray<string>): boolean => {
        if (id === item.id || seen.includes(id)) {
          return true
        }
        const next = newest.get(id)?.item.supersedes
        return next !== undefined && hasCycle(next, [...seen, id])
      }
      if (item.supersedes !== undefined && hasCycle(item.supersedes, [])) {
        return {
          ok: false,
          reason: 'Updates cannot supersede each other in a cycle.',
        }
      }
      return {
        ok: true,
        event: appendEvent(db, grill.id, 'item-published', item),
      }
    })
    .immediate()
}
