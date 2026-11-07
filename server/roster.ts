import { Schema } from 'effect'

import type { Roster, RosterMember } from '../src/roster'

const TTL = 60_000
const LIMIT = 64
const Address = Schema.String.check(
  Schema.isPattern(/^(?:[A-Za-z0-9][\w.-]{0,63}\/)?t[0-9a-z]+$/),
)
const Terminal = Schema.Literals(['live', 'finished'])
const Status = Schema.Literals(['working', 'idle', 'done', 'blocked', 'error'])
const Listing = Schema.Struct({
  terminals: Schema.Array(Schema.Struct({ address: Address, state: Terminal })),
  machines: Schema.Array(
    Schema.Struct({ name: Schema.String, state: Schema.String }),
  ),
})
const Detail = Schema.Struct({
  address: Address,
  state: Terminal,
  labels: Schema.Record(Schema.String, Schema.String),
  status: Schema.optionalKey(Schema.NullOr(Schema.Struct({ state: Status }))),
})
type ReadCommand = (args: ReadonlyArray<string>) => Promise<unknown>
const label = (value: string | undefined): string | null =>
  value === undefined || value.trim() === '' || /[\x00-\x1f\x7f]/.test(value)
    ? null
    : value.trim().slice(0, 160)
const initial = (profile: string): Roster => ({
  profile,
  state: 'loading',
  checkedAt: null,
  members: [],
  unavailableHosts: [],
  omitted: 0,
  unverified: 0,
  error: '',
})

export const createRosterReader = (
  run: ReadCommand,
  now: () => number = Date.now,
) => {
  const queue: Array<() => void> = []
  let active = 0
  const read: ReadCommand = args =>
    new Promise((resolve, reject) => {
      const start = () => {
        active += 1
        void run(args)
          .then(resolve, reject)
          .finally(() => {
            active -= 1
            queue.shift()?.()
          })
      }
      if (active < 4) {
        start()
      } else if (queue.length < 64) {
        queue.push(start)
      } else {
        reject(new Error('Roster reader is busy'))
      }
    })
  const cache = new Map<
    string,
    { value: Roster; next: number; pending: boolean }
  >()
  const refresh = async (
    profile: string,
    previous: Roster,
  ): Promise<Roster> => {
    const listing = Schema.decodeUnknownSync(Listing)(
      await read([
        'ls',
        '--all',
        '--label',
        `squad.profile=${profile}`,
        '--json',
      ]),
    )
    const unavailableHosts = listing.machines
      .filter(machine => machine.state !== 'connected')
      .map(machine => machine.name.slice(0, 160))
    const listed = listing.terminals
      .slice()
      .sort(
        (a, b) =>
          (a.state === 'live' ? 0 : 1) - (b.state === 'live' ? 0 : 1) ||
          a.address.localeCompare(b.address),
      )
    const selected = listed.slice(0, LIMIT)
    const batches = Array.from(
      { length: Math.ceil(selected.length / 4) },
      (_, index) => selected.slice(index * 4, index * 4 + 4),
    )
    const members = await batches.reduce<Promise<Array<RosterMember>>>(
      async (prior, batch) => {
        const accumulated = await prior
        const next = await Promise.all(
          batch.map(async row => {
            try {
              const detail = Schema.decodeUnknownSync(Detail)(
                await read(['get', row.address, '--json']),
              )
              if (
                detail.address !== row.address ||
                detail.labels['squad.profile'] !== profile
              ) {
                return []
              }
              return [
                {
                  address: row.address,
                  profile,
                  role: label(detail.labels['squad.role']),
                  run: label(detail.labels['squad.run']),
                  host: label(detail.labels['squad.host']),
                  terminal: detail.state,
                  coreStatus: detail.status?.state ?? 'unknown',
                  checkedAt: now(),
                  detail: 'ready',
                } satisfies RosterMember,
              ]
            } catch {
              const old = previous.members.find(
                member => member.address === row.address,
              )
              return old === undefined
                ? []
                : [{ ...old, detail: 'unavailable' } satisfies RosterMember]
            }
          }),
        )
        return accumulated.concat(next.flat())
      },
      Promise.resolve([]),
    )
    const missingRemote = previous.members
      .filter(
        member =>
          unavailableHosts.includes(member.address.split('/')[0] ?? '') &&
          !members.some(current => current.address === member.address),
      )
      .map(
        member => ({ ...member, detail: 'unavailable' }) satisfies RosterMember,
      )
    return {
      profile,
      state: 'ready',
      checkedAt: now(),
      members: members.concat(missingRemote),
      unavailableHosts,
      omitted: Math.max(0, listed.length - selected.length),
      unverified:
        selected.length -
        members.filter(member => member.detail === 'ready').length,
      error: '',
    }
  }
  return (profile: string): Roster => {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(profile)) {
      return {
        ...initial(profile),
        state: 'unavailable',
        error: 'This page has no supported roster profile ID.',
      }
    }
    const existing = cache.get(profile)
    const entry = existing ?? {
      value: initial(profile),
      next: 0,
      pending: false,
    }
    if (existing === undefined) {
      if (cache.size >= 16) {
        const oldest = cache.keys().next().value
        if (oldest !== undefined) {
          cache.delete(oldest)
        }
      }
      cache.set(profile, entry)
    }
    if (!entry.pending && now() >= entry.next) {
      entry.pending = true
      entry.next = now() + TTL
      void refresh(profile, entry.value)
        .then(value => {
          entry.value = value
        })
        .catch(() => {
          entry.value = {
            ...entry.value,
            state: entry.value.checkedAt === null ? 'unavailable' : 'stale',
            error:
              'Herdr roster could not be checked. Retrying after the cache interval.',
          }
        })
        .finally(() => {
          entry.pending = false
        })
    }
    return now() - (entry.value.checkedAt ?? now()) >= TTL
      ? { ...entry.value, state: 'stale' }
      : entry.value
  }
}

export const readRosterCommand: ReadCommand = async args => {
  if (
    !(
      (args.length === 5 &&
        args[0] === 'ls' &&
        args[1] === '--all' &&
        args[2] === '--label' &&
        args[3]?.startsWith('squad.profile=') &&
        args[4] === '--json') ||
      (args.length === 3 &&
        args[0] === 'get' &&
        args[2] === '--json' &&
        Schema.decodeUnknownResult(Address)(args[1])._tag === 'Success')
    )
  ) {
    throw new Error('Unsupported roster read')
  }
  const child = Bun.spawn(['hc', ...args], {
    stdout: 'pipe',
    stderr: 'ignore',
    timeout: 1200,
  })
  const reader = child.stdout.getReader()
  const collect = async (
    size = 0,
    chunks: ReadonlyArray<Uint8Array> = [],
  ): Promise<string> => {
    const chunk = await reader.read()
    if (chunk.done) {
      return Buffer.concat(chunks).toString('utf8')
    }
    const next = size + chunk.value.byteLength
    if (next > 2_000_000) {
      throw new Error('Oversized roster response')
    }
    return collect(next, chunks.concat(chunk.value))
  }
  try {
    const text = await collect()
    if ((await child.exited) !== 0) {
      throw new Error('Roster read failed')
    }
    return JSON.parse(text)
  } finally {
    if (child.exitCode === null) {
      child.kill()
    }
    reader.releaseLock()
  }
}
