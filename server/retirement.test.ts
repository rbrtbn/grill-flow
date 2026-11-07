import { Database } from 'bun:sqlite'
import { afterEach, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { dashboard } from './dashboard'
import { grillOnMachine } from './remote'
import { listPages, readPage } from './squad'
import {
  appendEvent,
  events,
  getGrill,
  loadGrill,
  retireGrill,
  restoreGrill,
  snapshot,
  squadRegistrations,
} from './store'

const fixture = JSON.parse(readFileSync('src/fixtures/grill.json', 'utf8'))
const databases = new Set<Database>()
const folders = new Set<string>()
afterEach(() => {
  databases.forEach(db => db.close())
  databases.clear()
  folders.forEach(folder => rmSync(folder, { recursive: true, force: true }))
  folders.clear()
})

const database = () => {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE grills (id TEXT PRIMARY KEY, json TEXT, loaded_at INTEGER);
    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      grill_id TEXT, at INTEGER, kind TEXT, payload TEXT
    );
    CREATE TABLE grill_remotes (grill_id TEXT, machine TEXT, dir TEXT);
  `)
  databases.add(db)
  return db
}

it('hides a retired member from the catalog and squad while retaining its direct history', async () => {
  const db = database()
  const member = loadGrill(db, {
    ...fixture,
    id: 'old-member',
    title: 'Old member',
    squad: { id: 'squad', section: 'Old member' },
  })
  loadGrill(db, {
    ...fixture,
    id: 'live-member',
    squad: { id: 'squad', section: 'Live member' },
  })
  appendEvent(db, member.id, 'answered', { question: 'Q1', key: 'a' })
  const registrations = squadRegistrations(db, 'squad')
  const before = events(db, member.id)
  const retirement = retireGrill(db, member, 'Q57 a')
  expect(retirement.ok).toBe(true)
  expect(listPages(db).map(page => page.id)).toEqual(['squad', 'live-member'])
  expect(readPage(db, 'squad')?.members.map(m => m.state.grill.id)).toEqual([
    'live-member',
  ])
  expect(readPage(db, member.id)?.state.answers.Q1).toBe('a')
  expect(readPage(db, member.id)?.state.retirement?.reason).toBe('Q57 a')
  expect(getGrill(db, member.id)).toEqual(member)
  expect(events(db, member.id).slice(0, before.length)).toEqual([...before])
  expect(await (await dashboard(db)).text()).not.toContain('Old member')
  expect(squadRegistrations(db, 'squad')).toEqual(registrations)
  expect(restoreGrill(db, member).ok).toBe(true)
  expect(snapshot(db, member).retirement).toBeUndefined()
  expect(listPages(db).map(page => page.id)).toContain(member.id)
  expect(readPage(db, 'squad')?.members).toHaveLength(2)
  expect(squadRegistrations(db, 'squad')).toEqual(registrations)
})

it('keeps retirement across a remote reimport and hides a squad with no remaining members', () => {
  const db = database()
  const member = loadGrill(
    db,
    grillOnMachine(
      { ...fixture, squad: { id: 'squad', section: 'Remote' } },
      'homelab',
    ),
  )
  retireGrill(db, member, 'Finished')
  loadGrill(db, member)
  expect(snapshot(db, getGrill(db, member.id)!).retirement?.reason).toBe(
    'Finished',
  )
  expect(listPages(db)).toEqual([])
  expect(readPage(db, 'squad')).toBeUndefined()
  expect(readPage(db, member.id)?.state.grill.session).toBe(member.session)
  restoreGrill(db, member)
  expect(listPages(db).map(page => page.id)).toEqual(['squad', member.id])
})

it('makes repeated retire/restore calls idempotent and rejects an empty retirement reason', () => {
  const db = database()
  const grill = loadGrill(db, fixture)
  expect(retireGrill(db, grill, '  ').ok).toBe(false)
  const before = events(db, grill.id).length
  restoreGrill(db, grill)
  expect(events(db, grill.id)).toHaveLength(before)
  retireGrill(db, grill, 'Done')
  retireGrill(db, grill, 'Another reason')
  expect(events(db, grill.id)).toHaveLength(before + 1)
  expect(snapshot(db, grill).retirement?.reason).toBe('Done')
  restoreGrill(db, grill)
  restoreGrill(db, grill)
  expect(events(db, grill.id)).toHaveLength(before + 2)
})

it('permits a replacement lead but refuses to restore a second active lead', () => {
  const db = database()
  const old = loadGrill(db, {
    ...fixture,
    squad: { id: 'squad', section: 'Old lead', lead: true },
  })
  retireGrill(db, old, 'Handed over')
  const replacement = loadGrill(db, {
    ...fixture,
    id: 'new-lead',
    squad: { id: 'squad', section: 'New lead', lead: true },
  })
  expect(restoreGrill(db, old).ok).toBe(false)
  expect(snapshot(db, old).retirement).toBeDefined()
  retireGrill(db, replacement, 'Handed back')
  expect(restoreGrill(db, old).ok).toBe(true)
  expect(readPage(db, 'squad')?.state.grill.session).toBe(old.session)
})

it('exposes retirement and restoration through gf without changing the source file', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'grill-retirement-'))
  folders.add(folder)
  const file = join(folder, 'source.json')
  const original = JSON.stringify(fixture)
  writeFileSync(file, original)
  const cli = async (...args: ReadonlyArray<string>) => {
    const child = Bun.spawn([process.execPath, 'server/cli.ts', ...args], {
      env: {
        ...process.env,
        GF_DB: join(folder, 'test.sqlite'),
        GF_OUTBOX: undefined,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [code, out, error] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    return { code, out, error }
  }
  expect((await cli('load', file)).code).toBe(0)
  expect((await cli('retire', fixture.id)).code).toBe(2)
  expect((await cli('retire', 'missing', '--reason', 'Done')).code).toBe(2)
  const retired = await cli('retire', fixture.id, '--reason', 'Q57 a')
  expect(retired.code).toBe(0)
  expect(retired.out).toContain(`retired ${fixture.id}`)
  expect((await cli('state', fixture.id)).out).toContain('Retired: Q57 a')
  expect((await cli('restore', fixture.id)).code).toBe(0)
  expect((await cli('state', fixture.id)).out).not.toContain('Retired:')
  expect(readFileSync(file, 'utf8')).toBe(original)
})
