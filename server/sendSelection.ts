import { Schema } from 'effect'

import {
  type Snapshot,
  TEXT_LIMIT,
  groupedAnswerText,
  replyText,
  sendableLines,
  textLimitError,
} from '../src/domain'

export const SendRequest = Schema.Struct({
  requestId: Schema.optionalKey(
    Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  ),
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
  const message = (request.message ?? '').trim()
  if (message.length > TEXT_LIMIT) {
    return {
      ok: false,
      status: 400,
      error: textLimitError('The message', message),
    }
  }
  const grill = snapshot.grill
  const all = sendableLines(
    grill,
    snapshot.answers,
    snapshot.notes,
    snapshot.own,
  )
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
      lines: Object.fromEntries(
        Object.entries(all).filter(
          ([id, line]) => snapshot.sent?.[id] !== line,
        ),
      ),
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
  const invalid = ids.some(id => all[id] === undefined)
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
    reply: groupedAnswerText(grill, lines),
  }
}
