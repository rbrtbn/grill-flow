import { Database } from 'bun:sqlite'
import { afterEach, expect, it } from 'bun:test'
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { attentionSnapshot } from './attention'
import {
  itemHistory,
  publishUpdate,
  publishedUpdates,
  updateHistory,
} from './channel'
import { readPage, sourceQuestionUrl, sourceText } from './squad'
import { loadGrill, retireGrill, restoreGrill, snapshot } from './store'

const fixture = JSON.parse(readFileSync('src/fixtures/grill.json', 'utf8'))
const databases = new Set<Database>()
const folders = new Set<string>()
const originalPath = process.env.PATH

afterEach(() => {
  databases.forEach(db => db.close())
  databases.clear()
  folders.forEach(dir => rmSync(dir, { recursive: true, force: true }))
  folders.clear()
})
const folder = () => {
  const dir = mkdtempSync(join(tmpdir(), 'grill-channel-'))
  folders.add(dir)
  return dir
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
const item = {
  version: 1,
  kind: 'update',
  id: 'progress',
  previous: 0,
  revision: 1,
  session: 't-worker',
  body: 'The work is ready. See Q1.',
  question: 'Q1',
}
const source = (id = 'source', squad = false) => ({
  ...fixture,
  id,
  session: 't-worker',
  steps: fixture.steps.slice(0, 1),
  ...(squad ? { squad: { id: 'team', section: id } } : {}),
})

it('publishes an update without inventing a question, answer, ask or send', () => {
  const db = database()
  const grill = loadGrill(db, source())
  const before = snapshot(db, grill)
  const result = publishUpdate(db, grill, item)
  expect(result.ok).toBe(true)
  expect(snapshot(db, grill)).toEqual(before)
  expect(publishedUpdates(db, [grill.id])).toMatchObject([
    { source: grill.id, item, at: expect.any(Number) },
  ])
  expect(publishUpdate(db, grill, item)).toEqual(result)
  expect(updateHistory(db, grill.id)).toHaveLength(1)
  const reloaded = loadGrill(db, { ...grill, steps: [] })
  expect(publishUpdate(db, reloaded, item)).toEqual(result)
  expect(publishedUpdates(db, [grill.id])).toHaveLength(1)
})

it('requires the expected previous revision and keeps accepted history immutable', () => {
  const db = database()
  const grill = loadGrill(db, source())
  expect(publishUpdate(db, grill, item).ok).toBe(true)
  expect(
    publishUpdate(db, grill, { ...item, body: 'Conflicting content' }).ok,
  ).toBe(false)
  expect(
    publishUpdate(db, grill, { ...item, previous: 1, revision: 3 }).ok,
  ).toBe(false)
  expect(
    publishUpdate(db, grill, { ...item, previous: 2, revision: 3 }).ok,
  ).toBe(false)
  expect(
    publishUpdate(db, grill, {
      ...item,
      previous: 1,
      revision: 2,
      body: 'The follow-up is ready.',
    }).ok,
  ).toBe(true)
  expect(publishedUpdates(db, [grill.id])[0]?.item.revision).toBe(2)
  expect(updateHistory(db, grill.id).map(entry => entry.item.body)).toEqual([
    item.body,
    'The follow-up is ready.',
  ])
  expect(publishUpdate(db, grill, item).ok).toBe(true)
  expect(publishUpdate(db, grill, { ...item, id: 'bad', body: '   ' }).ok).toBe(
    false,
  )
  expect(publishUpdate(db, grill, { ...item, id: '../bad' }).ok).toBe(false)
  expect(publishUpdate(db, grill, { ...item, question: 'Q999' }).ok).toBe(false)
  expect(publishUpdate(db, grill, { ...item, session: '' }).ok).toBe(false)
})

it('allows source-local supersession and refuses unknown targets or cycles', () => {
  const db = database()
  const grill = loadGrill(db, source())
  publishUpdate(db, grill, item)
  expect(
    publishUpdate(db, grill, { ...item, id: 'next', supersedes: 'missing' }).ok,
  ).toBe(false)
  expect(
    publishUpdate(db, grill, { ...item, id: 'next', supersedes: 'progress' })
      .ok,
  ).toBe(true)
  expect(
    publishedUpdates(db, [grill.id]).find(entry => entry.item.id === 'progress')
      ?.supersededBy,
  ).toBe('next')
  expect(
    publishUpdate(db, grill, {
      ...item,
      previous: 1,
      revision: 2,
      supersedes: 'next',
    }).ok,
  ).toBe(false)
})

it('resolves a source-qualified local Q1 through its own registration rather than guessing shared Q1', () => {
  const db = database()
  const a = loadGrill(db, source('alpha', true))
  const b = loadGrill(db, source('beta', true))
  const page = readPage(db, 'team')!
  const one = page.members.find(member => member.state.grill.id === a.id)!
    .registration.questions.Q1!
  const two = page.members.find(member => member.state.grill.id === b.id)!
    .registration.questions.Q1!
  expect(one).not.toBe(two)
  expect(sourceQuestionUrl(db, 'team', b.id, 'Q1')).toBe(
    `/g/team/question/${two}`,
  )
  expect(sourceQuestionUrl(db, 'team', 'missing', 'Q1')).toBeUndefined()
  expect(sourceQuestionUrl(db, 'team', b.id, 'Q999')).toBeUndefined()
  expect(sourceQuestionUrl(db, 'unrelated', b.id, 'Q1')).toBeUndefined()
  expect(sourceText(page, b.id, 'See Q1, not https://example.com/Q1')).toBe(
    `See ${two}, not https://example.com/Q1`,
  )
  retireGrill(db, b, 'Finished')
  expect(sourceQuestionUrl(db, 'team', b.id, 'Q1')).toBe('/g/beta/question/Q1')
  restoreGrill(db, b)
  expect(sourceQuestionUrl(db, 'team', b.id, 'Q1')).toBe(
    `/g/team/question/${two}`,
  )
  loadGrill(db, { ...fixture, id: b.id })
  expect(sourceQuestionUrl(db, 'team', b.id, 'Q1')).toBe('/g/beta/question/Q1')
})

it('publishes through gf item and rejects changing an immutable outbox item file', async () => {
  const dir = folder()
  const dbPath = join(dir, 'store.sqlite')
  const db = database(dbPath)
  const grill = loadGrill(db, source())
  const record = join(dir, 'item.json')
  writeFileSync(record, JSON.stringify(item))
  const cli = async (outbox?: string) => {
    const child = Bun.spawn(
      [process.execPath, 'server/cli.ts', 'item', grill.id, '--file', record],
      {
        env: { ...process.env, GF_DB: dbPath, GF_OUTBOX: outbox },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )
    const [code, out, error] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    return { code, out, error }
  }
  expect((await cli()).code).toBe(0)
  expect(publishedUpdates(db, [grill.id])).toHaveLength(1)
  const outbox = join(dir, 'outbox')
  mkdirSync(join(outbox, grill.id), { recursive: true })
  const grillFile = join(outbox, grill.id, 'grill.json')
  const original = JSON.stringify(grill)
  writeFileSync(grillFile, original)
  expect((await cli(outbox)).code).toBe(0)
  const queued = join(outbox, grill.id, 'items/progress-0000000001.json')
  expect(existsSync(queued)).toBe(true)
  expect((await cli(outbox)).code).toBe(0)
  writeFileSync(
    record,
    JSON.stringify({ ...item, body: 'Mutated after queuing' }),
  )
  expect((await cli(outbox)).code).not.toBe(0)
  expect(JSON.parse(readFileSync(queued, 'utf8')).body).toBe(item.body)
  const owner = {
    ...item,
    kind: 'owner-step',
    id: 'manual-step',
    host: 'rob-mbp',
    destination: 'https://example.test/owner',
    action: 'Exact owner command',
    urgency: 'soon',
    blockers: [],
    progress: { state: 'open' },
  }
  writeFileSync(record, JSON.stringify(owner))
  expect((await cli()).code).toBe(0)
  expect((await cli(outbox)).code).toBe(0)
  expect(
    JSON.parse(
      readFileSync(
        join(outbox, grill.id, 'items/manual-step-0000000001.json'),
        'utf8',
      ),
    ).action,
  ).toBe(owner.action)
  writeFileSync(
    record,
    JSON.stringify({
      ...owner,
      id: 'native-step',
      destination: { kind: 'terminal', address: 't42' },
    }),
  )
  expect((await cli()).code).toBe(0)
  const remoteNative = await cli(outbox)
  expect(remoteNative.code).not.toBe(0)
  expect(remoteNative.error).toContain(
    'native focus belongs to the serving host',
  )
  expect(
    existsSync(join(outbox, grill.id, 'items/native-step-0000000001.json')),
  ).toBe(false)
  expect(itemHistory(db, grill.id)).toHaveLength(3)
  expect(readFileSync(grillFile, 'utf8')).toBe(original)
})

it('imports remote immutable revisions in order, retries an unmet revision, and never reimports a changed seen file', async () => {
  const dir = folder()
  const root = join(dir, 'outbox')
  const id = 'remote-channel-fixture'
  const dbPath = join(dir, 'remote.sqlite')
  const db = database(dbPath)
  mkdirSync(join(root, id, 'items'), { recursive: true })
  writeFileSync(join(root, id, 'grill.json'), JSON.stringify(source(id)))
  const write = (revision: number) =>
    writeFileSync(
      join(
        root,
        id,
        'items',
        `progress-${String(revision).padStart(10, '0')}.json`,
      ),
      JSON.stringify({
        ...item,
        revision,
        previous: revision - 1,
        body: `Revision ${revision}`,
      }),
    )
  const owner = {
    ...item,
    kind: 'owner-step',
    id: 'remote-owner',
    host: 'lab',
    destination: 'https://example.test/remote-session',
    action: 'Exact remote-host action',
    urgency: 'soon',
    blockers: [],
    progress: { state: 'open' },
  }
  writeFileSync(
    join(root, id, 'items/remote-owner-0000000001.json'),
    JSON.stringify(owner),
  )
  writeFileSync(
    join(root, id, 'items/native-owner-0000000001.json'),
    JSON.stringify({
      ...owner,
      id: 'native-owner',
      destination: { kind: 'terminal', address: 't42' },
    }),
  )
  write(1)
  write(3)
  const hc = join(dir, 'hc')
  writeFileSync(
    hc,
    `#!${process.execPath}
import {readFileSync,readdirSync,statSync,writeFileSync} from 'node:fs';
const root=${JSON.stringify(root)};const args=process.argv.slice(2);
if(args[0]==='exec') {
 console.log(root);
 for(const file of ['${id}/grill.json',...readdirSync(root+'/${id}/items').map(x=>'${id}/items/'+x)]) { const s=statSync(root+'/'+file); console.log(s.mtimeMs+'.'+s.size+' ./'+file); }
} else if(args[0]==='file' && args[1]==='read') { console.log(readFileSync(args.at(-1),'utf8')); }
else if(args[0]==='file' && args[1]==='write') { writeFileSync(args.at(-1),await Bun.stdin.text()); }
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
try { await pollRemotesOnce(db,[{machine:'lab',dir:${JSON.stringify(root)}}]); } finally {db.close();}
`,
  )
  const poll = async () => {
    const child = Bun.spawn([process.execPath, runner], {
      env: { ...process.env, PATH: `${dir}:${originalPath}` },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [code, out, error] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect({ code, error: code === 0 ? '' : error, out }).toEqual({
      code: 0,
      error: '',
      out: '',
    })
  }
  await poll()
  expect(publishedUpdates(db, [id])[0]?.item.revision).toBe(1)
  expect(publishedUpdates(db, [id])[0]?.item.session).toBe('lab/t-worker')
  expect(attentionSnapshot(db, [id]).ownerSteps).toMatchObject([
    {
      item: {
        id: 'remote-owner',
        session: 'lab/t-worker',
        destination: owner.destination,
      },
    },
  ])
  expect(
    db
      .query<{ count: number }, []>(
        "SELECT COUNT(*) AS count FROM remote_files WHERE path LIKE '%native-owner%'",
      )
      .get()?.count,
  ).toBe(0)

  expect(
    db
      .query<{ count: number }, []>(
        "SELECT COUNT(*) AS count FROM remote_files WHERE path LIKE '%0000000003.json'",
      )
      .get()?.count,
  ).toBe(0)
  write(2)
  await poll()
  expect(publishedUpdates(db, [id])[0]?.item.revision).toBe(3)
  expect(updateHistory(db, id)).toHaveLength(3)
  const first = join(root, id, 'items/progress-0000000001.json')
  writeFileSync(
    first,
    JSON.stringify({ ...item, body: 'Forbidden replacement' }),
  )
  await poll()
  expect(updateHistory(db, id)).toHaveLength(3)
  expect(updateHistory(db, id)[0]?.item.body).toBe('Revision 1')
  expect(
    JSON.parse(readFileSync(join(root, id, 'state.json'), 'utf8')).snapshot
      .ownerSteps,
  ).toMatchObject([{ item: { id: 'remote-owner' } }])
  expect(
    JSON.parse(readFileSync(join(root, id, 'state.json'), 'utf8')).snapshot
      .updates[0].item.revision,
  ).toBe(3)
})
