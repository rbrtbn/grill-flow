import { Database } from 'bun:sqlite'
import { afterEach, expect, it } from 'bun:test'
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

import { OWN, type Grill } from '../src/domain'
import {
  questionRevisions,
  readSubmission,
  recordAnswer,
} from './answerReceipts'
import { seedLegacySource } from './legacySource.testSupport'
import { selectSend } from './sendSelection'
import { readPage, sendPageAnswers } from './squad'
import { appendEvent, events, getGrill, loadGrill, snapshot } from './store'

const fixture = JSON.parse(readFileSync('src/fixtures/grill.json', 'utf8'))
const folders = new Set<string>(),
  databases = new Set<Database>()
afterEach(() => {
  databases.forEach(db => db.close())
  folders.forEach(path => rmSync(path, { recursive: true, force: true }))
  databases.clear()
  folders.clear()
})
const folder = () => {
  const path = mkdtempSync(join(tmpdir(), 'grill-reload-'))
  folders.add(path)
  return path
}
const database = (path = ':memory:') => {
  const db = new Database(path)
  db.exec(`CREATE TABLE grills (id TEXT PRIMARY KEY, json TEXT, loaded_at INTEGER);
    CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, grill_id TEXT, at INTEGER, kind TEXT, payload TEXT);
    CREATE TABLE grill_remotes (grill_id TEXT PRIMARY KEY, machine TEXT, dir TEXT);
    CREATE TABLE remote_files (machine TEXT, path TEXT, stamp TEXT, PRIMARY KEY(machine,path));`)
  databases.add(db)
  return db
}
const source = (): Grill => ({
  ...fixture,
  id: 'reload-source',
  squad: { id: 'team', section: 'Reload' },
  steps: fixture.steps.slice(0, 1),
})
const pick = (db: Database, grill: Grill, key = 'a') => {
  expect(
    recordAnswer(db, grill, grill, 'Q1', {
      question: 'Q1',
      key,
      text: 'My own words',
      contextRevision: questionRevisions(grill).Q1,
    }).ok,
  ).toBe(true)
}
const contents = (db: Database) =>
  JSON.stringify(
    ['grills', 'events', 'grill_remotes', 'remote_files'].map(table =>
      db.query(`SELECT * FROM ${table}`).all(),
    ),
  )
const changeOptions = (
  grill: Grill,
  f: (
    options: Grill['steps'][number]['question']['options'],
  ) => Grill['steps'][number]['question']['options'],
): Grill => ({
  ...grill,
  steps: grill.steps.map(step => ({
    ...step,
    question: { ...step.question, options: f(step.question.options) },
  })),
})

it.each([
  ['removes its question', (grill: Grill) => ({ ...grill, steps: [] })],
  [
    'drops its key',
    (grill: Grill) =>
      changeOptions(grill, options =>
        options.filter(option => option.key !== 'a'),
      ),
  ],
  [
    'rekeys its option',
    (grill: Grill) =>
      changeOptions(grill, options =>
        options.map(option =>
          option.key === 'a' ? { ...option, key: 'z' } : option,
        ),
      ),
  ],
  [
    'swaps keys while reusing the pick',
    (grill: Grill) =>
      changeOptions(grill, options =>
        options.map(option => ({
          ...option,
          key: option.key === 'a' ? 'b' : option.key === 'b' ? 'a' : option.key,
        })),
      ),
  ],
] as const)(
  'refuses a load that %s without changing any stored state',
  (_name, change) => {
    const db = database(),
      grill = loadGrill(db, source())
    pick(db, grill)
    appendEvent(db, grill.id, 'sent', {
      what: 'answers',
      ok: true,
      lines: { Q1: 'Q1 a' },
    })
    const before = contents(db)
    expect(() => loadGrill(db, change(grill))).toThrow(
      'Reload refused for "reload-source" "Q1" pick "a"',
    )
    expect(contents(db)).toBe(before)
    expect(readPage(db, 'team')?.state.answers.Q1).toBe('a')
  },
)

it('allows ordinary rewording and keeps answer and send contexts independently frozen', async () => {
  const db = database(),
    original = loadGrill(db, source())
  pick(db, original)
  const wording = changeOptions(original, options =>
    options.map(option => ({
      ...option,
      label: 'New ' + option.label,
      effect: 'New ' + option.effect,
    })),
  )
  const changed = loadGrill(db, {
    ...wording,
    steps: wording.steps.map(step => ({
      ...step,
      question: { ...step.question, title: 'Reworded title', ask: 'New ask?' },
    })),
  })
  const page = readPage(db, changed.id)!,
    selection = selectSend(page.state, { questions: ['Q1'] })
  if (!selection.ok) throw new Error(selection.error)
  await sendPageAnswers(
    db,
    page,
    selection,
    async () => ({ ok: true, detail: 'mock' }),
    () => 'gf',
  )
  const submitted = events(db, changed.id).find(
    row => row.kind === 'submitted',
  )!
  const captured = readSubmission(db, changed.id, submitted.id).answers[0]!
  expect(captured.context?.ask).toBe(original.steps[0]!.question.ask)
  expect(captured.sendRevision).toBe(questionRevisions(changed).Q1!)
  expect(captured.sendRevision).not.toBe(captured.context?.revision)
})

it('allows deliberate clearing, custom answers and already removed historical answers', () => {
  const db = database(),
    grill = loadGrill(db, source())
  pick(db, grill)
  appendEvent(db, grill.id, 'cleared', { question: 'Q1' })
  expect(loadGrill(db, { ...grill, steps: [] }).steps).toEqual([])
  loadGrill(db, grill)
  pick(db, grill, OWN)
  expect(
    loadGrill(db, {
      ...grill,
      steps: [],
      decided: [{ id: 'Q1', text: 'Custom answer acted on.' }],
    }).steps,
  ).toEqual([])
  loadGrill(db, grill)
  pick(db, grill)
  seedLegacySource(db, { ...grill, steps: [] })
  expect(loadGrill(db, { ...grill, steps: [] }).steps).toEqual([])
  expect(snapshot(db, getGrill(db, grill.id)!).answers.Q1).toBe('a')
})

it('does not mistake an existing duplicate option wording for a moved pick', () => {
  const db = database(),
    initial = source()
  const grill = loadGrill(
    db,
    changeOptions(initial, options =>
      options.map(option =>
        option.key === 'b'
          ? { ...option, label: options[0]!.label, effect: options[0]!.effect }
          : option,
      ),
    ),
  )
  pick(db, grill)
  expect(() =>
    loadGrill(
      db,
      changeOptions(grill, options =>
        options.map(option =>
          option.key === 'a' ? { ...option, label: 'Reworded' } : option,
        ),
      ),
    ),
  ).not.toThrow()
})

it.each([false, true])(
  'checks resolution before replacing an answered outbox source (resolved: %s)',
  async resolved => {
    const dir = folder(),
      outbox = join(dir, 'outbox'),
      db = database(),
      grill = loadGrill(db, source())
    pick(db, grill)
    const target = join(outbox, grill.id)
    mkdirSync(target, { recursive: true })
    const original = JSON.stringify(grill)
    writeFileSync(join(target, 'grill.json'), original)
    writeFileSync(
      join(target, 'state.json'),
      JSON.stringify({
        snapshot: snapshot(db, grill),
        events: [],
        lastEventId: 2,
      }),
    )
    const file = join(dir, 'changed.json')
    writeFileSync(
      file,
      JSON.stringify({
        ...grill,
        steps: [],
        ...(resolved
          ? { decided: [{ id: 'Q1', text: 'Resolved and implemented.' }] }
          : {}),
      }),
    )
    const child = Bun.spawn([process.execPath, 'server/cli.ts', 'load', file], {
      env: {
        ...process.env,
        GF_OUTBOX: outbox,
        GF_DB: join(dir, 'unused.sqlite'),
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [code, error] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
    ])
    if (resolved) {
      expect(code).toBe(0)
      const queued = JSON.parse(
        readFileSync(join(target, 'grill.json'), 'utf8'),
      )
      expect(queued.steps).toEqual([])
      expect(queued.decided).toEqual([
        { id: 'Q1', text: 'Resolved and implemented.' },
      ])
    } else {
      expect(code).not.toBe(0)
      expect(error).toContain('Reload refused')
      expect(readFileSync(join(target, 'grill.json'), 'utf8')).toBe(original)
    }
  },
)

it('keeps a refused remote load retryable at the same stamp after a deliberate clear', async () => {
  const dir = folder(),
    root = join(dir, 'outbox'),
    dbPath = join(dir, 'store.sqlite'),
    db = database(dbPath),
    grill = source()
  const target = join(root, grill.id)
  mkdirSync(target, { recursive: true })
  const file = join(target, 'grill.json')
  writeFileSync(file, JSON.stringify(grill))
  const hc = join(dir, 'hc')
  writeFileSync(
    hc,
    `#!${process.execPath}
import {readFileSync,statSync,writeFileSync} from 'node:fs';
const root=${JSON.stringify(root)},file=${JSON.stringify(file)},args=process.argv.slice(2);
if(args[0]==='exec'){const s=statSync(file);console.log(root);console.log(s.mtimeMs+'.'+s.size+' ./${grill.id}/grill.json');}
else if(args[0]==='file'&&args[1]==='read'){console.log(readFileSync(args.at(-1),'utf8'));}
else if(args[0]==='file'&&args[1]==='write'){writeFileSync(args.at(-1),await Bun.stdin.text());}
else process.exit(2);
`,
  )
  chmodSync(hc, 0o700)
  const runner = join(dir, 'poll.ts')
  writeFileSync(
    runner,
    `import {Database} from 'bun:sqlite';
import {pollRemotesOnce} from ${JSON.stringify(join(process.cwd(), 'server/remote.ts'))};
const db=new Database(${JSON.stringify(dbPath)});
try{await pollRemotesOnce(db,[{machine:'fake',dir:${JSON.stringify(root)}}]);}finally{db.close();}
`,
  )
  const poll = async () => {
    const child = Bun.spawn([process.execPath, runner], {
      env: { ...process.env, PATH: dir + ':' + process.env.PATH },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [code, error] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
    ])
    expect(code).toBe(0)
    return error
  }
  expect(await poll()).toBe('')
  pick(db, getGrill(db, grill.id)!)
  writeFileSync(file, JSON.stringify({ ...grill, steps: [] }))
  const before = contents(db)
  expect(await poll()).toContain('Reload refused')
  expect(contents(db)).toBe(before)
  appendEvent(db, grill.id, 'cleared', { question: 'Q1' })
  expect(await poll()).toBe('')
  expect(getGrill(db, grill.id)?.steps).toEqual([])
  expect(db.query('SELECT stamp FROM remote_files').get()).not.toEqual(
    JSON.parse(before)[3][0],
  )
})

it.each(['a', OWN])(
  'takes a resolved %s question off the source and squad while preserving its immutable submission',
  async key => {
    const db = database(),
      grill = loadGrill(db, source())
    pick(db, grill, key)
    const page = readPage(db, grill.id)!,
      selection = selectSend(page.state, { questions: ['Q1'] })
    if (!selection.ok) throw new Error(selection.error)
    await sendPageAnswers(
      db,
      page,
      selection,
      async () => ({ ok: true, detail: 'mock' }),
      () => 'gf',
    )
    const submitted = events(db, grill.id).find(
      row => row.kind === 'submitted',
    )!
    const receipt = readSubmission(db, grill.id, submitted.id)
    const history = events(db, grill.id)
    const resolved = loadGrill(db, {
      ...grill,
      steps: [],
      decided: [
        { id: 'Q1', text: 'Implemented and verified the selected outcome.' },
      ],
    })
    expect(resolved.steps).toEqual([])
    expect(readPage(db, 'team')?.state.grill.steps).toEqual([])
    expect(snapshot(db, resolved).answers.Q1).toBe(key)
    expect(readSubmission(db, grill.id, submitted.id)).toEqual(receipt)
    expect(events(db, grill.id).slice(0, history.length)).toEqual([...history])
  },
)

it.each(
  ['a', OWN].flatMap(key => [
    { key, outcome: { id: 'Q99', text: 'Different question resolved.' } },
    { key, outcome: { id: 'Q1', text: '   ' } },
  ]),
)('refuses unaccounted removal for $key with $outcome', ({ key, outcome }) => {
  const db = database(),
    grill = loadGrill(db, source())
  pick(db, grill, key)
  const before = contents(db)
  expect(() =>
    loadGrill(db, { ...grill, steps: [], decided: [outcome] }),
  ).toThrow('Reload refused')
  expect(contents(db)).toBe(before)
})

it('keeps a surviving picked option protected even with a decided outcome for its question', () => {
  const db = database(),
    grill = loadGrill(db, source())
  pick(db, grill)
  const changed = changeOptions(grill, options =>
    options.filter(option => option.key !== 'a'),
  )
  expect(() =>
    loadGrill(db, {
      ...changed,
      decided: [{ id: 'Q1', text: 'Only part is resolved.' }],
    }),
  ).toThrow('picked option key')
})
