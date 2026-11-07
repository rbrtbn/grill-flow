import { Schema } from 'effect'

import {
  ProviderReading,
  type ProviderReference,
  referenceKey,
  referenceOf,
  referenceUrl,
} from '../src/references'

const PR_FIELDS = 'number,title,state,isDraft,statusCheckRollup,url'
const ISSUE_FIELDS = 'number,title,state,url'
// linear-snapshot echoes its workspace flag; an immutable issue UUID pins the organization.
export const LINEAR_ANCHOR = 'LAB-1280'
export const LINEAR_ANCHOR_UUID = 'd2694e39-f07e-42e0-abde-7eda89b0ffce'
const IDENTITY = [
  'gh',
  'api',
  'user',
  '--hostname',
  'github.com',
  '--jq',
  '{login:.login}',
]
export type ProviderCommand = (args: ReadonlyArray<string>) => Promise<unknown>
const safeText = (value: string): string =>
  value
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .replace(
      /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]+|sk-(?:proj-)?[A-Za-z0-9_-]{16,}|Bearer\s+\S+)/gi,
      '[redacted]',
    )
    .slice(0, 300)
const Github = Schema.Struct({
  number: Schema.Number,
  title: Schema.String,
  state: Schema.Literals(['OPEN', 'CLOSED', 'MERGED']),
  url: Schema.String,
  isDraft: Schema.optionalKey(Schema.Boolean),
  statusCheckRollup: Schema.optionalKey(
    Schema.NullOr(
      Schema.Array(
        Schema.Struct({
          conclusion: Schema.optionalKey(Schema.NullOr(Schema.String)),
          status: Schema.optionalKey(Schema.String),
          state: Schema.optionalKey(Schema.String),
        }),
      ),
    ),
  ),
})
const Linear = Schema.Struct({
  fetchedAt: Schema.String,
  workspace: Schema.Literal('rbrtbn'),
  issues: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      identifier: Schema.String,
      title: Schema.String,
      state: Schema.Struct({ name: Schema.String, type: Schema.String }),
    }),
  ),
})
const checkState = (
  checks: (typeof Github.Type)['statusCheckRollup'],
): ProviderReading['checks'] => {
  if (checks === undefined || checks === null || checks.length === 0) {
    return 'unknown'
  }
  const states = checks.map(
    check =>
      check.conclusion?.toUpperCase() ||
      check.state?.toUpperCase() ||
      check.status?.toUpperCase() ||
      '',
  )
  if (
    states.some(state =>
      [
        'FAILURE',
        'ERROR',
        'TIMED_OUT',
        'CANCELLED',
        'ACTION_REQUIRED',
        'STARTUP_FAILURE',
        'STALE',
      ].includes(state),
    )
  ) {
    return 'failed'
  }
  if (
    states.some(state =>
      [
        'PENDING',
        'QUEUED',
        'IN_PROGRESS',
        'WAITING',
        'REQUESTED',
        'EXPECTED',
      ].includes(state),
    )
  ) {
    return 'pending'
  }
  return states.some(state => state === 'SUCCESS') &&
    states.every(state => ['SUCCESS', 'SKIPPED', 'NEUTRAL'].includes(state))
    ? 'passed'
    : 'unknown'
}

export const createProviderFetcher = (
  run: ProviderCommand,
  now: () => number = Date.now,
) => {
  let identity: Promise<boolean> | undefined
  let identityUntil = 0
  const identityChecked = () => {
    if (identity === undefined || now() >= identityUntil) {
      identityUntil = now() + 900_000
      identity = run(IDENTITY)
        .then(raw => {
          const decoded = Schema.decodeUnknownSync(
            Schema.Struct({ login: Schema.String }),
          )(raw)
          const confirmed = decoded.login === 'rbrtbn'
          identityUntil = now() + (confirmed ? 900_000 : 60_000)
          return confirmed
        })
        .catch(() => {
          identityUntil = now() + 60_000
          return false
        })
    }
    return identity
  }
  return async (reference: ProviderReference): Promise<ProviderReading> => {
    const base = {
      version: 1,
      reference,
      freshness: 'fresh',
      checkedAt: now(),
      validUntil: now() + 600_000,
      url: referenceUrl(reference),
      error: '',
    }
    if (reference.provider === 'github') {
      if (!(await identityChecked())) {
        throw new Error('GitHub account identity is not confirmed.')
      }
      const raw = await run([
        'gh',
        reference.kind === 'pull' ? 'pr' : 'issue',
        'view',
        referenceUrl(reference),
        '--json',
        reference.kind === 'pull' ? PR_FIELDS : ISSUE_FIELDS,
      ])
      const data = Schema.decodeUnknownSync(Github)(raw)
      const resolved = referenceOf('', data.url)
      if (
        resolved === undefined ||
        referenceKey(resolved) !== referenceKey(reference) ||
        data.number !== reference.number
      ) {
        throw new Error('GitHub returned a different reference.')
      }
      const status =
        data.state === 'MERGED'
          ? 'merged'
          : data.state === 'CLOSED'
            ? 'closed'
            : data.isDraft
              ? 'draft'
              : 'open'
      const checks =
        reference.kind === 'pull'
          ? checkState(data.statusCheckRollup)
          : 'not-applicable'
      return Schema.decodeUnknownSync(ProviderReading)({
        ...base,
        checkedAt: now(),
        validUntil: now() + 600_000,
        title: safeText(data.title),
        status,
        type: reference.kind === 'pull' ? 'pr' : 'issue',
        checks,
        states: [
          ...new Set([
            status,
            ...(data.state === 'OPEN' && data.isDraft ? ['open'] : []),
            ...(['passed', 'failed'].includes(checks) ? [checks] : []),
          ]),
        ],
      })
    }
    const ids =
      reference.id === LINEAR_ANCHOR
        ? [LINEAR_ANCHOR]
        : [LINEAR_ANCHOR, reference.id]
    const data = Schema.decodeUnknownSync(Linear)(
      await run(['linear-snapshot', '--workspace', 'rbrtbn', ...ids]),
    )
    const issue = data.issues.find(issue => issue.identifier === reference.id)
    const fetched = Date.parse(data.fetchedAt)
    if (
      issue === undefined ||
      data.issues.length !== ids.length ||
      data.issues.find(item => item.identifier === LINEAR_ANCHOR)?.id !==
        LINEAR_ANCHOR_UUID ||
      !Number.isFinite(fetched) ||
      fetched > now() + 5000 ||
      fetched < now() - 60_000
    ) {
      throw new Error('Linear identity or freshness is not confirmed.')
    }
    const type = [
      'triage',
      'backlog',
      'unstarted',
      'started',
      'completed',
      'canceled',
    ].includes(issue.state.type)
      ? issue.state.type
      : 'issue'
    const state =
      type === 'completed'
        ? 'done'
        : type === 'canceled'
          ? 'closed'
          : type === 'started'
            ? 'in-progress'
            : type === 'issue'
              ? 'unknown'
              : 'open'
    return Schema.decodeUnknownSync(ProviderReading)({
      ...base,
      checkedAt: now(),
      validUntil: now() + 600_000,
      title: safeText(issue.title),
      status: safeText(issue.state.name),
      type,
      states: [state],
      checks: 'not-applicable',
    })
  }
}

export const readProviderCommand: ProviderCommand = async args => {
  const reference = referenceOf('', args[3])
  const allowed =
    JSON.stringify(args) === JSON.stringify(IDENTITY) ||
    (args.length === 6 &&
      args[0] === 'gh' &&
      args[2] === 'view' &&
      args[4] === '--json' &&
      reference?.provider === 'github' &&
      ((args[1] === 'pr' &&
        reference.kind === 'pull' &&
        args[5] === PR_FIELDS) ||
        (args[1] === 'issue' &&
          reference.kind === 'issue' &&
          args[5] === ISSUE_FIELDS))) ||
    ((args.length === 4 || args.length === 5) &&
      args[0] === 'linear-snapshot' &&
      args[1] === '--workspace' &&
      args[2] === 'rbrtbn' &&
      args[3] === LINEAR_ANCHOR &&
      (args.length === 4 || /^[A-Z][A-Z0-9]*-[1-9][0-9]*$/.test(args[4] ?? '')))
  if (!allowed) {
    throw new Error('Unsupported provider read')
  }
  const child = Bun.spawn([...args], {
    stdout: 'pipe',
    stderr: 'ignore',
    timeout: 6000,
  })
  const reader = child.stdout.getReader()
  const collect = async (
    size = 0,
    chunks: ReadonlyArray<Uint8Array> = [],
  ): Promise<string> => {
    const chunk = await reader.read()
    if (chunk.done) {
      return Buffer.concat(chunks).toString('utf8')
    }
    const next = size + chunk.value.byteLength
    if (next > 2_000_000) {
      throw new Error('Oversized provider response')
    }
    return collect(next, chunks.concat(chunk.value))
  }
  try {
    const text = await collect()
    if ((await child.exited) !== 0) {
      throw new Error('Provider read failed')
    }
    return JSON.parse(text)
  } finally {
    if (child.exitCode === null) {
      child.kill()
    }
    reader.releaseLock()
  }
}
