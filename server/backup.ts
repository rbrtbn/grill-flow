import { Database } from 'bun:sqlite'
import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'

export const BACKUPS_KEPT = 48
const HOUR = 3_600_000
const FIRST_DELAY = 60_000
const NAME = /^grill-flow-\d{8}T\d{6}Z\.sqlite$/

export const backupName = (now: Date): string =>
  `grill-flow-${now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')}.sqlite`

/**
 * Copies the database with VACUUM INTO, which reads one consistent snapshot even while the
 * server writes in WAL mode, then keeps only the newest backups.
 */
export const writeBackup = (
  dbPath: string,
  dir: string,
  now = new Date(),
  keep = BACKUPS_KEPT,
): string => {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const path = join(dir, backupName(now))
  const partial = `${path}.partial`
  rmSync(partial, { force: true })
  const db = new Database(dbPath, { readonly: true })
  try {
    db.run('VACUUM INTO ?', [partial])
  } finally {
    db.close()
  }
  renameSync(partial, path)
  readdirSync(dir)
    .filter(name => NAME.test(name))
    .sort()
    .reverse()
    .slice(keep)
    .forEach(name => rmSync(join(dir, name), { force: true }))
  return path
}

/**
 * Hourly backups from a child process, so a large copy never stalls request handling. Returns
 * a stop function; does nothing for previews or when GF_BACKUPS=0.
 */
export const startBackups = (
  dbPath: string,
  dir: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  timing = { first: FIRST_DELAY, every: HOUR },
): (() => void) => {
  if (env.GF_PREVIEW === '1' || env.GF_BACKUPS === '0') {
    return () => {}
  }
  let running = false
  const run = () => {
    if (running) {
      return
    }
    running = true
    const child = Bun.spawn([process.execPath, import.meta.path, dbPath, dir], {
      stdout: 'ignore',
      stderr: 'pipe',
      // A hung copy is killed so the next hour can try again.
      timeout: 10 * 60_000,
    })
    void child.exited.then(async code => {
      running = false
      if (code !== 0) {
        console.error(
          `backup failed: ${(await new Response(child.stderr).text()).slice(0, 300)}`,
        )
      }
    })
  }
  let interval: ReturnType<typeof setInterval> | undefined
  const first = setTimeout(() => {
    run()
    interval = setInterval(run, timing.every)
  }, timing.first)
  return () => {
    clearTimeout(first)
    clearInterval(interval)
  }
}

if (import.meta.main) {
  const [dbPath, dir] = process.argv.slice(2)
  if (dbPath === undefined || dir === undefined) {
    console.error('usage: bun server/backup.ts <database> <backup-dir>')
    process.exit(2)
  }
  writeBackup(dbPath, dir)
}
