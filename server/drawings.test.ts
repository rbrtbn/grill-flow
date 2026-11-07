import { Database } from 'bun:sqlite'
import { afterEach, expect, it } from 'bun:test'
import { Schema } from 'effect'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Grill } from '../src/domain'
import { questionRevisions } from './answerReceipts'
import { pageDrawings, publishDrawing, requestDrawing } from './drawings'
import { newsSince } from './outbox'
import { eventDestination, readPage } from './squad'
import { events, loadGrill, retireGrill } from './store'

const fixture = Schema.decodeUnknownSync(Grill)(
  JSON.parse(readFileSync('src/fixtures/grill.json', 'utf8')),
)
const databases = new Set<Database>()
const folders = new Set<string>()
afterEach(() => {
  databases.forEach(db => db.close())
  databases.clear()
  folders.forEach(folder => rmSync(folder, { recursive: true, force: true }))
  folders.clear()
})
const database = (path = ':memory:') => {
  const db = new Database(path)
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
    session: 't-owner',
    steps: fixture.steps.slice(0, 1),
    squad: { id: 'team', section: id },
  })
const command = () => 'bun run gf'
const delivered = async () => ({ ok: true, detail: 'Mock transport' })
const request = (grill: Grill, previous = 0, requestId = 'drawing-one') => ({
  question: 'Q1',
  contextRevision: questionRevisions(grill).Q1,
  previous,
  requestId,
})
const compare = {
  kind: 'compare',
  now: 'Today',
  rows: [{ label: 'Ownership', cells: { now: 'Unknown', a: 'One owner' } }],
}
const reply = (request: number) => ({
  version: 1,
  question: 'Q1',
  request,
  previous: 0,
  revision: 1,
  diagram: compare,
})

it('freezes displayed wording and canonical ownership before transport without answering the question', async () => {
  const db = database()
  source(db, 'first')
  const grill = source(db)
  const page = readPage(db, 'team')!
  const member = page.members.find(
    member => member.state.grill.id === grill.id,
  )!
  const displayQuestion = member.registration.questions.Q1!
  expect(displayQuestion).not.toBe('Q1')
  const body = {
    ...request(page.state.grill),
    question: displayQuestion,
    contextRevision: questionRevisions(page.state.grill)[displayQuestion],
  }
  const destination = eventDestination(page, body)
  const result = await requestDrawing(
    db,
    destination.grill,
    page.state.grill,
    displayQuestion,
    destination.body,
    async (session, text) => {
      expect(session).toBe('t-owner')
      expect(pageDrawings(db, page)[0]).toMatchObject({
        source: grill.id,
        question: 'Q1',
        displayQuestion,
        delivery: 'pending',
        context: {
          displayPage: 'team',
          displayQuestion,
          ask: page.state.grill.steps.find(
            step => step.question.id === displayQuestion,
          )!.question.ask,
        },
      })
      expect(text).toContain(`draw '${grill.id}' 'Q1' --request`)
      return delivered()
    },
    command,
  )
  expect(result.ok).toBe(true)
  expect(pageDrawings(db, page)[0]?.delivery).toBe('delivered')
  expect(
    events(db, grill.id).filter(event => event.kind === 'answered'),
  ).toHaveLength(0)
  expect(
    events(db, 'team').filter(event => event.kind === 'drawing-requested'),
  ).toHaveLength(0)
})

it('replays only the same request identity, rejects stale context and serializes concurrent requests', async () => {
  const db = database(),
    grill = source(db)
  const first = await requestDrawing(
    db,
    grill,
    grill,
    'Q1',
    request(grill),
    delivered,
    command,
  )
  expect(first.ok).toBe(true)
  const noSend = async () => {
    throw new Error('Replay must not deliver')
  }
  expect(
    await requestDrawing(
      db,
      grill,
      grill,
      'Q1',
      request(grill),
      noSend,
      command,
    ),
  ).toEqual(first)
  for (const body of [
    { ...request(grill), contextRevision: 'changed' },
    { ...request(grill), previous: 20 },
    request(grill, 0, 'concurrent'),
    { ...request(grill, 0, 'stale'), contextRevision: 'changed' },
  ]) {
    expect(
      await requestDrawing(db, grill, grill, 'Q1', body, noSend, command),
    ).toMatchObject({ ok: false, status: 409 })
  }
  expect(
    await requestDrawing(
      db,
      grill,
      grill,
      'Q1',
      { ...request(grill), previous: -1 },
      noSend,
      command,
    ),
  ).toMatchObject({ ok: false, status: 400 })
  expect(
    events(db, grill.id).filter(event => event.kind === 'drawing-requested'),
  ).toHaveLength(1)
})

it('keeps failed, interrupted, unrouted and preview deliveries visible', async () => {
  const db = database(),
    grill = source(db)
  const failure = await requestDrawing(
    db,
    grill,
    grill,
    'Q1',
    request(grill),
    async () => {
      throw new Error('Mock offline')
    },
    command,
  )
  expect(failure.ok).toBe(true)
  expect(pageDrawings(db, readPage(db, grill.id)!)[0]).toMatchObject({
    delivery: 'failed',
    detail: 'Error: Mock offline',
  })
  db.run("DELETE FROM events WHERE kind = 'drawing-delivery'")
  expect(pageDrawings(db, readPage(db, grill.id)!)[0]?.delivery).toBe('pending')
  await requestDrawing(
    db,
    grill,
    grill,
    'Q1',
    request(grill),
    delivered,
    command,
  )
  expect(pageDrawings(db, readPage(db, grill.id)!)[0]?.delivery).toBe('pending')
  const blank = loadGrill(db, { ...grill, id: 'blank', session: '' })
  await requestDrawing(
    db,
    blank,
    blank,
    'Q1',
    request(blank),
    async () => {
      throw new Error('No route must not send')
    },
    command,
  )
  expect(pageDrawings(db, readPage(db, blank.id)!)[0]).toMatchObject({
    delivery: 'pending',
    recipient: '',
  })
  const preview = source(db, 'preview')
  await requestDrawing(
    db,
    preview,
    preview,
    'Q1',
    request(preview),
    async () => {
      throw new Error('Preview must not send')
    },
    command,
    true,
  )
  expect(pageDrawings(db, readPage(db, preview.id)!)[0]?.detail).toContain(
    'Preview',
  )
})

it('accepts typed responses only for their saved source question and preserves frozen wording after reload', async () => {
  const db = database(),
    grill = source(db),
    foreign = source(db, 'foreign')
  const saved = await requestDrawing(
    db,
    grill,
    grill,
    'Q1',
    request(grill),
    delivered,
    command,
  )
  if (!saved.ok) throw new Error(saved.error)
  const response = reply(saved.event)
  expect(publishDrawing(db, foreign, response).ok).toBe(false)
  expect(publishDrawing(db, grill, { ...response, question: 'Q2' }).ok).toBe(
    false,
  )
  expect(
    publishDrawing(db, grill, { ...response, request: saved.event + 100 }).ok,
  ).toBe(false)
  const published = publishDrawing(db, grill, response)
  expect(published.ok).toBe(true)
  expect(publishDrawing(db, grill, response)).toEqual(published)
  expect(
    publishDrawing(db, grill, {
      ...response,
      diagram: { ...compare, now: 'Other' },
    }),
  ).toMatchObject({ ok: false, status: 409 })
  expect(
    publishDrawing(db, grill, { ...response, previous: 2, revision: 3 }),
  ).toMatchObject({ ok: false, status: 409 })
  const changed = loadGrill(db, {
    ...grill,
    steps: grill.steps.map(step => ({
      ...step,
      question: {
        ...step.question,
        ask: 'Changed wording?',
        options: step.question.options.map(option => ({
          ...option,
          label: 'New label',
        })),
      },
    })),
  })
  expect(pageDrawings(db, readPage(db, grill.id)!)[0]).toMatchObject({
    stale: true,
    context: { ask: grill.steps[0]!.question.ask },
    response: { revision: 1, diagram: compare },
  })
  expect(
    publishDrawing(db, changed, { ...response, previous: 1, revision: 2 }).ok,
  ).toBe(true)
  const next = await requestDrawing(
    db,
    changed,
    changed,
    'Q1',
    request(changed, saved.event, 'next'),
    delivered,
    command,
  )
  expect(next.ok).toBe(true)
  expect(pageDrawings(db, readPage(db, grill.id)!)[0]).toMatchObject({
    stale: false,
  })
  expect(pageDrawings(db, readPage(db, grill.id)!)[0]?.response).toBeUndefined()
  retireGrill(db, changed, 'test fixture')
  expect(pageDrawings(db, readPage(db, grill.id)!)).toHaveLength(1)
})

it('bounds diagrams and refuses unknown compare choices and flow lanes', async () => {
  const db = database(),
    grill = source(db)
  const saved = await requestDrawing(
    db,
    grill,
    grill,
    'Q1',
    request(grill),
    delivered,
    command,
  )
  if (!saved.ok) throw new Error(saved.error)
  const flow = {
    kind: 'flow',
    lanes: [{ id: 'owner', label: 'Owner' }],
    steps: ['Read', 'Reply'],
    states: {
      now: { nodes: { owner: ['Read request', null] } },
      a: { nodes: { owner: [null, 'Publish drawing'] } },
    },
  }
  for (const diagram of [
    { ...compare, rows: [] },
    {
      ...compare,
      rows: [{ label: 'Wrong', cells: { madeup: 'Unknown option' } }],
    },
    { ...compare, now: 'x'.repeat(100_001) },
    { ...flow, lanes: [] },
    {
      ...flow,
      states: {
        now: { nodes: {}, band: { from: 1, to: 999, label: 'Oversized band' } },
      },
    },
    { ...flow, lanes: [flow.lanes[0], flow.lanes[0]] },
    { ...flow, states: { now: { nodes: { stranger: ['Unknown lane'] } } } },
    { ...flow, states: { now: { nodes: { owner: ['One', 'Two', 'Three'] } } } },
    { kind: 'html', body: '<script>bad()</script>' },
  ]) {
    expect(
      publishDrawing(db, grill, { ...reply(saved.event), diagram }),
    ).toMatchObject({ ok: false, status: 400 })
  }
  expect(
    publishDrawing(db, grill, { ...reply(saved.event), diagram: flow }).ok,
  ).toBe(true)
})

it('publishes immutable local and remote CLI responses and returns tagged pending pickup', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gf-drawing-'))
  folders.add(dir)
  const dbPath = join(dir, 'db.sqlite'),
    db = database(dbPath),
    grill = source(db)
  const saved = await requestDrawing(
    db,
    grill,
    grill,
    'Q1',
    request(grill),
    delivered,
    command,
  )
  if (!saved.ok) throw new Error(saved.error)
  const file = join(dir, 'diagram.json')
  writeFileSync(file, JSON.stringify(compare))
  const cli = async (outbox?: string) => {
    const child = Bun.spawn(
      [
        process.execPath,
        'server/cli.ts',
        'draw',
        grill.id,
        'Q1',
        '--request',
        String(saved.event),
        '--file',
        file,
      ],
      {
        env: { ...process.env, GF_DB: dbPath, GF_OUTBOX: outbox },
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
  const fresh = () =>
    events(db, grill.id).map(event => ({
      ...event,
      payload: JSON.parse(event.payload),
    }))
  const pending = newsSince(grill.id, fresh(), new Set())
  expect(pending.lines).toHaveLength(1)
  expect(pending.lines[0]).toStartWith('<grill-flow source="page">\n')
  expect(pending.lines[0]).toContain(`--request ${saved.event}`)
  expect((await cli()).code).toBe(0)
  expect(newsSince(grill.id, fresh(), new Set()).lines).toHaveLength(0)
  const outbox = join(dir, 'outbox')
  mkdirSync(join(outbox, grill.id), { recursive: true })
  writeFileSync(join(outbox, grill.id, 'grill.json'), JSON.stringify(grill))
  expect((await cli(outbox)).code).toBe(0)
  expect((await cli(outbox)).code).toBe(0)
  const queued = join(
    outbox,
    grill.id,
    'drawings',
    `${saved.event}-0000000001.json`,
  )
  expect(JSON.parse(readFileSync(queued, 'utf8')).diagram).toEqual(compare)
  writeFileSync(file, JSON.stringify({ ...compare, now: 'Changed' }))
  expect((await cli(outbox)).code).not.toBe(0)
  expect(JSON.parse(readFileSync(queued, 'utf8')).diagram).toEqual(compare)
})
