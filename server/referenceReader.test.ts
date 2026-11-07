import { Database } from 'bun:sqlite'
import { afterEach, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

import type { ProviderReading } from '../src/references'
import { attentionSnapshot } from './attention'
import { publishItem } from './channel'
import { createReadLimiter, createReferenceReader } from './referenceReader'
import { readPage } from './squad'
import { events, getGrill, loadGrill } from './store'

const fixture = JSON.parse(readFileSync('src/fixtures/grill.json', 'utf8'))
const databases = new Set<Database>()
afterEach(() => {
  databases.forEach(db => db.close())
  databases.clear()
})
const database = () => {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE grills (id TEXT PRIMARY KEY, json TEXT, loaded_at INTEGER);
    CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, grill_id TEXT, at INTEGER, kind TEXT, payload TEXT);
    CREATE TABLE grill_remotes (grill_id TEXT PRIMARY KEY, machine TEXT, dir TEXT);`)
  databases.add(db)
  return db
}
const initialTime = Date.parse('2026-11-07T23:00:00Z')
const reference = {
  provider: 'github',
  repository: 'rbrtbn/squad',
  kind: 'pull',
  number: 100,
} satisfies import('../src/references').ProviderReference
const pr = {
  number: 100,
  title: 'Current PR',
  state: 'OPEN',
  isDraft: false,
  url: 'https://github.com/rbrtbn/squad/pull/100',
  statusCheckRollup: [{ conclusion: 'SUCCESS' }],
}
const source = (db: Database, id = 'worker') =>
  loadGrill(db, {
    ...fixture,
    id,
    session: 't1',
    squad: { id: 'team', section: id },
    steps: fixture.steps.slice(0, 1),
    refs: {
      '#100': {
        text: 'Reported PR',
        state: 'Reported open',
        type: 'pr',
        url: pr.url,
      },
      'LAB-1280': { text: 'Reported issue' },
    },
  })
const settled = async () => {
  await Bun.sleep(0)
}
const facts = (db: Database, id = 'worker') =>
  events(db, id).filter(event => event.kind === 'reference-checked')

it('refreshes projected chips with exact source ownership, preserves source JSON and records changes without heartbeat churn', async () => {
  const db = database(),
    grill = source(db)
  let now = initialTime,
    calls = 0,
    state = 'OPEN'
  const read = createReferenceReader(
    db,
    async args => {
      calls += 1
      if (args[1] === 'api') return { login: 'rbrtbn' }
      return args[0] === 'gh'
        ? { ...pr, state, body: 'fake-secret' }
        : {
            workspace: 'rbrtbn',
            fetchedAt: new Date(now).toISOString(),
            issues: [
              {
                id: 'd2694e39-f07e-42e0-abde-7eda89b0ffce',
                identifier: 'LAB-1280',
                title: 'Issue current title',
                description: 'fake-secret',
                state: { name: 'Done', type: 'completed' },
              },
            ],
          }
    },
    () => now,
  )
  const page = readPage(db, grill.id)!
  expect(
    read(page).readings.every(reading => reading.freshness === 'loading'),
  ).toBe(true)
  expect(facts(db)).toHaveLength(0)
  await settled()
  const current = read(page)
  expect(current.grill.refs?.['#100']).toMatchObject({
    state: 'open · checks passed',
    type: 'pr',
  })
  expect(current.grill.refs?.['LAB-1280']).toMatchObject({
    state: 'Done',
    type: 'completed',
  })
  expect(current.grill.refs?.['#100']?.text).toContain(
    'Primary github · Checked 2026-11-07T23:00:00.000Z',
  )
  expect(getGrill(db, grill.id)?.refs?.['#100']?.state).toBe('Reported open')
  expect(facts(db)).toHaveLength(2)
  expect(calls).toBe(3)
  Array.from({ length: 10 }).forEach(() => read(page))
  expect(calls).toBe(3)
  expect(facts(db)).toHaveLength(2)
  now += 60_001
  read(page)
  await settled()
  expect(read(page).readings.every(reading => reading.checkedAt === now)).toBe(
    true,
  )
  expect(facts(db)).toHaveLength(2)
  state = 'MERGED'
  now += 60_001
  read(page)
  await settled()
  expect(read(page).grill.refs?.['#100']?.state).toBe('merged · checks passed')
  expect(facts(db)).toHaveLength(3)
  expect(facts(db).every(event => event.grill_id === grill.id)).toBe(true)
  expect(JSON.stringify(facts(db))).not.toContain('fake-secret')
  expect(
    events(db, grill.id).some(event =>
      ['answered', 'submitted', 'sent'].includes(event.kind),
    ),
  ).toBe(false)
})

it('keeps last-good readings dated and stale on errors or restart, never returning raw provider errors', async () => {
  const db = database(),
    grill = source(db)
  let now = initialTime,
    fail = false
  const run = async (args: ReadonlyArray<string>) => {
    if (fail) throw new Error('fake-private-credential-and-error')
    return args[1] === 'api'
      ? { login: 'rbrtbn' }
      : args[0] === 'gh'
        ? pr
        : {
            workspace: 'rbrtbn',
            fetchedAt: new Date(now).toISOString(),
            issues: [
              {
                id: 'd2694e39-f07e-42e0-abde-7eda89b0ffce',
                identifier: 'LAB-1280',
                title: 'Issue',
                state: { name: 'Done', type: 'completed' },
              },
            ],
          }
  }
  const read = createReferenceReader(db, run, () => now),
    page = readPage(db, grill.id)!
  read(page)
  await settled()
  fail = true
  now += 60_001
  read(page)
  await settled()
  const failed = read(page)
  expect(
    failed.readings.every(
      reading =>
        reading.freshness === 'stale' && reading.checkedAt === initialTime,
    ),
  ).toBe(true)
  expect(failed.grill.refs?.['#100']).toMatchObject({ state: 'Stale' })
  expect(failed.grill.refs?.['#100']?.type).toBeUndefined()
  expect(JSON.stringify(failed)).not.toContain('fake-private')
  expect(JSON.stringify(facts(db))).not.toContain('fake-private')
  const restart = createReferenceReader(db, run, () => now)
  expect(
    restart(page).readings.every(reading => reading.freshness === 'stale'),
  ).toBe(true)
  await settled()
  expect(
    restart(page).readings.every(reading => reading.checkedAt === initialTime),
  ).toBe(true)
  now += 600_001
  expect(
    read(page).readings.every(reading => reading.freshness === 'stale'),
  ).toBe(true)
  await settled()
})

it('preserves ambiguous composite targets while checking each canonical source separately', async () => {
  const db = database(),
    first = source(db, 'first'),
    second = source(db, 'second')
  loadGrill(db, {
    ...second,
    refs: {
      '#100': {
        text: 'Other PR',
        url: 'https://github.com/other/repo/pull/100',
      },
    },
  })
  const read = createReferenceReader(
    db,
    async args =>
      args[1] === 'api'
        ? { login: 'rbrtbn' }
        : args[0] === 'gh'
          ? { ...pr, url: args[3] }
          : {
              workspace: 'rbrtbn',
              fetchedAt: new Date(initialTime).toISOString(),
              issues: [
                {
                  id: 'd2694e39-f07e-42e0-abde-7eda89b0ffce',
                  identifier: 'LAB-1280',
                  title: 'Issue',
                  state: { name: 'Todo', type: 'unstarted' },
                },
              ],
            },
    () => initialTime,
  )
  const page = readPage(db, 'team')!
  expect(read(page).grill.refs?.['#100']).toMatchObject({ state: 'Ambiguous' })
  expect(read(page).grill.refs?.['#100']?.url).toBeUndefined()
  await settled()
  expect(read(page).grill.refs?.['#100']?.url).toBeUndefined()
  expect(facts(db, first.id)).toHaveLength(2)
  expect(facts(db, second.id)).toHaveLength(1)
  expect(facts(db, 'team')).toHaveLength(0)
})

it('evaluates only the exact named provider evidence and leaves owner and grant blockers independent', async () => {
  const db = database(),
    grill = source(db)
  const base = {
    version: 1,
    previous: 0,
    revision: 1,
    session: 't1',
    body: 'Exact published condition',
  }
  publishItem(
    db,
    grill,
    {
      ...base,
      kind: 'evidence',
      id: 'pr',
      reference,
      state: 'open',
      proof: pr.url,
      checkedAt: initialTime,
      validUntil: initialTime + 1000,
    },
    initialTime,
  )
  publishItem(db, grill, {
    ...base,
    kind: 'owner-step',
    id: 'grant',
    host: 'mbp',
    destination: 'https://example.test/owner',
    action: 'Typed grant required',
    urgency: 'blocking',
    blockers: [],
    progress: { state: 'open' },
  })
  const blocker = (id: string, condition: unknown) =>
    publishItem(db, grill, { ...base, kind: 'blocker', id, condition })
  blocker('merged', {
    kind: 'provider',
    source: grill.id,
    evidence: 'pr',
    reference,
    state: 'merged',
  })
  blocker('checks', {
    kind: 'provider',
    source: grill.id,
    evidence: 'pr',
    reference,
    state: 'passed',
  })
  blocker('grant-required', {
    kind: 'owner-step',
    source: grill.id,
    id: 'grant',
  })
  blocker('wrong-pr', {
    kind: 'provider',
    source: grill.id,
    evidence: 'pr',
    reference: { ...reference, number: 101 },
    state: 'merged',
  })
  const primary: ProviderReading = {
    version: 1,
    reference,
    freshness: 'fresh',
    checkedAt: initialTime,
    validUntil: initialTime + 600_000,
    title: 'PR',
    url: pr.url,
    type: 'pr',
    status: 'merged',
    states: ['merged', 'failed'],
    checks: 'failed',
    error: '',
  }
  const statuses = (
    readings: ReadonlyArray<ProviderReading>,
    at = initialTime + 2000,
  ) =>
    attentionSnapshot(db, [grill.id], at, readings).blockers?.map(entry => [
      entry.item.id,
      entry.state,
    ])
  expect(statuses([primary])).toEqual([
    ['merged', 'clear'],
    ['checks', 'blocked'],
    ['grant-required', 'blocked'],
    ['wrong-pr', 'unknown'],
  ])
  expect(statuses([{ ...primary, freshness: 'stale' }])?.[0]?.[1]).toBe(
    'unknown',
  )
  expect(
    statuses([{ ...primary, checks: 'unknown', states: ['merged'] }])?.[1]?.[1],
  ).toBe('unknown')
  expect(statuses([primary], initialTime + 600_000)?.[0]?.[1]).toBe('unknown')
  blocker('missing-evidence', {
    kind: 'provider',
    source: grill.id,
    evidence: 'absent',
    reference,
    state: 'merged',
  })
  expect(statuses([primary])?.at(-1)?.[1]).toBe('unknown')
})

it('bounds provider command rate, concurrency and pending queue including identity reads', async () => {
  let now = 1000,
    active = 0,
    maximum = 0
  const starts: Array<number> = []
  const run = createReadLimiter(
    async () => {
      starts.push(now)
      active += 1
      maximum = Math.max(maximum, active)
      await Bun.sleep(0)
      active -= 1
      return { ok: true }
    },
    () => now,
    async ms => {
      now += ms
    },
  )
  const results = await Promise.allSettled(
    Array.from({ length: 70 }, () => run(['read'])),
  )
  expect(results.filter(result => result.status === 'rejected')).toHaveLength(4)
  expect(maximum).toBeLessThanOrEqual(2)
  expect(starts.filter(at => at === 1000)).toHaveLength(24)
  expect(starts.filter(at => at === 61000)).toHaveLength(24)
  expect(starts.filter(at => at === 121000)).toHaveLength(18)
})
