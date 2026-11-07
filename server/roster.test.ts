import { afterEach, expect, it } from 'bun:test'
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createRosterReader, readRosterCommand } from './roster'

const folders = new Set<string>()
afterEach(() => {
  folders.forEach(folder => rmSync(folder, { recursive: true, force: true }))
  folders.clear()
})
const detail = (address: string, profile = 'team') => ({
  address,
  state: 'live',
  status: { state: 'blocked', progress: 79 },
  labels: {
    'squad.profile': profile,
    'squad.role': 'helper',
    'squad.run': 'published-run',
    'squad.host': 'mbp',
    where: 'Never use this for membership',
  },
  argv: ['fake-secret-not-for-the-page'],
  screen: 'fake-secret-not-for-the-page',
})
const listing = (addresses = ['t1', 'lab/t2']) => ({
  terminals: addresses.map(address => ({ address, state: 'live' })),
  machines: [{ name: 'lab', state: 'connected' }],
})
const settle = async () => {
  await Bun.sleep(0)
}

it('uses exact profile labels and projects only dated roster metadata', async () => {
  const calls: Array<ReadonlyArray<string>> = []
  const read = createRosterReader(
    async args => {
      calls.push(args)
      return args[0] === 'ls'
        ? listing(['t1', 't2', 't3'])
        : args[1] === 't2'
          ? detail('t2', 'other')
          : args[1] === 't3'
            ? { ...detail('t3'), labels: { where: 'team' } }
            : detail('t1')
    },
    () => 1000,
  )
  expect(read('team').state).toBe('loading')
  await settle()
  const result = read('team')
  expect(result).toMatchObject({
    state: 'ready',
    checkedAt: 1000,
    unverified: 2,
    members: [
      {
        address: 't1',
        profile: 'team',
        role: 'helper',
        run: 'published-run',
        host: 'mbp',
        coreStatus: 'blocked',
        checkedAt: 1000,
      },
    ],
  })
  expect(calls[0]).toEqual([
    'ls',
    '--all',
    '--label',
    'squad.profile=team',
    '--json',
  ])
  expect(calls.slice(1)).toEqual(
    ['t1', 't2', 't3'].map(address => ['get', address, '--json']),
  )
  expect(JSON.stringify(result)).not.toContain('fake-secret')
  expect(JSON.stringify(result)).not.toContain('79')
  expect(JSON.stringify(result)).not.toContain('where')
})

it('coalesces cached reads, bounds concurrent profiles and reports truncated inventories', async () => {
  let active = 0,
    maximum = 0,
    calls = 0
  const read = createRosterReader(
    async args => {
      calls += 1
      active += 1
      maximum = Math.max(maximum, active)
      await Bun.sleep(1)
      active -= 1
      return args[0] === 'ls'
        ? listing(Array.from({ length: 70 }, (_, index) => `t${index + 1}`))
        : detail(args[1]!)
    },
    () => 1000,
  )
  read('team')
  read('second')
  Array.from({ length: 20 }).forEach(() => read('team'))
  const finished = async (profile: string, remaining = 200): Promise<void> => {
    if (read(profile).state !== 'loading' || remaining === 0) return
    await Bun.sleep(5)
    return finished(profile, remaining - 1)
  }
  await Promise.all(['team', 'second'].map(profile => finished(profile)))
  const result = read('team')
  expect(result.state).toBe('ready')
  expect(result.members).toHaveLength(64)
  expect(result.omitted).toBe(6)
  expect(maximum).toBeLessThanOrEqual(4)
  expect(calls).toBe(130)
  read('team')
  expect(calls).toBe(130)
})

it('retains dated last-good rows for unavailable hosts and failed details without pretending they are current', async () => {
  let now = 1000,
    unavailable = false
  const read = createRosterReader(
    async args => {
      if (args[0] === 'ls')
        return unavailable
          ? {
              ...listing(['t1']),
              machines: [{ name: 'lab', state: 'disconnected' }],
            }
          : listing()
      if (unavailable) throw new Error('private stderr must never escape')
      return detail(args[1]!)
    },
    () => now,
  )
  read('team')
  await settle()
  expect(read('team').members).toHaveLength(2)
  now += 60_001
  unavailable = true
  expect(read('team').state).toBe('stale')
  await settle()
  const result = read('team')
  expect(result.checkedAt).toBe(now)
  expect(result.unavailableHosts).toEqual(['lab'])
  expect(result.unverified).toBe(1)
  expect(result.members).toMatchObject([
    { address: 't1', detail: 'unavailable', checkedAt: 1000 },
    { address: 'lab/t2', detail: 'unavailable', checkedAt: 1000 },
  ])
  expect(JSON.stringify(result)).not.toContain('private stderr')
})

it('shows unavailable or stale instead of inventing an empty successful roster on read errors', async () => {
  let now = 1000,
    fail = true
  const read = createRosterReader(
    async args => {
      if (fail) throw new Error('fake-secret')
      return args[0] === 'ls' ? listing(['t1']) : detail('t1')
    },
    () => now,
  )
  read('team')
  await settle()
  expect(read('team')).toMatchObject({
    state: 'unavailable',
    checkedAt: null,
    members: [],
  })
  expect(read('team').error).not.toContain('fake-secret')
  now += 60_001
  fail = false
  read('team')
  await settle()
  expect(read('team').state).toBe('ready')
  now += 60_001
  fail = true
  read('team')
  await settle()
  expect(read('team')).toMatchObject({
    state: 'stale',
    checkedAt: 61001,
    members: [{ address: 't1' }],
  })
})

it('rejects malformed inventory and crafted addresses, and keeps missing role/run/status unknown', async () => {
  let malformed = false
  const read = createRosterReader(
    async args =>
      args[0] === 'ls'
        ? listing(malformed ? ['t1;touch /tmp/not-allowed'] : ['t1'])
        : {
            address: 't1',
            state: 'finished',
            labels: { 'squad.profile': 'team' },
          },
    () => 1000,
  )
  expect(read('--invalid').state).toBe('unavailable')
  read('team')
  await settle()
  expect(read('team').members[0]).toMatchObject({
    terminal: 'finished',
    role: null,
    run: null,
    coreStatus: 'unknown',
  })
  malformed = true
  read('other')
  await settle()
  expect(read('other').state).toBe('unavailable')
  for (const args of [
    ['send', 't1', 'text'],
    ['kill', 't1'],
    ['label', 't1', 'squad.profile=x'],
    ['get', 't1;touch /tmp/not-allowed', '--json'],
    ['get', '--help', '--json'],
    ['ls', '--all', '--label', 'squad.profile=team', '--json', '--extra'],
  ])
    await expect(readRosterCommand(args)).rejects.toThrow(
      'Unsupported roster read',
    )
})

it('runs only fixed read argv and times out oversized or hanging helpers without exposing stderr', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'gf-roster-'))
  folders.add(folder)
  const log = join(folder, 'argv.jsonl')
  const binary = join(folder, 'hc')
  writeFileSync(
    binary,
    `#!${process.execPath}
import {appendFileSync} from 'node:fs';
const args=process.argv.slice(2);
appendFileSync(${JSON.stringify(log)},JSON.stringify(args)+'\\n');
if(args[1]==='t2') { await Bun.sleep(5000); }
else if(args[1]==='t3') { console.log('x'.repeat(2000001)); }
else { console.error('fake-secret'); console.log(JSON.stringify({ok:true})); }
`,
  )
  chmodSync(binary, 0o700)
  const runner = join(folder, 'read.ts')
  writeFileSync(
    runner,
    `import {readRosterCommand} from ${JSON.stringify(join(process.cwd(), 'server/roster.ts'))};
console.log(JSON.stringify(await readRosterCommand(['ls','--all','--label','squad.profile=team','--json'])));
console.log(JSON.stringify(await readRosterCommand(['get','t1','--json'])));
for(const address of ['t2','t3']) { try { await readRosterCommand(['get',address,'--json']); process.exitCode=2; } catch {console.log('bounded');} }
`,
  )
  const child = Bun.spawn([process.execPath, runner], {
    env: { ...process.env, PATH: `${folder}:${process.env.PATH}` },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  expect(code).toBe(0)
  expect(stdout.trim().split('\n')).toEqual([
    '{"ok":true}',
    '{"ok":true}',
    'bounded',
    'bounded',
  ])
  expect(stderr).toBe('')
  expect(
    readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map(line => JSON.parse(line)),
  ).toEqual([
    ['ls', '--all', '--label', 'squad.profile=team', '--json'],
    ...['t1', 't2', 't3'].map(address => ['get', address, '--json']),
  ])
})
