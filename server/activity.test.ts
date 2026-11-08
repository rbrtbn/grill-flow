import { Database } from 'bun:sqlite'
import { afterEach, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

import { answerAnchor, itemAnchor } from '../src/activity'
import { activityFeed } from './activity'
import { publishItem } from './channel'
import { readPage } from './squad'
import {
  appendEvent,
  events,
  loadGrill,
  retireGrill,
  restoreGrill,
} from './store'

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
const source = (db: Database, id = 'worker') =>
  loadGrill(db, {
    ...fixture,
    id,
    session: 't1',
    squad: { id: 'team', section: id },
    steps: fixture.steps.slice(0, 2).map((step: { question: object }) => ({
      ...step,
      question: { ...step.question, dependsOn: [], when: [] },
    })),
  })
const base = {
  version: 1,
  previous: 0,
  revision: 1,
  session: 't1',
  body: 'Recorded original words.',
}
const owner = {
  ...base,
  kind: 'owner-step',
  id: 'manual',
  host: 'mbp',
  action: 'Exact action',
  destination: 'https://example.test/owner',
  urgency: 'soon',
  blockers: [],
  progress: { state: 'open' },
}

it('records precise reload differences without inventing context for older reloads', () => {
  const db = database(),
    grill = source(db)
  const initial = activityFeed(db, readPage(db, grill.id)!)
  expect(initial.entries[0]).toMatchObject({
    label: 'Questions changed',
    source: grill.id,
    question: 'Q1',
    needsAction: true,
  })
  expect(initial.entries[0]?.summary).toContain('Added: Q1, Q2')
  loadGrill(db, grill)
  expect(activityFeed(db, readPage(db, grill.id)!).entries).toHaveLength(1)
  const changed = loadGrill(db, {
    ...grill,
    steps: [
      {
        ...grill.steps[0],
        question: { ...grill.steps[0]!.question, ask: 'New wording?' },
      },
    ],
  })
  const diff = activityFeed(db, readPage(db, grill.id)!).entries[0]!
  expect(diff.summary).toContain('changed: Q1; removed: Q2')
  expect(diff.question).toBe('Q1')
  const legacy = appendEvent(db, grill.id, 'loaded', { round: 1, steps: 1 })
  expect(
    activityFeed(db, readPage(db, grill.id)!).entries.find(
      entry => entry.event === legacy,
    ),
  ).toMatchObject({
    label: 'Page reloaded',
    summary:
      'Round 1 · 1 questions. Detailed changes unavailable for this older reload.',
  })
  loadGrill(db, { ...changed, intro: ['New context only.'] })
  expect(activityFeed(db, readPage(db, grill.id)!).entries[0]?.label).toBe(
    'Page context changed',
  )
})

it('keeps source identities through composite renumbering, retirement and restoration without feed writes', () => {
  const db = database(),
    alpha = source(db, 'alpha'),
    beta = source(db, 'beta')
  const first = appendEvent(db, alpha.id, 'answered', {
    question: 'Q1',
    key: 'a',
  })
  const second = appendEvent(db, beta.id, 'answered', {
    question: 'Q1',
    key: 'b',
  })
  const page = readPage(db, 'team')!,
    before = events(db, alpha.id).length + events(db, beta.id).length
  const feed = activityFeed(db, page)
  expect(feed.entries.find(entry => entry.event === first)).toMatchObject({
    source: alpha.id,
    question: 'Q1',
    target: 'question',
  })
  expect(feed.entries.find(entry => entry.event === second)).toMatchObject({
    source: beta.id,
    question: 'Q1',
    target: 'question',
  })
  expect(feed.highWater).toMatchObject({ alpha: first, beta: second })
  activityFeed(db, page)
  expect(events(db, alpha.id).length + events(db, beta.id).length).toBe(before)
  retireGrill(db, alpha, 'fixture')
  expect(
    activityFeed(db, readPage(db, 'team')!).entries.every(
      entry => entry.source === beta.id,
    ),
  ).toBe(true)
  expect(
    activityFeed(db, readPage(db, alpha.id)!).entries.some(
      entry => entry.event === first,
    ),
  ).toBe(true)
  restoreGrill(db, alpha)
  expect(
    activityFeed(db, readPage(db, 'team')!).entries.some(
      entry => entry.event === first && entry.question === 'Q1',
    ),
  ).toBe(true)
})

it('retains frozen item excerpts while deriving action from the current published item', () => {
  const db = database(),
    grill = source(db)
  publishItem(db, grill, owner)
  publishItem(db, grill, {
    ...base,
    kind: 'update',
    id: 'update',
    question: 'Q1',
  })
  publishItem(db, grill, {
    ...base,
    kind: 'decision',
    id: 'ruling',
    deadline: Date.now() + 60_000,
    affected: [],
    resolution: { state: 'provisional' },
  })
  const feed = activityFeed(db, readPage(db, grill.id)!)
  expect(feed.entries.find(entry => entry.item === 'manual')).toMatchObject({
    needsAction: true,
    anchor: itemAnchor(grill.id, 'manual'),
    summary: owner.body,
  })
  expect(feed.entries.find(entry => entry.item === 'update')).toMatchObject({
    needsAction: false,
    target: 'updates',
    anchor: itemAnchor(grill.id, 'update'),
  })
  expect(feed.entries.find(entry => entry.item === 'ruling')?.needsAction).toBe(
    true,
  )
  publishItem(db, grill, {
    ...owner,
    previous: 1,
    revision: 2,
    body: 'Later words.',
    progress: { state: 'withdrawn', reason: 'No action remains.' },
  })
  const revised = activityFeed(db, readPage(db, grill.id)!)
  const versions = revised.entries.filter(entry => entry.item === 'manual')
  expect(versions.map(entry => entry.summary)).toEqual([
    'Later words.',
    owner.body,
  ])
  expect(versions.every(entry => !entry.needsAction)).toBe(true)
})

it('links answer receipts and exact replies while keeping recorded requests separate from transport', () => {
  const db = database(),
    grill = source(db)
  const ask = appendEvent(db, grill.id, 'asked', {
    stepId: grill.steps[0]!.id,
    text: 'Please clarify.',
  })
  const failedAsk = appendEvent(db, grill.id, 'sent', {
    what: 'ask',
    askId: ask,
    ok: false,
  })
  const revision = appendEvent(db, grill.id, 'revised', {
    stepId: grill.steps[0]!.id,
    askId: ask,
    kind: 'comment',
    text: 'Frozen agent answer.',
  })
  const reply = appendEvent(db, grill.id, 'replied', {
    text: 'Whole answer reply.',
  })
  const submission = appendEvent(db, grill.id, 'submitted', {
    version: 1,
    questions: { Q1: 'Q1' },
    answers: [],
    recipients: [],
  })
  const delivery = appendEvent(db, grill.id, 'sent', {
    what: 'answers',
    submission,
    ok: true,
  })
  const feed = activityFeed(db, readPage(db, grill.id)!)
  expect(feed.entries.find(entry => entry.event === ask)?.label).toBe(
    'Discussion ask recorded',
  )
  expect(feed.entries.find(entry => entry.event === failedAsk)).toMatchObject({
    label: 'Ask delivery failed',
    question: 'Q1',
    target: 'question',
  })
  expect(feed.entries.find(entry => entry.event === revision)).toMatchObject({
    summary: 'Frozen agent answer.',
    target: 'replies',
    anchor: `agent-answer-${revision}`,
  })
  expect(feed.entries.find(entry => entry.event === reply)?.anchor).toBe(
    `agent-reply-${reply}`,
  )
  expect(feed.entries.find(entry => entry.event === submission)?.anchor).toBe(
    answerAnchor(grill.id, submission),
  )
  expect(feed.entries.find(entry => entry.event === delivery)?.anchor).toBe(
    answerAnchor(grill.id, submission),
  )
})

it('resolves drawing and veto delivery to their recorded source targets and never adds grant authority', () => {
  const db = database(),
    grill = source(db)
  const request = appendEvent(db, grill.id, 'drawing-requested', {
    question: 'Q1',
  })
  const drawing = appendEvent(db, grill.id, 'drawing-delivery', {
    request,
    attempted: true,
    ok: false,
  })
  const veto = appendEvent(db, grill.id, 'veto-requested', {
    item: 'ruling',
    decision: 'Frozen decision.',
  })
  const delivered = appendEvent(db, grill.id, 'veto-delivery', {
    receipt: veto,
    ok: true,
  })
  const reference = appendEvent(db, grill.id, 'reference-checked', {
    version: 1,
    reference: {
      provider: 'github',
      repository: 'rbrtbn/squad',
      kind: 'pull',
      number: 100,
    },
    freshness: 'fresh',
    checkedAt: 1,
    validUntil: 2,
    title: 'Title',
    url: 'https://github.com/rbrtbn/squad/pull/100',
    status: 'merged',
    type: 'pr',
    states: ['merged'],
    checks: 'failed',
    error: '',
  })
  const count = events(db, grill.id).length,
    feed = activityFeed(db, readPage(db, grill.id)!)
  expect(feed.entries.find(entry => entry.event === drawing)).toMatchObject({
    question: 'Q1',
    target: 'question',
  })
  expect(feed.entries.find(entry => entry.event === delivered)).toMatchObject({
    item: 'ruling',
    anchor: itemAnchor(grill.id, 'ruling'),
    needsAction: false,
  })
  expect(feed.entries.find(entry => entry.event === reference)).toMatchObject({
    label: 'Reference changed',
    target: 'reference',
    needsAction: false,
  })
  expect(
    feed.entries.find(entry => entry.event === reference)?.summary,
  ).toContain('rbrtbn/squad PR #100')
  expect(events(db, grill.id)).toHaveLength(count)
})

it('bounds the rendered feed while retaining source high water and keeps removed questions off dead links', () => {
  const db = database(),
    grill = source(db)
  const removed = appendEvent(db, grill.id, 'answered', {
    question: 'Q2',
    key: 'a',
  })
  loadGrill(db, { ...grill, steps: grill.steps.slice(0, 1) })
  expect(
    activityFeed(db, readPage(db, grill.id)!).entries.find(
      entry => entry.event === removed,
    ),
  ).toMatchObject({ question: 'Q2', target: 'overview' })
  const ids = Array.from({ length: 310 }, (_, index) =>
    appendEvent(db, grill.id, 'replied', {
      text: `Reply ${index} ${'x'.repeat(500)}`,
    }),
  )
  const feed = activityFeed(db, readPage(db, grill.id)!)
  expect(feed.entries).toHaveLength(300)
  expect(feed.truncated).toBe(true)
  expect(feed.total).toBeGreaterThan(310)
  expect(feed.highWater[grill.id]).toBe(ids.at(-1)!)
  expect(feed.entries[0]?.event).toBe(ids.at(-1)!)
  expect(feed.entries.every(entry => entry.summary.length <= 240)).toBe(true)
})
