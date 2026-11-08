import { Database } from 'bun:sqlite'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'

import { PilotFault, runtimePilot } from './runtimePilot'

const MODE = { mode: 'fixture-only', productionReady: false, version: 1 }
const MARKER = '.grill-flow-runtime-pilot.json'
const fail = (message: string): never => {
  throw new PilotFault(message)
}
const flag = (args: ReadonlyArray<string>, name: string): string => {
  const position = args.indexOf(name)
  return position >= 0 && typeof args[position + 1] === 'string'
    ? args[position + 1]!
    : fail('Required pilot argument is missing.')
}
const flags = (args: ReadonlyArray<string>, allowed: ReadonlyArray<string>) => {
  const seen = new Set<string>()
  for (let i = 0; i < args.length; i++) {
    const key = args[i]!
    if (!allowed.includes(key) || seen.has(key))
      fail('Unknown or repeated pilot argument.')
    seen.add(key)
    if (key !== '--fixture-only') {
      if (args[i + 1] === undefined || args[i + 1]!.startsWith('--'))
        fail('Pilot argument value is missing.')
      i++
    }
  }
  if (!seen.has('--fixture-only'))
    fail(
      'BLOCKED: the runtime pilot requires explicit --fixture-only and a scratch store; no live adapter is enabled.',
    )
}
const fixtureFile = (directory: string, path: string): unknown => {
  const target = resolve(path)
  if (
    lstatSync(target).isSymbolicLink() ||
    !realpathSync(target).startsWith(directory + sep)
  )
    fail('Fixture input must be a regular file inside its own pilot directory.')
  const stat = lstatSync(target)
  if (!stat.isFile() || stat.nlink !== 1 || stat.size > 1_048_576)
    fail('Fixture input is invalid or oversized.')
  return JSON.parse(readFileSync(target, 'utf8'))
}
const directoryOf = (path: string): string => {
  const requested = resolve(path)
  if (
    path !== requested ||
    !/^grill-flow-pilot-[A-Za-z0-9_-]+$/.test(basename(requested))
  )
    fail(
      'Use an absolute grill-flow-pilot-* directory directly inside the system temporary directory.',
    )
  if (realpathSync(dirname(requested)) !== realpathSync(tmpdir()))
    fail(
      'The inert pilot only opens a direct system-temporary scratch directory.',
    )
  if (
    existsSync(requested) &&
    (!lstatSync(requested).isDirectory() ||
      lstatSync(requested).isSymbolicLink())
  )
    fail('Pilot directory must not be a symlink or other file.')
  return join(realpathSync(dirname(requested)), basename(requested))
}

export const runRuntimePilotCli = (
  command: string,
  input: ReadonlyArray<string>,
): number => {
  let db: Database | undefined
  try {
    const operation = command === 'pilot' ? input[0] : command
    const args = command === 'pilot' ? input.slice(1) : input
    const common = ['--fixture-only', '--pilot-dir']
    const allowed =
      operation === 'init'
        ? common
        : operation === 'bind'
          ? [...common, '--file', '--fixture']
          : operation === 'enqueue'
            ? [...common, '--file']
            : operation === 'inbox'
              ? [...common, '--source', '--thread', '--fixture']
              : operation === 'ack'
                ? [...common, '--event', '--fixture']
                : operation === 'delivery'
                  ? [...common, '--event', '--ok']
                  : operation === 'inspect'
                    ? [...common, '--event']
                    : fail('Unknown inert pilot operation.')
    flags(args, allowed)
    const directory = directoryOf(flag(args, '--pilot-dir'))
    const marker = join(directory, MARKER)
    const database = join(directory, 'pilot.sqlite')
    for (const path of [
      marker,
      database,
      database + '-wal',
      database + '-shm',
    ]) {
      const stat = lstatSync(path, { throwIfNoEntry: false })
      if (stat !== undefined && (stat.isSymbolicLink() || stat.nlink !== 1))
        fail('Pilot files must not be symlinks or shared hard links.')
    }
    if (operation === 'init' && !existsSync(marker)) {
      if (existsSync(directory) && readdirSync(directory).length > 0)
        fail('Pilot initialization requires an empty scratch directory.')
      if (!existsSync(directory)) mkdirSync(directory, { mode: 0o700 })
      chmodSync(directory, 0o700)
      writeFileSync(marker, JSON.stringify(MODE) + '\n', {
        mode: 0o600,
        flag: 'wx',
      })
    }
    if (
      !existsSync(marker) ||
      JSON.stringify(fixtureFile(directory, marker)) !== JSON.stringify(MODE)
    )
      fail('Initialize an explicit fixture-only pilot store first.')
    if (operation !== 'init' && !existsSync(database))
      fail('Pilot database is missing; initialize it explicitly.')
    db = new Database(
      database,
      operation === 'inbox' || operation === 'inspect'
        ? { readonly: true }
        : { create: operation === 'init', readwrite: true },
    )
    db.exec('PRAGMA busy_timeout = 5000')
    if (operation === 'init') {
      db.exec('PRAGMA journal_mode = WAL')
      db.exec(
        'CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, grill_id TEXT NOT NULL, at INTEGER NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL)',
      )
      chmodSync(database, 0o600)
    }
    const pilot = runtimePilot(db)
    const observation = () => fixtureFile(directory, flag(args, '--fixture'))
    const eventId = () => Number(flag(args, '--event'))
    const result =
      operation === 'init'
        ? { initialized: true }
        : operation === 'bind'
          ? pilot.bind(
              fixtureFile(directory, flag(args, '--file')),
              observation(),
            )
          : operation === 'enqueue'
            ? pilot.enqueue(fixtureFile(directory, flag(args, '--file')))
            : operation === 'inbox'
              ? pilot.inbox(
                  flag(args, '--source'),
                  flag(args, '--thread'),
                  observation(),
                )
              : operation === 'ack'
                ? pilot.acknowledge(eventId(), observation())
                : operation === 'delivery'
                  ? {
                      recorded: pilot.recordDelivery(
                        eventId(),
                        flag(args, '--ok') === 'true'
                          ? true
                          : flag(args, '--ok') === 'false'
                            ? false
                            : fail(
                                'Delivery evidence must explicitly be true or false.',
                              ),
                      ),
                    }
                  : pilot.inspect(eventId())
    console.log(JSON.stringify({ ...MODE, result }))
    return 0
  } catch (error) {
    console.error(
      JSON.stringify({
        ...MODE,
        error:
          error instanceof PilotFault
            ? error.message
            : 'Fixture pilot operation failed; no live runtime is enabled.',
      }),
    )
    return 2
  } finally {
    db?.close()
  }
}
