import type { Database } from 'bun:sqlite'
import { Schema } from 'effect'

import type { Grill, Ref } from '../src/domain'
import {
  ProviderReading,
  type ProviderReference,
  referenceKey,
  referenceOf,
  referenceUrl,
} from '../src/references'
import { latestItems } from './channel'
import { type ProviderCommand, createProviderFetcher } from './providerReads'
import type { Page } from './squad'
import { appendEvent } from './store'

const placeholder = (reference: ProviderReference): ProviderReading => ({
  version: 1,
  reference,
  freshness: 'loading',
  checkedAt: null,
  validUntil: null,
  title: '',
  url: referenceUrl(reference),
  status: 'Unknown',
  type:
    reference.provider === 'github' && reference.kind === 'pull'
      ? 'pr'
      : 'issue',
  states: [],
  checks: 'unknown',
  error: '',
})

export const createReadLimiter = (
  run: ProviderCommand,
  clock = Date.now,
  wait: (ms: number) => Promise<unknown> = ms => Bun.sleep(ms),
) => {
  const queue: Array<{
    args: ReadonlyArray<string>
    resolve: (value: unknown) => void
    reject: (error: unknown) => void
  }> = []
  let active = 0
  let starts: Array<number> = []
  let waiting = false
  const pump = (): void => {
    starts = starts.filter(at => at > clock() - 60_000)
    if (active >= 2 || queue.length === 0 || waiting) {
      return
    }
    if (starts.length >= 24) {
      waiting = true
      void wait(Math.max(1, 60_000 - (clock() - starts[0]!))).then(() => {
        waiting = false
        pump()
      })
      return
    }
    const next = queue.shift()!
    starts.push(clock())
    active += 1
    void run(next.args)
      .then(next.resolve, next.reject)
      .finally(() => {
        active -= 1
        pump()
      })
    pump()
  }
  return (args: ReadonlyArray<string>): Promise<unknown> =>
    new Promise((resolve, reject) => {
      if (queue.length >= 64) {
        reject(new Error('Provider reader queue is full'))
        return
      }
      queue.push({ args, resolve, reject })
      pump()
    })
}

export const createReferenceReader = (
  db: Database,
  run: ProviderCommand,
  now: () => number = Date.now,
) => {
  const fetch = createProviderFetcher(createReadLimiter(run, now), now)
  const cache = new Map<
    string,
    {
      value: ProviderReading
      next: number
      pending: boolean
      sources: Set<string>
    }
  >()
  type Entry = {
    value: ProviderReading
    next: number
    pending: boolean
    sources: Set<string>
  }
  const queue: Array<Entry> = []
  let active = 0
  const histories = new Map<string, Map<string, ProviderReading>>()
  const history = (source: string) => {
    const existing = histories.get(source)
    if (existing !== undefined) {
      return existing
    }
    const saved = new Map(
      db
        .query<{ payload: string }, [string]>(
          "SELECT payload FROM events WHERE grill_id = ? AND kind = 'reference-checked' ORDER BY id",
        )
        .all(source)
        .map(event =>
          Schema.decodeUnknownSync(ProviderReading)(JSON.parse(event.payload)),
        )
        .map(value => [referenceKey(value.reference), value]),
    )
    if (histories.size >= 256) {
      const oldest = histories.keys().next().value
      if (oldest !== undefined) {
        histories.delete(oldest)
      }
    }
    histories.set(source, saved)
    return saved
  }
  const signature = (value: ProviderReading) =>
    JSON.stringify({
      reference: referenceKey(value.reference),
      freshness: value.freshness,
      title: value.title,
      status: value.status,
      type: value.type,
      states: value.states,
      checks: value.checks,
      error: value.error,
    })
  const record = (source: string, reading: ProviderReading): void => {
    try {
      const previous = history(source),
        key = referenceKey(reading.reference)
      const old = previous.get(key)
      if (old === undefined || signature(old) !== signature(reading)) {
        appendEvent(db, source, 'reference-checked', reading)
        previous.set(key, reading)
      }
    } catch {
      // A busy history store must not strand provider reads; a later page poll retries.
      histories.delete(source)
    }
  }
  const pump = (): void => {
    if (active >= 2 || queue.length === 0) {
      return
    }
    const entry = queue.shift()!
    active += 1
    void fetch(entry.value.reference)
      .then(value => {
        entry.value = value
      })
      .catch(() => {
        entry.value = {
          ...entry.value,
          freshness: entry.value.checkedAt === null ? 'unavailable' : 'stale',
          error:
            'Primary provider check unavailable; retrying after the cache interval.',
        }
      })
      .finally(() => {
        entry.pending = false
        entry.next = now() + 60_000
        entry.sources.forEach(source => record(source, entry.value))
        active -= 1
        pump()
      })
    pump()
  }
  const read = (
    reference: ProviderReference,
    source: string,
  ): ProviderReading => {
    const key = referenceKey(reference)
    const existing = cache.get(key)
    const saved = existing === undefined ? history(source).get(key) : undefined
    const entry = existing ?? {
      value:
        saved === undefined
          ? placeholder(reference)
          : ({ ...saved, freshness: 'stale' } satisfies ProviderReading),
      next: 0,
      pending: false,
      sources: new Set<string>(),
    }
    if (existing === undefined) {
      if (cache.size >= 256) {
        const oldest = [...cache.entries()].find(
          ([, item]) => !item.pending,
        )?.[0]
        if (oldest === undefined) {
          return {
            ...placeholder(reference),
            freshness: 'unavailable',
            error: 'Provider cache is busy; retry on a later poll.',
          }
        }
        cache.delete(oldest)
      }
      cache.set(key, entry)
    }
    entry.sources.add(source)
    if (!entry.pending && now() >= entry.next && queue.length < 64) {
      entry.pending = true
      queue.push(entry)
      pump()
    }
    const value =
      entry.value.validUntil !== null && entry.value.validUntil <= now()
        ? ({ ...entry.value, freshness: 'stale' } satisfies ProviderReading)
        : entry.value
    if (!entry.pending && value.freshness !== 'loading') {
      record(source, value)
    }
    return value
  }
  return (page: Page) => {
    const owners =
      page.members.length === 0
        ? [page.state.grill]
        : page.members.map(member => member.state.grill)
    const readings = new Map<string, ProviderReading>()
    owners.forEach(grill => {
      Object.entries(grill.refs ?? {}).forEach(([key, ref]) => {
        const reference = referenceOf(key, ref.url)
        if (reference !== undefined) {
          readings.set(referenceKey(reference), read(reference, grill.id))
        }
      })
      latestItems(db, grill.id).forEach(entry => {
        const reference =
          entry.item.kind === 'evidence'
            ? entry.item.reference
            : entry.item.kind === 'blocker' &&
                entry.item.condition.kind === 'provider'
              ? entry.item.condition.reference
              : undefined
        if (reference !== undefined) {
          readings.set(referenceKey(reference), read(reference, grill.id))
        }
      })
    })
    const refs = Object.fromEntries(
      Object.entries(page.state.grill.refs ?? {}).map(
        ([key, ref]): [string, Ref] => {
          if (ref.state === 'Ambiguous') {
            return [key, ref]
          }
          const reference = referenceOf(key, ref.url)
          const reading =
            reference === undefined
              ? undefined
              : readings.get(referenceKey(reference))
          if (reading === undefined) {
            return [
              key,
              {
                ...ref,
                text: `${ref.text} · Agent-reported reference; no primary adapter.`,
              },
            ]
          }
          const fresh = reading.freshness === 'fresh'
          const check =
            reading.checkedAt === null
              ? 'Not checked'
              : `Checked ${new Date(reading.checkedAt).toISOString()}`
          const status = fresh
            ? `${reading.status}${reading.checks === 'not-applicable' ? '' : ` · checks ${reading.checks}`}`
            : reading.freshness === 'loading'
              ? 'Checking'
              : reading.freshness === 'stale'
                ? 'Stale'
                : 'Unavailable'
          const type = reading.type === 'issue' ? undefined : reading.type
          return [
            key,
            {
              text: [
                reading.title || ref.text,
                `Primary ${reference!.provider}`,
                check,
                ...(fresh ? [] : [`Last known: ${reading.status}`]),
                ...(reading.error === '' ? [] : [reading.error]),
              ].join(' · '),
              url: reading.url,
              state: status,
              ...(type === undefined || !fresh ? {} : { type }),
            },
          ]
        },
      ),
    )
    return {
      grill: { ...page.state.grill, refs } satisfies Grill,
      readings: [...readings.values()],
    }
  }
}
