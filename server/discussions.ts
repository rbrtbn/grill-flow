import type {
  AskDelivery,
  DiscussionRef,
  RevisionKind,
  Snapshot,
} from '../src/domain'

// Discussions live only in the event store; served snapshots reference them and grill writes
// never carry them (docs/adr/0033).

export type ThreadMessage = Readonly<{
  id: number
  at: number
  kind: RevisionKind
  text: string
}>

export type ThreadAsk = Readonly<{
  id: number
  at: number
  text: string
  answered: boolean
  delivery?: AskDelivery
  replies: ReadonlyArray<ThreadMessage>
}>

export type DiscussionThread = Readonly<{
  target: string
  asks: ReadonlyArray<ThreadAsk>
  // Rewrites and comments the agent made on this target without an ask to answer.
  unasked: ReadonlyArray<ThreadMessage>
}>

const message = (revision: Snapshot['revisions'][number]): ThreadMessage => ({
  id: revision.id,
  at: revision.at,
  kind: revision.kind,
  text: revision.text,
})

/**
 * Every target's asks with their replies, keyed by the target step's question id (shared ids
 * on a composed page, whose steps already carry them) or by the target itself.
 */
export const discussionThreads = (
  state: Snapshot,
): Readonly<Record<string, DiscussionThread>> => {
  const questionOf = new Map(
    state.grill.steps.map(step => [step.id, step.question.id]),
  )
  const repliesTo = state.revisions.reduce(
    (replies, revision) =>
      revision.askId === null
        ? replies
        : replies.set(revision.askId, [
            ...(replies.get(revision.askId) ?? []),
            revision,
          ]),
    new Map<number, ReadonlyArray<Snapshot['revisions'][number]>>(),
  )
  const targets = [
    ...new Set([
      ...state.asks.map(ask => ask.stepId),
      ...state.revisions.map(revision => revision.stepId),
    ]),
  ]
  return Object.fromEntries(
    targets.map(target => [
      questionOf.get(target) ?? target,
      {
        target,
        asks: state.asks
          .filter(ask => ask.stepId === target)
          .map(ask => ({
            id: ask.id,
            at: ask.at,
            text: ask.text,
            answered: ask.answered,
            ...(ask.delivery === undefined ? {} : { delivery: ask.delivery }),
            replies: (repliesTo.get(ask.id) ?? []).map(message),
          })),
        unasked: state.revisions
          .filter(
            revision => revision.stepId === target && revision.askId === null,
          )
          .map(message),
      },
    ]),
  )
}

/** A summary per discussion with at least one ask, cheap enough for every poll. */
export const discussionRefs = (
  state: Snapshot,
): Readonly<Record<string, DiscussionRef>> =>
  Object.fromEntries(
    Object.entries(discussionThreads(state)).flatMap(([key, thread]) =>
      thread.asks.length === 0
        ? []
        : [
            [
              key,
              {
                target: thread.target,
                asks: thread.asks.length,
                replies: thread.asks.reduce(
                  (sum, ask) => sum + ask.replies.length,
                  0,
                ),
                open: thread.asks.filter(ask => !ask.answered).length,
                lastAt: Math.max(
                  ...thread.asks.flatMap(ask => [
                    ask.at,
                    ...ask.replies.map(reply => reply.at),
                  ]),
                ),
                firstAskId: Math.min(...thread.asks.map(ask => ask.id)),
              },
            ],
          ],
    ),
  )

/**
 * Drops a `discussions` key from grill JSON before it is validated, so copying a served grill
 * back into a load can neither write nor erase discussion references.
 */
export const withoutDiscussions = (
  raw: unknown,
  warn: (text: string) => void = console.warn,
): unknown => {
  if (
    typeof raw !== 'object' ||
    raw === null ||
    Array.isArray(raw) ||
    !('discussions' in raw)
  ) {
    return raw
  }
  const { discussions: _dropped, ...grill } = raw
  const id = 'id' in grill && typeof grill.id === 'string' ? grill.id : 'grill'
  warn(
    `Ignored "discussions" in ${id}: the server keeps discussions and derives their references itself. Read them with gf export or the served snapshot, and leave the key out of grill files.`,
  )
  return grill
}
