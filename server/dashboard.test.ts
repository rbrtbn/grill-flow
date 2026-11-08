import { Database } from 'bun:sqlite'
import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { Schema } from 'effect'
import { Window } from 'happy-dom'
import { readFileSync } from 'node:fs'

import { Grill, OWN, answerLines } from '../src/domain'
import { dashboard } from './dashboard'
import { seedLegacySource } from './legacySource.testSupport'
import { appendEvent, loadGrill, snapshot } from './store'

const decodeGrill = Schema.decodeUnknownSync(Grill)
const fixture = decodeGrill(
  JSON.parse(readFileSync('src/fixtures/grill.json', 'utf8')),
)
const grill = decodeGrill({
  ...fixture,
  steps: fixture.steps.filter(step => ['Q1', 'Q17'].includes(step.question.id)),
})
const databases = new Set<Database>()
const windows = new Set<Window>()

afterEach(async () => {
  databases.forEach(db => db.close())
  databases.clear()
  await Promise.all([...windows].map(window => window.happyDOM.close()))
  windows.clear()
})

const database = (): Database => {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE grills (id TEXT PRIMARY KEY, json TEXT, loaded_at INTEGER);
    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      grill_id TEXT, at INTEGER, kind TEXT, payload TEXT
    );
    CREATE TABLE grill_remotes (grill_id TEXT PRIMARY KEY, machine TEXT, dir TEXT);
  `)
  databases.add(db)
  loadGrill(db, grill)
  return db
}

const render = async (db: Database) => {
  const spawn = spyOn(Bun, 'spawn').mockImplementation(() => {
    throw new Error('No terminals in this test')
  })
  try {
    const window = new Window()
    windows.add(window)
    window.document.write(await (await dashboard(db)).text())
    return window.document
  } finally {
    spawn.mockRestore()
  }
}

const answerAll = (db: Database): void => {
  appendEvent(db, grill.id, 'answered', { question: 'Q1', key: 'a' })
  appendEvent(db, grill.id, 'answered', { question: 'Q17', key: 'a' })
}

const send = (db: Database, ok = true): void => {
  const state = snapshot(db, grill)
  appendEvent(db, grill.id, 'sent', {
    ok,
    what: 'answers',
    lines: answerLines(grill, state.answers, state.notes, state.own),
  })
}

describe('dashboard delivery and archives', () => {
  it('distinguishes unanswered questions from saved answers ready to send', async () => {
    const db = database()
    appendEvent(db, grill.id, 'answered', { question: 'Q1', key: 'a' })
    const document = await render(db)
    const row = document.querySelector('.active a')
    expect(row?.textContent).toContain('1/2 answered')
    expect(row?.textContent).toContain('2 not sent')
    expect(row?.textContent).toContain('1 ready to send')
    expect(document.querySelector('.archive')).toBeNull()
  })

  it('keeps a partial send active and counts only the remaining questions', async () => {
    const db = database()
    appendEvent(db, grill.id, 'answered', { question: 'Q1', key: 'a' })
    send(db)
    const document = await render(db)
    expect(document.querySelector('.active .delivery')?.textContent).toBe(
      '1 not sent',
    )
    expect(document.querySelector('.ready')).toBeNull()
  })

  it('archives successful sends under each machine with the sections closed', async () => {
    const db = database()
    answerAll(db)
    send(db)
    const remote = decodeGrill({
      ...grill,
      id: 'remote',
      title: 'Remote completed',
    })
    loadGrill(db, remote)
    appendEvent(db, remote.id, 'answered', { question: 'Q1', key: 'a' })
    appendEvent(db, remote.id, 'answered', { question: 'Q17', key: 'a' })
    appendEvent(db, remote.id, 'sent', {
      ok: true,
      lines: { Q1: 'Q1 a', Q17: 'Q17 a' },
    })
    db.run('INSERT INTO grill_remotes VALUES (?, ?, ?)', [
      remote.id,
      'remote-machine',
      '/outbox',
    ])
    const document = await render(db)
    const archives = [...document.querySelectorAll('.archive')]
    expect(archives).toHaveLength(2)
    expect(archives.every(section => !section.hasAttribute('open'))).toBe(true)
    expect(document.querySelector('.active')).toBeNull()
    expect(document.querySelectorAll('.archive .delivery.done')).toHaveLength(2)
    expect(
      archives[1]?.parentElement?.querySelector('h2')?.textContent,
    ).toContain('remote-machine')
    expect(archives[1]?.textContent).toContain('Remote completed')
  })

  it.each(['answer', 'note', 'own answer', 'cleared answer'])(
    'returns an archived grilling to the active list after a changed %s',
    async change => {
      const db = database()
      answerAll(db)
      send(db)
      if (change === 'note') {
        appendEvent(db, grill.id, 'noted', { question: 'Q1', text: 'New note' })
      } else if (change === 'cleared answer') {
        appendEvent(db, grill.id, 'cleared', { question: 'Q1' })
      } else {
        appendEvent(db, grill.id, 'answered', {
          question: 'Q1',
          key: change === 'own answer' ? OWN : 'b',
          text: 'Another choice',
        })
      }
      const document = await render(db)
      expect(document.querySelector('.active .delivery')?.textContent).toBe(
        '1 not sent',
      )
      expect(document.querySelector('.archive')).toBeNull()
    },
  )

  it('keeps failed sends active', async () => {
    const db = database()
    answerAll(db)
    send(db, false)
    const document = await render(db)
    expect(document.querySelector('.active .ready')?.textContent).toBe(
      '2 ready to send',
    )
    expect(document.querySelector('.archive')).toBeNull()
  })

  it('does not require sending questions ruled out by another answer', async () => {
    const db = database()
    const conditional = decodeGrill({
      ...grill,
      steps: fixture.steps.filter(step =>
        ['Q1', 'Q2'].includes(step.question.id),
      ),
    })
    loadGrill(db, conditional)
    appendEvent(db, grill.id, 'answered', { question: 'Q1', key: 'b' })
    send(db)
    const document = await render(db)
    expect(document.querySelector('.archive .count')?.textContent).toBe(
      '1/1 answered',
    )
    expect(document.querySelector('.archive .delivery')?.textContent).toBe(
      'All 1 sent',
    )
  })

  it('keeps an older unsent pick active when the current round is completely sent', async () => {
    const db = database()
    appendEvent(db, grill.id, 'answered', { question: 'Q1', key: 'b' })
    appendEvent(db, grill.id, 'answered', { question: 'Q17', key: 'a' })
    loadGrill(db, {
      ...grill,
      round: 2,
      steps: grill.steps.map(step => ({
        ...step,
        question: {
          ...step.question,
          round: step.question.id === 'Q1' ? 1 : 2,
        },
      })),
    })
    appendEvent(db, grill.id, 'sent', {
      ok: true,
      what: 'answers',
      lines: { Q17: 'Q17 a' },
    })
    const document = await render(db)
    expect(document.querySelector('.active a')?.textContent).toContain(
      '1 not sent',
    )
    expect(document.querySelector('.active a')?.textContent).toContain(
      '1 ready to send',
    )
  })

  it('keeps a saved pick visible after its question is removed from the latest round', async () => {
    const db = database()
    appendEvent(db, grill.id, 'answered', { question: 'Q1', key: 'b' })
    appendEvent(db, grill.id, 'answered', { question: 'Q17', key: 'a' })
    seedLegacySource(db, {
      ...grill,
      round: 2,
      steps: grill.steps.filter(step => step.question.id !== 'Q1'),
    })
    appendEvent(db, grill.id, 'sent', {
      ok: true,
      what: 'answers',
      lines: { Q17: 'Q17 a' },
    })
    const document = await render(db)
    expect(document.querySelector('.active a')?.textContent).toContain(
      '1 not sent',
    )
    expect(document.querySelector('.active a')?.textContent).toContain(
      '1 ready to send',
    )
  })

  it('counts the current round and reopens a grilling when a new round is loaded', async () => {
    const db = database()
    answerAll(db)
    send(db)
    loadGrill(
      db,
      decodeGrill({
        ...grill,
        round: 2,
        steps: fixture.steps
          .filter(step => ['Q1', 'Q2', 'Q17'].includes(step.question.id))
          .map(step => ({
            ...step,
            question: {
              ...step.question,
              round: step.question.id === 'Q2' ? 2 : 1,
            },
          })),
      }),
    )
    const document = await render(db)
    expect(document.querySelector('.active .count')?.textContent).toBe(
      '0/1 answered',
    )
    expect(document.querySelector('.active .delivery')?.textContent).toBe(
      '1 not sent',
    )
    expect(document.querySelector('.archive')).toBeNull()
  })
})
