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

import {
  freezeSubmission,
  questionRevisions,
  recordAnswer,
  sendRequestIdentity,
} from './answerReceipts'
import { publishItem } from './channel'
import { selectSend } from './sendSelection'
import { events, getGrill, loadGrill, snapshot } from './store'

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
  GF_POLL_PROVIDERS: '0',
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
  writeFileSync(
    join(dir, 'herdr-app'),
    `#!${process.execPath}
import { appendFileSync } from 'node:fs'
appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + '\\n')
`,
  )
  chmodSync(join(dir, 'herdr-app'), 0o700)

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
          row: `routing-card/Q${index + 1}`,
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

  it.each([
    { size: 'short', text: 'Short page text.' },
    { size: 'long', text: 'Long page text. '.repeat(230) },
  ])(
    'wraps every terminal path in one page-marked block for $size text',
    async ({ text }) => {
      const fixture = JSON.parse(
        readFileSync('src/fixtures/grill.json', 'utf8'),
      )
      const start = received().length
      for (const stepId of [
        fixture.steps[0].id,
        `part:${fixture.steps[0].part}`,
        'card:routing-card',
        'run',
        'grill-flow',
      ]) {
        await request('events', { kind: 'asked', stepId, text })
      }
      await request('events', { kind: 'noted', question: 'Q1', text })
      await request('send', { questions: ['Q1'], message: text })
      const db = new Database(database)
      const decision = `veto-${text.length}`
      try {
        expect(
          publishItem(db, getGrill(db, 'routing-fixture')!, {
            version: 1,
            kind: 'decision',
            id: decision,
            previous: 0,
            revision: 1,
            session: 'homelab/worker',
            body: text,
            deadline: Date.now() + 60_000,
            affected: [],
            resolution: { state: 'provisional' },
          }).ok,
        ).toBe(true)
      } finally {
        db.close()
      }
      const vetoed = await request('events', {
        kind: 'veto-requested',
        source: 'routing-fixture',
        item: decision,
        revision: 1,
        requestId: decision,
      })
      expect(
        vetoed.decisions.find(
          (entry: { item: { id: string } }) => entry.item.id === decision,
        ).vetoes[0],
      ).toMatchObject({ delivery: 'delivered', acknowledgment: 'none' })
      const calls = received().slice(start)
      expect(calls).toHaveLength(7)
      calls.forEach(call => {
        expect(call).toHaveLength(3)
        expect(call[2].startsWith('<grill-flow source="page">\n')).toBe(true)
        expect(call[2].endsWith('\n</grill-flow>')).toBe(true)
        expect(call[2]).toContain(text.trim())
      })
      const marker = calls[5]![2]!.match(
        /^<grill-flow source="page">\n<gf grill="routing-fixture" send="([1-9][0-9]*)">\n/,
      )
      expect(marker).not.toBeNull()
      const evidence = new Database(database)
      try {
        expect(
          evidence
            .query('SELECT kind, grill_id FROM events WHERE id = ?')
            .get(Number(marker![1])),
        ).toEqual({ kind: 'submitted', grill_id: 'routing-fixture' })
      } finally {
        evidence.close()
      }
      expect(
        calls.filter(call => call[2]?.includes('<gf grill=')),
      ).toHaveLength(1)
    },
  )

  it.each(['Short drawing context.', 'Long drawing context. '.repeat(230)])(
    'delivers a drawing request as one page-marked block at every length',
    async text => {
      const db = new Database(database)
      const fixture = JSON.parse(
        readFileSync('src/fixtures/grill.json', 'utf8'),
      )
      const grill = loadGrill(db, {
        ...fixture,
        id: `drawing-http-${text.length}`,
        session: 'homelab/drawing-owner',
        steps: fixture.steps.slice(0, 1).map((step: { question: object }) => ({
          ...step,
          question: { ...step.question, ask: text },
        })),
      })
      db.close()
      const start = received().length
      const response = await fetch(`${base}/api/grills/${grill.id}/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie, origin: base },
        body: JSON.stringify({
          kind: 'drawing-requested',
          question: 'Q1',
          contextRevision: questionRevisions(grill).Q1,
          previous: 0,
          requestId: `draw-${text.length}`,
        }),
      })
      expect(response.status).toBe(200)
      expect((await response.json()).drawings[0]).toMatchObject({
        source: grill.id,
        question: 'Q1',
        delivery: 'delivered',
        context: { ask: text },
      })
      const calls = received().slice(start)
      expect(calls).toHaveLength(1)
      expect(calls[0]).toHaveLength(3)
      expect(calls[0]?.[1]).toBe('homelab/drawing-owner')
      expect(calls[0]?.[2]).toStartWith('<grill-flow source="page">\n')
      expect(calls[0]?.[2]).toEndWith('\n</grill-flow>')
      expect(calls[0]?.[2]).toContain(text)
    },
  )
})

it('publishes answer revisions, rejects stale choices and exposes an interrupted replay on the page', async () => {
  const db = new Database(database)
  try {
    const fixture = JSON.parse(readFileSync('src/fixtures/grill.json', 'utf8'))
    const grill = loadGrill(db, { ...fixture, id: 'receipt-http-fixture' })
    const body = { requestId: 'interrupted-http', questions: ['Q1'] }
    expect(
      recordAnswer(db, grill, grill, 'Q1', {
        question: 'Q1',
        key: 'a',
        contextRevision: questionRevisions(grill).Q1,
      }).ok,
    ).toBe(true)
    const selection = selectSend(snapshot(db, grill), body)
    if (!selection.ok) throw new Error(selection.error)
    const id = db
      .transaction(() =>
        freezeSubmission(
          db,
          grill,
          grill,
          { Q1: 'Q1' },
          selection,
          sendRequestIdentity(body),
        ),
      )
      .immediate()
    const url = `${base}/api/grills/${grill.id}`
    const state = await fetch(url).then(response => response.json())
    expect(state.questionRevisions.Q1).toBe(questionRevisions(grill).Q1)
    expect(state.unconfirmedSends).toEqual([{ source: grill.id, send: id }])
    const post = (path: string, payload: unknown) =>
      fetch(`${url}/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie, origin: base },
        body: JSON.stringify(payload),
      })
    const before = received().length
    const replay = await post('send', body)
    expect(replay.status).toBe(200)
    expect((await replay.json()).unconfirmedSends).toEqual(
      state.unconfirmedSends,
    )
    expect(received()).toHaveLength(before)
    expect(
      events(db, grill.id).filter(item => item.kind === 'submitted'),
    ).toHaveLength(1)
    expect(
      (await post('send', { ...body, message: 'Changed request' })).status,
    ).toBe(409)
    const changed = loadGrill(db, {
      ...grill,
      steps: grill.steps.map(step => ({
        ...step,
        question: { ...step.question, ask: 'Changed while open?' },
      })),
    })
    const stale = await post('events', {
      kind: 'answered',
      question: 'Q1',
      key: 'b',
      contextRevision: state.questionRevisions.Q1,
    })
    expect(stale.status).toBe(409)
    expect(snapshot(db, changed).answers.Q1).toBe('a')
    const fresh = await post('events', {
      kind: 'answered',
      question: 'Q1',
      key: 'b',
      contextRevision: questionRevisions(changed).Q1,
    })
    expect(fresh.status).toBe(200)
    expect((await fresh.json()).answers.Q1).toBe('b')
    expect(
      (
        await post('events', {
          kind: 'answered',
          question: 'Q1',
          key: 'a',
          contextRevision: 5,
        })
      ).status,
    ).toBe(400)
  } finally {
    db.close()
  }
})

it('uses fixed focus argv from the published owner step without sending its command', async () => {
  const db = new Database(database)
  try {
    expect(
      publishItem(db, getGrill(db, 'routing-fixture')!, {
        version: 1,
        kind: 'owner-step',
        id: 'focus-only',
        previous: 0,
        revision: 1,
        session: 'lead',
        body: 'A typed owner action.',
        host: 'rob-mbp',
        destination: { kind: 'terminal', address: 't42' },
        action: 'never type or paste this',
        urgency: 'soon',
        blockers: [],
        progress: { state: 'open' },
      }).ok,
    ).toBe(true)
    const before = received().length
    const state = await request('events', {
      kind: 'owner-focused',
      source: 'routing-fixture',
      item: 'focus-only',
      revision: 1,
      address: 't99;touch /tmp/unsafe',
      text: 'do not send',
    })
    expect(
      state.ownerSteps.find(
        (entry: { item: { id: string } }) => entry.item.id === 'focus-only',
      ).item.destination,
    ).toEqual({ kind: 'terminal', address: 't42' })
    const calls = readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map(line => JSON.parse(line))
    expect(calls.at(-1)).toEqual(['do', 'agent.focus', '--terminal', 't42'])
    expect(received()).toHaveLength(before)
  } finally {
    db.close()
  }
})
