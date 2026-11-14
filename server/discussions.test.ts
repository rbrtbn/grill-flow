import { Database } from 'bun:sqlite'
import { afterEach, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Grill } from '../src/domain'
import { SKILL_REVISION } from './authoring'
import { discussionRefs, discussionThreads } from './discussions'
import { readPage } from './squad'
import {
  appendEvent,
  getGrill,
  loadGrill,
  reviseGrill,
  snapshot,
} from './store'

const base: Grill = JSON.parse(readFileSync('src/fixtures/grill.json', 'utf8'))
const fixture: Grill = {
  ...base,
  steps: base.steps.map((step, index) =>
    index === 0
      ? { ...step, question: { ...step.question, row: 'card-7/a' } }
      : step,
  ),
}
const databases = new Set<Database>()
const folders = new Set<string>()
afterEach(() => {
  databases.forEach(db => db.close())
  folders.forEach(path => rmSync(path, { recursive: true, force: true }))
  databases.clear()
  folders.clear()
})
const folder = () => {
  const path = mkdtempSync(join(tmpdir(), 'grill-discussions-'))
  folders.add(path)
  return path
}
const database = () => {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE grills (id TEXT PRIMARY KEY, json TEXT, loaded_at INTEGER);
    CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, grill_id TEXT, at INTEGER, kind TEXT, payload TEXT);`)
  databases.add(db)
  return db
}
const ask = (db: Database, grillId: string, stepId: string, text: string) =>
  appendEvent(db, grillId, 'asked', { stepId, text })
const answer = (
  db: Database,
  grill: Grill,
  stepId: string,
  askId: number | null,
  text: string,
  kind: 'comment' | 'rewrite' = 'comment',
) => {
  const result = reviseGrill(db, grill, { stepId, askId, kind, text })
  expect(result.ok).toBe(true)
}

it('references each question and whole-target discussion from the snapshot', () => {
  const db = database()
  const grill = loadGrill(db, fixture)
  const first = ask(db, grill.id, 'step-q1', 'Why this?')
  appendEvent(db, grill.id, 'sent', {
    what: 'ask',
    askId: first,
    ok: false,
    to: 't9',
    detail: 'offline',
  })
  answer(db, grill, 'step-q1', first, 'Because.')
  const second = ask(db, grill.id, 'step-q1', 'And then?')
  ask(db, grill.id, 'run', 'How is the run?')
  const part = ask(db, grill.id, 'part:part-2', 'Is this concept right?')
  answer(db, grill, 'part:part-2', part, 'Yes.')
  ask(db, grill.id, 'card:card-7', 'Which card?')
  answer(db, grill, 'step-q2', null, 'New reasoning.', 'rewrite')

  const state = snapshot(db, grill)
  const refs = discussionRefs(state)
  expect(Object.keys(refs).sort()).toEqual([
    'Q1',
    'card:card-7',
    'part:part-2',
    'run',
  ])
  const replies = state.revisions.filter(revision => revision.askId !== null)
  expect(refs.Q1).toEqual({
    target: 'step-q1',
    asks: 2,
    replies: 1,
    open: 1,
    lastAt: Math.max(
      ...state.asks.map(item => item.at),
      ...replies.map(item => item.at),
    ),
    firstAskId: first,
  })
  expect(refs['part:part-2']).toMatchObject({
    target: 'part:part-2',
    asks: 1,
    replies: 1,
    open: 0,
  })
  expect(refs.run).toMatchObject({ asks: 1, replies: 0, open: 1 })

  const threads = discussionThreads(state)
  expect(threads.Q1?.asks.map(item => item.id)).toEqual([first, second])
  expect(threads.Q1?.asks[0]).toMatchObject({
    text: 'Why this?',
    answered: true,
    delivery: { state: 'failed', to: 't9', detail: 'offline' },
    replies: [{ kind: 'comment', text: 'Because.' }],
  })
  expect(threads.Q2).toMatchObject({
    target: 'step-q2',
    asks: [],
    unasked: [{ kind: 'rewrite', text: 'New reasoning.' }],
  })
})

it('keys a composed squad page by shared question ids and scoped targets', () => {
  const db = database()
  const member = (id: string, lead = false) =>
    loadGrill(db, {
      ...fixture,
      id,
      steps: fixture.steps.slice(0, 2),
      squad: { id: 'team', section: id, ...(lead ? { lead: true } : {}) },
    })
  member('lead-run', true)
  const worker = member('worker-run')
  const local = ask(db, worker.id, 'step-q1', 'Explain.')
  answer(db, worker, 'step-q1', local, 'Explained Q1.')
  ask(db, worker.id, 'run', 'Status?')

  const page = readPage(db, 'team')!
  const refs = discussionRefs(page.state)
  expect(refs.Q3).toMatchObject({
    target: 'worker-run::step-q1',
    asks: 1,
    replies: 1,
    open: 0,
    firstAskId: local,
  })
  expect(refs['part:worker-run::run']).toMatchObject({ asks: 1, open: 1 })
  expect(refs.Q1).toBeUndefined()
  expect(discussionRefs(snapshot(db, worker)).Q1?.target).toBe('step-q1')
})

const run = async (
  dir: string,
  args: ReadonlyArray<string>,
  env: Record<string, string | undefined> = {},
) => {
  const child = Bun.spawn(
    [
      process.execPath,
      'server/cli.ts',
      ...args,
      '--skill-revision',
      String(SKILL_REVISION),
    ],
    {
      env: {
        ...process.env,
        GF_DB: join(dir, 'test.sqlite'),
        GF_OUTBOX: undefined,
        GF_SQUAD: undefined,
        GF_REQUIRE_REASON: undefined,
        HC_TERMINAL_ID: 't7',
        ...env,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  const [code, out, error] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { code, out, error }
}

it('drops an agent-supplied discussions key on load, with one warning', async () => {
  const dir = folder()
  const file = join(dir, 'grill.json')
  const served = {
    ...fixture,
    discussions: { Q1: { target: 'step-q1', asks: 9 } },
  }
  writeFileSync(file, JSON.stringify(served))
  const loaded = await run(dir, ['load', file, '--reason', 'copied back'])
  expect(loaded.code).toBe(0)
  expect(loaded.error.match(/Ignored "discussions"/g)).toHaveLength(1)
  const db = new Database(join(dir, 'test.sqlite'))
  databases.add(db)
  const stored = db
    .query<{ json: string }, [string]>('SELECT json FROM grills WHERE id = ?')
    .get(fixture.id)!
  expect(JSON.parse(stored.json)).not.toHaveProperty('discussions')

  writeFileSync(join(dir, 'clean.json'), JSON.stringify(fixture))
  const quiet = await run(dir, [
    'load',
    join(dir, 'clean.json'),
    '--reason',
    'clean',
  ])
  expect(quiet).toMatchObject({ code: 0, error: '' })

  const outbox = join(dir, 'outbox')
  const queued = await run(dir, ['load', file, '--reason', 'remote'], {
    GF_OUTBOX: outbox,
  })
  expect(queued.code).toBe(0)
  expect(queued.error).toContain('Ignored "discussions"')
  expect(
    JSON.parse(readFileSync(join(outbox, fixture.id, 'grill.json'), 'utf8')),
  ).not.toHaveProperty('discussions')
})

it('exports a grill with revisions, full threads, answers and events, without reference checks', async () => {
  const dir = folder()
  const file = join(dir, 'grill.json')
  writeFileSync(file, JSON.stringify(fixture))
  expect((await run(dir, ['load', file, '--reason', 'round 1'])).code).toBe(0)
  writeFileSync(file, JSON.stringify({ ...fixture, title: 'Round two' }))
  expect((await run(dir, ['load', file, '--reason', 'round 2'])).code).toBe(0)

  const db = new Database(join(dir, 'test.sqlite'))
  databases.add(db)
  const grill = getGrill(db, fixture.id)!
  appendEvent(db, grill.id, 'answered', { question: 'Q1', key: 'a' })
  appendEvent(db, grill.id, 'noted', { question: 'Q1', text: 'Only if cheap.' })
  appendEvent(db, grill.id, 'reference-checked', { ref: 'noise' })
  const asked = ask(db, grill.id, 'step-q1', 'Why?')
  appendEvent(db, grill.id, 'sent', {
    what: 'ask',
    askId: asked,
    ok: true,
    to: 't7',
    detail: 'sent to t7',
  })
  answer(db, grill, 'step-q1', asked, 'Because.')
  appendEvent(db, grill.id, 'sent', {
    what: 'answers',
    ok: true,
    detail: 'sent to t7',
    lines: { Q1: 'Q1 a' },
  })

  const out = join(dir, 'export.json')
  const written = await run(dir, ['export', grill.id, '--out', out])
  expect(written).toMatchObject({ code: 0, error: '' })
  expect(written.out).toContain(`exported ${grill.id} to ${out}`)
  const document = JSON.parse(readFileSync(out, 'utf8'))
  expect(Date.parse(document.exportedAt)).toBeGreaterThan(0)
  expect(document).toMatchObject({
    kind: 'grill',
    id: grill.id,
    grill: { id: grill.id, title: 'Round two' },
    answers: { Q1: 'a' },
    notes: { Q1: 'Only if cheap.' },
    sent: { Q1: 'Q1 a' },
    retirement: null,
  })
  expect(
    document.revisions.map(
      (revision: { rev: number; reason: string; json: Grill }) => [
        revision.rev,
        revision.reason,
        revision.json.title,
      ],
    ),
  ).toEqual([
    [1, 'round 1', fixture.title],
    [2, 'round 2', 'Round two'],
  ])
  expect(document.discussions.Q1).toMatchObject({
    target: 'step-q1',
    asks: [
      {
        id: asked,
        text: 'Why?',
        answered: true,
        delivery: { state: 'delivered', to: 't7' },
        replies: [{ kind: 'comment', text: 'Because.' }],
      },
    ],
  })
  expect(document.sends.at(-1)).toMatchObject({ ok: true })
  expect(document.answerHistory[0]).toMatchObject({
    state: 'delivered',
    legacyLines: { Q1: 'Q1 a' },
  })
  const kinds = document.events.map((event: { kind: string }) => event.kind)
  expect(kinds).toContain('answered')
  expect(kinds).not.toContain('reference-checked')

  const printed = await run(dir, ['export', grill.id])
  expect(JSON.parse(printed.out).id).toBe(grill.id)
  expect((await run(dir, ['export', 'missing'])).code).toBe(2)
})
