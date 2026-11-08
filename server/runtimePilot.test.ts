import { Database } from 'bun:sqlite'
import { afterEach, expect, it } from 'bun:test'
import {
  existsSync,
  linkSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  type FixtureObservation,
  type PilotBinding,
  runFixtureTurn,
  runtimePilot,
} from './runtimePilot'

const directories = new Set<string>(),
  databases = new Set<Database>()
afterEach(() => {
  databases.forEach(db => db.close())
  directories.forEach(path => rmSync(path, { recursive: true, force: true }))
  databases.clear()
  directories.clear()
})
const binding = (changes: Partial<PilotBinding> = {}): PilotBinding => ({
  version: 1,
  mode: 'fixture-only',
  source: 'alpha',
  thread: 'thread-Q1',
  run: 'run-a',
  epoch: 1,
  previous: 0,
  route: 't1',
  native: {
    runtime: 'codex-cli',
    uuid: '11111111-1111-1111-1111-111111111111',
  },
  process: {
    pid: 123,
    frontend: 'front-a',
    backend: 'back-a',
    socket: 'socket-a',
  },
  question: { id: 'Q1', revision: 'revision-a' },
  ...changes,
})
const observation = (
  owner = binding(),
  changes: Partial<FixtureObservation> = {},
): FixtureObservation => ({
  ...owner,
  mode: 'fixture-only',
  turn: 'turn-a',
  at: 1_000_000,
  capability: 'pull-turn-v1',
  ...changes,
})
const request = (changes = {}) => ({
  version: 1,
  mode: 'fixture-only',
  source: 'alpha',
  thread: 'thread-Q1',
  messageId: 'message-a',
  replyTo: null,
  senderKind: 'page',
  questionRevision: 'revision-a',
  body: 'Exact fixture words.\nSecond line.',
  ...changes,
})
const fixture = () => {
  const db = new Database(':memory:')
  db.exec(
    'CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, grill_id TEXT NOT NULL, at INTEGER NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL)',
  )
  databases.add(db)
  const clock = { at: 1_000_000 }
  return { db, clock, pilot: runtimePilot(db, () => clock.at) }
}
const rows = (db: Database) =>
  db.query('SELECT * FROM events ORDER BY id').all()

it.each(['claude-cli', 'claude-desktop', 'codex-cli'] as const)(
  'matches only the exact %s namespace, source and observed process',
  runtime => {
    const { db, pilot } = fixture(),
      owner = binding({ native: { ...binding().native, runtime } }),
      seen = observation(owner)
    const published = pilot.bind(owner, seen)
    const message = pilot.enqueue(request())
    const before = rows(db)
    const inbox = pilot.inbox(owner.source, owner.thread, seen)
    expect(inbox.pending[0]?.recipient.native.runtime).toBe(runtime)
    expect(inbox.pending[0]?.binding).toBe(published.id)
    expect(inbox.pending[0]?.formatted).toBe(
      '<grill-flow source="page">\n[fixture-only runtime pilot]\n' +
        request().body +
        '\n</grill-flow>',
    )
    expect(pilot.inbox(owner.source, owner.thread, seen).pending[0]?.id).toBe(
      message.id,
    )
    expect(rows(db)).toEqual(before)
    const wrong = runtime === 'codex-cli' ? 'claude-cli' : 'codex-cli'
    expect(() =>
      pilot.acknowledge(
        message.id,
        observation(owner, { native: { ...owner.native, runtime: wrong } }),
      ),
    ).toThrow('binding conflicts')
    expect(rows(db)).toEqual(before)
  },
)

it.each([
  { source: 'beta' },
  { thread: 'other-thread' },
  { run: 'other-run' },
  { route: 't2' },
  {
    native: {
      runtime: 'codex-cli',
      uuid: '22222222-2222-2222-2222-222222222222',
    },
  },
  { process: { ...binding().process, pid: 124 } },
  { process: { ...binding().process, frontend: 'front-b' } },
  { process: { ...binding().process, backend: 'back-b' } },
  { process: { ...binding().process, socket: 'socket-b' } },
  { question: { id: 'Q2', revision: 'revision-a' } },
  { question: { id: 'Q1', revision: 'revision-b' } },
])(
  'refuses mismatched fixture identity without acknowledging or exposing a pending body',
  mismatch => {
    const { db, pilot } = fixture()
    pilot.bind(binding(), observation())
    const message = pilot.enqueue(request()),
      before = rows(db)
    const changed = { ...observation(), ...mismatch }
    expect(() => pilot.inbox('alpha', 'thread-Q1', changed)).toThrow(
      'binding conflicts',
    )
    expect(() => pilot.acknowledge(message.id, changed)).toThrow(
      'binding conflicts',
    )
    expect(rows(db)).toEqual(before)
  },
)

it.each([
  { capability: 'unknown-runtime-v2' },
  { at: 969_999 },
  { at: 1_005_001 },
  { native: { runtime: 'unknown', uuid: binding().native.uuid } },
  { mode: 'live' },
  { native: { runtime: 'codex-cli', uuid: 'not-a-native-uuid' } },
])('keeps unsupported, stale and invalid evidence fail-closed', mismatch => {
  const { db, pilot } = fixture()
  const before = rows(db)
  expect(() =>
    pilot.bind(binding(), { ...observation(), ...mismatch }),
  ).toThrow()
  expect(rows(db)).toEqual(before)
})

it('freezes an envelope once, preserves exact words and rejects an edited replay', () => {
  const { db, clock, pilot } = fixture()
  const owner = pilot.bind(binding(), observation())
  expect(pilot.bind(binding(), observation())).toEqual(owner)
  const message = pilot.enqueue(request()),
    before = rows(db)
  clock.at += 500
  expect(pilot.enqueue(request())).toEqual(message)
  expect(pilot.inspect(message.id).request.body).toBe(request().body)
  expect(() => pilot.enqueue(request({ body: 'Changed words' }))).toThrow(
    'different content',
  )
  expect(rows(db)).toEqual(before)
})

it('keeps transport evidence independent from explicit, idempotent consumption', () => {
  const { db, clock, pilot } = fixture()
  pilot.bind(binding(), observation())
  const message = pilot.enqueue(request())
  expect(pilot.inspect(message.id)).toMatchObject({
    delivery: 'unconfirmed',
    consumption: 'pending',
    receipt: null,
  })
  pilot.recordDelivery(message.id, false)
  expect(pilot.inspect(message.id)).toMatchObject({
    delivery: 'failed',
    consumption: 'pending',
  })
  pilot.recordDelivery(message.id, true)
  expect(pilot.inspect(message.id)).toMatchObject({
    delivery: 'delivered',
    consumption: 'pending',
  })
  const receipt = pilot.acknowledge(message.id, observation()),
    before = rows(db)
  clock.at += 2_000
  expect(
    pilot.acknowledge(
      message.id,
      observation(binding(), { at: clock.at, turn: 'turn-b' }),
    ),
  ).toEqual(receipt)
  expect(rows(db)).toEqual(before)
  expect(pilot.inspect(message.id)).toMatchObject({
    delivery: 'delivered',
    consumption: 'consumed',
    receipt,
  })
  expect(
    pilot.inbox('alpha', 'thread-Q1', observation(binding(), { at: clock.at }))
      .pending,
  ).toEqual([])
})

it('retains recorded timestamps when the clock advances between operations and replays', () => {
  const { db } = fixture()
  let now = 1_000_000
  const pilot = runtimePilot(db, () => now++)
  const owner = pilot.bind(binding(), observation())
  const message = pilot.enqueue(request())
  const receipt = pilot.acknowledge(message.id, observation())
  expect(pilot.bind(binding(), observation())).toEqual(owner)
  expect(pilot.enqueue(request())).toEqual(message)
  expect(pilot.inspect(message.id).receipt).toEqual(receipt)
})

it('isolates same message IDs and reply targets by canonical source and thread', () => {
  const { db, pilot } = fixture()
  pilot.bind(binding(), observation())
  const first = pilot.enqueue(request())
  const other = binding({ source: 'beta', thread: 'other-thread' })
  pilot.bind(other, observation(other))
  const second = pilot.enqueue(
    request({ source: other.source, thread: other.thread }),
  )
  expect(second.id).not.toBe(first.id)
  const before = rows(db)
  expect(() =>
    pilot.enqueue(
      request({
        source: other.source,
        thread: other.thread,
        messageId: 'reply',
        replyTo: first.id,
      }),
    ),
  ).toThrow('another source/thread')
  expect(rows(db)).toEqual(before)
  const third = binding({ thread: 'same-source-other-thread' })
  pilot.bind(third, observation(third))
  const independent = pilot.enqueue(request({ thread: third.thread }))
  expect(independent.id).not.toBe(first.id)
  expect(() =>
    pilot.enqueue(
      request({
        thread: third.thread,
        messageId: 'cross-thread-reply',
        replyTo: first.id,
      }),
    ),
  ).toThrow('another source/thread')
  const reply = pilot.enqueue(
    request({ messageId: 'reply', replyTo: first.id, senderKind: 'agent' }),
  )
  expect(reply.request.replyTo).toBe(first.id)
})

it('keeps an old pending recipient in conflict after handover without rerouting its body', () => {
  const { db, pilot } = fixture()
  const old = pilot.bind(binding(), observation()),
    pending = pilot.enqueue(request())
  const next = binding({
    epoch: 2,
    previous: old.id,
    route: 't2',
    run: 'run-b',
    native: {
      runtime: 'codex-cli',
      uuid: '22222222-2222-2222-2222-222222222222',
    },
  })
  const replacement = pilot.bind(next, observation(next))
  const before = rows(db)
  expect(() => pilot.acknowledge(pending.id, observation())).toThrow(
    'binding conflicts',
  )
  expect(() => pilot.acknowledge(pending.id, observation(next))).toThrow(
    'acknowledgement refused',
  )
  expect(() => pilot.bind(binding(), observation())).toThrow('epoch conflicts')
  expect(rows(db)).toEqual(before)
  const inbox = pilot.inbox('alpha', 'thread-Q1', observation(next))
  expect(inbox.pending).toEqual([])
  expect(inbox.conflicts).toEqual([
    { envelope: pending.id, reason: 'recipient-binding-or-question-changed' },
  ])
  expect(JSON.stringify(inbox)).not.toContain(request().body)
  expect(pilot.enqueue(request())).toEqual(pending)
  const fresh = pilot.enqueue(request({ messageId: 'new-owner-message' }))
  expect(fresh.binding).toBe(replacement.id)
  expect(pilot.acknowledge(fresh.id, observation(next)).native).toEqual(
    next.native,
  )
})

it('refuses stale question revisions and preserves a prior consumed receipt through later edits', () => {
  const { db, pilot } = fixture()
  const old = pilot.bind(binding(), observation()),
    consumed = pilot.enqueue(request())
  const receipt = pilot.acknowledge(consumed.id, observation())
  const pending = pilot.enqueue(request({ messageId: 'pending-old-revision' }))
  const next = binding({
    previous: old.id,
    epoch: 2,
    question: { id: 'Q1', revision: 'revision-b' },
  })
  pilot.bind(next, observation(next))
  const before = rows(db)
  expect(() =>
    pilot.enqueue(request({ messageId: 'stale-new-request' })),
  ).toThrow('revision changed')
  expect(() => pilot.acknowledge(pending.id, observation(next))).toThrow(
    'acknowledgement refused',
  )
  expect(pilot.inspect(consumed.id).receipt).toEqual(receipt)
  expect(pilot.inspect(consumed.id).consumption).toBe('consumed')
  expect(pilot.inspect(pending.id).consumption).toBe('conflict')
  expect(rows(db)).toEqual(before)
})

it('requires a published source binding, valid reply and bounded body', () => {
  const { db, pilot } = fixture()
  expect(() => pilot.enqueue(request())).toThrow('No published')
  pilot.bind(binding(), observation())
  const before = rows(db)
  expect(() => pilot.enqueue(request({ replyTo: 999 }))).toThrow(
    'Unknown fixture envelope',
  )
  expect(() => pilot.enqueue(request({ body: 'x'.repeat(100_001) }))).toThrow(
    'Invalid fixture',
  )
  expect(() => pilot.enqueue(request({ source: 'alpha/foreign' }))).toThrow(
    'Invalid fixture',
  )
  expect(() =>
    pilot.bind(binding({ route: 'remote/t1' }), observation()),
  ).toThrow('Invalid fixture')
  expect(() =>
    pilot.bind(binding({ previous: 999, epoch: 2 }), observation()),
  ).toThrow('epoch conflicts')
  expect(rows(db)).toEqual(before)
})

it('leaves declined or crashed fixture handlers pending and consumes only accepted turns', async () => {
  const { pilot } = fixture()
  pilot.bind(binding(), observation())
  const first = pilot.enqueue(request())
  let count = 0
  const read = () => observation()
  expect(
    (await runFixtureTurn(pilot, 'alpha', 'thread-Q1', read, async () => false))
      .outcomes[0]?.consumed,
  ).toBe(false)
  expect(
    (
      await runFixtureTurn(pilot, 'alpha', 'thread-Q1', read, async () => {
        throw new Error('fixture handler failed')
      })
    ).outcomes[0]?.consumed,
  ).toBe(false)
  expect(pilot.inspect(first.id).consumption).toBe('pending')
  const accepted = await runFixtureTurn(
    pilot,
    'alpha',
    'thread-Q1',
    read,
    async body => {
      count++
      expect(body).toStartWith('<grill-flow source="page">')
      return true
    },
  )
  expect(accepted).toMatchObject({
    mode: 'fixture-only',
    productionReady: false,
  })
  expect(accepted.outcomes[0]?.consumed).toBe(true)
  await runFixtureTurn(pilot, 'alpha', 'thread-Q1', read, async () => {
    count++
    return true
  })
  expect(count).toBe(1)
})

it('rechecks the recipient before each handler and after acceptance during handover', async () => {
  const { db, pilot } = fixture(),
    old = pilot.bind(binding(), observation())
  const first = pilot.enqueue(request()),
    second = pilot.enqueue(request({ messageId: 'second' }))
  const next = binding({ epoch: 2, previous: old.id, route: 't2' })
  let calls = 0
  const result = await runFixtureTurn(
    pilot,
    'alpha',
    'thread-Q1',
    () => observation(),
    async () => {
      calls++
      pilot.bind(next, observation(next))
      return true
    },
  )
  expect(calls).toBe(1)
  expect(result.outcomes.every(outcome => !outcome.consumed)).toBe(true)
  expect(pilot.inspect(first.id).consumption).toBe('conflict')
  expect(pilot.inspect(second.id).consumption).toBe('conflict')
  expect(
    rows(db).filter(
      row =>
        JSON.parse((row as { payload: string }).payload)._tag === 'Consumed',
    ),
  ).toEqual([])
})

it('bounds one turn to 100 pending envelopes and exposes truncation', () => {
  const { pilot } = fixture()
  pilot.bind(binding(), observation())
  for (let i = 0; i < 101; i++)
    pilot.enqueue(request({ messageId: `message-${i}` }))
  const inbox = pilot.inbox('alpha', 'thread-Q1', observation())
  expect(inbox.pending).toHaveLength(100)
  expect(inbox.truncated).toBe(true)
})

it('does not invoke a handler when the observed capability is unavailable', async () => {
  const { db, pilot } = fixture()
  pilot.bind(binding(), observation())
  pilot.enqueue(request())
  const before = rows(db)
  let invoked = false
  await expect(
    runFixtureTurn(
      pilot,
      'alpha',
      'thread-Q1',
      () => observation(binding(), { capability: 'unsupported' }),
      async () => {
        invoked = true
        return true
      },
    ),
  ).rejects.toThrow('Unsupported')
  expect(invoked).toBe(false)
  expect(rows(db)).toEqual(before)
})

const scratch = () => {
  const directory = mkdtempSync(join(tmpdir(), 'grill-flow-pilot-test-'))
  directories.add(directory)
  return directory
}
const cli = async (
  directory: string,
  command: string,
  extra: Array<string> = [],
) => {
  const args = command.startsWith('pilot ') ? command.split(' ') : [command]
  const child = Bun.spawn(
    [
      process.execPath,
      'server/cli.ts',
      ...args,
      '--fixture-only',
      '--pilot-dir',
      directory,
      ...extra,
    ],
    {
      env: {
        ...process.env,
        GF_DB: join(directory, 'must-not-open-live.sqlite'),
        GF_OUTBOX: join(directory, 'must-not-use-outbox'),
      },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  const [code, out, error] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  const parsed = JSON.parse(out || error)
  expect(parsed).toMatchObject({
    mode: 'fixture-only',
    productionReady: false,
    version: 1,
  })
  return { code, out, error, parsed }
}
const inputFile = (directory: string, name: string, value: unknown) => {
  const path = join(directory, name + '.json')
  writeFileSync(path, JSON.stringify(value))
  return path
}

it('runs the explicit scratch CLI end to end without opening the live DB or outbox', async () => {
  const directory = scratch()
  expect((await cli(directory, 'pilot init')).code).toBe(0)
  const manifest = inputFile(directory, 'binding', binding()),
    seen = inputFile(
      directory,
      'observation',
      observation(binding(), { at: Date.now() }),
    ),
    message = inputFile(directory, 'request', request())
  const bound = await cli(directory, 'pilot bind', [
    '--file',
    manifest,
    '--fixture',
    seen,
  ])
  expect(bound.error).toBe('')
  expect(bound.code).toBe(0)
  const enqueued = await cli(directory, 'pilot enqueue', ['--file', message]),
    event = String(enqueued.parsed.result.id)
  expect(
    (
      await cli(directory, 'inbox', [
        '--source',
        'alpha',
        '--thread',
        'thread-Q1',
        '--fixture',
        seen,
      ])
    ).parsed.result.pending,
  ).toHaveLength(1)
  await cli(directory, 'pilot delivery', ['--event', event, '--ok', 'true'])
  expect(
    (await cli(directory, 'pilot inspect', ['--event', event])).parsed.result,
  ).toMatchObject({ delivery: 'delivered', consumption: 'pending' })
  const receipts = await Promise.all([
    cli(directory, 'ack', ['--event', event, '--fixture', seen]),
    cli(directory, 'ack', ['--event', event, '--fixture', seen]),
  ])
  expect(receipts.every(row => row.code === 0)).toBe(true)
  expect(receipts[0]!.parsed.result).toEqual(receipts[1]!.parsed.result)
  expect(
    (
      await cli(directory, 'inbox', [
        '--source',
        'alpha',
        '--thread',
        'thread-Q1',
        '--fixture',
        seen,
      ])
    ).parsed.result.pending,
  ).toEqual([])
  expect(existsSync(join(directory, 'must-not-open-live.sqlite'))).toBe(false)
  expect(existsSync(join(directory, 'must-not-use-outbox'))).toBe(false)
  const db = new Database(join(directory, 'pilot.sqlite'), { readonly: true })
  try {
    expect(
      db
        .query(
          "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
        )
        .all(),
    ).toEqual([{ name: 'events' }, { name: 'sqlite_sequence' }])
    expect(
      db
        .query(
          "SELECT COUNT(*) AS count FROM events WHERE json_extract(payload, '$._tag') = 'Consumed'",
        )
        .get(),
    ).toEqual({ count: 1 })
  } finally {
    db.close()
  }
})

it('refuses implicit inbox, unowned stores, foreign fixture files and shared DB links', async () => {
  const directory = scratch(),
    before = readdirSync(directory)
  expect(
    (
      await cli(directory, 'inbox', [
        '--source',
        'alpha',
        '--thread',
        'thread-Q1',
        '--fixture',
        join(directory, 'none.json'),
      ])
    ).code,
  ).toBe(2)
  expect(readdirSync(directory)).toEqual(before)
  const child = Bun.spawn([process.execPath, 'server/cli.ts', 'inbox'], {
    env: {
      ...process.env,
      GF_DB: join(directory, 'must-not-open-live.sqlite'),
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [code, error] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
  ])
  expect(code).toBe(2)
  expect(error).toContain('BLOCKED')
  expect(readdirSync(directory)).toEqual(before)
  const retained = join(directory, 'retained.txt')
  writeFileSync(retained, 'Retained fixture data')
  expect((await cli(directory, 'pilot init')).code).toBe(2)
  expect(readFileSync(retained, 'utf8')).toBe('Retained fixture data')
  rmSync(retained)
  expect((await cli(directory, 'pilot init')).code).toBe(0)
  const external = scratch(),
    sentinel = inputFile(external, 'private', {
      secret: 'FAKE_PRIVATE_SENTINEL',
    })
  const result = await cli(directory, 'pilot bind', [
    '--file',
    sentinel,
    '--fixture',
    sentinel,
  ])
  expect(result.code).toBe(2)
  expect(result.error).not.toContain('FAKE_PRIVATE_SENTINEL')
  const linked = join(directory, 'linked.json')
  symlinkSync(sentinel, linked)
  expect(
    (
      await cli(directory, 'pilot bind', [
        '--file',
        linked,
        '--fixture',
        linked,
      ])
    ).code,
  ).toBe(2)
  rmSync(join(directory, 'pilot.sqlite'))
  linkSync(sentinel, join(directory, 'pilot.sqlite'))
  expect((await cli(directory, 'pilot inspect', ['--event', '1'])).code).toBe(2)
  expect(JSON.parse(readFileSync(sentinel, 'utf8'))).toEqual({
    secret: 'FAKE_PRIVATE_SENTINEL',
  })
})
