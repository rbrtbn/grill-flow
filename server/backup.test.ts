import { Database } from 'bun:sqlite'
import { afterEach, expect, it } from 'bun:test'
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { backupName, startBackups, writeBackup } from './backup'

const folders = new Set<string>()
afterEach(() => {
  folders.forEach(path => rmSync(path, { recursive: true, force: true }))
  folders.clear()
})
const live = () => {
  const dir = mkdtempSync(join(tmpdir(), 'grill-backup-'))
  folders.add(dir)
  const path = join(dir, 'grill-flow.sqlite')
  const db = new Database(path)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('CREATE TABLE events (id INTEGER PRIMARY KEY, payload TEXT)')
  db.run('INSERT INTO events (payload) VALUES (?)', ['kept'])
  return { dir, path, db }
}
const count = (path: string) => {
  const copy = new Database(path, { readonly: true })
  try {
    return copy
      .query<{ n: number }, []>('SELECT COUNT(*) AS n FROM events')
      .get()!.n
  } finally {
    copy.close()
  }
}

it('names backups by UTC time so they sort chronologically', () => {
  expect(backupName(new Date('2026-11-14T09:05:07.123Z'))).toBe(
    'grill-flow-20261114T090507Z.sqlite',
  )
})

it('copies a database the server still has open, with its uncheckpointed writes', () => {
  const { dir, path, db } = live()
  db.run('INSERT INTO events (payload) VALUES (?)', ['in the WAL'])
  const copy = writeBackup(path, join(dir, 'backups'))
  expect(count(copy)).toBe(2)
  expect(readdirSync(join(dir, 'backups'))).toEqual([copy.split('/').at(-1)!])
  db.close()
})

it('keeps only the newest backups and leaves other files alone', () => {
  const { dir, path, db } = live()
  const backups = join(dir, 'backups')
  const hours = [1, 2, 3, 4].map(hour => new Date(Date.UTC(2026, 10, 14, hour)))
  writeBackup(path, backups, hours[0])
  writeFileSync(join(backups, 'notes.txt'), 'mine')
  hours.slice(1).forEach(at => writeBackup(path, backups, at, 2))
  expect(readdirSync(backups).sort()).toEqual([
    'grill-flow-20261114T030000Z.sqlite',
    'grill-flow-20261114T040000Z.sqlite',
    'notes.txt',
  ])
  db.close()
})

it('writes the first backup from a child process soon after start', async () => {
  const { dir, path, db } = live()
  const backups = join(dir, 'backups')
  const stop = startBackups(path, backups, {}, { first: 10, every: 60_000 })
  for (let tries = 0; tries < 100 && !existsSync(backups); tries += 1) {
    await Bun.sleep(50)
  }
  for (
    let tries = 0;
    tries < 100 &&
    !readdirSync(backups).some(name => name.endsWith('Z.sqlite'));
    tries += 1
  ) {
    await Bun.sleep(50)
  }
  stop()
  const [name] = readdirSync(backups).filter(name => name.endsWith('Z.sqlite'))
  expect(count(join(backups, name!))).toBe(1)
  db.close()
})

it.each([{ GF_PREVIEW: '1' }, { GF_BACKUPS: '0' }])(
  'skips backups with %o',
  async env => {
    const { dir, path, db } = live()
    const stop = startBackups(path, join(dir, 'backups'), env, {
      first: 1,
      every: 1,
    })
    await Bun.sleep(100)
    stop()
    expect(existsSync(join(dir, 'backups'))).toBe(false)
    db.close()
  },
)
