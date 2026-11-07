import { Schema } from 'effect'

export const AnswerOption = Schema.Struct({
  key: Schema.String,
  label: Schema.String,
  effect: Schema.String,
  recommended: Schema.Boolean,
})
export type AnswerOption = typeof AnswerOption.Type

export const AnswerContext = Schema.Struct({
  revision: Schema.String,
  displayPage: Schema.String,
  displayQuestion: Schema.String,
  round: Schema.Number,
  title: Schema.String,
  scope: Schema.String,
  ask: Schema.String,
  options: Schema.Array(AnswerOption),
})
