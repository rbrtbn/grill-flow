import { Database } from 'bun:sqlite'
import { afterAll, beforeAll, expect, it } from 'bun:test'
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

import { type Snapshot, roundSteps } from '../src/domain'
import { grillOnMachine } from './remote'
import { readPage } from './squad'
import { appendEvent, getGrill, loadGrill, squadRegistrations } from './store'

const dir = mkdtempSync(join(tmpdir(), 'squad-composition-'))
const database = join(dir, 'test.sqlite')
const log = join(dir, 'deliveries.jsonl')
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
  GF_DIST: join(dir, 'dist'),
}
const fixture = JSON.parse(readFileSync('src/fixtures/grill.json', 'utf8'))
const source = (id: string, session: string, lead = false) => ({
  ...fixture,
  id,
  session,
  round: 2,
  squad: {
    id: 'squad',
    section: id,
    ...(lead ? { lead: true, openForYou: 'step-q2' } : {}),
  },
  roundNames: { '1': 'Definitions', '2': 'Execution' },
  steps: fixture.steps
    .slice(0, 2)
    .map((step: { question: object }, index: number) => ({
      ...step,
      prose: ['Reference Q1.'],
      question: {
        ...step.question,
        round: index + 1,
        dependsOn: index === 0 ? [] : ['Q1'],
        when: [],
      },
    })),
})
let server: ReturnType<typeof Bun.spawn>
let cookie = ''
let db: Database
const state = async (id = 'squad'): Promise<Snapshot> => {
  const response = await fetch(`${base}/api/grills/${id}`)
  expect(response.status).toBe(200)
  return response.json()
}
const post = async (id: string, endpoint: string, body: unknown) => {
  const response = await fetch(`${base}/api/grills/${id}/${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, origin: base },
    body: JSON.stringify(body),
  })
  expect(response.status).toBe(200)
  return response.json() as Promise<Snapshot>
}
const calls = () =>
  readFileSync(log, 'utf8')
    .trim()
    .split('\n')
    .map(line => JSON.parse(line) as Array<string>)
    .filter(call => call[0] === 'send')
const cli = async (...args: ReadonlyArray<string>) => {
  const child = Bun.spawn([process.execPath, 'server/cli.ts', ...args], {
    env: environment,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [code, text, error] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  expect(error).toBe('')
  expect(code).toBe(0)
  return text
}

beforeAll(async () => {
  mkdirSync(join(dir, 'dist'))
  writeFileSync(
    join(dir, 'dist/index.html'),
    '<html><body>Squad fixture</body></html>',
  )
  writeFileSync(
    join(dir, 'hc'),
    `#!${process.execPath}\nimport {appendFileSync} from 'node:fs'\nappendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2))+'\\n')\nif (process.argv[3]==='homelab/worker') {console.error('offline');process.exit(1)}\n`,
  )
  chmodSync(join(dir, 'hc'), 0o700)
  for (const grill of [
    source('lead-run', 'lead', true),
    grillOnMachine(source('worker-run', 'worker'), 'homelab'),
  ]) {
    const file = join(dir, `${grill.id}.json`)
    writeFileSync(file, JSON.stringify(grill))
    await cli('load', file)
  }
  db = new Database(database)
  db.run('INSERT INTO grill_remotes (grill_id,machine,dir) VALUES (?,?,?)', [
    'worker-run',
    'homelab',
    '/tmp/outbox/worker-run',
  ])
  const started = Bun.spawn([process.execPath, 'server/main.ts'], {
    env: environment,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  server = started
  await started.stdout.getReader().read()
  cookie =
    (await fetch(`${base}/g/squad`)).headers.get('set-cookie')?.split(';')[0] ??
    ''
  expect(cookie).not.toBe('')
})

afterAll(async () => {
  server?.kill()
  if (server) await server.exited
  db?.close()
  rmSync(dir, { recursive: true, force: true })
})

it('composes duplicate local Q1 and Round 1 without collisions and pins the lead step first', async () => {
  const page = await state()
  expect(page.grill.steps.map(step => step.question.id)).toEqual([
    'Q2',
    'Q1',
    'Q3',
    'Q4',
  ])
  expect(page.grill.steps[0]?.id).toBe('lead-run::step-q2')
  expect(
    page.grill.steps.find(step => step.question.id === 'Q4')?.question
      .dependsOn,
  ).toEqual(['Q3'])
  expect(
    page.grill.steps.find(step => step.question.id === 'Q4')?.prose,
  ).toEqual(['Reference Q3.'])
  expect(page.grill.roundSections).toEqual({
    '1': 'lead-run',
    '2': 'lead-run',
    '3': 'worker-run',
    '4': 'worker-run',
  })
  expect(page.grill.roundNumbers).toEqual({ '1': 1, '2': 2, '3': 1, '4': 2 })
  expect(roundSteps(page.grill).map(step => step.question.id)).toEqual([
    'Q2',
    'Q4',
  ])
  const listings = (await (await fetch(`${base}/api/grills`)).json()) as Array<{
    id: string
  }>
  expect(listings.map(row => row.id)).toContain('squad')
  expect((await state('worker-run')).grill.steps[0]?.question.id).toBe('Q1')
})

it('shares source answers, notes, own answers and round renames in both directions', async () => {
  await post('lead-run', 'events', {
    kind: 'answered',
    question: 'Q1',
    key: 'a',
  })
  expect((await state()).answers.Q1).toBe('a')
  await post('squad', 'events', { kind: 'answered', question: 'Q3', key: 'a' })
  await post('squad', 'events', {
    kind: 'noted',
    question: 'Q3',
    text: 'Keep it simple.',
  })
  expect((await state('worker-run')).answers.Q1).toBe('a')
  expect((await state('worker-run')).notes.Q1).toBe('Keep it simple.')
  await post('squad', 'events', {
    kind: 'answered',
    question: 'Q4',
    key: 'other',
    text: 'Q1 stays literal in my answer',
  })
  expect((await state('worker-run')).own.Q2).toBe(
    'Q1 stays literal in my answer',
  )
  expect((await state()).own.Q4).toBe('Q1 stays literal in my answer')
  await post('squad', 'events', {
    kind: 'renamed-round',
    round: 3,
    name: 'Worker foundation',
  })
  expect((await state('worker-run')).grill.roundNames?.['1']).toBe(
    'Worker foundation',
  )
  expect((await state()).grill.roundNames?.['3']).toBe('Worker foundation')
})

it('delivers original IDs and reply commands, preserving failed-source drafts and successful receipts', async () => {
  const page = await state()
  const result = await post('squad', 'send', { questions: ['Q1', 'Q3'] })
  const delivered = calls()
  expect(
    delivered.some(
      call =>
        call[1] === 'lead' &&
        call[2]?.includes('Q1 a') &&
        call[2]?.includes('reply lead-run'),
    ),
  ).toBe(true)
  expect(
    delivered.some(
      call =>
        call[1] === 'homelab/worker' &&
        call[2]?.includes('Q1 a') &&
        !call[2]?.includes('Q3 a') &&
        call[2]?.includes('GF_OUTBOX=/tmp/outbox') &&
        call[2]?.includes('reply worker-run'),
    ),
  ).toBe(true)
  expect(result.sent?.Q1).toBe('Q1 a')
  expect(result.sent?.Q3).toBeUndefined()
  expect(result.sends.at(-1)?.ok).toBe(false)
  expect(result.sends.at(-1)?.detail).toContain('homelab/worker')
  expect(result.sends.at(-1)?.detail).toContain('lead')
  expect(result.answers).toEqual(page.answers)
})

it('routes scoped discussions and revisions to canonical ask IDs and source steps', async () => {
  await post('squad', 'events', {
    kind: 'asked',
    stepId: 'worker-run::step-q1',
    text: 'Explain this.',
  })
  const local = await state('worker-run')
  const ask = local.asks.at(-1)!
  expect(ask.stepId).toBe('step-q1')
  expect(calls().at(-1)?.[2]).toContain(
    `revise worker-run step-q1 --ask ${ask.id}`,
  )
  const file = join(dir, 'reply.txt')
  writeFileSync(file, 'A clearer explanation of Q1.')
  await cli(
    'revise',
    'worker-run',
    'step-q1',
    '--ask',
    String(ask.id),
    '--kind',
    'comment',
    '--file',
    file,
  )
  const merged = await state()
  expect(merged.asks.find(item => item.id === ask.id)?.answered).toBe(true)
  expect(merged.revisions.at(-1)?.text).toBe('A clearer explanation of Q3.')
  expect(merged.revisions.at(-1)?.stepId).toBe('worker-run::step-q1')
  await post('squad', 'events', {
    kind: 'asked',
    stepId: 'run',
    text: 'How is the squad?',
  })
  const whole = (await state()).asks.at(-1)!
  expect(calls().at(-1)?.[1]).toBe('lead')
  await cli(
    'revise',
    'squad',
    'run',
    '--ask',
    String(whole.id),
    '--kind',
    'comment',
    '--file',
    file,
  )
  expect(
    (await state()).asks.find(item => item.id === whole.id)?.answered,
  ).toBe(true)
})

it('retains shared mappings and source history when a member reloads, disappears or adds questions', async () => {
  const before = squadRegistrations(db, 'squad')
  const local = getGrill(db, 'worker-run')!
  loadGrill(db, { ...local, steps: local.steps.slice(1) })
  loadGrill(db, local)
  expect(squadRegistrations(db, 'squad')).toEqual(before)
  expect(readPage(db, 'squad')?.state.answers.Q3).toBe('a')
  const added = {
    ...local.steps[0]!,
    id: 'new-step',
    question: { ...local.steps[0]!.question, id: 'Q9' },
  }
  loadGrill(db, { ...local, steps: [...local.steps, added] })
  expect(
    squadRegistrations(db, 'squad').find(
      member => member.source === 'worker-run',
    )?.questions,
  ).toMatchObject({ Q1: 'Q3', Q2: 'Q4', Q9: 'Q5' })
  expect(() => loadGrill(db, { ...local, id: 'squad' })).toThrow()
  expect(() =>
    loadGrill(db, { ...local, squad: { ...local.squad!, lead: true } }),
  ).toThrow()
})

it('includes a saved pick removed before joining and sends it using the original ID', async () => {
  appendEvent(db, 'legacy-run', 'answered', { question: 'Q99', key: 'b' })
  loadGrill(db, source('legacy-run', 'legacy'))
  const registration = squadRegistrations(db, 'squad').find(
    member => member.source === 'legacy-run',
  )!
  const id = registration.questions.Q99!
  expect((await state()).answers[id]).toBe('b')
  const delivered = await post('squad', 'send', { questions: [id] })
  expect(calls().at(-1)?.[2]).toContain('Q99 b')
  expect(delivered.sent?.[id]).toBe(`${id} b`)
})

it('allocates distinct stable numbers when two independent agents load concurrently', async () => {
  const files = ['concurrent-a', 'concurrent-b'].map(id => {
    const file = join(dir, `${id}.json`)
    writeFileSync(file, JSON.stringify(source(id, id)))
    return file
  })
  await Promise.all(files.map(file => cli('load', file)))
  const values = squadRegistrations(db, 'squad').flatMap(member =>
    Object.values(member.questions),
  )
  expect(new Set(values).size).toBe(values.length)
})

it('keeps the lead first and remaps plan gates when the lead joins after a worker', () => {
  const worker = source('early-worker', 'worker')
  loadGrill(db, { ...worker, squad: { ...worker.squad, id: 'late-lead' } })
  const lead = source('late-owner', 'lead', true)
  loadGrill(db, {
    ...lead,
    squad: { ...lead.squad, id: 'late-lead' },
    plan: {
      issues: [{ id: 'task', title: 'Task', phase: 'gated', start: ['Q1'] }],
    },
  })
  const page = readPage(db, 'late-lead')!
  expect(page.state.grill.steps[0]?.id).toBe('late-owner::step-q2')
  expect(page.state.grill.plan?.issues[0]?.start).toEqual(['Q3'])
})
