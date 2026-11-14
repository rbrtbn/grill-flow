import { Database } from 'bun:sqlite'
import { afterAll, beforeAll, expect, it } from 'bun:test'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type Snapshot, type Step, roundSteps } from '../src/domain'
import { questionRevisions, recordAnswer } from './answerReceipts'
import { SKILL_REVISION, isAuthoringCommand, needsReason } from './authoring'
import { publishUpdate } from './channel'
import { grillOnMachine } from './remote'
import { selectSend } from './sendSelection'
import { readPage, sendPageAnswers } from './squad'
import {
  appendEvent,
  getGrill,
  loadGrill,
  retireGrill,
  snapshot,
  squadRegistrations,
} from './store'

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
  GF_POLL_PROVIDERS: '0',
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
  const child = Bun.spawn(
    [
      process.execPath,
      'server/cli.ts',
      ...args,
      ...(isAuthoringCommand(args[0])
        ? ['--skill-revision', String(SKILL_REVISION)]
        : []),
      ...(needsReason(args[0], args) ? ['--reason', 'test write'] : []),
      // Every load here creates its grill.
      ...(args[0] === 'load' ? ['--expect-rev', '0'] : []),
    ],
    {
      env: environment,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
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
  expect(merged.discussions?.Q3).toMatchObject({
    target: 'worker-run::step-q1',
    asks: 1,
    replies: 1,
    open: 0,
    firstAskId: ask.id,
  })
  expect((await state('worker-run')).discussions?.Q1?.target).toBe('step-q1')
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
  const answered = await state()
  expect(answered.asks.find(item => item.id === whole.id)?.answered).toBe(true)
  expect(answered.discussions?.run).toMatchObject({ target: 'run', open: 0 })

  const out = join(dir, 'squad-export.json')
  await cli('export', 'squad', '--out', out)
  const exported = JSON.parse(readFileSync(out, 'utf8'))
  expect(exported.kind).toBe('squad')
  expect(
    exported.page.mapping.find(
      (entry: { grill: string }) => entry.grill === 'worker-run',
    ).questions,
  ).toMatchObject({ Q1: 'Q3' })
  expect(exported.page.discussions.run.asks[0]).toMatchObject({
    id: whole.id,
    answered: true,
  })
  const worker = exported.members.find(
    (member: { id: string }) => member.id === 'worker-run',
  )
  expect(worker.discussions.Q1.asks[0]).toMatchObject({
    id: ask.id,
    text: 'Explain this.',
    replies: [{ kind: 'comment', text: 'A clearer explanation of Q1.' }],
  })
  expect(worker.revisions.length).toBeGreaterThan(0)
})

it('retains shared mappings and source history when a member reloads, disappears or adds questions', async () => {
  const before = squadRegistrations(db, 'squad')
  const local = getGrill(db, 'worker-run')!
  expect(() =>
    loadGrill(db, { ...local, steps: local.steps.slice(1) }),
  ).toThrow('Reload refused')
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

it('lists every joined member explicitly in the CLI summary, including current-round-only members', async () => {
  const text = await cli('state', 'squad')
  expect(text).toContain('lead-run (lead-run, lead)')
  expect(text).toContain('worker-run (worker-run, homelab/worker)')
})

it('preserves sent receipts and references for member question IDs that are not Q numbers', async () => {
  const member = source('custom-ids', 'custom')
  const local = loadGrill(db, {
    ...member,
    steps: member.steps.map((step: Step, index: number) => ({
      ...step,
      prose: ['Compare grant-1 and S1.'],
      question: {
        ...step.question,
        id: index === 0 ? 'grant-1' : 'S1',
        dependsOn: index === 0 ? [] : ['grant-1'],
      },
    })),
  })
  await post(local.id, 'events', {
    kind: 'answered',
    question: 'grant-1',
    key: 'a',
  })
  await post(local.id, 'events', { kind: 'answered', question: 'S1', key: 'b' })
  await post(local.id, 'send', { questions: ['grant-1', 'S1'] })
  const registration = squadRegistrations(db, 'squad').find(
    member => member.source === local.id,
  )!
  const merged = await state()
  expect(merged.sent?.[registration.questions['grant-1']!]).toBe(
    `${registration.questions['grant-1']} a`,
  )
  expect(merged.sent?.[registration.questions.S1!]).toBe(
    `${registration.questions.S1} b`,
  )
  expect(
    merged.grill.steps.find(step => step.id === 'custom-ids::step-q1')?.prose,
  ).toEqual([
    `Compare ${registration.questions['grant-1']} and ${registration.questions.S1}.`,
  ])
})

it('projects updates and immutable answer history and resolves canonical source links through HTTP', async () => {
  const grill = loadGrill(db, source('channel-source', 'channel-worker'))
  const before = await state()
  const visible = Object.entries(before.questionOrigins ?? {}).find(
    ([, origin]) => origin.grill === grill.id && origin.question === 'Q1',
  )?.[0]
  expect(visible).toBeDefined()
  const item = {
    version: 1,
    kind: 'update',
    id: 'progress',
    previous: 0,
    revision: 1,
    session: 'channel-worker',
    body: 'Progress on Q1.',
    question: 'Q1',
  }
  expect(publishUpdate(db, grill, item).ok).toBe(true)
  const updated = await state()
  const update = updated.updates?.find(entry => entry.source === grill.id)
  expect(update?.item.body).toBe('Progress on Q1.')
  expect(update?.displayBody).toBe(`Progress on ${visible}.`)
  expect(updated.grill.steps).toHaveLength(before.grill.steps.length)
  expect(updated.answers).toEqual(before.answers)
  expect(updated.sends).toEqual(before.sends)
  const qualified = `${base}/g/squad/question/Q1?source=${grill.id}`
  const resolved = await fetch(qualified, { redirect: 'manual' })
  expect(resolved.status).toBe(302)
  expect(resolved.headers.get('location')).toBe(`/g/squad/question/${visible}`)
  expect(
    (
      await fetch(`${base}/g/squad/question/Q1?source=unknown`, {
        redirect: 'manual',
      })
    ).status,
  ).toBe(404)
  expect(
    (
      await fetch(`${base}/g/squad/question/Q999?source=${grill.id}`, {
        redirect: 'manual',
      })
    ).status,
  ).toBe(404)
  expect(
    recordAnswer(db, grill, updated.grill, visible!, {
      question: 'Q1',
      key: 'a',
      contextRevision: updated.questionRevisions?.[visible!],
    }).ok,
  ).toBe(true)
  const selected = selectSend(snapshot(db, grill), { questions: ['Q1'] })
  if (!selected.ok) throw new Error(selected.error)
  await sendPageAnswers(
    db,
    readPage(db, grill.id)!,
    selected,
    async () => ({ ok: true, detail: 'Mocked history transport' }),
    () => 'gf',
  )
  const legacy = appendEvent(db, grill.id, 'sent', {
    ok: true,
    what: 'answers',
    lines: { Q1: 'Q1 old receipt' },
  })
  loadGrill(db, {
    ...grill,
    steps: grill.steps.map(step => ({
      ...step,
      question: { ...step.question, ask: 'New wording after Send' },
    })),
  })
  const history =
    (await state()).answerHistory?.filter(entry => entry.source === grill.id) ??
    []
  expect(history).toHaveLength(2)
  const captured = history.find(entry => entry.submission !== null)
  expect(captured?.answers[0]?.context?.ask).toBe(
    updated.grill.steps.find(step => step.question.id === visible)!.question
      .ask,
  )
  expect(captured?.answers[0]?.context?.displayQuestion).toBe(visible!)
  expect(captured?.state).toBe('delivered')
  expect(history.find(entry => entry.event === legacy)).toMatchObject({
    submission: null,
    answers: [],
    legacyLines: { Q1: 'Q1 old receipt' },
  })
  retireGrill(db, grill, 'Source finished')
  const retired = await fetch(qualified, { redirect: 'manual' })
  expect(retired.status).toBe(302)
  expect(retired.headers.get('location')).toBe(`/g/${grill.id}/question/Q1`)
  expect(
    (await state()).updates?.some(entry => entry.source === grill.id),
  ).toBe(false)
  expect(
    (await state(grill.id)).updates?.find(entry => entry.source === grill.id)
      ?.item.body,
  ).toBe('Progress on Q1.')
})

it('hands the page to a new lead so run asks and old-lead questions reach it', async () => {
  const moved = await cli(
    'handover',
    'squad',
    '--session',
    'new-lead',
    '--reason',
    'lead recycled',
  )
  expect(moved).toContain(
    'lead is now new-lead; deliveries to lead go to new-lead',
  )
  expect((await state()).grill.session).toBe('new-lead')
  await post('squad', 'events', { kind: 'asked', stepId: 'run', text: 'Next?' })
  expect(calls().at(-1)?.[1]).toBe('new-lead')
  await post('squad', 'events', {
    kind: 'asked',
    stepId: 'lead-run::step-q1',
    text: 'Still open?',
  })
  expect(calls().at(-1)?.[1]).toBe('new-lead')
  await cli('handover', 'squad', '--session', 'lead', '--reason', 'lead back')
  await post('squad', 'events', {
    kind: 'asked',
    stepId: 'lead-run::step-q1',
    text: 'Back with you?',
  })
  expect(calls().at(-1)?.[1]).toBe('lead')
})

it('joins the GF_SQUAD page on load unless --solo', async () => {
  const load = async (id: string, ...flags: ReadonlyArray<string>) => {
    const { squad: _squad, ...plain } = source(id, 'helper')
    const file = join(dir, `${id}.json`)
    writeFileSync(file, JSON.stringify(plain))
    const child = Bun.spawn(
      [
        process.execPath,
        'server/cli.ts',
        'load',
        file,
        ...flags,
        '--skill-revision',
        String(SKILL_REVISION),
      ],
      {
        env: { ...environment, GF_SQUAD: 'squad', HC_TERMINAL_ID: '' },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )
    const [code, text] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
    ])
    expect(code).toBe(0)
    return text
  }
  expect(await load('helper-run')).toContain('joining the squad page')
  expect(getGrill(db, 'helper-run')?.squad).toEqual({
    id: 'squad',
    section: fixture.title,
  })
  await load('solo-run', '--solo')
  expect(getGrill(db, 'solo-run')?.squad).toBeUndefined()
})
