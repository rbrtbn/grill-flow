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

import { createProviderFetcher, readProviderCommand } from './providerReads'

const reference = {
  provider: 'github',
  repository: 'rbrtbn/squad',
  kind: 'pull',
  number: 100,
} satisfies import('../src/references').ProviderReference
const now = Date.parse('2026-11-07T23:00:00Z')
const pr = {
  number: 100,
  title: 'Exact PR title',
  state: 'MERGED',
  isDraft: false,
  url: 'https://github.com/rbrtbn/squad/pull/100',
  statusCheckRollup: [{ conclusion: 'SUCCESS' }],
  body: 'fake-secret-never-project',
  token: 'fake-secret-never-project',
}
const folders = new Set<string>()
afterEach(() => {
  folders.forEach(folder => rmSync(folder, { recursive: true, force: true }))
  folders.clear()
})

it.each([
  {
    checks: [{ conclusion: 'SUCCESS' }, { conclusion: 'SKIPPED' }],
    expected: 'passed',
  },
  { checks: [{ state: 'SUCCESS' }, { state: 'FAILURE' }], expected: 'failed' },
  { checks: [{ conclusion: 'CANCELLED' }], expected: 'failed' },
  { checks: [{ status: 'IN_PROGRESS', conclusion: '' }], expected: 'pending' },
  { checks: [{ state: 'PENDING' }], expected: 'pending' },
  { checks: [{ conclusion: 'NEUTRAL' }], expected: 'unknown' },
  { checks: [{ conclusion: 'NEW_PROVIDER_STATE' }], expected: 'unknown' },
  { checks: [], expected: 'unknown' },
])(
  'keeps merged state independent of $expected check evidence',
  async ({ checks, expected }) => {
    const calls: Array<ReadonlyArray<string>> = []
    const fetch = createProviderFetcher(
      async args => {
        calls.push(args)
        return args[1] === 'api'
          ? { login: 'rbrtbn' }
          : { ...pr, statusCheckRollup: checks }
      },
      () => now,
    )
    const reading = await fetch(reference)
    expect(reading.states).toContain('merged')
    expect(reading.checks).toBe(expected)
    expect(reading.states.includes('passed')).toBe(expected === 'passed')
    expect(reading.states.includes('failed')).toBe(expected === 'failed')
    expect(calls).toEqual([
      [
        'gh',
        'api',
        'user',
        '--hostname',
        'github.com',
        '--jq',
        '{login:.login}',
      ],
      [
        'gh',
        'pr',
        'view',
        pr.url,
        '--json',
        'number,title,state,isDraft,statusCheckRollup,url',
      ],
    ])
    expect(JSON.stringify(reading)).not.toContain('fake-secret')
  },
)

it('coalesces identity reads and refuses the wrong account, reference or malformed provider data', async () => {
  let identityCalls = 0
  const fetch = createProviderFetcher(
    async args => {
      if (args[1] === 'api') {
        identityCalls += 1
        return { login: 'rbrtbn' }
      }
      return pr
    },
    () => now,
  )
  await Promise.all([fetch(reference), fetch(reference)])
  expect(identityCalls).toBe(1)
  const wrongIdentity = createProviderFetcher(
    async () => ({ login: 'other-account' }),
    () => now,
  )
  await expect(wrongIdentity(reference)).rejects.toThrow('identity')
  for (const data of [
    { ...pr, number: 101 },
    { ...pr, url: 'https://github.com/other/repo/pull/100' },
    { ...pr, state: 'NEW_STATE' },
  ]) {
    const read = createProviderFetcher(
      async args => (args[1] === 'api' ? { login: 'rbrtbn' } : data),
      () => now,
    )
    await expect(read(reference)).rejects.toThrow()
  }
})

it('normalizes draft PRs, issues and redacts token-like title text', async () => {
  const fetch = createProviderFetcher(
    async args =>
      args[1] === 'api'
        ? { login: 'rbrtbn' }
        : {
            ...pr,
            state: 'OPEN',
            isDraft: true,
            title:
              'Fix ghp_abcdefghijklmnopqrstuvwxyz and Bearer private-value',
            statusCheckRollup: null,
          },
    () => now,
  )
  expect(await fetch(reference)).toMatchObject({
    states: ['draft', 'open'],
    checks: 'unknown',
    title: 'Fix [redacted] and [redacted]',
  })
  const issue = createProviderFetcher(
    async args =>
      args[1] === 'api'
        ? { login: 'rbrtbn' }
        : {
            ...pr,
            state: 'CLOSED',
            url: 'https://github.com/rbrtbn/squad/issues/100',
          },
    () => now,
  )
  expect(await issue({ ...reference, kind: 'issue' })).toMatchObject({
    states: ['closed'],
    checks: 'not-applicable',
    type: 'issue',
  })
})

it('checks Linear workspace, exact issue identity and freshness before projecting its state', async () => {
  const data = {
    fetchedAt: new Date(now).toISOString(),
    workspace: 'rbrtbn',
    issues: [
      {
        id: 'd2694e39-f07e-42e0-abde-7eda89b0ffce',
        identifier: 'LAB-1280',
        title: 'Exact issue',
        description: 'fake-secret',
        state: { name: 'Done', type: 'completed' },
      },
    ],
  }
  const calls: Array<ReadonlyArray<string>> = []
  const fetch = createProviderFetcher(
    async args => {
      calls.push(args)
      return data
    },
    () => now,
  )
  const reading = await fetch({ provider: 'linear', id: 'LAB-1280' })
  expect(reading).toMatchObject({
    status: 'Done',
    type: 'completed',
    states: ['done'],
    checks: 'not-applicable',
  })
  expect(JSON.stringify(reading)).not.toContain('fake-secret')
  expect(calls).toEqual([
    ['linear-snapshot', '--workspace', 'rbrtbn', 'LAB-1280'],
  ])
  for (const raw of [
    { ...data, workspace: 'other' },
    { ...data, fetchedAt: 'invalid' },
    { ...data, fetchedAt: new Date(now - 60_001).toISOString() },
    { ...data, issues: [{ ...data.issues[0], identifier: 'LAB-1' }] },
    {
      ...data,
      issues: [{ ...data.issues[0], id: 'same-label-in-a-different-org' }],
    },
  ]) {
    await expect(
      createProviderFetcher(
        async () => raw,
        () => now,
      )({ provider: 'linear', id: 'LAB-1280' }),
    ).rejects.toThrow()
  }
  const paired = createProviderFetcher(
    async args => {
      expect(args).toEqual([
        'linear-snapshot',
        '--workspace',
        'rbrtbn',
        'LAB-1280',
        'LAB-1281',
      ])
      return {
        ...data,
        issues: [
          ...data.issues,
          {
            id: 'other-issue',
            identifier: 'LAB-1281',
            title: 'Requested item',
            state: { name: 'In Progress', type: 'started' },
          },
        ],
      }
    },
    () => now,
  )
  expect(await paired({ provider: 'linear', id: 'LAB-1281' })).toMatchObject({
    title: 'Requested item',
    states: ['in-progress'],
  })
})

it('refuses writes, comments, labels, arbitrary URLs and crafted argv before spawning', async () => {
  for (const args of [
    ['gh', 'pr', 'merge', pr.url],
    ['gh', 'issue', 'comment', '100', '--body', 'text'],
    ['gh', 'api', 'repos/rbrtbn/squad/issues', '--method', 'POST'],
    [
      'gh',
      'pr',
      'view',
      'https://evil.test/pr/100',
      '--json',
      'number,title,state,isDraft,statusCheckRollup,url',
    ],
    [
      'gh',
      'pr',
      'view',
      pr.url,
      '--json',
      'number,title,state,isDraft,statusCheckRollup,url',
      '--comments',
    ],
    ['linear-snapshot', '--workspace', 'other', 'LAB-1280'],
    ['linear-snapshot', '--workspace', 'rbrtbn', 'LAB-1;touch /tmp/unsafe'],
  ])
    await expect(readProviderCommand(args)).rejects.toThrow(
      'Unsupported provider read',
    )
})

it('executes only read argv and bounds output and process lifetime without returning stderr', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'gf-provider-'))
  folders.add(folder)
  const log = join(folder, 'calls.jsonl')
  const binary = `#!${process.execPath}
import {appendFileSync} from 'node:fs';
const a=process.argv.slice(2); appendFileSync(${JSON.stringify(log)},JSON.stringify(a)+'\\n');
if(a[2]?.endsWith('/998')) { await Bun.sleep(10000); }
else if(a[2]?.endsWith('/999')) { console.log('x'.repeat(2000001)); }
else { console.error('fake-private-stderr'); console.log(JSON.stringify({ok:true})); }
`
  for (const name of ['gh', 'linear-snapshot']) {
    writeFileSync(join(folder, name), binary)
    chmodSync(join(folder, name), 0o700)
  }
  const runner = join(folder, 'runner.ts')
  writeFileSync(
    runner,
    `import {readProviderCommand} from ${JSON.stringify(join(process.cwd(), 'server/providerReads.ts'))};
const fields='number,title,state,isDraft,statusCheckRollup,url';
console.log(JSON.stringify(await readProviderCommand(['gh','api','user','--hostname','github.com','--jq','{login:.login}'])));
console.log(JSON.stringify(await readProviderCommand(['linear-snapshot','--workspace','rbrtbn','LAB-1280'])));
for(const id of [998,999]) { try { await readProviderCommand(['gh','pr','view','https://github.com/rbrtbn/squad/pull/'+id,'--json',fields]); process.exitCode=2; } catch { console.log('bounded'); } }
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
  expect(stderr).toBe('')
  expect(stdout.trim().split('\n')).toEqual([
    '{"ok":true}',
    '{"ok":true}',
    'bounded',
    'bounded',
  ])
  const calls = readFileSync(log, 'utf8')
    .trim()
    .split('\n')
    .map(line => JSON.parse(line))
  expect(calls).toHaveLength(4)
  expect(
    calls.every(
      args =>
        args[0] === 'api' ||
        args[0] === '--workspace' ||
        (args[0] === 'pr' && args[1] === 'view'),
    ),
  ).toBe(true)
}, 12000)
