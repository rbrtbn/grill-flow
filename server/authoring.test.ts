import { afterEach, expect, it } from 'bun:test'
import { Schema } from 'effect'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ChannelItem } from '../src/channel'
import { Grill } from '../src/domain'
import {
  type GuideView,
  SKILL_REVISION,
  authoringWarning,
  cachedGuide,
  guideText,
  hostGuide,
  needsReason,
} from './authoring'

const folders = new Set<string>()
const folder = () => {
  const path = mkdtempSync(join(tmpdir(), 'gf-authoring-'))
  folders.add(path)
  return path
}
afterEach(() => {
  folders.forEach(path => rmSync(path, { recursive: true, force: true }))
  folders.clear()
})
// Every write carries a reason so these tests see only guide-revision warnings.
const cli = async (dir: string, args: ReadonlyArray<string>, outbox = '') => {
  const reason = needsReason(args[0], args) ? ['--reason', 'test write'] : []
  const child = Bun.spawn(
    [process.execPath, 'server/cli.ts', ...args, ...reason],
    {
      env: {
        ...process.env,
        GF_DB: join(dir, 'store/database.sqlite'),
        GF_OUTBOX: outbox,
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
  return { code, out, error }
}
const examples = () =>
  [...hostGuide().text.matchAll(/```json\n([\s\S]*?)\n```/g)].map(match =>
    JSON.parse(match[1]!),
  )
const prepare = (dir: string) => {
  const [grill, item] = examples()
  writeFileSync(join(dir, 'grill.json'), JSON.stringify(grill))
  writeFileSync(join(dir, 'item.json'), JSON.stringify(item))
  writeFileSync(join(dir, 'reply.md'), 'The result is ready for review.')
  return { grill, item }
}

it('prints a complete guide and conditional refresh without opening a database or creating an outbox', async () => {
  const dir = folder(),
    outbox = join(dir, 'missing-outbox')
  const full = await cli(dir, ['--skill'])
  expect(full.code).toBe(0)
  expect(full.error).toBe('')
  expect(full.out).toContain(hostGuide().text)
  const same = await cli(dir, [
    '--skill',
    '--if-newer-than',
    String(SKILL_REVISION),
  ])
  expect(same.out).toContain('Unchanged')
  expect(same.out).not.toContain('## Write for the reader')
  for (const revision of ['0', 'unknown', '999']) {
    const result = await cli(dir, ['--skill', '--if-newer-than', revision])
    expect(result.code).toBe(0)
    expect(result.out).toContain(hostGuide().text)
  }
  const remote = await cli(dir, ['--skill'], outbox)
  expect(remote.out).toContain('Unverified bundled fallback')
  expect(existsSync(outbox)).toBe(false)
  expect(existsSync(join(dir, 'store'))).toBe(false)
})

it('validates the actual guide examples and preserves warning-first local success and objective rejection', async () => {
  const dir = folder(),
    { grill, item } = prepare(dir)
  expect(Schema.decodeUnknownSync(Grill)(grill).id).toBe('guide-example')
  expect(Schema.decodeUnknownSync(ChannelItem)(item).id).toBe(
    'verification-result',
  )
  const loaded = await cli(dir, ['load', join(dir, 'grill.json')])
  expect(loaded.code).toBe(0)
  expect(loaded.out).toStartWith('loaded guide-example:')
  expect(loaded.error).toContain('Published as submitted')
  expect(loaded.error).toContain(hostGuide().text)
  const current = await cli(dir, [
    'load',
    join(dir, 'grill.json'),
    '--expect-rev',
    '1',
    '--skill-revision',
    String(SKILL_REVISION),
  ])
  expect(current.code).toBe(0)
  expect(current.error).toBe('')
  const update = await cli(dir, [
    'item',
    grill.id,
    '--file',
    join(dir, 'item.json'),
    '--skill-revision',
    '0',
  ])
  expect(update.code).toBe(0)
  expect(update.error).toContain('Published as submitted')
  expect(update.out).toStartWith('published item')
  const replay = await cli(dir, [
    'item',
    grill.id,
    '--file',
    join(dir, 'item.json'),
    '--skill-revision',
    String(SKILL_REVISION),
  ])
  expect(replay.code).toBe(0)
  expect(replay.error).toBe('')
  const revised = await cli(dir, [
    'revise',
    grill.id,
    'next-step',
    '--kind',
    'comment',
    '--file',
    join(dir, 'reply.md'),
  ])
  expect(revised.code).toBe(0)
  expect(revised.error).toContain('Published as submitted')
  const replied = await cli(dir, [
    'reply',
    grill.id,
    '--file',
    join(dir, 'reply.md'),
  ])
  expect(replied.code).toBe(0)
  expect(replied.error).toContain('Published as submitted')
  writeFileSync(join(dir, 'bad.json'), JSON.stringify({ ...item, revision: 4 }))
  const rejected = await cli(dir, [
    'item',
    grill.id,
    '--file',
    join(dir, 'bad.json'),
  ])
  expect(rejected.code).not.toBe(0)
  expect(rejected.error).not.toContain('Published as submitted')
  const state = await cli(dir, ['state', grill.id])
  expect(state.code).toBe(0)
  expect(state.error).toBe('')
})

it('reads a host-issued guide cache, rejects conflicting or corrupt caches honestly and keeps queue replay intact', async () => {
  const dir = folder(),
    outbox = join(dir, 'outbox'),
    { grill } = prepare(dir)
  const source = join(outbox, grill.id)
  mkdirSync(source, { recursive: true })
  const cached = { ...hostGuide(), host: 'fixture-host' }
  const file = join(source, 'state.json')
  writeFileSync(
    file,
    JSON.stringify({
      lastEventId: 0,
      snapshot: {
        grill,
        answers: {},
        notes: {},
        own: {},
        asks: [],
        revisions: [],
        sends: [],
      },
      events: [],
      authoringGuide: cached,
    }),
  )
  const original = readFileSync(file, 'utf8')
  const read = await cli(dir, ['--skill'], outbox)
  expect(read.out).toContain('Cached from host: fixture-host')
  expect(read.out).toContain(cached.text)
  expect(readFileSync(file, 'utf8')).toBe(original)
  expect(existsSync(join(dir, 'store'))).toBe(false)
  expect(
    (
      await cli(
        dir,
        [
          'load',
          join(dir, 'grill.json'),
          '--skill-revision',
          String(SKILL_REVISION),
        ],
        outbox,
      )
    ).error,
  ).toBe('')
  const queued = JSON.parse(readFileSync(join(source, 'grill.json'), 'utf8'))
  expect(queued.skillRevision).toBe(SKILL_REVISION)
  const itemArgs = ['item', grill.id, '--file', join(dir, 'item.json')]
  const first = await cli(dir, [...itemArgs, '--skill-revision', '0'], outbox)
  expect(first.code).toBe(0)
  expect(first.error).toContain('Queued as submitted')
  const itemFile = join(source, 'items', readdirSync(join(source, 'items'))[0]!)
  const bytes = readFileSync(itemFile, 'utf8')
  const retry = await cli(
    dir,
    [...itemArgs, '--skill-revision', String(SKILL_REVISION)],
    outbox,
  )
  expect(retry.code).toBe(0)
  expect(readFileSync(itemFile, 'utf8')).toBe(bytes)
  const changed = JSON.parse(readFileSync(join(dir, 'item.json'), 'utf8'))
  writeFileSync(
    join(dir, 'item.json'),
    JSON.stringify({ ...changed, body: 'Changed immutable body' }),
  )
  const conflict = await cli(
    dir,
    [...itemArgs, '--skill-revision', String(SKILL_REVISION)],
    outbox,
  )
  expect(conflict.code).toBe(2)
  expect(conflict.error).toContain(
    'That immutable item file already has different content.',
  )
  expect(conflict.error).not.toContain('Queued as submitted')
  expect(readFileSync(itemFile, 'utf8')).toBe(bytes)
  const alternate = join(outbox, 'other')
  mkdirSync(alternate)
  writeFileSync(
    join(alternate, 'state.json'),
    JSON.stringify({ authoringGuide: { ...cached, host: 'another-host' } }),
  )
  expect(cachedGuide(outbox).origin).toBe('unverified')
  rmSync(alternate, { recursive: true })
  writeFileSync(
    file,
    JSON.stringify({ authoringGuide: { ...cached, text: 'corrupt content' } }),
  )
  expect(cachedGuide(outbox).origin).toBe('unverified')
})

it('keeps unknown or future revisions and unverified fallback distinct from current host guidance', () => {
  const view: GuideView = { guide: hostGuide(), origin: 'host' }
  expect(authoringWarning(SKILL_REVISION, view, 'published')).toBeUndefined()
  expect(authoringWarning(999, view, 'published')).toContain(
    'Published as submitted',
  )
  expect(guideText(view, '999')).toContain('does not establish')
  expect(
    guideText({ ...view, origin: 'unverified' }, String(SKILL_REVISION)),
  ).toContain(view.guide.text)
})

it('returns host guidance and import warnings through state, wakes wait, and never reimports accepted files', async () => {
  const dir = folder(),
    outbox = join(dir, 'outbox'),
    { grill } = prepare(dir)
  const load = await cli(dir, ['load', join(dir, 'grill.json')], outbox)
  expect(load.code).toBe(0)
  expect(load.error).toContain('Queued as submitted')
  const item = await cli(
    dir,
    [
      'item',
      grill.id,
      '--file',
      join(dir, 'item.json'),
      '--skill-revision',
      '999',
    ],
    outbox,
  )
  expect(item.code).toBe(0)
  const reply = await cli(
    dir,
    ['reply', grill.id, '--file', join(dir, 'reply.md')],
    outbox,
  )
  expect(reply.code).toBe(0)
  const revision = await cli(
    dir,
    [
      'revise',
      grill.id,
      'next-step',
      '--kind',
      'comment',
      '--file',
      join(dir, 'reply.md'),
    ],
    outbox,
  )
  expect(revision.code).toBe(0)
  const invalid = join(outbox, grill.id, 'revisions', 'invalid.json')
  writeFileSync(
    invalid,
    JSON.stringify({
      kind: 'rewrite',
      stepId: 'missing-step',
      text: 'Invalid target',
    }),
  )
  const hc = join(dir, 'hc')
  writeFileSync(
    hc,
    `#!${process.execPath}
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const root=${JSON.stringify(outbox)}, args=process.argv.slice(2), source=${JSON.stringify(grill.id)};
if(args[0]==='exec') {
 console.log(root);
 const files=[source+'/grill.json',...['items','revisions'].flatMap(dir=>readdirSync(join(root,source,dir)).map(file=>source+'/'+dir+'/'+file))];
 for(const file of files) {const s=statSync(join(root,file)); console.log(s.mtimeMs+'.'+s.size+' ./'+file);}
} else if(args[0]==='file'&&args[1]==='read') console.log(readFileSync(args.at(-1),'utf8'));
else if(args[0]==='file'&&args[1]==='write') writeFileSync(args.at(-1),await Bun.stdin.text());
else process.exit(2);
`,
  )
  chmodSync(hc, 0o700)
  const runner = join(dir, 'poll.ts')
  writeFileSync(
    runner,
    `import {open,events} from ${JSON.stringify(join(process.cwd(), 'server/store.ts'))};
import {pollRemotesOnce} from ${JSON.stringify(join(process.cwd(), 'server/remote.ts'))};
const db=open();try {
 await pollRemotesOnce(db,[{machine:'fixture',dir:${JSON.stringify(outbox)}}]);
 const before=events(db,${JSON.stringify(grill.id)}).length;
 await pollRemotesOnce(db,[{machine:'fixture',dir:${JSON.stringify(outbox)}}]);
 console.log(JSON.stringify({before,after:events(db,${JSON.stringify(grill.id)}).length}));
}finally{db.close();}`,
  )
  const child = Bun.spawn([process.execPath, runner], {
    env: {
      ...process.env,
      GF_DB: join(dir, 'store/database.sqlite'),
      GF_OUTBOX: '',
      PATH: `${dir}:${process.env.PATH}`,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [code, out, error] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  expect(code).toBe(0)
  expect(error).toContain('no step, concept, card or run missing-step')
  const counts = JSON.parse(out)
  expect(counts.after).toBe(counts.before)
  const state = JSON.parse(
    readFileSync(join(outbox, grill.id, 'state.json'), 'utf8'),
  )
  expect(state.authoringGuide.revision).toBe(SKILL_REVISION)
  expect(state.authoringGuide.text).toBe(hostGuide().text)
  expect(state.authoringWarnings).toHaveLength(4)
  expect(
    state.authoringWarnings.some((warning: { path: string }) =>
      warning.path.endsWith('invalid.json'),
    ),
  ).toBe(false)
  expect(
    state.events.filter(
      (event: { kind: string }) => event.kind === 'item-published',
    ),
  ).toHaveLength(1)
  expect(
    state.events.filter((event: { kind: string }) => event.kind === 'replied'),
  ).toHaveLength(1)
  const read = await cli(dir, ['state', grill.id], outbox)
  expect(read.code).toBe(0)
  expect(read.error).toContain(
    'Host import authoring warnings: published as submitted',
  )
  expect(read.error).toContain(hostGuide().text)
  const waited = await cli(dir, ['wait', grill.id, '--since', '0'], outbox)
  expect(waited.code).toBe(0)
  expect(waited.error).toContain('Host import authoring warnings')
  expect(waited.out).toContain(`--since ${state.lastEventId}`)
  const cached = await cli(
    dir,
    ['--skill', '--if-newer-than', String(SKILL_REVISION)],
    outbox,
  )
  expect(cached.out).toContain('Cached from host:')
  expect(cached.out).toContain('Unchanged')
}, 15000)
