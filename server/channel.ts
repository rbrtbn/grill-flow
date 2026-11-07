import type { Database } from 'bun:sqlite'
import { Schema } from 'effect'

import { ChannelItem } from '../src/channel'
import { type Grill, type Snapshot } from '../src/domain'
import { appendEvent, events } from './store'

type PublishResult =
  | Readonly<{ ok: true; event: number }>
  | Readonly<{ ok: false; reason: string }>

export const remoteItemError = (item: ChannelItem): string | undefined =>
  item.kind === 'owner-step' && typeof item.destination !== 'string'
    ? 'Remote owner steps need an HTTP(S) link; native focus belongs to the serving host.'
    : undefined

export const itemHistory = (db: Database, source: string) =>
  events(db, source)
    .filter(event => event.kind === 'item-published')
    .map(event => ({
      source,
      event: event.id,
      at: event.at,
      item: Schema.decodeUnknownSync(ChannelItem)(JSON.parse(event.payload)),
    }))

export const updateHistory = (db: Database, source: string) =>
  itemHistory(db, source).flatMap(entry =>
    entry.item.kind === 'update' ? [{ ...entry, item: entry.item }] : [],
  )

export const latestItems = (db: Database, source: string) => [
  ...new Map(
    itemHistory(db, source).map(entry => [entry.item.id, entry]),
  ).values(),
]

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

export const publishItem = (
  db: Database,
  grill: Grill,
  raw: unknown,
  now = Date.now(),
): PublishResult => {
  const decoded = Schema.decodeUnknownResult(ChannelItem)(raw)
  if (decoded._tag === 'Failure') {
    return { ok: false, reason: 'Invalid version-1 channel item.' }
  }
  const item = decoded.success
  if (
    item.body.trim() === '' ||
    item.session.trim() === '' ||
    item.revision !== item.previous + 1
  ) {
    return {
      ok: false,
      reason:
        'An update needs text and the revision immediately after its expected previous revision.',
    }
  }
  return db
    .transaction((): PublishResult => {
      const history = itemHistory(db, grill.id)
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
      const previous = history.find(entry => entry.item.id === item.id)
      if (previous !== undefined && previous.item.kind !== item.kind) {
        return { ok: false, reason: 'A published item cannot change its kind.' }
      }
      if (
        item.kind === 'owner-step' &&
        (item.action.trim() === '' || item.host.trim() === '')
      ) {
        return {
          ok: false,
          reason: 'An owner step needs an exact action and host.',
        }
      }
      if (
        item.kind === 'owner-step' &&
        item.progress.state === 'completed' &&
        (item.progress.checkedAt > now ||
          (item.progress.validUntil !== undefined &&
            item.progress.validUntil < item.progress.checkedAt))
      ) {
        return {
          ok: false,
          reason:
            'Completion proof needs a non-future checked time and valid expiry.',
        }
      }
      if (
        item.kind === 'evidence' &&
        (item.checkedAt > now ||
          item.validUntil <= item.checkedAt ||
          item.validUntil > item.checkedAt + 86_400_000)
      ) {
        return {
          ok: false,
          reason:
            'Evidence needs a non-future check and expiry within 24 hours.',
        }
      }
      if (item.kind === 'decision') {
        const responses = item.vetoResponses ?? []
        const valid = responses.every(response => {
          if (response.text.trim() === '') {
            return false
          }
          const request = events(db, grill.id).find(
            event =>
              event.id === response.receipt && event.kind === 'veto-requested',
          )
          if (
            request === undefined ||
            JSON.parse(request.payload).item !== item.id
          ) {
            return false
          }
          const prior = history
            .flatMap(entry =>
              entry.item.kind === 'decision'
                ? (entry.item.vetoResponses ?? [])
                : [],
            )
            .reverse()
            .find(entry => entry.receipt === response.receipt)
          return (
            prior === undefined ||
            prior.state === 'acknowledged' ||
            (prior.state === response.state && prior.text === response.text)
          )
        })
        if (
          !valid ||
          new Set(responses.map(response => response.receipt)).size !==
            responses.length
        ) {
          return {
            ok: false,
            reason:
              'Veto responses must name this decision’s receipts and preserve confirmed outcomes.',
          }
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
        item.kind === 'update' &&
        item.supersedes !== undefined &&
        (item.supersedes === item.id ||
          !history.some(
            entry =>
              entry.item.kind === 'update' && entry.item.id === item.supersedes,
          ))
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
        const candidate = newest.get(id)?.item
        const next =
          candidate?.kind === 'update' ? candidate.supersedes : undefined
        return next !== undefined && hasCycle(next, [...seen, id])
      }
      if (
        item.kind === 'update' &&
        item.supersedes !== undefined &&
        hasCycle(item.supersedes, [])
      ) {
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

export const publishUpdate = publishItem
