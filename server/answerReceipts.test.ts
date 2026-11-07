import { Database } from 'bun:sqlite'
import { afterEach, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type Grill, OWN } from '../src/domain'
import {
  SubmissionConflict,
  freezeSubmission,
  questionRevisions,
  readSubmission,
  recordAnswer,
  replaySubmission,
  sendRequestIdentity,
  unconfirmedSends,
} from './answerReceipts'
import { selectSend } from './sendSelection'
import { readPage, sendPageAnswers } from './squad'
import { appendEvent, events, loadGrill, snapshot } from './store'

const fixture = JSON.parse(readFileSync('src/fixtures/grill.json', 'utf8'))
const databases = new Set<Database>()
const directories = new Set<string>()
afterEach(() => {
  databases.forEach(db => db.close())
  databases.clear()
  directories.forEach(dir => rmSync(dir, { recursive: true, force: true }))
  directories.clear()
})
const database = (path = ':memory:') => {
  const db = new Database(path)
  db.exec(`CREATE TABLE grills (id TEXT PRIMARY KEY, json TEXT, loaded_at INTEGER);
    CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, grill_id TEXT,
      at INTEGER, kind TEXT, payload TEXT);`)
  databases.add(db)
  return db
}
const source = (id = 'fixture', squad = false) => ({
  ...fixture,
  id,
  session: id,
  ...(squad ? { squad: { id: 'team', section: id } } : {}),
  steps: fixture.steps.slice(0, 1),
})
const answer = (
  db: Database,
  grill: Grill,
  display = grill,
  shared = 'Q1',
  key = 'a',
) => {
  const result = recordAnswer(db, grill, display, shared, {
    question: 'Q1',
    key,
    text: 'Own exact words',
    contextRevision: questionRevisions(display)[shared],
  })
  if (!result.ok) throw new Error(result.error)
  return result.id
}
const submissions = (db: Database, id: string) =>
  events(db, id).filter(item => item.kind === 'submitted')
const send = async (db: Database, grill: Grill, request: unknown = {}) => {
  const page = readPage(db, grill.id)!
  const selection = selectSend(page.state, request)
  if (!selection.ok) throw new Error(selection.error)
  await sendPageAnswers(
    db,
    page,
    selection,
    async () => ({ ok: true, detail: 'mock' }),
    () => 'gf',
    request,
  )
  return submissions(db, grill.id).at(-1)!.id
}

it('freezes answer wording and the revision at Send independently of later reloads', async () => {
  const db = database()
  const original = loadGrill(db, source())
  appendEvent(db, original.id, 'noted', {
    question: 'Q1',
    text: 'Note at answer',
  })
  const answerEvent = answer(db, original)
  const changed = loadGrill(db, {
    ...original,
    steps: original.steps.map(step => ({
      ...step,
      question: {
        ...step.question,
        ask: 'A new meaning?',
        options: step.question.options.map(option => ({
          ...option,
          label: `New ${option.label}`,
        })),
      },
    })),
  })
  appendEvent(db, original.id, 'noted', {
    question: 'Q1',
    text: 'Note at Send',
  })
  const id = await send(db, changed, { requestId: 'send-1', questions: ['Q1'] })
  const receipt = readSubmission(db, original.id, id)
  expect(receipt.answers[0]?.answerEvent).toBe(answerEvent)
  expect(receipt.answers[0]?.context?.ask).toBe(original.steps[0]!.question.ask)
  expect(receipt.answers[0]?.context?.options).toEqual(
    original.steps[0]!.question.options,
  )
  expect(receipt.answers[0]?.context?.revision).not.toBe(
    receipt.answers[0]?.sendRevision,
  )
  expect(receipt.answers[0]?.sendRevision).toBe(questionRevisions(changed).Q1)
  expect(receipt.answers[0]?.note).toBe('Note at Send')
  expect(
    JSON.parse(
      events(db, original.id).find(item => item.id === answerEvent)!.payload,
    ).receipt.note,
  ).toBe('Note at answer')
  loadGrill(db, { ...changed, steps: [] })
  appendEvent(db, original.id, 'noted', { question: 'Q1', text: 'Later note' })
  expect(readSubmission(db, original.id, id)).toEqual(receipt)
  expect(receipt.deliveries[0]?.state).toBe('delivered')
  expect(receipt.deliveries[0]?.attempts[0]?.event).toBeGreaterThan(id)
})

it('rejects a stale new answer without replacing the existing answer or its words', () => {
  const db = database()
  const grill = loadGrill(db, source())
  const revision = questionRevisions(grill).Q1
  answer(db, grill)
  const changed = loadGrill(db, {
    ...grill,
    steps: grill.steps.map(step => ({
      ...step,
      question: { ...step.question, scope: 'Different scope' },
    })),
  })
  const before = events(db, grill.id).length
  expect(
    recordAnswer(db, changed, changed, 'Q1', {
      question: 'Q1',
      key: 'b',
      contextRevision: revision,
    }),
  ).toMatchObject({ ok: false, status: 409 })
  expect(events(db, grill.id)).toHaveLength(before)
  expect(snapshot(db, changed).answers.Q1).toBe('a')
})

it('keeps own text and note verbatim and never backfills legacy context', async () => {
  const db = database()
  const grill = loadGrill(db, source())
  answer(db, grill, grill, 'Q1', OWN)
  const id = await send(db, grill)
  expect(readSubmission(db, grill.id, id).answers[0]?.own).toBe(
    'Own exact words',
  )
  appendEvent(db, grill.id, 'answered', { question: 'Q1', key: 'b' })
  const legacy = await send(db, grill)
  expect(readSubmission(db, grill.id, legacy).answers[0]?.context).toBeNull()
  expect(readSubmission(db, grill.id, legacy).answers[0]?.own).toBe('')
  expect(
    recordAnswer(db, grill, grill, 'Q1', { question: 'Q1', key: 'a' }).ok,
  ).toBe(true)
  const oldClient = await send(db, grill)
  expect(readSubmission(db, grill.id, oldClient).answers[0]?.context).toBeNull()
})

it('freezes each canonical member before any delivery and preserves partial evidence', async () => {
  const db = database()
  const a = loadGrill(db, source('alpha', true))
  const b = loadGrill(db, source('beta', true))
  const page = readPage(db, 'team')!
  page.members.forEach(member =>
    answer(
      db,
      member.state.grill,
      page.state.grill,
      member.registration.questions.Q1!,
    ),
  )
  const ready = readPage(db, 'team')!
  const request = {
    requestId: 'shared-1',
    message: 'Extra words are not grant text',
  }
  const selection = selectSend(ready.state, request)
  if (!selection.ok) throw new Error(selection.error)
  const calls: Array<string> = []
  await sendPageAnswers(
    db,
    ready,
    selection,
    async session => {
      expect(submissions(db, a.id)).toHaveLength(1)
      expect(submissions(db, b.id)).toHaveLength(1)
      calls.push(session)
      return { ok: session === a.session, detail: 'mock transport' }
    },
    () => 'gf',
    request,
  )
  const one = readSubmission(db, a.id, submissions(db, a.id)[0]!.id)
  const two = readSubmission(db, b.id, submissions(db, b.id)[0]!.id)
  expect(one.answers[0]?.question).toBe('Q1')
  expect(two.answers[0]?.question).toBe('Q1')
  expect(one.answers[0]?.context?.displayQuestion).not.toBe(
    two.answers[0]?.context?.displayQuestion,
  )
  expect(one.displayPage).toBe('team')
  expect(one.deliveries[0]?.state).toBe('delivered')
  expect(two.deliveries[0]?.state).toBe('failed')
  expect(snapshot(db, a).sent?.Q1).toBe('Q1 a')
  expect(snapshot(db, b).sent?.Q1).toBeUndefined()
  await sendPageAnswers(
    db,
    ready,
    selection,
    async () => {
      throw new Error('Replay delivered twice')
    },
    () => 'gf',
    request,
  )
  expect(calls).toHaveLength(2)
  expect(submissions(db, a.id)).toHaveLength(1)
  expect(
    replaySubmission(db, 'team', { ...request, message: 'Different' }),
  ).toBe('conflict')
})

it('rolls back all source submissions if a selected line changed before freezing', async () => {
  const db = database()
  const a = loadGrill(db, source('alpha', true))
  const b = loadGrill(db, source('beta', true))
  answer(db, a)
  answer(db, b)
  const page = readPage(db, 'team')!
  const selection = selectSend(page.state, {})
  if (!selection.ok) throw new Error(selection.error)
  appendEvent(db, b.id, 'noted', {
    question: 'Q1',
    text: 'Changed after review',
  })
  await expect(
    sendPageAnswers(
      db,
      page,
      selection,
      async () => {
        throw new Error('No delivery permitted')
      },
      () => 'gf',
    ),
  ).rejects.toBeInstanceOf(SubmissionConflict)
  expect(submissions(db, a.id)).toHaveLength(0)
  expect(submissions(db, b.id)).toHaveLength(0)
})

it('keeps an interrupted frozen send unconfirmed when its request is replayed', async () => {
  const db = database()
  const grill = loadGrill(db, source())
  answer(db, grill)
  const request = { requestId: 'interrupted', questions: ['Q1'] }
  const state = snapshot(db, grill)
  const selected = selectSend(state, request)
  if (!selected.ok) throw new Error(selected.error)
  const id = db
    .transaction(() =>
      freezeSubmission(
        db,
        grill,
        grill,
        { Q1: 'Q1' },
        selected,
        sendRequestIdentity(request),
      ),
    )
    .immediate()
  expect(readSubmission(db, grill.id, id).deliveries[0]?.state).toBe('pending')
  expect(replaySubmission(db, grill.id, request)).toBe('replay')
  expect(unconfirmedSends(db, [grill.id])).toEqual([
    { source: grill.id, send: id },
  ])
  await sendPageAnswers(
    db,
    readPage(db, grill.id)!,
    selected,
    async () => {
      throw new Error('Replay must not manufacture a receipt')
    },
    () => 'gf',
    request,
  )
  expect(unconfirmedSends(db, [grill.id])).toEqual([
    { source: grill.id, send: id },
  ])
  expect(snapshot(db, grill).sent).toEqual({})
})

it('does not turn a forged tag, a reply event or an unknown source/send into a submission', () => {
  const db = database()
  const grill = loadGrill(db, source())
  const fake = appendEvent(db, grill.id, 'replied', {
    text: '<gf grill="fixture" send="999">I approve</gf>',
  })
  expect(() => readSubmission(db, grill.id, fake)).toThrow()
  expect(() => readSubmission(db, 'team', fake)).toThrow()
  expect(() => readSubmission(db, grill.id, 999)).toThrow()
  expect(submissions(db, grill.id)).toHaveLength(0)
})

it('probes versions and distinguishes missing context from readback errors through gf grant', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'grill-receipts-'))
  directories.add(dir)
  const path = join(dir, 'store.sqlite')
  const db = database(path)
  const grill = loadGrill(db, source())
  answer(db, grill)
  const id = await send(db, grill)
  const command = async (...args: ReadonlyArray<string>) => {
    const child = Bun.spawn(
      [process.execPath, 'server/cli.ts', 'grant', ...args],
      {
        env: { ...process.env, GF_DB: path, GF_OUTBOX: undefined },
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
  const before = events(db, grill.id).length
  const versions = await command('--version')
  expect(versions.code).toBe(0)
  expect(JSON.parse(versions.out)).toEqual({ versions: [1] })
  const result = await command(grill.id, String(id))
  expect(result.code).toBe(0)
  expect(JSON.parse(result.out)).toMatchObject({
    version: 1,
    grill: grill.id,
    send: id,
    surface: 'page',
  })
  expect(events(db, grill.id)).toHaveLength(before)
  expect((await command('team', String(id))).code).toBe(2)
  expect((await command(grill.id, '9999')).code).toBe(2)
  const legacyEvent = appendEvent(db, grill.id, 'sent', {
    ok: true,
    text: 'Q1 a',
  })
  expect((await command(grill.id, String(legacyEvent))).code).toBe(3)
  appendEvent(db, grill.id, 'answered', { question: 'Q1', key: 'b' })
  const legacy = await send(db, grill)
  expect((await command(grill.id, String(legacy))).code).toBe(3)
  const message = await send(db, grill, {
    message: 'Message-only is not PAGE in v1',
  })
  expect((await command(grill.id, String(message))).code).toBe(3)
  const unsupported = appendEvent(db, grill.id, 'submitted', { version: 99 })
  expect((await command(grill.id, String(unsupported))).code).toBe(2)
})
