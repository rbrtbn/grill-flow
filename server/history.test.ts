import { Database } from 'bun:sqlite'
import { afterEach, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Grill } from '../src/domain'
import { questionRevisions, recordAnswer } from './answerReceipts'
import { SKILL_REVISION, authoringBody, queuedProvenance } from './authoring'
import { publishItem } from './channel'
import {
  currentRev,
  fieldChanges,
  grillRevisions,
  questionHistory,
} from './history'
import { readPage } from './squad'
import { events, getGrill, loadGrill, snapshot } from './store'

const fixture: Grill = JSON.parse(
  readFileSync('src/fixtures/grill.json', 'utf8'),
)
const databases = new Set<Database>()
const folders = new Set<string>()
afterEach(() => {
  databases.forEach(db => db.close())
  folders.forEach(path => rmSync(path, { recursive: true, force: true }))
  databases.clear()
  folders.clear()
})
const folder = () => {
  const path = mkdtempSync(join(tmpdir(), 'grill-history-'))
  folders.add(path)
  return path
}
const database = () => {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE grills (id TEXT PRIMARY KEY, json TEXT, loaded_at INTEGER);
    CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, grill_id TEXT, at INTEGER, kind TEXT, payload TEXT);`)
  databases.add(db)
  return db
}
const pick = (db: Database, grill: Grill, question = 'Q1') =>
  expect(
    recordAnswer(db, grill, grill, question, {
      question,
      key: 'a',
      text: '',
      contextRevision: questionRevisions(grill)[question]!,
    }).ok,
  ).toBe(true)
const withoutQ1 = (grill: Grill, decided: Grill['decided']): Grill => ({
  ...grill,
  steps: grill.steps.filter(step => step.question.id !== 'Q1'),
  ...(decided === undefined ? {} : { decided }),
})
const rows = (db: Database) =>
  JSON.stringify(db.query('SELECT * FROM grill_revisions').all())

it('records each load as the next revision with its author, reason and parent', () => {
  const db = database()
  loadGrill(db, fixture, { author: 't1', reason: 'first round' })
  loadGrill(
    db,
    { ...fixture, title: 'Renamed' },
    { author: 'homelab/t2', reason: 'renamed' },
  )
  expect(currentRev(db, fixture.id)).toBe(2)
  expect(
    grillRevisions(db, fixture.id).map(
      ({ rev, author, reason, parentRev, grill }) => ({
        rev,
        author,
        reason,
        parentRev,
        title: grill.title,
      }),
    ),
  ).toEqual([
    {
      rev: 1,
      author: 't1',
      reason: 'first round',
      parentRev: null,
      title: fixture.title,
    },
    {
      rev: 2,
      author: 'homelab/t2',
      reason: 'renamed',
      parentRev: 1,
      title: 'Renamed',
    },
  ])
  const loaded = events(db, fixture.id).filter(row => row.kind === 'loaded')
  expect(JSON.parse(loaded[1]!.payload)).toMatchObject({
    rev: 2,
    reason: 'renamed',
    author: 'homelab/t2',
  })
  expect(currentRev(db, 'unknown')).toBe(0)
})

it('keeps a grill stored before history as rev 1 on its next load, not before', () => {
  const db = database()
  const stored = JSON.stringify({ ...fixture, title: 'Stored earlier' })
  db.run('INSERT INTO grills (id, json, loaded_at) VALUES (?, ?, ?)', [
    fixture.id,
    stored,
    1234,
  ])
  expect(currentRev(db, fixture.id)).toBe(0)
  loadGrill(db, fixture, { author: 't1', reason: 'next round' })
  const [first, second] = grillRevisions(db, fixture.id)
  expect(first).toMatchObject({ rev: 1, at: 1234, author: '', reason: '' })
  expect(first!.parentRev).toBeNull()
  expect(first!.grill.title).toBe('Stored earlier')
  expect(second).toMatchObject({ rev: 2, parentRev: 1, reason: 'next round' })
})

it('writes no revision for a refused load', () => {
  const db = database()
  const grill = loadGrill(db, fixture)
  pick(db, grill)
  const before = rows(db)
  expect(() => loadGrill(db, withoutQ1(grill, undefined))).toThrow(
    'Reload refused',
  )
  expect(rows(db)).toBe(before)
  expect(currentRev(db, grill.id)).toBe(1)
})

it('keeps revision history out of page snapshots', () => {
  const db = database()
  const grill = loadGrill(db, fixture, { author: '', reason: 'load' })
  db.exec('DROP TABLE grill_revisions')
  expect(snapshot(db, grill).grill.id).toBe(grill.id)
  expect(readPage(db, grill.id)?.state.grill.id).toBe(grill.id)
})

it('keeps a decided outcome when a later load omits it', () => {
  const db = database()
  const grill = loadGrill(db, fixture)
  pick(db, grill)
  loadGrill(db, withoutQ1(grill, [{ id: 'Q1', text: 'Chose a' }]))
  const omitted = loadGrill(db, withoutQ1(grill, undefined))
  expect(omitted.decided).toBeUndefined()
  expect(getGrill(db, grill.id)?.decided).toBeUndefined()
  expect(snapshot(db, omitted).grill.decided).toEqual([
    { id: 'Q1', text: 'Chose a' },
  ])
  loadGrill(
    db,
    withoutQ1(grill, [
      { id: 'Q2', text: 'Settled elsewhere' },
      { id: 'Q1', text: 'Chose a' },
    ]),
  )
  const reworded = loadGrill(
    db,
    withoutQ1(grill, [{ id: 'Q1', text: 'Chose a, then b' }]),
  )
  expect(snapshot(db, reworded).grill.decided).toEqual([
    { id: 'Q1', text: 'Chose a, then b' },
    { id: 'Q2', text: 'Settled elsewhere' },
  ])
  expect(
    events(db, grill.id)
      .filter(row => row.kind === 'resolved')
      .map(row => JSON.parse(row.payload)),
  ).toEqual([
    { id: 'Q1', text: 'Chose a' },
    { id: 'Q2', text: 'Settled elsewhere' },
    { id: 'Q1', text: 'Chose a, then b' },
  ])
})

it('records outcomes a grill held before outcome events existed', () => {
  const db = database()
  db.run('INSERT INTO grills (id, json, loaded_at) VALUES (?, ?, ?)', [
    fixture.id,
    JSON.stringify({ ...fixture, decided: [{ id: 'Q0', text: 'Earlier' }] }),
    1,
  ])
  const grill = loadGrill(db, fixture)
  expect(snapshot(db, grill).grill.decided).toEqual([
    { id: 'Q0', text: 'Earlier' },
  ])
  expect(snapshot(db, { ...grill, decided: [] }).grill.decided).toEqual([
    { id: 'Q0', text: 'Earlier' },
  ])
})

it('leaves a grill without outcomes without a decided list', () => {
  const db = database()
  const grill = loadGrill(db, fixture)
  expect('decided' in snapshot(db, grill).grill).toBe(false)
  loadGrill(db, { ...fixture, decided: [{ id: 'Q9', text: '  ' }] })
  expect(events(db, grill.id).some(row => row.kind === 'resolved')).toBe(false)
})

it('keeps picked-key protection for a question that remains after its outcome is recorded', () => {
  const db = database()
  const grill = loadGrill(db, fixture)
  pick(db, grill)
  loadGrill(db, { ...grill, decided: [{ id: 'Q1', text: 'Partly settled' }] })
  expect(() => loadGrill(db, withoutQ1(grill, undefined))).toThrow(
    'without a nonblank decided outcome',
  )
})

it('diffs fields structurally, options by key', () => {
  expect(
    fieldChanges(
      {
        title: 'Old',
        prose: ['a'],
        options: [
          { key: 'a', label: 'A', recommended: true },
          { key: 'b', label: 'B', recommended: false },
        ],
      },
      {
        title: 'New',
        prose: ['a'],
        ask: 'Which?',
        options: [
          { key: 'b', label: 'B', recommended: true },
          { key: 'c', label: 'C', recommended: false },
        ],
      },
    ),
  ).toEqual([
    { field: 'title', change: 'changed', before: 'Old', after: 'New' },
    {
      field: 'options[a]',
      change: 'removed',
      before: { key: 'a', label: 'A', recommended: true },
    },
    {
      field: 'options[b].recommended',
      change: 'changed',
      before: false,
      after: true,
    },
    {
      field: 'options[c]',
      change: 'added',
      after: { key: 'c', label: 'C', recommended: false },
    },
    { field: 'ask', change: 'added', after: 'Which?' },
  ])
  expect(fieldChanges(['x'], ['y'], 'prose')).toEqual([
    { field: 'prose', change: 'changed', before: ['x'], after: ['y'] },
  ])
})

it('lists the revisions where one question changed, with what changed', () => {
  const db = database()
  const grill = loadGrill(db, fixture, { author: 't1', reason: 'round 1' })
  loadGrill(
    db,
    { ...grill, title: 'Only the grill title' },
    { author: 't1', reason: 'title' },
  )
  const reworded = {
    ...grill,
    steps: grill.steps.map(step =>
      step.question.id === 'Q1'
        ? {
            ...step,
            prose: ['New reasoning.'],
            question: { ...step.question, ask: 'Reworded?' },
          }
        : step,
    ),
  }
  loadGrill(db, reworded, { author: 't2', reason: 'reworded Q1' })
  loadGrill(db, withoutQ1(reworded, [{ id: 'Q1', text: 'Done' }]), {
    author: 't2',
    reason: 'resolved Q1',
  })
  const changes = questionHistory(grillRevisions(db, grill.id), 'Q1')
  expect(changes.map(change => [change.rev, change.change])).toEqual([
    [1, 'added'],
    [3, 'changed'],
    [4, 'changed'],
  ])
  expect(changes[1]!.reason).toBe('reworded Q1')
  expect(changes[1]!.fields.map(field => field.field)).toEqual(['prose', 'ask'])
  expect(changes[2]!.fields.map(field => [field.field, field.change])).toEqual(
    expect.arrayContaining([
      ['ask', 'removed'],
      ['decided', 'added'],
    ]),
  )
  expect(
    questionHistory(grillRevisions(db, grill.id), 'step-q1').length,
  ).toBeGreaterThan(0)
  const untouched = questionHistory(grillRevisions(db, grill.id), 'Q2')
  expect(untouched.map(change => change.change)).toEqual(['added'])
})

it('keeps write metadata out of queued body identity and reads it back', () => {
  const stamped = {
    id: 'x',
    skillRevision: SKILL_REVISION,
    writeReason: 'why',
    writeAuthor: 't9',
  }
  expect(authoringBody(stamped)).toEqual({ id: 'x' })
  expect(queuedProvenance(stamped)).toEqual({ author: 't9', reason: 'why' })
  expect(queuedProvenance({ writeReason: 3 })).toEqual({
    author: '',
    reason: '',
  })
})

it('stores an item write reason beside the item without changing its replay identity', () => {
  const db = database()
  const grill = loadGrill(db, fixture)
  const item = {
    version: 1,
    kind: 'update',
    id: 'status',
    previous: 0,
    revision: 1,
    session: 't1',
    body: 'Started.',
  }
  const first = publishItem(db, grill, item, Date.now(), 'kick-off')
  expect(first.ok).toBe(true)
  const published = events(db, grill.id).find(
    row => row.kind === 'item-published',
  )!
  expect(JSON.parse(published.payload).writeReason).toBe('kick-off')
  expect(publishItem(db, grill, item, Date.now(), 'retry')).toEqual(first)
})

const run = async (
  dir: string,
  args: ReadonlyArray<string>,
  env: Record<string, string | undefined> = {},
) => {
  const child = Bun.spawn([process.execPath, 'server/cli.ts', ...args], {
    env: {
      ...process.env,
      GF_DB: join(dir, 'test.sqlite'),
      GF_OUTBOX: undefined,
      GF_SQUAD: undefined,
      GF_REQUIRE_REASON: undefined,
      HC_TERMINAL_ID: 't7',
      ...env,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [code, out, error] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { code, out, error }
}

it('gf load takes --reason and --session, and gf history reports them', async () => {
  const dir = folder()
  const file = join(dir, 'grill.json')
  const skill = ['--skill-revision', String(SKILL_REVISION)]
  writeFileSync(file, JSON.stringify(fixture))
  const first = await run(dir, ['load', file, '--reason', 'round 1', ...skill])
  expect(first).toMatchObject({ code: 0, error: '' })
  expect(first.out).toContain('(rev 1)')
  writeFileSync(
    file,
    JSON.stringify({
      ...fixture,
      steps: fixture.steps.map(step =>
        step.question.id === 'Q2'
          ? { ...step, question: { ...step.question, title: 'Retitled' } }
          : step,
      ),
    }),
  )
  const second = await run(dir, ['load', file, ...skill, '--session', 'lead'])
  expect(second.code).toBe(0)
  expect(second.error).toContain('Write reason missing')
  expect(second.error).toContain('--reason')

  const listed = await run(dir, ['history', fixture.id])
  expect(listed.code).toBe(0)
  const lines = listed.out.trim().split('\n')
  expect(lines[0]).toMatch(/^rev 1 {2}\S+Z {2}t7 {2}round 1$/)
  expect(lines[1]).toMatch(/^rev 2 {2}\S+Z {2}lead {2}\(no reason given\)$/)

  const json = JSON.parse(
    (await run(dir, ['history', fixture.id, '--json'])).out,
  )
  expect(
    json.map((row: { rev: number; author: string; reason: string }) => [
      row.rev,
      row.author,
      row.reason,
    ]),
  ).toEqual([
    [1, 't7', 'round 1'],
    [2, 'lead', ''],
  ])
  expect(json[0].grill).toBeUndefined()

  const question = await run(dir, ['history', fixture.id, 'Q2'])
  expect(question.out).toContain('[changed]')
  expect(question.out).toContain('~ title: ')
  expect(question.out).toContain('-> "Retitled"')
  const questionJson = JSON.parse(
    (await run(dir, ['history', fixture.id, 'Q2', '--json'])).out,
  )
  expect(questionJson.changes[1].fields).toEqual([
    {
      field: 'title',
      change: 'changed',
      before: fixture.steps[1]!.question.title,
      after: 'Retitled',
    },
  ])

  expect((await run(dir, ['history', 'missing'])).code).toBe(2)
})

it('warns only on writes that need a reason, and refuses them once required', async () => {
  const dir = folder()
  const file = join(dir, 'grill.json')
  const prose = join(dir, 'prose.txt')
  writeFileSync(file, JSON.stringify(fixture))
  writeFileSync(prose, 'A comment.')
  const skill = ['--skill-revision', String(SKILL_REVISION)]
  expect(
    (await run(dir, ['load', file, '--reason', 'start', ...skill])).code,
  ).toBe(0)
  const comment = await run(dir, [
    'revise',
    fixture.id,
    'step-q1',
    '--kind',
    'comment',
    '--file',
    prose,
    ...skill,
  ])
  expect(comment).toMatchObject({ code: 0, error: '' })
  const rewrite = await run(dir, [
    'revise',
    fixture.id,
    'step-q1',
    '--file',
    prose,
    ...skill,
  ])
  expect(rewrite.code).toBe(0)
  expect(rewrite.error).toContain('Write reason missing')

  const refused = await run(dir, ['load', file, ...skill], {
    GF_REQUIRE_REASON: '1',
  })
  expect(refused.code).toBe(2)
  expect(refused.error).toContain('GF_REQUIRE_REASON=1 refuses')
  const reasoned = await run(
    dir,
    [
      'revise',
      fixture.id,
      'step-q1',
      '--file',
      prose,
      '--reason',
      'clearer',
      ...skill,
    ],
    { GF_REQUIRE_REASON: '1' },
  )
  expect(reasoned).toMatchObject({ code: 0, error: '' })

  const retired = await run(dir, ['retire', fixture.id, '--reason', 'pause'])
  expect(retired.code).toBe(0)
  const restored = await run(dir, [
    'restore',
    fixture.id,
    '--reason',
    'back on',
  ])
  expect(restored).toMatchObject({ code: 0, error: '' })

  const log = (await run(dir, ['events', fixture.id])).out
    .trim()
    .split('\n')
    .map(line => JSON.parse(line))
  expect(
    log
      .filter(event => event.kind === 'loaded')
      .map(event => event.payload.rev),
  ).toEqual([1])
  expect(
    log
      .filter(event => event.kind === 'revised')
      .map(event => event.payload.reason),
  ).toEqual([undefined, undefined, 'clearer'])
  expect(log.find(event => event.kind === 'restored').payload).toEqual({
    reason: 'back on',
  })
})

it('carries an outbox write reason and author into the queued file', async () => {
  const dir = folder()
  const outbox = join(dir, 'outbox')
  const file = join(dir, 'grill.json')
  writeFileSync(file, JSON.stringify(fixture))
  const queued = await run(
    dir,
    [
      'load',
      file,
      '--reason',
      'remote round',
      '--skill-revision',
      String(SKILL_REVISION),
    ],
    { GF_OUTBOX: outbox },
  )
  expect(queued.code).toBe(0)
  expect(queued.error).not.toContain('Write reason missing')
  const written = JSON.parse(
    readFileSync(join(outbox, fixture.id, 'grill.json'), 'utf8'),
  )
  expect(queuedProvenance(written)).toEqual({
    author: 't7',
    reason: 'remote round',
  })
  const history = await run(dir, ['history', fixture.id], {
    GF_OUTBOX: outbox,
  })
  expect(history.code).toBe(2)
  expect(history.error).toContain('serving machine')
})
