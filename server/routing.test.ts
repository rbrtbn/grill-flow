import { Database } from 'bun:sqlite'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'grill-routing-'))
const log = join(dir, 'deliveries.jsonl')
const database = join(dir, 'test.sqlite')
const probe = Bun.serve({ port: 0, fetch: () => new Response('reserved') })
const port = probe.port
probe.stop(true)
const base = `http://127.0.0.1:${port}`
const environment = {
  ...process.env,
  PATH: `${dir}:${process.env.PATH}`,
  GF_DB: database,
  GF_PORT: String(port),
  GF_PREVIEW: '0',
  GF_POLL_REMOTES: '0',
  GF_SESSION: undefined,
  GF_MAINTAINER_SESSION: 'maintainer',
  GF_DIST: join(dir, 'dist'),
}
let server: ReturnType<typeof Bun.spawn>
let cookie = ''
const request = async (path: string, body: unknown) => {
  const response = await fetch(`${base}/api/grills/routing-fixture/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, origin: base },
    body: JSON.stringify(body),
  })
  expect(response.status).toBe(200)
  return response.json()
}
const received = (): Array<[string, string, string]> =>
  readFileSync(log, 'utf8')
    .trim()
    .split('\n')
    .map(line => JSON.parse(line))
    .filter(call => call[0] === 'send')

beforeAll(async () => {
  mkdirSync(join(dir, 'dist'))
  writeFileSync(
    join(dir, 'dist/index.html'),
    '<html><body>Routing fixture</body></html>',
  )
  writeFileSync(
    join(dir, 'hc'),
    `#!${process.execPath}
import { appendFileSync } from 'node:fs'
appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + '\\n')
if (process.argv[3] === 'failed-worker') { console.error('worker unavailable'); process.exit(1) }
`,
  )
  chmodSync(join(dir, 'hc'), 0o700)
  const fixture = JSON.parse(readFileSync('src/fixtures/grill.json', 'utf8'))
  const grill = {
    ...fixture,
    id: 'routing-fixture',
    session: 'lead',
    steps: fixture.steps
      .slice(0, 3)
      .map((step: { question: object }, index: number) => ({
        ...step,
        question: {
          ...step.question,
          ...(index === 0
            ? { session: 'homelab/worker' }
            : index === 2
              ? { session: 'failed-worker' }
              : {}),
        },
      })),
  }
  const file = join(dir, 'grill.json')
  writeFileSync(file, JSON.stringify(grill))
  const load = Bun.spawn([process.execPath, 'server/cli.ts', 'load', file], {
    env: environment,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  expect(await load.exited).toBe(0)
  const db = new Database(database)
  db.run(
    'INSERT INTO grill_remotes (grill_id, machine, dir) VALUES (?, ?, ?)',
    ['routing-fixture', 'homelab', '/tmp/outbox/routing-fixture'],
  )
  db.close()
  const started = Bun.spawn([process.execPath, 'server/main.ts'], {
    env: environment,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  server = started
  await started.stdout.getReader().read()
  const response = await fetch(`${base}/g/routing-fixture`)
  cookie = response.headers.get('set-cookie')?.split(';')[0] ?? ''
  expect(cookie).not.toBe('')
})

afterAll(async () => {
  server?.kill()
  if (server) {
    await server.exited
  }
  rmSync(dir, { recursive: true, force: true })
})

describe('HTTP delivery routing', () => {
  it('reaches each named recipient through hc and leaves a failed answer unsent', async () => {
    await request('events', { kind: 'answered', question: 'Q1', key: 'a' })
    await request('events', { kind: 'answered', question: 'Q2', key: 'b' })
    await request('events', { kind: 'answered', question: 'Q3', key: 'a' })
    const state = await request('send', { questions: ['Q1', 'Q2', 'Q3'] })
    const calls = received()
    expect(calls).toHaveLength(3)
    expect(calls.find(call => call[1] === 'homelab/worker')?.[2]).toContain(
      'Q1 a',
    )
    expect(calls.find(call => call[1] === 'homelab/worker')?.[2]).not.toContain(
      'Q2 b',
    )
    expect(calls.find(call => call[1] === 'lead')?.[2]).toContain('Q2 b')
    expect(calls.find(call => call[1] === 'lead')?.[2]).not.toContain('Q1 a')
    expect(calls.find(call => call[1] === 'homelab/worker')?.[2]).toContain(
      'GF_OUTBOX=/tmp/outbox',
    )
    expect(calls.find(call => call[1] === 'lead')?.[2]).not.toContain(
      'GF_OUTBOX',
    )
    expect(state.sent).toEqual({ Q1: 'Q1 a', Q2: 'Q2 b' })
    expect(state.sends.at(-1).ok).toBe(false)
    await request('send', { questions: ['Q1', 'Q2', 'Q3'] })
    expect(
      received()
        .slice(3)
        .map(call => call[1]),
    ).toEqual(['failed-worker'])
  })

  it('saves round names through the page event endpoint', async () => {
    const state = await request('events', {
      kind: 'renamed-round',
      round: 1,
      name: '  Stage definitions  ',
    })
    expect(state.grill.roundNames['1']).toBe('Stage definitions')
    const invalid = await fetch(`${base}/api/grills/routing-fixture/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, origin: base },
      body: JSON.stringify({
        kind: 'renamed-round',
        round: 999,
        name: 'Missing',
      }),
    })
    expect(invalid.status).toBe(400)
  })

  it('routes question asks, whole-run asks and grill-flow asks independently', async () => {
    const fixture = JSON.parse(readFileSync('src/fixtures/grill.json', 'utf8'))
    await request('events', {
      kind: 'asked',
      stepId: fixture.steps[0].id,
      text: 'Explain the choice.',
    })
    await request('events', {
      kind: 'asked',
      stepId: 'run',
      text: 'What is next?',
    })
    const state = await request('events', {
      kind: 'asked',
      stepId: 'grill-flow',
      text: 'Improve this page.',
    })
    const calls = received().slice(-3)
    expect(calls.map(call => call[1])).toEqual([
      'homelab/worker',
      'lead',
      'maintainer',
    ])
    expect(calls[2]?.[2]).toContain('about grill-flow')
    expect(calls[2]?.[2]).toContain('grill-flow --ask')
    expect(calls[2]?.[2]).toContain('--kind comment')
    expect(calls[2]?.[2]).not.toContain('GF_OUTBOX')
    expect(state.maintainerSession).toBe('maintainer')
  })
})
