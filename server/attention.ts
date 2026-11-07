import type { Database } from 'bun:sqlite'
import { Schema } from 'effect'

import { type ChannelItem, VetoReceipt } from '../src/channel'
import { RecordedAnswer, type Snapshot, statusOf } from '../src/domain'
import { type ProviderReading, referenceKey } from '../src/references'
import { questionRevisions } from './answerReceipts'
import { itemHistory, latestItems } from './channel'
import type { SessionSender } from './delivery'
import { type Page, readPage } from './squad'
import { appendEvent, events, getGrill, snapshot } from './store'

const VetoRequest = Schema.Struct({
  kind: Schema.Literal('veto-requested'),
  source: Schema.String,
  item: Schema.String,
  revision: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
  requestId: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(200),
  ),
})
const FrozenVeto = Schema.Struct({
  ...VetoRequest.fields,
  version: Schema.Literal(1),
  recordedAt: Schema.Number,
  decision: Schema.String,
  deadline: Schema.Number,
  session: Schema.String,
  late: Schema.Boolean,
})

export const vetoReceipts = (
  db: Database,
  source: string,
): ReadonlyArray<typeof VetoReceipt.Type> => {
  const history = events(db, source)
  const responses = itemHistory(db, source).flatMap(entry =>
    entry.item.kind === 'decision' ? (entry.item.vetoResponses ?? []) : [],
  )
  return history
    .filter(event => event.kind === 'veto-requested')
    .map(event => {
      const request = Schema.decodeUnknownSync(FrozenVeto)(
        JSON.parse(event.payload),
      )
      const sent = history
        .filter(entry => entry.kind === 'veto-delivery')
        .map(entry => JSON.parse(entry.payload))
        .reverse()
        .find(entry => entry.receipt === event.id)
      const response = [...responses]
        .reverse()
        .find(entry => entry.receipt === event.id)
      return {
        version: 1,
        source,
        event: event.id,
        at: request.recordedAt,
        item: request.item,
        revision: request.revision,
        decision: request.decision,
        deadline: request.deadline,
        session: request.session,
        late: request.late,
        delivery:
          sent === undefined ? 'pending' : sent.ok ? 'delivered' : 'failed',
        detail:
          sent?.detail ??
          'Delivery is unconfirmed; the saved request remains available to its owner.',
        acknowledgment: response?.state ?? 'none',
        response: response?.text ?? '',
      }
    })
}

export const requestVeto = async (
  db: Database,
  page: Page,
  raw: unknown,
  send: SessionSender,
  command: (source: string, session: string) => string,
  clock = Date.now,
): Promise<
  | Readonly<{ ok: true; event: number }>
  | Readonly<{ ok: false; status: number; error: string }>
> => {
  const decoded = Schema.decodeUnknownResult(VetoRequest)(raw)
  if (decoded._tag === 'Failure') {
    return { ok: false, status: 400, error: 'Invalid veto request.' }
  }
  const request = decoded.success
  const sources =
    page.members.length > 0
      ? page.members.map(member => member.state.grill.id)
      : [page.state.grill.id]
  if (!sources.includes(request.source)) {
    return {
      ok: false,
      status: 400,
      error: 'That decision does not belong to this page.',
    }
  }
  const frozen = db
    .transaction(() => {
      const previous = events(db, request.source)
        .filter(event => event.kind === 'veto-requested')
        .map(event => ({
          event: event.id,
          request: Schema.decodeUnknownSync(FrozenVeto)(
            JSON.parse(event.payload),
          ),
        }))
      const replay = previous.find(
        entry => entry.request.requestId === request.requestId,
      )
      if (replay !== undefined) {
        return replay.request.item === request.item &&
          replay.request.revision === request.revision
          ? ({ ok: true, event: replay.event, fresh: false } satisfies {
              ok: true
              event: number
              fresh: boolean
            })
          : ({
              ok: false,
              status: 409,
              error:
                'That veto request ID was already used for another decision.',
            } satisfies { ok: false; status: number; error: string })
      }
      const entry = latestItems(db, request.source).find(
        entry => entry.item.id === request.item,
      )
      if (
        entry?.item.kind !== 'decision' ||
        entry.item.revision !== request.revision ||
        entry.item.resolution.state !== 'provisional'
      ) {
        return {
          ok: false,
          status: 409,
          error:
            'The provisional decision changed. Reload before requesting a veto.',
        } satisfies { ok: false; status: number; error: string }
      }
      const existing = previous.find(
        entry =>
          entry.request.item === request.item &&
          entry.request.revision === request.revision,
      )
      if (existing !== undefined) {
        return { ok: true, event: existing.event, fresh: false } satisfies {
          ok: true
          event: number
          fresh: boolean
        }
      }
      const now = clock()
      const record = Schema.decodeUnknownSync(FrozenVeto)({
        version: 1,
        ...request,
        recordedAt: now,
        decision: entry.item.body,
        deadline: entry.item.deadline,
        session: entry.item.session,
        late: now > entry.item.deadline,
      })
      return {
        ok: true,
        event: appendEvent(db, request.source, 'veto-requested', record),
        fresh: true,
        record,
      } satisfies {
        ok: true
        event: number
        fresh: boolean
        record: typeof FrozenVeto.Type
      }
    })
    .immediate()
  if (!frozen.ok) {
    return frozen
  }
  if (!frozen.fresh || !('record' in frozen)) {
    return { ok: true, event: frozen.event }
  }
  const receipt = frozen.event
  const record = frozen.record
  const sourceArgument = `'${record.source.replaceAll("'", "'\\''")}'`
  const text = [
    `[grill-flow] Veto request ${record.source}#${receipt} for ${record.item} revision ${record.revision}.`,
    record.late
      ? 'This request arrived after the deadline.'
      : 'This request arrived within the veto window.',
    `Decision: ${record.decision}`,
    'This is a page veto request, not a grant. Delivery does not prove that an action stopped.',
    `Read the saved receipt with ${command(record.source, record.session)} events ${sourceArgument} --since ${receipt - 1}.`,
    `Acknowledge or confirm the outcome by publishing the next decision revision with vetoResponses:[{receipt:${receipt},state:"acknowledged"|"stopped"|"continued",text:"your response"}].`,
    'The lead copies each T1 veto receipt to Linear.',
  ].join('\n')
  const result = await send(record.session, text).catch(error => ({
    ok: false,
    detail: String(error).slice(0, 300),
  }))
  appendEvent(db, record.source, 'veto-delivery', { receipt, ...result })
  return { ok: true, event: receipt }
}

export const focusOwnerStep = async (
  db: Database,
  page: Page,
  raw: unknown,
  focus: (
    address: string,
  ) => Promise<Readonly<{ ok: boolean; detail: string }>>,
  preview = false,
): Promise<
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; status: number; error: string }>
> => {
  if (preview) {
    return {
      ok: false,
      status: 409,
      error: 'Preview does not focus live sessions.',
    }
  }
  const decoded = Schema.decodeUnknownResult(
    Schema.Struct({
      kind: Schema.Literal('owner-focused'),
      source: Schema.String,
      item: Schema.String,
      revision: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
    }),
  )(raw)
  if (decoded._tag === 'Failure') {
    return {
      ok: false,
      status: 400,
      error: 'Invalid owner destination request.',
    }
  }
  const request = decoded.success
  const sources =
    page.members.length > 0
      ? page.members.map(member => member.state.grill.id)
      : [page.state.grill.id]
  if (!sources.includes(request.source)) {
    return {
      ok: false,
      status: 400,
      error: 'That owner step does not belong to this page.',
    }
  }
  const published = latestItems(db, request.source).find(
    entry => entry.item.id === request.item,
  )
  if (
    published?.item.kind !== 'owner-step' ||
    published.item.revision !== request.revision ||
    typeof published.item.destination === 'string'
  ) {
    return {
      ok: false,
      status: 409,
      error:
        'The published owner destination changed or is not a local terminal.',
    }
  }
  const result = await focus(published.item.destination.address).catch(
    error => ({ ok: false, detail: String(error).slice(0, 300) }),
  )
  return result.ok
    ? { ok: true }
    : { ok: false, status: 502, error: result.detail }
}

type BlockerStatus = Readonly<{
  state: 'blocked' | 'clear' | 'unknown'
  checkedAt: number | null
  detail: string
  proof?: string
}>
const unknown = (
  detail: string,
  checkedAt: number | null = null,
  proof?: string,
): BlockerStatus => ({
  state: 'unknown',
  checkedAt,
  detail,
  ...(proof === undefined ? {} : { proof }),
})
const conditionState = (
  db: Database,
  item: Extract<ChannelItem, { kind: 'blocker' }>,
  now: number,
  providerReadings?: ReadonlyArray<ProviderReading>,
): BlockerStatus => {
  const condition = item.condition
  const source = getGrill(db, condition.source)
  if (source === undefined) {
    return unknown('The named source is unavailable.')
  }
  if (condition.kind === 'question') {
    const state = snapshot(db, source)
    const question = source.steps.find(
      step => step.question.id === condition.question,
    )
    if (question === undefined) {
      return unknown('The named question is no longer published.')
    }
    const latest = events(db, source.id)
      .filter(event => event.kind === 'answered' || event.kind === 'cleared')
      .reverse()
      .find(event => JSON.parse(event.payload).question === condition.question)
    if (latest === undefined || latest.kind === 'cleared') {
      return {
        state: 'blocked',
        checkedAt: latest?.at ?? now,
        detail: 'The named question has no saved answer.',
      }
    }
    const captured = Schema.decodeUnknownResult(RecordedAnswer)(
      JSON.parse(latest.payload).receipt,
    )
    if (captured._tag === 'Failure' || captured.success.context === null) {
      return unknown('The saved answer has no captured wording.')
    }
    const context = captured.success.context
    const display = readPage(db, context.displayPage)?.state.grill
    if (
      display === undefined ||
      questionRevisions(display)[context.displayQuestion] !== context.revision
    ) {
      return unknown('The question wording changed after this answer.')
    }
    const clear =
      statusOf(source, state.answers, condition.question)._tag === 'Answered' &&
      condition.oneOf.includes(state.answers[condition.question] ?? '')
    return {
      state: clear ? 'clear' : 'blocked',
      checkedAt: latest.at,
      detail: clear
        ? 'The named answer condition is met.'
        : 'The saved answer does not meet the named condition.',
    }
  }
  const dependency = latestItems(db, source.id).find(
    entry =>
      entry.item.id ===
      (condition.kind === 'owner-step' ? condition.id : condition.evidence),
  )
  if (condition.kind === 'owner-step') {
    if (dependency?.item.kind !== 'owner-step') {
      return unknown('The named owner step is unavailable.')
    }
    const progress = dependency.item.progress
    if (progress.state !== 'completed') {
      return {
        state: 'blocked',
        checkedAt: dependency.at,
        detail: 'The owner step has no reported completion proof.',
      }
    }
    if (
      (progress.validUntil !== undefined && progress.validUntil <= now) ||
      progress.checkedAt > now
    ) {
      return unknown(
        'The owner-reported completion evidence is expired or future-dated.',
        progress.checkedAt,
        progress.proof,
      )
    }
    return {
      state: 'clear',
      checkedAt: progress.checkedAt,
      detail: 'The owner reported completion with a proof link.',
      proof: progress.proof,
    }
  }
  const primary = providerReadings?.find(
    reading =>
      referenceKey(reading.reference) === referenceKey(condition.reference),
  )
  if (primary !== undefined) {
    if (
      dependency?.item.kind !== 'evidence' ||
      referenceKey(dependency.item.reference) !==
        referenceKey(condition.reference)
    ) {
      return unknown(
        'The named evidence item is unavailable or names a different reference.',
      )
    }
    if (
      primary.freshness !== 'fresh' ||
      primary.checkedAt === null ||
      primary.checkedAt > now ||
      primary.validUntil === null ||
      primary.validUntil <= now ||
      primary.states.includes('unknown') ||
      ((condition.state === 'passed' || condition.state === 'failed') &&
        ['unknown', 'not-applicable'].includes(primary.checks))
    ) {
      return unknown(
        'Primary provider evidence is unavailable, stale or unknown.',
        primary.checkedAt,
        primary.url,
      )
    }
    return {
      state: primary.states.includes(condition.state) ? 'clear' : 'blocked',
      checkedAt: primary.checkedAt,
      proof: primary.url,
      detail: `Primary ${primary.reference.provider} evidence is ${primary.status}; checks ${primary.checks}; required ${condition.state}.`,
    }
  }
  if (
    dependency?.item.kind !== 'evidence' ||
    dependency.item.state === 'unknown' ||
    dependency.item.validUntil <= now ||
    dependency.item.checkedAt > now ||
    JSON.stringify(dependency.item.reference) !==
      JSON.stringify(condition.reference)
  ) {
    return dependency?.item.kind === 'evidence'
      ? unknown(
          'Provider evidence is unknown, expired or names a different reference.',
          dependency.item.checkedAt,
          dependency.item.proof,
        )
      : unknown('Provider evidence is unavailable.')
  }
  return {
    state: dependency.item.state === condition.state ? 'clear' : 'blocked',
    checkedAt: dependency.item.checkedAt,
    proof: dependency.item.proof,
    detail: `Agent-reported ${dependency.item.reference.provider} evidence is ${dependency.item.state}; required ${condition.state}.`,
  }
}

export const attentionSnapshot = (
  db: Database,
  sources: ReadonlyArray<string>,
  now = Date.now(),
  providerReadings?: ReadonlyArray<ProviderReading>,
): Pick<Snapshot, 'ownerSteps' | 'decisions' | 'blockers' | 'channelNow'> => {
  const latest = sources.flatMap(source => latestItems(db, source))
  return {
    channelNow: now,
    ownerSteps: latest.flatMap(entry =>
      entry.item.kind === 'owner-step' ? [{ ...entry, item: entry.item }] : [],
    ),
    decisions: latest.flatMap(entry =>
      entry.item.kind === 'decision'
        ? [
            {
              ...entry,
              item: entry.item,
              window: now > entry.item.deadline ? 'expired' : 'open',
              vetoes: vetoReceipts(db, entry.source).filter(
                receipt => receipt.item === entry.item.id,
              ),
            },
          ]
        : [],
    ),
    blockers: latest.flatMap(entry =>
      entry.item.kind === 'blocker'
        ? [
            {
              ...entry,
              item: entry.item,
              ...conditionState(db, entry.item, now, providerReadings),
            },
          ]
        : [],
    ),
  }
}
