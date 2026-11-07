import { Schema } from 'effect'

import { OWN, type Snapshot, answerLines, replyText } from '../src/domain'

const SendRequest = Schema.Struct({
  message: Schema.optionalKey(Schema.String),
  questions: Schema.optionalKey(Schema.Array(Schema.String)),
  expectedLines: Schema.optionalKey(
    Schema.Record(Schema.String, Schema.String),
  ),
})

export type SendSelection =
  | Readonly<{
      ok: true
      reply: string
      message: string
      lines: Readonly<Record<string, string>>
    }>
  | Readonly<{ ok: false; status: number; error: string }>

export const selectSend = (
  snapshot: Snapshot,
  body: unknown,
): SendSelection => {
  const decoded = Schema.decodeUnknownResult(SendRequest)(body)
  if (decoded._tag === 'Failure') {
    return { ok: false, status: 400, error: 'Invalid send request' }
  }
  const request = decoded.success
  const message = (request.message ?? '').trim().slice(0, 4000)
  const grill = snapshot.grill
  if (request.questions === undefined) {
    return {
      ok: true,
      message,
      reply: replyText(
        grill,
        snapshot.answers,
        snapshot.notes,
        snapshot.own,
        snapshot.sent,
      ),
      lines: answerLines(grill, snapshot.answers, snapshot.notes, snapshot.own),
    }
  }
  const ids = request.questions
  if (ids.length === 0 || new Set(ids).size !== ids.length) {
    return {
      ok: false,
      status: 400,
      error: 'Select at least one distinct answer to send',
    }
  }
  const all = answerLines(
    grill,
    snapshot.answers,
    snapshot.notes,
    snapshot.own,
    grill.steps,
  )
  const invalid = ids.some(
    id =>
      all[id] === undefined ||
      (snapshot.answers[id] !== OWN &&
        !grill.steps
          .find(step => step.question.id === id)
          ?.question.options.some(
            option => option.key === snapshot.answers[id],
          )) ||
      (snapshot.answers[id] === OWN && (snapshot.own[id] ?? '').trim() === ''),
  )
  if (invalid) {
    return {
      ok: false,
      status: 400,
      error:
        'A selected answer is no longer available. Review your drafts again.',
    }
  }
  if (
    ids.some(
      id =>
        request.expectedLines !== undefined &&
        request.expectedLines[id] !== all[id],
    )
  ) {
    return {
      ok: false,
      status: 409,
      error:
        'An answer changed while you were reviewing. Reload and check your drafts before sending.',
    }
  }
  const lines = Object.fromEntries(
    ids
      .filter(id => snapshot.sent?.[id] !== all[id])
      .map(id => [id, all[id] ?? '']),
  )
  if (Object.keys(lines).length === 0) {
    return {
      ok: false,
      status: 409,
      error: 'These answers have already been sent.',
    }
  }
  return {
    ok: true,
    message,
    lines,
    reply: ['Selected answers:', ...Object.values(lines)].join('\n'),
  }
}
