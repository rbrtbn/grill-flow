import { Database } from 'bun:sqlite'
import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FORMAT_VERSION, type Grill } from '../src/domain'
import { questionRevisions, recordAnswer } from './answerReceipts'
import { SKILL_REVISION } from './authoring'
import {
  EditError,
  applyPatch,
  mergePatch,
  parsePatch,
  readPointer,
  strictCheck,
} from './grillEdit'
import { currentRev, grillRevisions } from './history'
import { withoutLint } from './lint.testSupport'
import { events, getGrill } from './store'

const fixture: Grill = JSON.parse(
  readFileSync('src/fixtures/grill.json', 'utf8'),
)
const folders = new Set<string>()
afterEach(() => {
  folders.forEach(path => rmSync(path, { recursive: true, force: true }))
  folders.clear()
})
const folder = () => {
  const path = mkdtempSync(join(tmpdir(), 'grill-edit-'))
  folders.add(path)
  return path
}

const run = async (
  dir: string,
  args: ReadonlyArray<string>,
  env: Record<string, string | undefined> = {},
) => {
  const child = Bun.spawn(
    [
      process.execPath,
      'server/cli.ts',
      ...args,
      '--skill-revision',
      String(SKILL_REVISION),
    ],
    {
      env: {
        ...process.env,
        GF_DB: join(dir, 'test.sqlite'),
        GF_OUTBOX: undefined,
        GF_SQUAD: undefined,
        GF_REQUIRE_REASON: undefined,
        GF_REQUIRE_EXPECT_REV: undefined,
        HC_TERMINAL_ID: 't7',
        ...env,
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
  return { code, out, error: withoutLint(error), stderr: error }
}

const write = (dir: string, name: string, value: unknown) => {
  const path = join(dir, name)
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value))
  return path
}

/** A temp server database holding the fixture at rev 1. */
const loaded = async () => {
  const dir = folder()
  const result = await run(dir, [
    'load',
    write(dir, 'grill.json', fixture),
    '--expect-rev',
    '0',
    '--reason',
    'round 1',
  ])
  expect(result).toMatchObject({ code: 0, error: '' })
  return dir
}
const database = (dir: string) => new Database(join(dir, 'test.sqlite'))
const stored = (dir: string) => {
  const db = database(dir)
  try {
    return {
      grill: getGrill(db, fixture.id)!,
      rev: currentRev(db, fixture.id),
      revisions: grillRevisions(db, fixture.id),
    }
  } finally {
    db.close()
  }
}
const edit = (dir: string, ...args: ReadonlyArray<string>) => run(dir, args)

describe('strict validation', () => {
  it('reports every problem in one pass, each with its pointer', () => {
    const raw = structuredClone(fixture) as unknown as Record<string, any>
    raw.bogus = 1
    raw.round = 'two'
    raw.steps[0].question.extra = true
    raw.steps[1].question.options[0].nope = 'x'
    delete raw.steps[2].heading
    expect(strictCheck(raw)).toEqual({
      errors: [
        { path: '/bogus', message: 'unknown key' },
        { path: '/round', message: 'Expected number' },
        { path: '/steps/0/question/extra', message: 'unknown key' },
        { path: '/steps/1/question/options/0/nope', message: 'unknown key' },
        { path: '/steps/2/heading', message: 'Missing key' },
      ],
      unknownKeys: [],
    })
    expect(strictCheck(fixture)).toEqual({ errors: [], unknownKeys: [] })
  })

  it('tolerates unknown keys in a grill declaring a newer format', () => {
    const raw = { ...fixture, version: FORMAT_VERSION + 1, future: {} }
    expect(strictCheck(raw)).toEqual({
      errors: [],
      unknownKeys: [{ path: '/future', message: 'unknown key' }],
    })
    expect(strictCheck({ ...raw, round: 'x' }).errors).toHaveLength(1)
  })
})

describe('JSON patch', () => {
  const doc = { a: [1, 2], 'b/c': { '~d': 0 } }

  it('applies add, remove, replace, move, copy and test', () => {
    expect(
      applyPatch(
        doc,
        parsePatch([
          { op: 'test', path: '/b~1c/~0d', value: 0 },
          { op: 'add', path: '/a/-', value: 3 },
          { op: 'add', path: '/a/0', value: 0 },
          { op: 'replace', path: '/a/1', value: 'one' },
          { op: 'remove', path: '/a/2' },
          { op: 'copy', from: '/a', path: '/copied' },
          { op: 'move', from: '/b~1c', path: '/moved' },
          { op: 'test', path: '/copied', value: [0, 'one', 3] },
        ]),
      ),
    ).toEqual({ a: [0, 'one', 3], copied: [0, 'one', 3], moved: { '~d': 0 } })
    expect(doc).toEqual({ a: [1, 2], 'b/c': { '~d': 0 } })
  })

  it('fails whole, naming the operation, and leaves the input alone', () => {
    const ops = parsePatch([
      { op: 'add', path: '/a/-', value: 3 },
      { op: 'test', path: '/a/0', value: 9 },
    ])
    expect(() => applyPatch(doc, ops)).toThrow(
      'patch operation 1 (test /a/0): test failed: /a/0 holds 1',
    )
    expect(doc.a).toEqual([1, 2])
    for (const bad of [
      [{ op: 'remove', path: '/missing' }],
      [{ op: 'replace', path: '/a/5', value: 1 }],
      [{ op: 'add', path: '/a/01', value: 1 }],
      [{ op: 'move', from: '/b~1c', path: '/b~1c/inner' }],
      [{ op: 'remove', path: '' }],
    ]) {
      expect(() => applyPatch(doc, parsePatch(bad))).toThrow(EditError)
    }
    expect(() => parsePatch([{ op: 'add', path: '/a' }])).toThrow('RFC 6902')
    expect(() => parsePatch({ op: 'add' })).toThrow(EditError)
  })

  it('reads pointers and merges partial objects (RFC 7386)', () => {
    expect(readPointer(doc, '/b~1c/~0d')).toBe(0)
    expect(readPointer(doc, '')).toBe(doc)
    expect(() => readPointer(doc, 'a')).toThrow('not a JSON pointer')
    expect(
      mergePatch(
        { a: 1, b: { c: 2, d: 3 }, list: [1] },
        { a: null, b: { c: 4 }, list: [2] },
      ),
    ).toEqual({ b: { c: 4, d: 3 }, list: [2] })
  })
})

describe('gf get', () => {
  it('prints the stored grill or one value, with the rev on stderr', async () => {
    const dir = await loaded()
    const whole = await run(dir, ['get', fixture.id])
    expect(whole.code).toBe(0)
    expect(JSON.parse(whole.out)).toEqual(stored(dir).grill)
    expect(whole.error.trim()).toBe('rev 1')

    const title = await run(dir, ['get', fixture.id, '/steps/2/question/title'])
    expect(JSON.parse(title.out)).toBe(fixture.steps[2]!.question.title)
    expect(title.error.trim()).toBe('rev 1  /steps/2/question/title')

    for (const target of [['Q3'], ['step-q3'], ['--question', 'Q3']]) {
      const step = await run(dir, ['get', fixture.id, ...target])
      expect(JSON.parse(step.out)).toEqual(fixture.steps[2])
      expect(step.error.trim()).toBe('rev 1  /steps/2')
    }

    const json = await run(dir, ['get', fixture.id, 'Q1', '--json'])
    expect(JSON.parse(json.out)).toEqual({
      rev: 1,
      pointer: '/steps/0',
      value: fixture.steps[0],
      discussions: {},
    })
    expect(json.error).toBe('')
  })

  it('refuses unknown grills, questions and pointers', async () => {
    const dir = await loaded()
    expect(await run(dir, ['get', 'missing'])).toMatchObject({
      code: 2,
      error: 'no source grill missing\n',
    })
    expect((await run(dir, ['get', fixture.id, 'Q99'])).error).toContain(
      'no question or step Q99',
    )
    expect((await run(dir, ['get', fixture.id, '/nope'])).error).toContain(
      'nothing at /nope',
    )
  })
})

describe('gf question', () => {
  const newStep = {
    id: 'step-q30',
    part: fixture.steps[0]!.part,
    heading: 'A new decision',
    prose: ['Why it matters now.'],
    question: {
      id: 'Q30',
      title: 'New?',
      scope: 'Here',
      ask: 'Take the new path?',
      options: [
        { key: 'a', label: 'Yes', effect: 'It happens.', recommended: true },
        { key: 'b', label: 'No', effect: 'It does not.', recommended: false },
      ],
      dependsOn: [],
      when: [],
    },
  }

  it('adds a step after another, defaulting its round, as the next revision', async () => {
    const dir = await loaded()
    const result = await edit(
      dir,
      'question',
      'add',
      fixture.id,
      'Q30',
      '--file',
      write(dir, 'step.json', newStep),
      '--after',
      'Q1',
      '--expect-rev',
      '1',
      '--reason',
      'round 2: Q30',
    )
    expect(result.code).toBe(0)
    expect(result.out).toStartWith(`Q30 added on ${fixture.id}: rev 2`)
    const { grill, revisions } = stored(dir)
    expect(grill.steps[1]).toEqual({
      ...newStep,
      question: { ...newStep.question, round: fixture.round },
    })
    expect(grill.steps).toHaveLength(fixture.steps.length + 1)
    expect(revisions.at(-1)).toMatchObject({
      rev: 2,
      author: 't7',
      reason: 'round 2: Q30',
    })
    const db = database(dir)
    const last = events(db, fixture.id).at(-1)!
    db.close()
    expect(JSON.parse(last.payload)).toMatchObject({
      rev: 2,
      questions: { added: ['Q30'], changed: [], removed: [] },
    })
  })

  it('refuses ids already used by a step, question or resolved outcome', async () => {
    const dir = await loaded()
    const taken = await edit(
      dir,
      'question',
      'add',
      fixture.id,
      'Q30',
      '--file',
      write(dir, 'step.json', {
        ...newStep,
        question: { ...newStep.question, id: 'Q30', dependsOn: [] },
        id: 'step-q1',
      }),
      '--expect-rev',
      '1',
      '--reason',
      'dup',
    )
    expect(taken.code).toBe(2)
    expect(taken.error).toContain('step-q1 already is used')
    expect(
      (
        await edit(
          dir,
          'question',
          'resolve',
          fixture.id,
          'Q17',
          '--outcome',
          'Dropped.',
          '--expect-rev',
          '1',
          '--reason',
          'withdrawn',
        )
      ).code,
    ).toBe(0)
    const reused = await edit(
      dir,
      'question',
      'add',
      fixture.id,
      'Q17',
      '--file',
      write(dir, 'step.json', {
        ...newStep,
        id: 'step-new',
        question: { ...newStep.question, id: 'Q17' },
      }),
      '--expect-rev',
      '2',
      '--reason',
      'reuse',
    )
    expect(reused.error).toContain('Q17 already is used')
    expect(stored(dir).rev).toBe(2)
  })

  it('merges fields into a step and its question, keeping ids', async () => {
    const dir = await loaded()
    const result = await edit(
      dir,
      'question',
      'update',
      fixture.id,
      'step-q2',
      '--file',
      write(dir, 'fields.json', {
        heading: 'Sharper heading',
        question: { title: 'Sharper?', urgency: 'soon' },
      }),
      '--expect-rev',
      '1',
      '--reason',
      'sharpen Q2',
    )
    expect(result.code).toBe(0)
    const step = stored(dir).grill.steps[1]!
    expect(step.heading).toBe('Sharper heading')
    expect(step.question).toEqual({
      ...fixture.steps[1]!.question,
      title: 'Sharper?',
      urgency: 'soon',
    })
    const renamed = await edit(
      dir,
      'question',
      'update',
      fixture.id,
      'Q2',
      '--file',
      write(dir, 'fields.json', { question: { id: 'Q99' } }),
      '--expect-rev',
      '2',
      '--reason',
      'rename',
    )
    expect(renamed.code).toBe(2)
    expect(renamed.error).toContain('ids are their identity')
    const unknown = await edit(
      dir,
      'question',
      'update',
      fixture.id,
      'Q2',
      '--file',
      write(dir, 'fields.json', { question: { titel: 'typo', round: 'x' } }),
      '--expect-rev',
      '2',
      '--reason',
      'typo',
    )
    expect(unknown.code).toBe(2)
    expect(unknown.error).toContain('/steps/1/question/titel: unknown key')
    expect(unknown.error).toContain('/steps/1/question/round: Expected number')
    expect(stored(dir).rev).toBe(2)
  })

  it('resolves a picked question with its outcome and keeps the reload guard', async () => {
    const dir = await loaded()
    const db = database(dir)
    const grill = getGrill(db, fixture.id)!
    expect(
      recordAnswer(db, grill, grill, 'Q1', {
        question: 'Q1',
        key: 'a',
        text: '',
        contextRevision: questionRevisions(grill)['Q1']!,
      }).ok,
    ).toBe(true)
    db.close()

    const dropPick = await edit(
      dir,
      'patch',
      fixture.id,
      '--file',
      write(dir, 'ops.json', [
        { op: 'remove', path: '/steps/0/question/options/0' },
      ]),
      '--expect-rev',
      '1',
      '--reason',
      'drop a',
    )
    expect(dropPick.code).toBe(2)
    expect(dropPick.error).toContain('Reload refused')

    const blank = await edit(
      dir,
      'question',
      'resolve',
      fixture.id,
      'Q1',
      '--outcome',
      '  ',
      '--expect-rev',
      '1',
      '--reason',
      'done',
    )
    expect(blank.error).toContain('needs its decided outcome')

    const resolved = await edit(
      dir,
      'question',
      'resolve',
      fixture.id,
      'Q1',
      '--file',
      write(dir, 'outcome.txt', 'Took a; shipped.\n'),
      '--expect-rev',
      '1',
      '--reason',
      'Q1 done',
    )
    expect(resolved.code).toBe(0)
    expect(resolved.out).toStartWith(`Q1 resolved on ${fixture.id}: rev 2`)
    expect(resolved.error).toContain('Q2, Q3, Q16, Q4 still name Q1')
    const after = stored(dir)
    expect(after.grill.steps.some(step => step.question.id === 'Q1')).toBe(
      false,
    )
    expect(after.grill.decided).toEqual([
      { id: 'Q1', text: 'Took a; shipped.' },
    ])
    expect(after.revisions.at(-1)?.reason).toBe('Q1 done')
  })
})

describe('gf patch', () => {
  it('applies operations to the stored grill as the next revision', async () => {
    const dir = await loaded()
    const result = await edit(
      dir,
      'patch',
      fixture.id,
      '--file',
      write(dir, 'ops.json', [
        { op: 'test', path: '/round', value: 1 },
        { op: 'replace', path: '/title', value: 'Patched' },
        { op: 'add', path: '/next/-', value: 'Then this.' },
      ]),
      '--expect-rev',
      '1',
      '--reason',
      'retitle',
    )
    expect(result).toMatchObject({ code: 0, error: '' })
    expect(result.out).toStartWith(`patched on ${fixture.id}: rev 2`)
    const { grill } = stored(dir)
    expect(grill.title).toBe('Patched')
    expect(grill.next.at(-1)).toBe('Then this.')
  })

  it('refuses a failing test, a new id or an unknown key without a revision', async () => {
    const dir = await loaded()
    for (const [ops, message] of [
      [[{ op: 'test', path: '/round', value: 2 }], 'test failed'],
      [[{ op: 'replace', path: '/id', value: 'other' }], 'keeps the grill id'],
      [[{ op: 'add', path: '/colour', value: 'red' }], '/colour: unknown key'],
    ] as const) {
      const result = await edit(
        dir,
        'patch',
        fixture.id,
        '--file',
        write(dir, 'ops.json', ops),
        '--expect-rev',
        '1',
        '--reason',
        'bad',
      )
      expect(result.code).toBe(2)
      expect(result.error).toContain(message)
    }
    expect(stored(dir).rev).toBe(1)
  })
})

describe('--expect-rev', () => {
  const retitle = (dir: string, rev: string, title: string) =>
    edit(
      dir,
      'patch',
      fixture.id,
      '--file',
      write(dir, `ops-${title}.json`, [
        { op: 'replace', path: '/steps/1/question/title', value: title },
      ]),
      '--expect-rev',
      rev,
      '--reason',
      title,
    )

  it('refuses a stale write with exit 3, the current rev and what changed', async () => {
    const dir = await loaded()
    expect((await retitle(dir, '1', 'First')).code).toBe(0)
    const stale = await retitle(dir, '1', 'Second')
    expect(stale.code).toBe(3)
    expect(stale.error).toContain(
      `Stale write refused: ${fixture.id} is at rev 2, but this write expected rev 1.`,
    )
    expect(stale.error).toMatch(/rev 2 {2}\S+Z {2}t7 {2}First/)
    expect(stale.error).toContain(
      `~ steps[step-q2].question.title: ${JSON.stringify(fixture.steps[1]!.question.title)} -> "First"`,
    )
    expect(stale.error).toContain('retry with --expect-rev 2')
    expect(stored(dir).grill.steps[1]!.question.title).toBe('First')
  })

  it('lets exactly one of two racing writers on the same rev win', async () => {
    const dir = await loaded()
    const results = await Promise.all([
      retitle(dir, '1', 'Left'),
      retitle(dir, '1', 'Right'),
    ])
    expect(results.map(result => result.code).sort()).toEqual([0, 3])
    expect(stored(dir).rev).toBe(2)
  })

  it('is required on edits, and on loads warns until GF_REQUIRE_EXPECT_REV=1', async () => {
    const dir = await loaded()
    const ops = write(dir, 'ops.json', [])
    const missing = await edit(dir, 'patch', fixture.id, '--file', ops)
    expect(missing.code).toBe(2)
    expect(missing.error).toContain('--expect-rev takes')
    const unreasoned = await edit(
      dir,
      'patch',
      fixture.id,
      '--file',
      ops,
      '--expect-rev',
      '1',
    )
    expect(unreasoned.error).toContain('needs --reason')

    const file = write(dir, 'grill.json', fixture)
    const warned = await run(dir, ['load', file, '--reason', 'again'])
    expect(warned.code).toBe(0)
    expect(warned.error).toContain('Expected revision missing')
    const refused = await run(dir, ['load', file, '--reason', 'again'], {
      GF_REQUIRE_EXPECT_REV: '1',
    })
    expect(refused.code).toBe(2)
    expect(refused.error).toContain('GF_REQUIRE_EXPECT_REV=1 refuses')
    const stale = await run(dir, [
      'load',
      file,
      '--reason',
      'again',
      '--expect-rev',
      '1',
    ])
    expect(stale.code).toBe(3)
    expect(stale.error).toContain('is at rev 2')
    expect(stored(dir).rev).toBe(2)
  })
})

describe('gf load', () => {
  it('refuses unknown keys with every problem listed, and warns for newer formats', async () => {
    const dir = folder()
    const raw = structuredClone(fixture) as unknown as Record<string, any>
    raw.steps[0].question.extra = 1
    raw.steps[3].prose = 'not a list'
    const refused = await run(dir, [
      'load',
      write(dir, 'bad.json', raw),
      '--expect-rev',
      '0',
      '--reason',
      'bad',
    ])
    expect(refused.code).toBe(2)
    expect(refused.error).toContain('/steps/0/question/extra: unknown key')
    expect(refused.error).toContain('/steps/3/prose: Expected array')
    const newer = await run(dir, [
      'load',
      write(dir, 'newer.json', {
        ...fixture,
        version: FORMAT_VERSION + 1,
        future: true,
      }),
      '--expect-rev',
      '0',
      '--reason',
      'newer',
    ])
    expect(newer.code).toBe(0)
    expect(newer.error).toContain('dropped keys it does not know: /future')
    expect(stored(dir).grill).not.toHaveProperty('future')
    expect(
      (
        await run(dir, [
          'load',
          write(dir, 'broken.json', '{'),
          '--reason',
          'x',
        ])
      ).error,
    ).toContain('is not valid JSON')
  })

  it('refuses edits and strictly checks loads with GF_OUTBOX', async () => {
    const dir = folder()
    const outbox = join(dir, 'outbox')
    for (const args of [
      ['get', fixture.id],
      ['patch', fixture.id, '--expect-rev', '1', '--reason', 'r'],
    ]) {
      const result = await run(dir, args, { GF_OUTBOX: outbox })
      expect(result.code).toBe(2)
      expect(result.error).toContain('serving machine')
    }
    const refused = await run(
      dir,
      [
        'load',
        write(dir, 'bad.json', { ...fixture, extra: 1 }),
        '--reason',
        'r',
      ],
      { GF_OUTBOX: outbox },
    )
    expect(refused.code).toBe(2)
    expect(refused.error).toContain('/extra: unknown key')
    const queued = await run(
      dir,
      [
        'load',
        write(dir, 'grill.json', fixture),
        '--reason',
        'r',
        '--expect-rev',
        '0',
      ],
      { GF_OUTBOX: outbox },
    )
    expect(queued.code).toBe(0)
    expect(queued.error).toContain('--expect-rev is not checked with GF_OUTBOX')
  })
})
