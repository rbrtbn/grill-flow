import { Option, Schema } from 'effect'

import { ProviderReference } from './channel'

export const ActivityCursors = Schema.Record(
  Schema.String,
  Schema.Number.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(0),
    Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
  ),
)

export const ActivityEntry = Schema.Struct({
  source: Schema.String,
  member: Schema.String,
  event: Schema.Number,
  at: Schema.Number,
  kind: Schema.String,
  label: Schema.String,
  summary: Schema.String,
  needsAction: Schema.Boolean,
  target: Schema.Literals([
    'question',
    'updates',
    'needs-you',
    'answer-history',
    'replies',
    'overview',
    'reference',
  ]),
  question: Schema.optionalKey(Schema.String),
  item: Schema.optionalKey(Schema.String),
  anchor: Schema.optionalKey(Schema.String),
  reference: Schema.optionalKey(ProviderReference),
})
export type ActivityEntry = typeof ActivityEntry.Type
export const ActivityFeed = Schema.Struct({
  entries: Schema.Array(ActivityEntry),
  highWater: ActivityCursors,
  total: Schema.Number,
  truncated: Schema.Boolean,
})
export type ActivityFeed = typeof ActivityFeed.Type
export const ActivityFilter = Schema.Literals(['Unread', 'All', 'NeedsAction'])

export const activityReadFrom = (
  value: unknown,
): Readonly<Record<string, number>> => {
  const decoded = Schema.decodeUnknownResult(ActivityCursors)(value)
  return decoded._tag === 'Failure'
    ? {}
    : Object.fromEntries(
        Object.entries(decoded.success).filter(
          ([_key, cursor]) => Number.isSafeInteger(cursor) && cursor >= 0,
        ),
      )
}
export const unreadActivity = (
  entry: ActivityEntry,
  read: Readonly<Record<string, number>>,
): boolean => entry.event > activityCursorOf(read, entry.source)
export const activityCursorOf = (
  read: Readonly<Record<string, number>>,
  source: string,
): number => (Object.hasOwn(read, source) ? (read[source] ?? 0) : 0)
export const activityUnreadCount = (
  feed: ActivityFeed | undefined,
  read: Readonly<Record<string, number>>,
): string => {
  if (feed === undefined) {
    return '0'
  }
  const count = feed.entries.filter(entry => unreadActivity(entry, read)).length
  const hidden =
    feed.truncated &&
    Object.entries(feed.highWater).some(
      ([source, high]) =>
        high > activityCursorOf(read, source) &&
        Math.min(
          ...feed.entries
            .filter(entry => entry.source === source)
            .map(entry => entry.event),
        ) > activityCursorOf(read, source),
    )
  return hidden ? `${Math.max(1, count)}+` : String(count)
}
export const itemAnchor = (source: string, item: string): string =>
  `gf-item-${encodeURIComponent(JSON.stringify([source, item]))}`
export const answerAnchor = (source: string, event: number): string =>
  `gf-answer-${encodeURIComponent(JSON.stringify([source, event]))}`
export const revealAnchorFrom = (
  hash: Option.Option<string>,
): Option.Option<string> =>
  Option.filter(hash, value =>
    /^(?:gf-(?:item|answer)-[A-Za-z0-9%._!~*'()-]+|agent-(?:reply|answer)-[0-9]+)$/.test(
      value,
    ),
  )
