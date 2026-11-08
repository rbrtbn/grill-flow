import { Database } from 'bun:sqlite'
import { afterEach, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

import { readSubmission } from './answerReceipts'
import { pageMessage, submissionMessage } from './messages'
import { newsSince } from './outbox'
import { selectSend } from './sendSelection'
import { readPage, sendPageAnswers } from './squad'
import { appendEvent, events, loadGrill } from './store'

const fixture = JSON.parse(readFileSync('src/fixtures/grill.json', 'utf8'))
const databases = new Set<Database>()
afterEach(() => {
  databases.forEach(db => db.close())
  databases.clear()
})
const database = () => {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE grills (id TEXT PRIMARY KEY, json TEXT, loaded_at INTEGER);
    CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, grill_id TEXT,
      at INTEGER, kind TEXT, payload TEXT);`)
  databases.add(db)
  return db
}
const source = (db: Database, id: string, joined = false) => {
  const grill = loadGrill(db, {
    ...fixture,
    id,
    session: 't1',
    ...(joined ? { squad: { id: 'team', section: id } } : {}),
    steps: fixture.steps
      .slice(0, 2)
      .map((step: { question: object }, i: number) => ({
        ...step,
        question: {
          ...step.question,
          session: i === 0 ? 't1' : 'homelab/t2',
          dependsOn: [],
          when: [],
        },
      })),
  })
  appendEvent(db, id, 'answered', { question: 'Q1', key: 'a' })
  appendEvent(db, id, 'answered', { question: 'Q2', key: 'a' })
  return grill
}
const markerOf = (text: string) => {
  const match = text.match(
    /<gf grill="([A-Za-z0-9._-]+)" send="([1-9][0-9]*)">/,
  )
  expect(match).not.toBeNull()
  return { grill: match![1]!, send: Number(match![2]) }
}

it.each(['Short message.', 'Long message. '.repeat(230)])(
  'retains the frozen member pair in transport receipts and local/remote wait output',
  async message => {
    const db = database()
    source(db, 'alpha', true)
    source(db, 'beta', true)
    const page = readPage(db, 'team')!
    const request = { message, requestId: 'one-request' }
    const selection = selectSend(page.state, request)
    if (!selection.ok) throw new Error(selection.error)
    const received: Array<{ session: string; text: string }> = []
    await sendPageAnswers(
      db,
      page,
      selection,
      async (session, text) => {
        received.push({ session, text: pageMessage(text) })
        return { ok: session === 't1', detail: 'mock only' }
      },
      () => 'gf',
      request,
    )
    expect(received).toHaveLength(4)
    for (const id of ['alpha', 'beta']) {
      const history = events(db, id)
      const submission = history.find(event => event.kind === 'submitted')!
      const marker = `<gf grill="${id}" send="${submission.id}">`
      const matching = received.filter(call => call.text.includes(marker))
      expect(matching.map(call => call.session)).toEqual(['t1', 'homelab/t2'])
      matching.forEach(call => {
        expect(
          call.text.startsWith('<grill-flow source="page">\n' + marker + '\n'),
        ).toBe(true)
        expect(call.text.endsWith('\n</gf>\n</grill-flow>')).toBe(true)
        expect(call.text).toContain(message.trim())
        expect(markerOf(call.text)).toEqual({ grill: id, send: submission.id })
      })
      const receipt = readSubmission(db, id, submission.id)
      expect(receipt.deliveries.map(row => row.state)).toEqual([
        'delivered',
        'failed',
      ])
      receipt.deliveries.forEach(row =>
        expect(row.attempts[0]?.text.startsWith(marker)).toBe(true),
      )
      for (const gf of [undefined, 'GF_OUTBOX=/isolated/outbox gf']) {
        const news = newsSince(
          id,
          history.map(event => ({
            ...event,
            payload: JSON.parse(event.payload),
          })),
          new Set(),
          gf,
        )
        expect(news.lines).toHaveLength(1)
        expect(
          news.lines[0]?.startsWith('<grill-flow source="page">\n' + marker),
        ).toBe(true)
        expect(news.lines[0]?.endsWith('\n</grill-flow>')).toBe(true)
      }
    }
    const pageSend = events(db, 'team').find(event => event.kind === 'sent')!
    expect(
      received.some(call => call.text.includes(`send="${pageSend.id}"`)),
    ).toBe(false)
    await sendPageAnswers(
      db,
      page,
      selection,
      async () => {
        throw new Error('A replay must not deliver again')
      },
      () => 'gf',
      request,
    )
    expect(received).toHaveLength(4)
  },
)

it('marks a direct message-only submission without making it an answer grant', async () => {
  const db = database()
  source(db, 'direct')
  appendEvent(db, 'direct', 'cleared', { question: 'Q1' })
  appendEvent(db, 'direct', 'cleared', { question: 'Q2' })
  const page = readPage(db, 'direct')!
  const selection = selectSend(page.state, {
    message: 'Only a message',
  })
  if (!selection.ok) throw new Error(selection.error)
  let delivered = ''
  await sendPageAnswers(
    db,
    page,
    selection,
    async (_session, text) => {
      delivered = text
      return { ok: true, detail: 'mock' }
    },
    () => 'gf',
  )
  const pair = markerOf(delivered)
  expect(pair.grill).toBe('direct')
  expect(readSubmission(db, pair.grill, pair.send).answers).toEqual([])
})

it.each(['bad id', 'bad/id', 'bad"id', 'bad\nid', '<bad>', ''])(
  'refuses unsafe source %j before freezing or delivering',
  async id => {
    const db = database()
    source(db, id)
    const page = readPage(db, id)!
    const before = events(db, id)
    const selection = selectSend(page.state, {})
    if (!selection.ok) throw new Error(selection.error)
    await expect(
      sendPageAnswers(
        db,
        page,
        selection,
        async () => {
          throw new Error('Unsafe source must not deliver')
        },
        () => 'gf',
      ),
    ).rejects.toThrow('source grill ID')
    expect(events(db, id)).toEqual(before)
  },
)

it.each([0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1])(
  'refuses invalid submission id %s',
  send => {
    expect(() => submissionMessage('safe-source', send, 'text')).toThrow(
      'positive submission event ID',
    )
  },
)
