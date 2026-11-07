import { Database } from 'bun:sqlite'
import { afterEach, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

import {
  questionRevisions,
  readSubmission,
  recordAnswer,
} from './answerReceipts'
import {
  attentionSnapshot,
  focusOwnerStep,
  requestVeto,
  vetoReceipts,
} from './attention'
import { itemHistory, publishItem } from './channel'
import { readPage } from './squad'
import { appendEvent, events, loadGrill, retireGrill } from './store'

const fixture = JSON.parse(readFileSync('src/fixtures/grill.json', 'utf8'))
const databases = new Set<Database>()
afterEach(() => {
  databases.forEach(db => db.close())
  databases.clear()
})
const database = () => {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE grills (id TEXT PRIMARY KEY, json TEXT, loaded_at INTEGER);
    CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, grill_id TEXT, at INTEGER, kind TEXT, payload TEXT);
    CREATE TABLE grill_remotes (grill_id TEXT PRIMARY KEY, machine TEXT, dir TEXT);`)
  databases.add(db)
  return db
}
const source = (db: Database, id = 'worker') =>
  loadGrill(db, {
    ...fixture,
    id,
    session: 't-worker',
    steps: fixture.steps.slice(0, 1),
    squad: { id: 'team', section: id },
  })
const base = {
  version: 1,
  previous: 0,
  revision: 1,
  session: 't-worker',
  body: 'Exact published words.',
}
const owner = {
  ...base,
  kind: 'owner-step',
  id: 'setup',
  host: 'rob-mbp',
  destination: 'https://example.test/session/t-worker',
  action: 'Run the exact command',
  urgency: 'soon',
  blockers: [],
  progress: { state: 'open' },
}
const decision = {
  ...base,
  kind: 'decision',
  id: 'choice',
  deadline: 2000,
  affected: ['PR A'],
  resolution: { state: 'provisional' },
}
const reference = {
  provider: 'github',
  repository: 'rbrtbn/squad',
  number: 102,
  kind: 'pull',
}
const evidence = {
  ...base,
  kind: 'evidence',
  id: 'pr-status',
  reference,
  state: 'merged',
  proof: 'https://github.com/rbrtbn/squad/pull/102',
  checkedAt: 1000,
  validUntil: 2000,
}
const blocker = (id: string, condition: unknown) => ({
  ...base,
  kind: 'blocker',
  id,
  condition,
})
const request = {
  kind: 'veto-requested',
  source: 'worker',
  item: 'choice',
  revision: 1,
  requestId: 'veto-one',
}
const command = () => 'bun run gf'

it('requires explicit completion proof and retains source-owned item revisions across reloads', () => {
  const db = database(),
    grill = source(db)
  const published = publishItem(db, grill, owner)
  expect(published.ok).toBe(true)
  expect(
    publishItem(db, grill, Object.fromEntries(Object.entries(owner).reverse())),
  ).toEqual(published)
  expect(
    publishItem(db, grill, {
      ...owner,
      previous: 1,
      revision: 2,
      progress: { state: 'completed' },
    }).ok,
  ).toBe(false)
  expect(
    publishItem(db, grill, {
      ...owner,
      previous: 1,
      revision: 2,
      action: ' ',
      progress: {
        state: 'completed',
        proof: 'javascript:alert(1)',
        checkedAt: 1000,
      },
    }).ok,
  ).toBe(false)
  const completedProgress: {
    state: 'completed'
    proof: string
    checkedAt: number
  } = {
    state: 'completed',
    proof: 'https://example.test/proof',
    checkedAt: 1000,
  }
  const completed = {
    ...owner,
    previous: 1,
    revision: 2,
    progress: completedProgress,
  }
  expect(publishItem(db, grill, completed, 1000).ok).toBe(true)
  expect(
    publishItem(
      db,
      grill,
      {
        ...completed,
        previous: 2,
        revision: 3,
        progress: { ...completed.progress, checkedAt: 2000 },
      },
      1000,
    ).ok,
  ).toBe(false)
  expect(
    publishItem(db, grill, {
      ...base,
      kind: 'decision',
      id: owner.id,
      deadline: 2000,
      affected: [],
      resolution: { state: 'provisional' },
      previous: 2,
      revision: 3,
    }).ok,
  ).toBe(false)
  loadGrill(db, { ...grill, steps: [] })
  expect(
    attentionSnapshot(db, [grill.id]).ownerSteps?.[0]?.item.progress,
  ).toEqual(completed.progress)
  expect(itemHistory(db, grill.id)).toHaveLength(2)
})

it('derives each named blocker independently and refuses expired or mismatched provider evidence', () => {
  const db = database(),
    grill = source(db)
  publishItem(db, grill, evidence, 1000)
  publishItem(db, grill, owner, 1000)
  publishItem(
    db,
    grill,
    blocker('pr-merged', {
      kind: 'provider',
      source: grill.id,
      evidence: 'pr-status',
      reference,
      state: 'merged',
    }),
    1000,
  )
  publishItem(
    db,
    grill,
    blocker('grant-typed', {
      kind: 'owner-step',
      source: grill.id,
      id: 'setup',
    }),
    1000,
  )
  publishItem(
    db,
    grill,
    blocker('wrong-pr', {
      kind: 'provider',
      source: grill.id,
      evidence: 'pr-status',
      reference: { ...reference, number: 103 },
      state: 'merged',
    }),
    1000,
  )
  expect(
    attentionSnapshot(db, [grill.id], 1500).blockers?.map(entry => [
      entry.item.id,
      entry.state,
    ]),
  ).toEqual([
    ['pr-merged', 'clear'],
    ['grant-typed', 'blocked'],
    ['wrong-pr', 'unknown'],
  ])
  expect(attentionSnapshot(db, [grill.id], 2000).blockers?.[0]?.state).toBe(
    'unknown',
  )
  expect(
    publishItem(db, grill, { ...evidence, id: 'future', checkedAt: 1500 }, 1000)
      .ok,
  ).toBe(false)
  expect(
    publishItem(
      db,
      grill,
      { ...evidence, id: 'unbounded', validUntil: 1000 + 86_400_001 },
      1000,
    ).ok,
  ).toBe(false)
  publishItem(
    db,
    grill,
    {
      ...owner,
      previous: 1,
      revision: 2,
      progress: {
        state: 'completed',
        proof: 'https://example.test/proof',
        checkedAt: 1000,
        validUntil: 1600,
      },
    },
    1000,
  )
  expect(attentionSnapshot(db, [grill.id], 1500).blockers?.[1]?.state).toBe(
    'clear',
  )
  expect(attentionSnapshot(db, [grill.id], 1600).blockers?.[1]?.state).toBe(
    'unknown',
  )
})

it('requires current captured question wording and never treats a legacy answer as evidence', () => {
  const db = database(),
    grill = source(db)
  publishItem(
    db,
    grill,
    blocker('answer', {
      kind: 'question',
      source: grill.id,
      question: 'Q1',
      oneOf: ['a'],
    }),
  )
  expect(attentionSnapshot(db, [grill.id]).blockers?.[0]?.state).toBe('blocked')
  appendEvent(db, grill.id, 'answered', { question: 'Q1', key: 'a' })
  expect(attentionSnapshot(db, [grill.id]).blockers?.[0]?.state).toBe('unknown')
  recordAnswer(db, grill, grill, 'Q1', {
    question: 'Q1',
    key: 'a',
    contextRevision: questionRevisions(grill).Q1,
  })
  expect(attentionSnapshot(db, [grill.id]).blockers?.[0]?.state).toBe('clear')
  const changed = loadGrill(db, {
    ...grill,
    steps: grill.steps.map(step => ({
      ...step,
      question: { ...step.question, ask: 'Changed terms?' },
    })),
  })
  expect(attentionSnapshot(db, [grill.id]).blockers?.[0]?.state).toBe('unknown')
  recordAnswer(db, changed, changed, 'Q1', {
    question: 'Q1',
    key: 'b',
    contextRevision: questionRevisions(changed).Q1,
  })
  expect(attentionSnapshot(db, [grill.id]).blockers?.[0]?.state).toBe('blocked')
  appendEvent(db, grill.id, 'cleared', { question: 'Q1' })
  expect(attentionSnapshot(db, [grill.id]).blockers?.[0]?.state).toBe('blocked')
})

it('freezes one canonical veto receipt before transport and distinguishes late delivery from owner outcome', async () => {
  const db = database(),
    grill = source(db)
  publishItem(db, grill, decision)
  const sends: Array<string> = []
  const result = await requestVeto(
    db,
    readPage(db, 'team')!,
    { ...request, grant: 'never send this extra field' },
    async (session, text) => {
      expect(session).toBe('t-worker')
      expect(vetoReceipts(db, grill.id)).toMatchObject([
        { delivery: 'pending', decision: decision.body, late: true },
      ])
      sends.push(text)
      return { ok: true, detail: 'mock delivery' }
    },
    command,
    () => 2001,
  )
  expect(result.ok).toBe(true)
  expect(sends).toHaveLength(1)
  expect(sends[0]).not.toContain('never send this extra field')
  expect(vetoReceipts(db, grill.id)).toMatchObject([
    {
      delivery: 'delivered',
      acknowledgment: 'none',
      late: true,
      deadline: 2000,
    },
  ])
  const receipt = vetoReceipts(db, grill.id)[0]!
  expect(() => readSubmission(db, grill.id, receipt.event)).toThrow()
  expect(
    await requestVeto(
      db,
      readPage(db, 'team')!,
      request,
      async () => {
        throw new Error('must not redeliver')
      },
      command,
    ),
  ).toEqual(result)
  expect(
    await requestVeto(
      db,
      readPage(db, 'team')!,
      { ...request, requestId: 'another-browser' },
      async () => {
        throw new Error('must not duplicate')
      },
      command,
    ),
  ).toEqual(result)
  expect(
    publishItem(db, grill, {
      ...decision,
      previous: 1,
      revision: 2,
      vetoResponses: [
        { receipt: receipt.event, state: 'acknowledged', text: 'Read it.' },
      ],
    }).ok,
  ).toBe(true)
  expect(vetoReceipts(db, grill.id)[0]?.acknowledgment).toBe('acknowledged')
  expect(
    publishItem(db, grill, {
      ...decision,
      previous: 2,
      revision: 3,
      vetoResponses: [
        {
          receipt: receipt.event,
          state: 'stopped',
          text: 'Stopped the action.',
        },
      ],
    }).ok,
  ).toBe(true)
  expect(
    publishItem(db, grill, {
      ...decision,
      previous: 3,
      revision: 4,
      vetoResponses: [
        {
          receipt: receipt.event,
          state: 'continued',
          text: 'Changed my report.',
        },
      ],
    }).ok,
  ).toBe(false)
  expect(vetoReceipts(db, grill.id)[0]?.acknowledgment).toBe('stopped')
  expect(vetoReceipts(db, grill.id)[0]?.decision).toBe(decision.body)
})

it('keeps failed and interrupted requests visible and rejects stale, foreign and mismatched responses', async () => {
  const db = database(),
    grill = source(db),
    foreign = source(db, 'foreign')
  publishItem(db, grill, decision)
  const page = readPage(db, grill.id)!
  expect(
    (
      await requestVeto(
        db,
        page,
        { ...request, source: foreign.id },
        async () => ({ ok: true, detail: '' }),
        command,
      )
    ).ok,
  ).toBe(false)
  expect(
    (
      await requestVeto(
        db,
        page,
        { ...request, revision: 2 },
        async () => ({ ok: true, detail: '' }),
        command,
      )
    ).ok,
  ).toBe(false)
  const failed = await requestVeto(
    db,
    page,
    request,
    async () => {
      throw new Error('offline')
    },
    command,
    () => 1999,
  )
  expect(failed.ok).toBe(true)
  expect(vetoReceipts(db, grill.id)).toMatchObject([
    { delivery: 'failed', late: false, acknowledgment: 'none' },
  ])
  expect(
    (
      await requestVeto(
        db,
        page,
        { ...request, item: 'another' },
        async () => ({ ok: true, detail: '' }),
        command,
      )
    ).ok,
  ).toBe(false)
  expect(
    publishItem(db, foreign, {
      ...decision,
      vetoResponses: [
        {
          receipt: vetoReceipts(db, grill.id)[0]!.event,
          state: 'stopped',
          text: 'Wrong source',
        },
      ],
    }).ok,
  ).toBe(false)
  const saved = events(db, grill.id).find(
    event => event.kind === 'veto-requested',
  )!
  db.run('DELETE FROM events WHERE grill_id = ? AND kind = ?', [
    grill.id,
    'veto-delivery',
  ])
  expect(vetoReceipts(db, grill.id)[0]?.delivery).toBe('pending')
  await requestVeto(
    db,
    page,
    request,
    async () => {
      throw new Error('replay must not send')
    },
    command,
  )
  expect(vetoReceipts(db, grill.id)[0]?.delivery).toBe('pending')
  expect(vetoReceipts(db, grill.id)[0]?.event).toBe(saved.id)
  retireGrill(db, grill, 'fixture')
  expect(vetoReceipts(db, grill.id)).toHaveLength(1)
})

it.each([
  't42;touch /tmp/unsafe',
  't42\n',
  'homelab/t42',
  '--terminal t42',
  't42 --command sh',
])(
  'rejects crafted or remote terminal destinations %j before any focus',
  address => {
    const db = database(),
      grill = source(db)
    expect(
      publishItem(db, grill, {
        ...owner,
        destination: { kind: 'terminal', address },
      }).ok,
    ).toBe(false)
    expect(attentionSnapshot(db, [grill.id]).ownerSteps).toEqual([])
  },
)

it('focuses only a published local terminal and never accepts a target from the request', async () => {
  const db = database(),
    grill = source(db)
  publishItem(db, grill, {
    ...owner,
    destination: { kind: 'terminal', address: 't42' },
  })
  const page = readPage(db, grill.id)!
  const body = {
    kind: 'owner-focused',
    source: grill.id,
    item: owner.id,
    revision: 1,
    address: 't99;bad',
    text: 'never type this',
  }
  const focused: Array<string> = []
  const focus = async (address: string) => {
    focused.push(address)
    return { ok: true, detail: '' }
  }
  expect(await focusOwnerStep(db, page, body, focus)).toEqual({ ok: true })
  expect(focused).toEqual(['t42'])
  expect(
    (await focusOwnerStep(db, page, { ...body, revision: 2 }, focus)).ok,
  ).toBe(false)
  expect(
    (await focusOwnerStep(db, page, { ...body, source: 'foreign' }, focus)).ok,
  ).toBe(false)
  expect((await focusOwnerStep(db, page, body, focus, true)).ok).toBe(false)
  expect(focused).toEqual(['t42'])
  expect(
    events(db, grill.id).some(event =>
      ['sent', 'asked', 'submitted', 'answered', 'veto-requested'].includes(
        event.kind,
      ),
    ),
  ).toBe(false)
})
