import { Database } from 'bun:sqlite'
import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Grill, Step } from '../src/domain'
import { SKILL_REVISION } from './authoring'
import { strictCheck } from './grillEdit'
import {
  keyFormProblems,
  keyHistoryProblems,
  lintGrill,
  lintLines,
} from './questionLint'
import { readPage } from './squad'
import { appendEvent, loadGrill } from './store'

const fixture: Grill = JSON.parse(
  readFileSync('src/fixtures/grill.json', 'utf8'),
)

type Fields = {
  readonly [K in keyof Step['question']]?: Step['question'][K] | undefined
}

// `undefined` in `fields` drops that field, the way a writer would leave it out.
const step = (
  id: string,
  fields: Fields = {},
  prose: ReadonlyArray<string> = ['Plain reasoning.'],
): Step => ({
  id: `step-${id}`,
  part: 'part-1',
  heading: `Heading ${id}`,
  prose,
  question: JSON.parse(
    JSON.stringify({
      id,
      key: `${id.toLowerCase()}-key`,
      title: `Title ${id}`,
      context: 'What is decided and why now.',
      scope: 'Where it applies',
      ask: 'Take the recommended option?',
      options: [
        {
          key: 'a',
          label: 'Option a',
          effect: 'What a changes.',
          recommended: true,
        },
        {
          key: 'b',
          label: 'Option b',
          effect: 'What b changes.',
          recommended: false,
        },
      ],
      dependsOn: [],
      when: [],
      ...fields,
    }),
  ),
})

const grillOf = (...steps: ReadonlyArray<Step>): Grill => ({
  ...fixture,
  steps,
})

const messages = (grill: Grill, previous?: Grill) =>
  lintGrill(grill, previous).map(
    finding => `${finding.path}: ${finding.message}`,
  )

describe('clarity lint', () => {
  it('is quiet on a question with key, context and plain words', () => {
    expect(lintGrill(grillOf(step('Q1'), step('Q2')))).toEqual([])
  })

  it('reports every finding in one pass, each with its pointer', () => {
    const grill = grillOf(
      step(
        'Q1',
        {
          key: undefined,
          context: undefined,
          ask: 'Keep Q7 as it is?',
          options: [
            {
              key: 'a',
              label: 'Option a',
              effect: 'Unblocks Q2 and the SLO work.',
              recommended: true,
            },
          ],
        },
        ['The MVP needs this before [[q2-key]] can start.'],
      ),
      step('Q2'),
    )
    expect(messages(grill)).toEqual([
      '/steps/0/question: no context — set question.context: what is being decided, why now, and what happens if it waits, for a reader new to this run',
      '/steps/0/question: no key — set question.key to a short kebab-case name and use it in chat, sends and commits',
      '/steps/0/prose/0: forward reference to [[q2-key]], which comes later on the page — say what each answer to it would mean here, or put this question after it',
      '/steps/0/prose/0: "MVP" is not defined — spell it out on first use, as "<words> (MVP)", or add it to terms',
      '/steps/0/question/ask: bare "Q7" — refer to the question by key (give it a key and write [[its-key]]); squad pages renumber questions',
      '/steps/0/question/options/0/effect: forward reference to "Q2", which comes later on the page — say what each answer to it would mean here, or put this question after it; write [[q2-key]]',
      '/steps/0/question/options/0/effect: "SLO" is not defined — spell it out on first use, as "<words> (SLO)", or add it to terms',
    ])
  })

  it('suggests the key for a bare id of an earlier question', () => {
    const grill = grillOf(
      step('Q1'),
      step('Q2', { ask: 'Does Q1 still hold?' }),
    )
    expect(messages(grill)).toEqual([
      '/steps/1/question/ask: bare "Q1" — refer to the question by key (write [[q1-key]]); squad pages renumber questions',
    ])
  })

  it('reads past code spans, links, key references and diagrams', () => {
    const grill = grillOf(
      step('Q1'),
      step('Q2', { ask: 'Does [[q1-key]] hold for `Q9` and `TODO`?' }, [
        'See [Q5 notes](https://example.test/Q5) and https://example.test/NOTE.',
        '```diagram\n{"kind": "flow", "title": "Q4 to Q6"}\n```',
      ]),
    )
    expect(lintGrill(grill)).toEqual([])
  })

  it('takes acronyms defined in terms, entities, the allowlist or in parentheses', () => {
    const grill: Grill = {
      ...grillOf(
        step('Q1', { ask: 'Ship the PR once CI passes and the RFC is in?' }, [
          'The service level objective (SLO) covers it.',
        ]),
        step('Q2', { ask: 'Raise the SLO for the BOX host?' }),
      ),
      terms: [{ term: 'RFC', about: 'A request for comments.', aliases: [] }],
      entities: [
        {
          id: 'box',
          name: 'BOX',
          tone: 'ochre',
          about: 'A host.',
          aliases: [],
        },
      ],
    }
    expect(lintGrill(grill)).toEqual([])
  })

  it('names an unknown key reference and reports an acronym once', () => {
    const grill = grillOf(
      step('Q1', { ask: 'Does [[no-such-key]] apply to the QA run?' }),
      step('Q2', { ask: 'Does the QA run stay?' }),
    )
    expect(messages(grill)).toEqual([
      '/steps/0/question/ask: [[no-such-key]] names no question in fixture; write [[key]] with a key a question here has',
      '/steps/0/question/ask: "QA" is not defined — spell it out on first use, as "<words> (QA)", or add it to terms',
    ])
  })

  it('resolves [[member/key]] against the other members of its squad page', () => {
    const lead: Grill = {
      ...grillOf(step('Q1', { key: 'release-fix' })),
      id: 'lead-run',
    }
    const worker = grillOf(
      step('Q1', { ask: 'Ship after [[lead-run/release-fix]]?' }),
      step('Q2', { ask: 'Ship after [[lead-run/missing]]?' }),
      step('Q3', { ask: 'Ship after [[release-fix]]?' }),
    )
    expect(
      lintGrill(worker, undefined, [lead]).map(finding => finding.message),
    ).toEqual([
      "[[lead-run/missing]] names no question in fixture or another member of its squad page; write [[key]] for a question here, or [[member-grill-id/key]] for another member's",
      '[[release-fix]] names no question in fixture; write [[key]] with a key a question here has',
    ])
  })

  it('leaves [[member/key]] unchecked where the squad page cannot be seen', () => {
    const worker = grillOf(
      step('Q1', { ask: 'Ship after [[lead-run/release-fix]]?' }),
    )
    expect(lintGrill(worker, undefined, undefined)).toEqual([])
    expect(
      lintGrill(worker, undefined, []).map(finding => finding.path),
    ).toEqual(['/steps/0/question/ask'])
  })

  it('lints only the questions a write adds or changes', () => {
    const before = grillOf(step('Q1', { context: undefined }), step('Q2'))
    const after = grillOf(
      step('Q1', { context: undefined }),
      step('Q2', { context: undefined }),
    )
    expect(lintGrill(after, before).map(finding => finding.path)).toEqual([
      '/steps/1/question',
    ])
  })

  it('prints one lint line per finding', () => {
    expect(
      lintLines([{ path: '/steps/3/question/ask', message: 'bare "Q7"' }]),
    ).toBe('lint: /steps/3/question/ask: bare "Q7"')
  })
})

describe('question keys', () => {
  it('refuses a malformed or repeated key alongside schema problems', () => {
    const raw = structuredClone(
      grillOf(
        step('Q1', { key: 'Deploy_Order' }),
        step('Q2', { key: 'ab' }),
        step('Q3', { key: 'q3-key' }),
        step('Q4', { key: 'q3-key' }),
      ),
    ) as unknown as Record<string, any>
    raw.bogus = true
    expect(strictCheck(raw).errors).toEqual([
      { path: '/bogus', message: 'unknown key' },
      {
        path: '/steps/0/question/key',
        message:
          '"Deploy_Order" is not a key: 3 to 48 characters of lowercase letters, digits and single hyphens, starting with a letter, such as deploy-order',
      },
      {
        path: '/steps/1/question/key',
        message:
          '"ab" is not a key: 3 to 48 characters of lowercase letters, digits and single hyphens, starting with a letter, such as deploy-order',
      },
      {
        path: '/steps/3/question/key',
        message:
          '"q3-key" is already the key of Q3; each question needs its own',
      },
    ])
    expect(keyFormProblems(grillOf(step('Q1'), step('Q2')))).toEqual([])
  })

  it('keeps a loaded key: no change, no removal, no reuse by another question', () => {
    const earlier = [grillOf(step('Q1'), step('Q2'))]
    expect(
      keyHistoryProblems(grillOf(step('Q1'), step('Q2'), step('Q3')), earlier),
    ).toEqual([])
    expect(
      keyHistoryProblems(
        grillOf(
          step('Q1', { key: 'renamed' }),
          step('Q2', { key: undefined }),
          step('Q3', { key: 'q1-key' }),
        ),
        earlier,
      ),
    ).toEqual([
      {
        path: '/steps/0/question/key',
        message:
          'Q1 was loaded with key "q1-key", and a key never changes or goes away; keep it. To rename, resolve Q1 and add a new question with the new key',
      },
      {
        path: '/steps/1/question',
        message:
          'Q2 was loaded with key "q2-key", and a key never changes or goes away; keep it. To rename, resolve Q2 and add a new question with the new key',
      },
      {
        path: '/steps/2/question/key',
        message:
          '"q1-key" was the key of Q1 in an earlier revision; keys are never reused, so pick another',
      },
    ])
    expect(
      keyHistoryProblems(grillOf(step('Q2', { key: undefined })), [
        grillOf(step('Q2', { key: undefined })),
      ]),
    ).toEqual([])
  })

  it('qualifies keys two squad members share, and their [[key]] references', () => {
    const db = new Database(':memory:')
    db.exec(`CREATE TABLE grills (id TEXT PRIMARY KEY, json TEXT, loaded_at INTEGER);
      CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, grill_id TEXT, at INTEGER, kind TEXT, payload TEXT);`)
    const member = (id: string, steps: ReadonlyArray<Step>, lead = false) =>
      loadGrill(db, {
        ...grillOf(...steps),
        id,
        squad: { id: 'team', section: id, ...(lead ? { lead: true } : {}) },
      })
    member(
      'lead-run',
      [
        step('Q1', { key: 'deploy-order' }),
        step('Q2', {
          key: 'lead-only',
          ask: 'After [[deploy-order]], Q1 too?',
        }),
      ],
      true,
    )
    member('worker-run', [
      step('Q1', {
        key: 'deploy-order',
        context: 'Q1 waits on [[lead-run/lead-only]].',
      }),
    ])
    const steps = readPage(db, 'team')!.state.grill.steps
    expect(steps.map(item => [item.question.id, item.question.key])).toEqual([
      ['Q1', 'lead-run/deploy-order'],
      ['Q2', 'lead-only'],
      ['Q3', 'worker-run/deploy-order'],
    ])
    expect(steps[1]!.question.ask).toBe(
      'After [[lead-run/deploy-order]], Q1 too?',
    )
    expect(steps[2]!.question.context).toBe(
      'Q3 waits on [[lead-run/lead-only]].',
    )
    db.close()
  })
})

const folders = new Set<string>()
afterEach(() => {
  folders.forEach(path => rmSync(path, { recursive: true, force: true }))
  folders.clear()
})

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
        GF_REQUIRE_CONTEXT: undefined,
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
  return { code, out, error }
}

const keyed = grillOf(step('Q1', { key: 'deploy-order' }), step('Q2'))

const loadedKeyed = async () => {
  const dir = mkdtempSync(join(tmpdir(), 'grill-keys-'))
  folders.add(dir)
  const path = join(dir, 'grill.json')
  writeFileSync(path, JSON.stringify(keyed))
  expect(
    await run(dir, ['load', path, '--expect-rev', '0', '--reason', 'round 1']),
  ).toMatchObject({ code: 0, error: '' })
  return dir
}

const file = (dir: string, name: string, value: unknown) => {
  const path = join(dir, name)
  writeFileSync(path, JSON.stringify(value))
  return path
}

describe('keys, lint and discussions on the CLI', () => {
  it('reads, edits and lists history by key', async () => {
    const dir = await loadedKeyed()
    const got = await run(dir, ['get', 'fixture', 'deploy-order'])
    expect(got.code).toBe(0)
    expect(JSON.parse(got.out).question.id).toBe('Q1')
    expect(got.error.trim()).toBe('rev 1  /steps/0')

    const updated = await run(dir, [
      'question',
      'update',
      'fixture',
      'deploy-order',
      '--file',
      file(dir, 'fields.json', { question: { title: 'Order the deploys' } }),
      '--expect-rev',
      '1',
      '--reason',
      'clearer title',
    ])
    expect(updated).toMatchObject({ code: 0, error: '' })

    const history = await run(dir, ['history', 'fixture', 'deploy-order'])
    expect(history.out).toContain('clearer title  [changed]')
    expect(history.out).toContain('~ title: "Title Q1" -> "Order the deploys"')
  })

  it('refuses a changed or removed key and a reused one, with the way out', async () => {
    const dir = await loadedKeyed()
    const removed = await run(dir, [
      'question',
      'update',
      'fixture',
      'Q1',
      '--file',
      file(dir, 'fields.json', { question: { key: null } }),
      '--expect-rev',
      '1',
      '--reason',
      'drop key',
    ])
    expect(removed.code).toBe(2)
    expect(removed.error).toContain(
      '/steps/0/question: Q1 was loaded with key "deploy-order", and a key never changes or goes away',
    )

    expect(
      (
        await run(dir, [
          'question',
          'resolve',
          'fixture',
          'deploy-order',
          '--outcome',
          'Deploy in order.',
          '--expect-rev',
          '1',
          '--reason',
          'decided',
        ])
      ).code,
    ).toBe(0)
    const reused = await run(dir, [
      'question',
      'add',
      'fixture',
      'Q9',
      '--file',
      file(dir, 'step.json', step('Q9', { key: 'deploy-order' })),
      '--expect-rev',
      '2',
      '--reason',
      'reuse',
    ])
    expect(reused.code).toBe(2)
    expect(reused.error).toContain(
      '"deploy-order" was the key of Q1 in an earlier revision; keys are never reused',
    )
  })

  it("loads a member referencing another member's key on the same squad page without lint", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'grill-siblings-'))
    folders.add(dir)
    const member = (id: string, steps: ReadonlyArray<Step>) =>
      file(dir, `${id}.json`, {
        ...grillOf(...steps),
        id,
        squad: { id: 'team', section: id },
      })
    const load = (path: string) =>
      run(dir, ['load', path, '--expect-rev', '0', '--reason', 'round 1'])
    expect(
      await load(member('lead-run', [step('Q1', { key: 'release-fix' })])),
    ).toMatchObject({ code: 0, error: '' })
    const worker = await load(
      member('worker-run', [
        step('Q1', {
          key: 'ship-order',
          ask: 'Ship after [[lead-run/release-fix]]?',
        }),
      ]),
    )
    expect(worker).toMatchObject({ code: 0, error: '' })
    const stray = await load(
      member('helper-run', [
        step('Q1', {
          key: 'helper-check',
          ask: 'Ship after [[lead-run/missing]]?',
        }),
      ]),
    )
    expect(stray.code).toBe(0)
    expect(stray.error).toContain(
      '[[lead-run/missing]] names no question in helper-run or another member of its squad page',
    )
  })

  it('lints the added question, and GF_REQUIRE_CONTEXT=1 refuses it without context', async () => {
    const dir = await loadedKeyed()
    const added = file(
      dir,
      'step.json',
      step('Q3', {
        key: 'new-thing',
        context: undefined,
        ask: 'Ship it before Q2?',
      }),
    )
    const args = [
      'question',
      'add',
      'fixture',
      'new-thing',
      '--file',
      added,
      '--expect-rev',
      '1',
      '--reason',
      'round 2',
    ]
    const refused = await run(dir, args, { GF_REQUIRE_CONTEXT: '1' })
    expect(refused.code).toBe(2)
    expect(refused.error).toContain(
      'GF_REQUIRE_CONTEXT=1 refuses questions without context; set question.context at /steps/2/question',
    )

    const warned = await run(dir, args)
    expect(warned.code).toBe(0)
    expect(warned.error.trim().split('\n')).toEqual([
      'lint: /steps/2/question: no context — set question.context: what is being decided, why now, and what happens if it waits, for a reader new to this run',
      'lint: /steps/2/question/ask: bare "Q2" — refer to the question by key (write [[q2-key]]); squad pages renumber questions',
    ])
  })

  it('serves discussions with gf get and strips an edited-in discussions key', async () => {
    const dir = await loadedKeyed()
    const db = new Database(join(dir, 'test.sqlite'))
    appendEvent(db, 'fixture', 'asked', { stepId: 'step-Q1', text: 'Why?' })
    db.close()

    const json = await run(dir, ['get', 'fixture', '--json'])
    expect(JSON.parse(json.out).discussions).toMatchObject({
      Q1: { target: 'step-Q1', asks: 1, open: 1 },
    })
    const plain = await run(dir, ['get', 'fixture', 'Q2'])
    expect(plain.error).toContain(
      'discussions: Q1 (1 open) (gf export fixture for the threads)',
    )

    const patched = await run(dir, [
      'patch',
      'fixture',
      '--file',
      file(dir, 'ops.json', [
        { op: 'add', path: '/discussions', value: { Q1: { asks: 9 } } },
      ]),
      '--expect-rev',
      '1',
      '--reason',
      'copied back',
    ])
    expect(patched.code).toBe(0)
    expect(patched.error).toContain('Ignored "discussions" in fixture')
  })
})
