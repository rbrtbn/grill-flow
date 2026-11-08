import { Array, Schema } from 'effect'

import {
  type Grill,
  groupedAnswerText,
  questionSession,
  sentAnswers,
} from '../src/domain'
import { submissionMessage } from './messages'
import type { SendSelection } from './sendSelection'

export const DeliveryReceipt = Schema.Struct({
  session: Schema.String,
  ok: Schema.Boolean,
  detail: Schema.String,
  text: Schema.String,
  lines: Schema.Record(Schema.String, Schema.String),
})

export type SessionSender = (
  session: string,
  text: string,
) => Promise<Readonly<{ ok: boolean; detail: string }>>

export const sendAnswerBatches = async (
  grill: Grill,
  selection: Extract<SendSelection, { ok: true }>,
  send: SessionSender,
  gf: string | ((session: string) => string),
  submission: number,
) => {
  const entries = Object.entries(selection.lines)
  const sessionOf = (id: string) =>
    questionSession(
      grill,
      grill.steps.find(step => step.question.id === id)?.question,
    )
  const sessions = Array.dedupe(entries.map(([id]) => sessionOf(id)))
  const targets = Array.isArrayEmpty(sessions) ? [grill.session] : sessions
  const deliveries = await Promise.all(
    targets.map(async session => {
      const lines = Object.fromEntries(
        entries.filter(([id]) => sessionOf(id) === session),
      )
      const reply =
        targets.length === 1 ? selection.reply : groupedAnswerText(grill, lines)
      const text = submissionMessage(
        grill.id,
        submission,
        [
          `[grill-flow] Answers from the ${grill.title} page:`,
          sentAnswers(reply, selection.message),
          'Once you have taken these in, tell the user on the page what you decided and what comes next: write it to a file, then run',
          `${typeof gf === 'string' ? gf : gf(session)} reply ${grill.id} --file <path>`,
        ].join('\n'),
      )
      const result = await send(session, text)
      return { session, ...result, text, lines }
    }),
  )
  return {
    ok: deliveries.every(delivery => delivery.ok),
    detail: deliveries
      .map(
        delivery => `${delivery.session || 'Asking agent'}: ${delivery.detail}`,
      )
      .join('; '),
    text: deliveries.map(delivery => delivery.text).join('\n\n'),
    lines: Object.fromEntries(
      deliveries
        .filter(delivery => delivery.ok)
        .flatMap(delivery => Object.entries(delivery.lines)),
    ),
    deliveries,
  }
}
