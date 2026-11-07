import { Schema } from 'effect'

import { CompareDiagram, FlowDiagram } from './diagram'
import { AnswerContext } from './questionContext'

export const DrawingDiagram = Schema.Union([CompareDiagram, FlowDiagram])
export const DrawingResponse = Schema.Struct({
  version: Schema.Literal(1),
  event: Schema.Number,
  at: Schema.Number,
  revision: Schema.Number,
  diagram: DrawingDiagram,
})
export const QuestionDrawing = Schema.Struct({
  source: Schema.String,
  question: Schema.String,
  displayQuestion: Schema.String,
  request: Schema.Number,
  at: Schema.Number,
  recipient: Schema.String,
  context: AnswerContext,
  stale: Schema.Boolean,
  delivery: Schema.Literals(['pending', 'delivered', 'failed']),
  detail: Schema.String,
  response: Schema.optionalKey(DrawingResponse),
})
export type QuestionDrawing = typeof QuestionDrawing.Type

export const drawingAttemptKey = (page: string, question: string): string =>
  JSON.stringify([page, question])
