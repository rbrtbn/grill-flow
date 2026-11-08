import type { Database } from 'bun:sqlite'
import { Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'
import { createHash } from 'node:crypto'

import { pageMessage } from './messages'

const Identifier = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9._:-]{1,160}$/),
)
const Source = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9._-]{1,100}$/))
const Natural = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
)
const Positive = Natural.check(Schema.isGreaterThan(0))
const UUID = Schema.String.check(
  Schema.isPattern(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  ),
)
const NativeIdentity = Schema.Struct({
  runtime: Schema.Literals(['claude-cli', 'claude-desktop', 'codex-cli']),
  uuid: UUID,
})
const ProcessIdentity = Schema.Struct({
  pid: Positive,
  frontend: Identifier,
  backend: Identifier,
  socket: Identifier,
})
const QuestionIdentity = Schema.NullOr(
  Schema.Struct({ id: Identifier, revision: Identifier }),
)
export const PilotBinding = Schema.Struct({
  version: Schema.Literal(1),
  mode: Schema.Literal('fixture-only'),
  source: Source,
  thread: Identifier,
  run: Identifier,
  epoch: Positive,
  previous: Natural,
  route: Schema.String.check(Schema.isPattern(/^t[0-9a-z]+$/)),
  native: NativeIdentity,
  process: ProcessIdentity,
  question: QuestionIdentity,
})
export type PilotBinding = typeof PilotBinding.Type
export const FixtureObservation = Schema.Struct({
  mode: Schema.Literal('fixture-only'),
  source: Source,
  thread: Identifier,
  run: Identifier,
  route: Schema.String.check(Schema.isPattern(/^t[0-9a-z]+$/)),
  native: NativeIdentity,
  process: ProcessIdentity,
  question: QuestionIdentity,
  turn: Identifier,
  at: Natural,
  capability: Schema.String.check(Schema.isMaxLength(100)),
})
export type FixtureObservation = typeof FixtureObservation.Type
export const PilotEnvelopeRequest = Schema.Struct({
  version: Schema.Literal(1),
  mode: Schema.Literal('fixture-only'),
  source: Source,
  thread: Identifier,
  messageId: Identifier,
  replyTo: Schema.NullOr(Positive),
  senderKind: Schema.Literals(['page', 'agent']),
  questionRevision: Schema.NullOr(Identifier),
  body: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100_000)),
})
export type PilotEnvelopeRequest = typeof PilotEnvelopeRequest.Type
const Receipt = Schema.Struct({
  envelope: Positive,
  binding: Positive,
  digest: Schema.String,
  turn: Identifier,
  native: NativeIdentity,
})
const PilotEvent = defineTaggedUnion({
  Bound: { binding: PilotBinding },
  Enqueued: {
    request: PilotEnvelopeRequest,
    requestDigest: Schema.String,
    binding: Positive,
    recipient: PilotBinding,
    digest: Schema.String,
  },
  Transported: { envelope: Positive, ok: Schema.Boolean },
  Consumed: { receipt: Receipt },
})
type PilotEvent = typeof PilotEvent.Type
type Row = Readonly<{
  id: number
  at: number
  source: string
  event: PilotEvent
}>
type Bound = Readonly<{
  id: number
  at: number
  binding: PilotBinding
  digest: string
}>
type Envelope = Readonly<{
  id: number
  at: number
  request: PilotEnvelopeRequest
  requestDigest: string
  binding: number
  recipient: PilotBinding
  digest: string
}>

export class PilotFault extends Error {}
const invalid = (reason: string): never => {
  throw new PilotFault(reason)
}
const decode = <A>(
  schema: Schema.ConstraintDecoder<A, never>,
  value: unknown,
): A => {
  const result = Schema.decodeUnknownResult(schema)(value)
  return result._tag === 'Success'
    ? result.success
    : invalid('Invalid fixture protocol record.')
}
const canonical = (value: unknown): string => {
  if (value === null || typeof value !== 'object')
    return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  return (
    '{' +
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => JSON.stringify(key) + ':' + canonical(child))
      .join(',') +
    '}'
  )
}
const digestOf = (value: unknown) =>
  createHash('sha256').update(canonical(value)).digest('hex')
const bindingOf = (row: Row): Bound | undefined =>
  row.event._tag === 'Bound'
    ? {
        id: row.id,
        at: row.at,
        binding: row.event.binding,
        digest: digestOf(row.event.binding),
      }
    : undefined
const envelopeOf = (row: Row): Envelope | undefined =>
  row.event._tag === 'Enqueued'
    ? { id: row.id, at: row.at, ...row.event }
    : undefined

export const matchFixtureTurn = (
  binding: PilotBinding,
  raw: unknown,
  now: number,
): FixtureObservation => {
  decode(Natural, now)
  const observation = decode(FixtureObservation, raw)
  if (observation.capability !== 'pull-turn-v1')
    invalid(
      'Unsupported fixture runtime capability; no native runtime support is implied.',
    )
  if (observation.at > now + 5_000 || now - observation.at > 30_000)
    invalid('Fixture runtime observation is stale or future-dated.')
  const observed = {
    source: observation.source,
    thread: observation.thread,
    run: observation.run,
    route: observation.route,
    native: observation.native,
    process: observation.process,
    question: observation.question,
  }
  const expected = {
    source: binding.source,
    thread: binding.thread,
    run: binding.run,
    route: binding.route,
    native: binding.native,
    process: binding.process,
    question: binding.question,
  }
  if (canonical(observed) !== canonical(expected))
    invalid(
      'Fixture recipient binding conflicts with the observed source, run, native identity, process or question.',
    )
  return observation
}

// This store accepts fixtures only; matching a fixture never establishes native production readiness.
export const runtimePilot = (db: Database, clock: () => number = Date.now) => {
  const history = (): ReadonlyArray<Row> =>
    db
      .query<{ id: number; at: number; grill_id: string; payload: string }, []>(
        "SELECT id, at, grill_id, payload FROM events WHERE kind = 'runtime-pilot' ORDER BY id",
      )
      .all()
      .map(row => ({
        id: row.id,
        at: row.at,
        source: row.grill_id,
        event: decode(PilotEvent, JSON.parse(row.payload)),
      }))
  const append = (source: string, event: PilotEvent) => {
    const count =
      db
        .query<{ count: number }, []>(
          "SELECT COUNT(*) AS count FROM events WHERE kind = 'runtime-pilot'",
        )
        .get()?.count ?? 0
    if (count >= 10_000) invalid('Fixture store event limit reached.')
    const at = decode(Natural, clock())
    const id = Number(
      db.run(
        "INSERT INTO events (grill_id, at, kind, payload) VALUES (?, ?, 'runtime-pilot', ?)",
        [source, at, JSON.stringify(event)],
      ).lastInsertRowid,
    )
    return { id, at }
  }
  const latest = (source: string, thread: string, rows = history()): Bound => {
    const row = [...rows]
      .reverse()
      .map(bindingOf)
      .find(
        bound =>
          bound?.binding.source === source && bound.binding.thread === thread,
      )
    return (
      row ??
      invalid('No published fixture recipient binding for this source/thread.')
    )
  }
  const envelope = (id: number): Envelope => {
    decode(Positive, id)
    return (
      history()
        .map(envelopeOf)
        .find(row => row?.id === id) ?? invalid('Unknown fixture envelope.')
    )
  }
  const state = (item: Envelope, rows = history()) => {
    const consumed = rows.find(
      row =>
        row.event._tag === 'Consumed' && row.event.receipt.envelope === item.id,
    )
    const transport = [...rows]
      .reverse()
      .find(
        row =>
          row.event._tag === 'Transported' && row.event.envelope === item.id,
      )
    const current = latest(item.request.source, item.request.thread, rows)
    return {
      delivery:
        transport?.event._tag !== 'Transported'
          ? 'unconfirmed'
          : transport.event.ok
            ? 'delivered'
            : 'failed',
      consumption:
        consumed !== undefined
          ? 'consumed'
          : current.id !== item.binding || current.digest !== item.digest
            ? 'conflict'
            : 'pending',
      receipt:
        consumed?.event._tag === 'Consumed'
          ? { id: consumed.id, at: consumed.at, ...consumed.event.receipt }
          : null,
    }
  }
  const bind = (raw: unknown, observation: unknown): Bound =>
    db
      .transaction(() => {
        const binding = decode(PilotBinding, raw)
        matchFixtureTurn(binding, observation, clock())
        const current = [...history()]
          .reverse()
          .map(bindingOf)
          .find(
            row =>
              row?.binding.source === binding.source &&
              row.binding.thread === binding.thread,
          )
        const digest = digestOf(binding)
        if (current?.digest === digest) return current
        if (
          binding.previous !== (current?.id ?? 0) ||
          binding.epoch !== (current?.binding.epoch ?? 0) + 1
        )
          invalid('Fixture binding revision or handover epoch conflicts.')
        const saved = append(binding.source, PilotEvent.Bound({ binding }))
        return { ...saved, binding, digest }
      })
      .immediate()
  const enqueue = (raw: unknown): Envelope =>
    db
      .transaction(() => {
        const request = decode(PilotEnvelopeRequest, raw)
        const requestDigest = digestOf(request)
        const replay = history()
          .map(envelopeOf)
          .find(
            row =>
              row?.request.source === request.source &&
              row.request.thread === request.thread &&
              row.request.messageId === request.messageId,
          )
        if (replay !== undefined) {
          if (replay.requestDigest !== requestDigest)
            invalid('Fixture message ID already names different content.')
          return replay
        }
        const current = latest(request.source, request.thread)
        if (
          request.questionRevision !==
          (current.binding.question?.revision ?? null)
        )
          invalid('Fixture question revision changed before enqueue.')
        if (request.replyTo !== null) {
          const target = envelope(request.replyTo)
          if (
            target.request.source !== request.source ||
            target.request.thread !== request.thread
          )
            invalid('Fixture reply target belongs to another source/thread.')
        }
        const event = PilotEvent.Enqueued({
          request,
          requestDigest,
          binding: current.id,
          recipient: current.binding,
          digest: current.digest,
        })
        const saved = append(request.source, event)
        return { ...saved, ...event }
      })
      .immediate()
  const inbox = (source: string, thread: string, observation: unknown) => {
    const rows = history()
    const binding = latest(source, thread, rows)
    const turn = matchFixtureTurn(binding.binding, observation, clock())
    const all = rows
      .map(envelopeOf)
      .filter(
        (row): row is Envelope =>
          row !== undefined &&
          row.request.source === source &&
          row.request.thread === thread,
      )
    const projected = all.map(row => ({ ...row, ...state(row, rows) }))
    const relevant = projected.filter(row => row.consumption !== 'consumed')
    const pending = relevant.filter(row => row.consumption === 'pending')
    return {
      binding,
      turn: turn.turn,
      pending: pending.slice(0, 100).map(row => ({
        ...row,
        formatted: pageMessage(
          '[fixture-only runtime pilot]\n' + row.request.body,
        ),
      })),
      conflicts: relevant
        .filter(row => row.consumption === 'conflict')
        .slice(0, 100)
        .map(row => ({
          envelope: row.id,
          reason: 'recipient-binding-or-question-changed',
        })),
      truncated: pending.length > 100 || relevant.length - pending.length > 100,
    }
  }
  const acknowledge = (id: number, observation: unknown) =>
    db
      .transaction(() => {
        const item = envelope(id)
        const current = latest(item.request.source, item.request.thread)
        const turn = matchFixtureTurn(current.binding, observation, clock())
        if (current.id !== item.binding || current.digest !== item.digest)
          invalid(
            'Fixture recipient or question changed; acknowledgement refused.',
          )
        const previous = state(item).receipt
        if (previous !== null) return previous
        const receipt = {
          envelope: id,
          binding: current.id,
          digest: current.digest,
          native: current.binding.native,
          turn: turn.turn,
        }
        const saved = append(
          item.request.source,
          PilotEvent.Consumed({ receipt }),
        )
        return { ...saved, ...receipt }
      })
      .immediate()
  const recordDelivery = (id: number, ok: boolean) =>
    db
      .transaction(() => {
        const item = envelope(id)
        decode(Schema.Boolean, ok)
        return append(
          item.request.source,
          PilotEvent.Transported({ envelope: id, ok }),
        ).id
      })
      .immediate()
  return {
    bind,
    enqueue,
    inbox,
    acknowledge,
    recordDelivery,
    inspect: (id: number) => {
      const item = envelope(id)
      return { ...item, ...state(item) }
    },
  }
}

export type RuntimePilot = ReturnType<typeof runtimePilot>

export const runFixtureTurn = async (
  pilot: RuntimePilot,
  source: string,
  thread: string,
  observe: () => unknown,
  receive: (body: string, event: number) => Promise<boolean>,
) => {
  const batch = pilot.inbox(source, thread, observe())
  const outcomes = []
  for (const item of batch.pending) {
    try {
      if (
        !pilot
          .inbox(source, thread, observe())
          .pending.some(pending => pending.id === item.id)
      ) {
        outcomes.push({
          envelope: item.id,
          consumed: false,
          reason: 'fixture-envelope-no-longer-pending',
        })
        continue
      }
      if (!(await receive(item.formatted, item.id))) {
        outcomes.push({
          envelope: item.id,
          consumed: false,
          reason: 'fixture-handler-declined',
        })
        continue
      }
      const receipt = pilot.acknowledge(item.id, observe())
      outcomes.push({ envelope: item.id, consumed: true, receipt })
    } catch {
      outcomes.push({
        envelope: item.id,
        consumed: false,
        reason: 'fixture-handler-or-binding-failed',
      })
    }
  }
  return {
    mode: 'fixture-only',
    productionReady: false,
    outcomes,
    truncated: batch.truncated,
  }
}
