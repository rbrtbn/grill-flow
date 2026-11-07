import type { Database } from 'bun:sqlite'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Grill } from '../src/domain'
import {
  ROOT,
  decodeGrill,
  events,
  getGrill,
  lastEventId,
  loadGrill,
  replyToGrill,
  reviseGrill,
  snapshot,
} from './store'

// An agent on another machine keeps its grills in an outbox folder there; this server pulls
// them in over hc and writes each grill's state back beside it (docs/adr/0002).
export type Remote = Readonly<{ machine: string; dir: string }>

const REMOTES_PATH = join(ROOT, 'data', 'remotes.json')
const POLL_MS = 5000

export const readRemotes = (): ReadonlyArray<Remote> => {
  if (!existsSync(REMOTES_PATH)) {
    return []
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(REMOTES_PATH, 'utf8'))
    return Array.isArray(parsed)
      ? parsed.flatMap(entry =>
          typeof entry?.machine === 'string' && typeof entry?.dir === 'string'
            ? [{ machine: entry.machine, dir: entry.dir }]
            : [],
        )
      : []
  } catch {
    return []
  }
}

export const writeRemotes = (remotes: ReadonlyArray<Remote>): void =>
  writeFileSync(REMOTES_PATH, `${JSON.stringify(remotes, null, 2)}\n`)

const quote = (text: string): string => `'${text.replaceAll("'", `'\\''`)}'`

// `~` only expands unquoted, so a leading one is kept outside the quotes.
const shellPath = (dir: string): string =>
  dir === '~'
    ? '~'
    : dir.startsWith('~/')
      ? `~/${quote(dir.slice(2))}`
      : quote(dir)

const hc = async (
  args: ReadonlyArray<string>,
  input?: string,
): Promise<{ ok: boolean; out: string }> => {
  const child = Bun.spawn(['hc', ...args], {
    stdin: input === undefined ? 'ignore' : new Blob([input]),
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [code, out, err] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { ok: code === 0, out: code === 0 ? out : err }
}

type Listing = Readonly<{
  root: string
  files: ReadonlyArray<Readonly<{ path: string; stamp: string }>>
}>

/** The outbox's absolute path, and each grill and reply file in it with its change stamp. */
const list = async (remote: Remote): Promise<Listing | undefined> => {
  const script = `cd ${shellPath(remote.dir)} 2>/dev/null || exit 0
pwd
find . -mindepth 2 -maxdepth 3 -type f \\( -name grill.json -o -path './*/revisions/*.json' \\) | while read -r f; do
  m=$(stat -f %m "$f" 2>/dev/null || stat -c %Y "$f")
  s=$(wc -c < "$f" | tr -d ' ')
  echo "$m.$s $f"
done`
  const result = await hc(['exec', '--on', remote.machine, script])
  if (!result.ok) {
    console.error(
      `remote ${remote.machine}: ${result.out.trim().slice(0, 200)}`,
    )
    return undefined
  }
  const [root, ...lines] = result.out.split('\n').filter(line => line !== '')
  if (root === undefined) {
    return undefined
  }
  return {
    root,
    files: lines.flatMap(line => {
      const space = line.indexOf(' ')
      return space < 0
        ? []
        : [{ stamp: line.slice(0, space), path: line.slice(space + 3) }]
    }),
  }
}

const seenStamp = (
  db: Database,
  machine: string,
  path: string,
): string | undefined =>
  db
    .query<{ stamp: string }, [string, string]>(
      'SELECT stamp FROM remote_files WHERE machine = ? AND path = ?',
    )
    .get(machine, path)?.stamp

const markSeen = (
  db: Database,
  machine: string,
  path: string,
  stamp: string,
): void => {
  db.run(
    'INSERT INTO remote_files (machine, path, stamp) VALUES (?, ?, ?) ON CONFLICT(machine, path) DO UPDATE SET stamp = excluded.stamp',
    [machine, path, stamp],
  )
}

const readRemote = async (
  machine: string,
  path: string,
): Promise<unknown | undefined> => {
  const result = await hc(['file', 'read', '--on', machine, path])
  if (!result.ok) {
    console.error(
      `remote ${machine}:${path}: ${result.out.trim().slice(0, 200)}`,
    )
    return undefined
  }
  try {
    return JSON.parse(result.out)
  } catch {
    console.error(`remote ${machine}:${path}: not JSON`)
    return undefined
  }
}

// hc on this machine reaches the agent's terminal by its machine-qualified address.
const remoteSession = (machine: string, session: string): string =>
  session.trim() !== '' && !session.includes('/')
    ? `${machine}/${session}`
    : session

export const grillOnMachine = (grill: Grill, machine: string): Grill => ({
  ...grill,
  session: remoteSession(machine, grill.session),
  steps: grill.steps.map(step => ({
    ...step,
    question:
      step.question.session === undefined
        ? step.question
        : {
            ...step.question,
            session: remoteSession(machine, step.question.session),
          },
  })),
})

const takeGrill = async (
  db: Database,
  remote: Remote,
  root: string,
  path: string,
): Promise<void> => {
  const raw = await readRemote(remote.machine, `${root}/${path}`)
  if (typeof raw !== 'object' || raw === null) {
    return
  }
  try {
    const grill = loadGrill(
      db,
      grillOnMachine(decodeGrill(raw), remote.machine),
    )
    db.run(
      'INSERT INTO grill_remotes (grill_id, machine, dir) VALUES (?, ?, ?) ON CONFLICT(grill_id) DO UPDATE SET machine = excluded.machine, dir = excluded.dir',
      [grill.id, remote.machine, `${root}/${path.split('/')[0]}`],
    )
  } catch (error) {
    console.error(
      `remote ${remote.machine}:${path}: ${String(error).slice(0, 300)}`,
    )
  }
}

const takeRevision = async (
  db: Database,
  remote: Remote,
  root: string,
  path: string,
): Promise<void> => {
  const grillId = path.split('/')[0] ?? ''
  const grill = getGrill(db, grillId)
  const raw = (await readRemote(remote.machine, `${root}/${path}`)) as
    | Record<string, unknown>
    | undefined
  if (grill === undefined || raw === undefined) {
    return
  }
  if (raw.kind === 'reply') {
    const replied = replyToGrill(db, grill, String(raw.text ?? ''))
    if (!replied.ok) {
      console.error(`remote ${remote.machine}:${path}: ${replied.reason}`)
    }
    return
  }
  const result = reviseGrill(db, grill, {
    stepId: String(raw.stepId ?? ''),
    askId: typeof raw.askId === 'number' ? raw.askId : null,
    kind: raw.kind === 'rewrite' ? 'rewrite' : 'comment',
    text: String(raw.text ?? ''),
  })
  if (!result.ok) {
    console.error(`remote ${remote.machine}:${path}: ${result.reason}`)
  }
}

const pushed = new Map<string, number>()

/** Writes a remote grill's state into its outbox folder whenever it has changed. */
const pushStates = async (db: Database): Promise<void> => {
  const linked = db
    .query<{ grill_id: string; machine: string; dir: string }, []>(
      'SELECT grill_id, machine, dir FROM grill_remotes',
    )
    .all()
  for (const { grill_id: id, machine, dir } of linked) {
    const latest = lastEventId(db, id)
    const grill = getGrill(db, id)
    if (grill === undefined || pushed.get(id) === latest) {
      continue
    }
    const state = {
      at: new Date().toISOString(),
      lastEventId: latest,
      snapshot: snapshot(db, grill),
      events: events(db, id).map(event => ({
        ...event,
        payload: JSON.parse(event.payload),
      })),
    }
    const result = await hc(
      ['file', 'write', '--on', machine, `${dir}/state.json`],
      `${JSON.stringify(state)}\n`,
    )
    if (result.ok) {
      pushed.set(id, latest)
    } else {
      console.error(
        `remote ${machine}:${dir}/state.json: ${result.out.trim().slice(0, 200)}`,
      )
    }
  }
}

const pollOnce = async (db: Database): Promise<void> => {
  for (const remote of readRemotes()) {
    const listing = await list(remote)
    if (listing === undefined) {
      continue
    }
    // Grills before replies, so a reply finds its grill; replies in the order they were written.
    const changed = listing.files
      .filter(file => seenStamp(db, remote.machine, file.path) !== file.stamp)
      .sort((a, b) => {
        const rank = (path: string) => (path.endsWith('/grill.json') ? 0 : 1)
        return rank(a.path) - rank(b.path) || a.path.localeCompare(b.path)
      })
    for (const file of changed) {
      // A reply is taken once; a grill again whenever the agent rewrites it.
      const isReply = file.path.includes('/revisions/')
      if (isReply && seenStamp(db, remote.machine, file.path) !== undefined) {
        continue
      }
      await (isReply
        ? takeRevision(db, remote, listing.root, file.path)
        : takeGrill(db, remote, listing.root, file.path))
      markSeen(db, remote.machine, file.path, file.stamp)
    }
  }
  await pushStates(db)
}

/** Pulls every registered outbox every few seconds, one pass at a time. */
export const startRemotes = (db: Database): void => {
  const tick = async (): Promise<void> => {
    try {
      await pollOnce(db)
    } catch (error) {
      console.error(`remotes: ${String(error).slice(0, 300)}`)
    }
    setTimeout(tick, POLL_MS)
  }
  void tick()
}
