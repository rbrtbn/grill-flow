import { Schema } from 'effect'

export const RosterMember = Schema.Struct({
  address: Schema.String,
  profile: Schema.String,
  role: Schema.NullOr(Schema.String),
  run: Schema.NullOr(Schema.String),
  host: Schema.NullOr(Schema.String),
  terminal: Schema.Literals(['live', 'finished']),
  coreStatus: Schema.Literals([
    'working',
    'idle',
    'done',
    'blocked',
    'error',
    'unknown',
  ]),
  checkedAt: Schema.NullOr(Schema.Number),
  detail: Schema.Literals(['ready', 'unavailable']),
})
export type RosterMember = typeof RosterMember.Type

export const Roster = Schema.Struct({
  profile: Schema.String,
  state: Schema.Literals(['loading', 'ready', 'stale', 'unavailable']),
  checkedAt: Schema.NullOr(Schema.Number),
  members: Schema.Array(RosterMember),
  unavailableHosts: Schema.Array(Schema.String),
  omitted: Schema.Number,
  unverified: Schema.Number,
  error: Schema.String,
})
export type Roster = typeof Roster.Type
