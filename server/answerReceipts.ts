import type { Database } from 'bun:sqlite'
import { Schema } from 'effect'
import { createHash } from 'node:crypto'

import {
  RecordedAnswer,
  SubmissionAnswer,
  OWN,
  TEXT_LIMIT,
  type Grill,
  type Question,
  type Step,
  type Snapshot,
  questionSession,
  roundOf,
  sendableLines,
  textLimitError,
} from '../src/domain'
import { DeliveryReceipt } from './delivery'
import { SendRequest, type SendSelection } from './sendSelection'
import { appendEvent, events, sentLines, snapshot } from './store'

export class SubmissionConflict extends Error {}
export class ContextUnavailable extends Error {}

const Submission = Schema.Struct({
  version: Schema.Literal(1),
  requestId: Schema.NullOr(Schema.String),
  requestDigest: Schema.String,
  displayPage: Schema.String,
  questions: Schema.Record(Schema.String, Schema.String),
  answers: Schema.Array(SubmissionAnswer),
  lines: Schema.Record(Schema.String, Schema.String),
  message: Schema.String,
  recipients: Schema.Array(Schema.String),
})
const AnswerRequest = Schema.Struct({
  question: Schema.String,
  key: Schema.String,
  text: Schema.optionalKey(Schema.String),
  contextRevision: Schema.optionalKey(Schema.String),
})
const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex')
const wording = (question: Question) => ({
  title: question.title,
  scope: question.scope,
  ask: question.ask,
  options: question.options,
})

export const questionRevisions = (
  grill: Grill,
): Readonly<Record<string, string>> =>
  Object.fromEntries(
    grill.steps.map(({ question }) => [question.id, digest(wording(question))]),
  )

export const captureQuestionContext = (
  source: Grill,
  display: Grill,
  step: Step,
  shown: Step,
) => ({
  revision: questionRevisions(display)[shown.question.id]!,
  displayPage: display.id,
  displayQuestion: shown.question.id,
  round: roundOf(source, step.question),
  ...wording(shown.question),
})

export const recordAnswer = (
  db: Database,
  grill: Grill,
  display: Grill,
  displayQuestion: string,
  body: unknown,
):
  | Readonly<{ ok: true; id: number }>
  | Readonly<{ ok: false; status: number; error: string }> => {
  const decoded = Schema.decodeUnknownResult(AnswerRequest)(body)
  if (decoded._tag === 'Failure') {
    return { ok: false, status: 400, error: 'Invalid answer request' }
  }
  const request = decoded.success
  const step = grill.steps.find(item => item.question.id === request.question)
  const shown = display.steps.find(item => item.question.id === displayQuestion)
  if (
    !step ||
    !shown ||
    !(
      request.key === OWN ||
      step.question.options.some(option => option.key === request.key)
    )
  ) {
    return { ok: false, status: 400, error: 'Unknown question or option' }
  }
  const captured = captureQuestionContext(grill, display, step, shown)
  const revision = captured.revision
  if (
    request.contextRevision !== undefined &&
    request.contextRevision !== revision
  ) {
    return {
      ok: false,
      status: 409,
      error:
        'The question wording changed. Reload and review the wording before answering again.',
    }
  }
  const own = request.key === OWN ? (request.text ?? '') : ''
  if (own.length > TEXT_LIMIT) {
    return {
      ok: false,
      status: 400,
      error: textLimitError('Your own answer', own),
    }
  }
  const state = snapshot(db, grill)
  const context = request.contextRevision === undefined ? null : captured
  return {
    ok: true,
    id: appendEvent(db, grill.id, 'answered', {
      question: request.question,
      key: request.key,
      ...(request.key === OWN ? { text: own } : {}),
      receipt: {
        version: 1,
        question: request.question,
        key: request.key,
        own,
        note: state.notes[request.question] ?? '',
        context,
      },
    }),
  }
}

export const sendRequestIdentity = (body: unknown) => {
  const request = Schema.decodeUnknownSync(SendRequest)(body)
  return {
    requestId: request.requestId ?? null,
    requestDigest: digest({
      message: (request.message ?? '').trim(),
      questions:
        request.questions === undefined ? null : [...request.questions].sort(),
      expectedLines:
        request.expectedLines === undefined
          ? null
          : Object.entries(request.expectedLines).sort(([a], [b]) =>
              a.localeCompare(b),
            ),
    }),
  }
}

// A request replay returns committed evidence; it never repeats a terminal delivery (ADR 0011).
export const replaySubmission = (
  db: Database,
  displayPage: string,
  body: unknown,
): 'new' | 'replay' | 'conflict' => {
  const identity = sendRequestIdentity(body)
  if (identity.requestId === null) {
    return 'new'
  }
  const row = db
    .query<{ payload: string }, [string, string]>(
      "SELECT payload FROM events WHERE kind = 'submitted' AND json_extract(payload, '$.displayPage') = ? AND json_extract(payload, '$.requestId') = ? ORDER BY id LIMIT 1",
    )
    .get(displayPage, identity.requestId)
  const previous =
    row === null
      ? undefined
      : Schema.decodeUnknownSync(Submission)(JSON.parse(row.payload))

  return previous === undefined
    ? 'new'
    : previous.requestDigest === identity.requestDigest
      ? 'replay'
      : 'conflict'
}

export const freezeSubmission = (
  db: Database,
  grill: Grill,
  display: Grill,
  questions: Readonly<Record<string, string>>,
  selection: Extract<SendSelection, { ok: true }>,
  identity: ReturnType<typeof sendRequestIdentity>,
): number => {
  const state = snapshot(db, grill)
  const history = [...events(db, grill.id)].reverse()
  const available = sendableLines(grill, state.answers, state.notes, state.own)
  const revisions = questionRevisions(display)
  if (
    Object.entries(selection.lines).some(
      ([question, line]) => available[question] !== line,
    )
  ) {
    throw new SubmissionConflict(
      'An answer changed before its submission was frozen. Review your drafts again.',
    )
  }
  const answers = Object.keys(selection.lines).map(question => {
    const event = history.find(item => {
      if (item.kind !== 'answered' && item.kind !== 'cleared') {
        return false
      }
      return JSON.parse(item.payload).question === question
    })
    const payload =
      event?.kind === 'answered' ? JSON.parse(event.payload) : undefined
    const captured =
      payload?.receipt === undefined
        ? null
        : Schema.decodeUnknownSync(RecordedAnswer)(payload.receipt)
    return {
      version: 1,
      question,
      key: state.answers[question] ?? '',
      own: state.answers[question] === OWN ? (state.own[question] ?? '') : '',
      note: state.notes[question] ?? '',
      context: captured?.context ?? null,
      answerEvent: event?.kind === 'answered' ? event.id : null,
      answerRecordedAt: event?.kind === 'answered' ? event.at : null,
      sendRevision: revisions[questions[question] ?? ''] ?? null,
      recipient: questionSession(
        grill,
        grill.steps.find(step => step.question.id === question)?.question,
      ),
    }
  })
  const recipients = [...new Set(answers.map(answer => answer.recipient))]
  return appendEvent(
    db,
    grill.id,
    'submitted',
    Schema.decodeUnknownSync(Submission)({
      version: 1,
      ...identity,
      displayPage: display.id,
      questions,
      answers,
      lines: selection.lines,
      message: selection.message,
      recipients: recipients.length === 0 ? [grill.session] : recipients,
    }),
  )
}

export const readSubmission = (db: Database, grill: string, send: number) => {
  const history = events(db, grill)
  const event = history.find(
    item => item.id === send && item.kind === 'submitted',
  )
  if (
    event === undefined &&
    history.some(item => item.id === send && item.kind === 'sent')
  ) {
    throw new ContextUnavailable(
      'Legacy sends have unavailable immutable answer context.',
    )
  }
  if (event === undefined)
    throw new Error(
      'No immutable submission for that source/send; legacy receipts have unavailable context.',
    )
  const submission = Schema.decodeUnknownSync(Submission)(
    JSON.parse(event.payload),
  )
  const attempts = history
    .filter(item => item.kind === 'sent')
    .flatMap(item => {
      const payload = JSON.parse(item.payload)
      return payload.submission !== send
        ? []
        : Schema.decodeUnknownSync(Schema.Array(DeliveryReceipt))(
            payload.deliveries,
          ).map(delivery => ({
            event: item.id,
            at: item.at,
            ...delivery,
          }))
    })
  return {
    ...submission,
    grill,
    send,
    recordedAt: event.at,
    surface: 'page',
    deliveries: submission.recipients.map(recipient => {
      const evidence = attempts.filter(attempt => attempt.session === recipient)
      return {
        recipient,
        state:
          evidence.length === 0
            ? 'pending'
            : evidence.some(attempt => attempt.ok)
              ? 'delivered'
              : 'failed',
        attempts: evidence,
      }
    }),
  }
}

export const unconfirmedSends = (
  db: Database,
  sources: ReadonlyArray<string>,
) =>
  sources.flatMap(source => {
    const history = events(db, source)
    const confirmed = new Set(
      history
        .filter(item => item.kind === 'sent')
        .map(item => JSON.parse(item.payload).submission),
    )
    return history
      .filter(item => item.kind === 'submitted' && !confirmed.has(item.id))
      .map(item => ({ source, send: item.id }))
  })

export const answerHistory = (
  db: Database,
  sources: ReadonlyArray<string>,
): NonNullable<Snapshot['answerHistory']> =>
  sources
    .flatMap(source =>
      events(db, source).flatMap(
        (event): NonNullable<Snapshot['answerHistory']> => {
          if (event.kind === 'submitted') {
            const receipt = readSubmission(db, source, event.id)
            return [
              {
                source,
                event: event.id,
                at: event.at,
                submission: event.id,
                answers: receipt.answers,
                legacyLines: {},
                message: receipt.message,
                state: receipt.deliveries.every(
                  item => item.state === 'delivered',
                )
                  ? 'delivered'
                  : receipt.deliveries.some(item => item.state === 'failed')
                    ? 'failed'
                    : 'pending',
              },
            ]
          }
          if (event.kind !== 'sent') return []
          const payload = JSON.parse(event.payload)
          if (payload.what === 'ask' || payload.submission !== undefined)
            return []
          return [
            {
              source,
              event: event.id,
              at: event.at,
              submission: null,
              answers: [],
              legacyLines: sentLines(payload),
              message: '',
              state: payload.ok === true ? 'delivered' : 'failed',
            },
          ]
        },
      ),
    )
    .sort((a, b) => b.event - a.event)
