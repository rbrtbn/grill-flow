import type { Database } from 'bun:sqlite'
import { Schema } from 'effect'

import {
  type ActivityEntry,
  type ActivityFeed,
  answerAnchor,
  itemAnchor,
} from '../src/activity'
import { ChannelItem } from '../src/channel'
import { isSent, sendableLines, statusOf } from '../src/domain'
import { ProviderReading } from '../src/references'
import { latestItems } from './channel'
import type { Page } from './squad'
import { events, lastEventId } from './store'

const Payload = Schema.Struct({
  question: Schema.optionalKey(Schema.String),
  stepId: Schema.optionalKey(Schema.String),
  key: Schema.optionalKey(Schema.String),
  text: Schema.optionalKey(Schema.String),
  prose: Schema.optionalKey(Schema.Array(Schema.String)),
  kind: Schema.optionalKey(Schema.String),
  what: Schema.optionalKey(Schema.String),
  ok: Schema.optionalKey(Schema.Boolean),
  askId: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  submission: Schema.optionalKey(Schema.Number),
  round: Schema.optionalKey(Schema.Number),
  steps: Schema.optionalKey(Schema.Number),
  name: Schema.optionalKey(Schema.String),
  reason: Schema.optionalKey(Schema.String),
  questions: Schema.optionalKey(Schema.Unknown),
  pageChanged: Schema.optionalKey(Schema.Boolean),
  item: Schema.optionalKey(Schema.String),
  receipt: Schema.optionalKey(Schema.Number),
  decision: Schema.optionalKey(Schema.String),
  request: Schema.optionalKey(Schema.Number),
})
const Changes = Schema.Struct({
  added: Schema.Array(Schema.String),
  changed: Schema.Array(Schema.String),
  removed: Schema.Array(Schema.String),
})
const excerpt = (value: string) =>
  value.replace(/\s+/g, ' ').trim().slice(0, 240)
const included = new Set([
  'loaded',
  'answered',
  'cleared',
  'asked',
  'revised',
  'replied',
  'submitted',
  'sent',
  'renamed-round',
  'item-published',
  'veto-requested',
  'veto-delivery',
  'drawing-requested',
  'drawing-delivery',
  'drawing-published',
  'reference-checked',
  'retired',
  'restored',
])

const feedCache = new WeakMap<
  Database,
  Map<string, { signature: string; feed: ActivityFeed }>
>()
export const activityFeed = (db: Database, page: Page): ActivityFeed => {
  const sources =
    page.members.length === 0
      ? [page.state]
      : page.members.map(member => member.state)
  const signature = JSON.stringify(
    sources.map(state => [state.grill.id, lastEventId(db, state.grill.id)]),
  )
  const cache =
    feedCache.get(db) ??
    new Map<string, { signature: string; feed: ActivityFeed }>()
  const previous = cache.get(page.state.grill.id)
  if (previous?.signature === signature) {
    return previous.feed
  }
  const entries = sources
    .flatMap(state => {
      const source = state.grill.id
      const latest = latestItems(db, source)
      const lines = sendableLines(
        state.grill,
        state.answers,
        state.notes,
        state.own,
      )
      const needsQuestion = (question: string | undefined) =>
        question !== undefined &&
        state.grill.steps.some(step => step.question.id === question) &&
        (statusOf(state.grill, state.answers, question)._tag === 'Open' ||
          (statusOf(state.grill, state.answers, question)._tag === 'Answered' &&
            !isSent(state.sent ?? {}, lines, question)))
      const history = events(db, source)
      const byId = new Map(history.map(event => [event.id, event]))
      return history.flatMap((event): ReadonlyArray<ActivityEntry> => {
        if (!included.has(event.kind)) {
          return []
        }
        const raw: unknown = JSON.parse(event.payload)
        const decoded = Schema.decodeUnknownResult(Payload)(raw)
        const payload = decoded._tag === 'Success' ? decoded.success : {}
        const original = byId.get(
          payload.request ?? payload.receipt ?? payload.askId ?? 0,
        )
        const linked =
          original === undefined
            ? undefined
            : Schema.decodeUnknownResult(Payload)(JSON.parse(original.payload))
        const question =
          payload.question ??
          (linked?._tag === 'Success' ? linked.success.question : undefined) ??
          state.grill.steps.find(
            step =>
              step.id ===
              (payload.stepId ??
                (linked?._tag === 'Success'
                  ? linked.success.stepId
                  : undefined)),
          )?.question.id
        const questionTarget =
          question !== undefined &&
          state.grill.steps.some(step => step.question.id === question)
            ? 'question'
            : 'overview'
        const base = {
          source,
          member: state.grill.squad?.section ?? state.grill.title,
          event: event.id,
          at: event.at,
          kind: event.kind,
          summary: '',
          needsAction: false,
          target: 'overview',
          ...(question === undefined ? {} : { question }),
        } satisfies Omit<ActivityEntry, 'label'>
        const row = (
          label: string,
          summary: string,
          target: ActivityEntry['target'] = questionTarget,
          needsAction = false,
        ): ActivityEntry => ({
          ...base,
          label,
          summary: excerpt(summary),
          target,
          needsAction,
        })
        if (event.kind === 'loaded') {
          const decodedChanges = Schema.decodeUnknownResult(Changes)(
            payload.questions,
          )
          const changes =
            decodedChanges._tag === 'Success'
              ? decodedChanges.success
              : undefined
          if (
            changes !== undefined &&
            changes.added.length +
              changes.changed.length +
              changes.removed.length ===
              0 &&
            payload.pageChanged !== true
          ) {
            return []
          }
          const first = changes?.added
            .concat(changes.changed)
            .find(id => state.grill.steps.some(step => step.question.id === id))
          return [
            {
              ...row(
                changes === undefined
                  ? 'Page reloaded'
                  : changes.added.length +
                        changes.changed.length +
                        changes.removed.length ===
                      0
                    ? 'Page context changed'
                    : 'Questions changed',
                changes === undefined
                  ? `Round ${payload.round ?? '?'} · ${payload.steps ?? '?'} questions. Detailed changes unavailable for this older reload.`
                  : `Added: ${changes.added.join(', ') || 'none'}; changed: ${changes.changed.join(', ') || 'none'}; removed: ${changes.removed.join(', ') || 'none'}.`,
                first === undefined ? 'overview' : 'question',
                first !== undefined && needsQuestion(first),
              ),
              ...(first === undefined ? {} : { question: first }),
            },
          ]
        }
        if (event.kind === 'item-published') {
          const item = Schema.decodeUnknownResult(ChannelItem)(raw)
          if (item._tag === 'Failure') {
            return [row('Item recorded', 'This item format is unavailable.')]
          }
          const value = item.success
          const current = latest.find(entry => entry.item.id === value.id)?.item
          const action =
            (current?.kind === 'owner-step' &&
              current.progress.state === 'open') ||
            (current?.kind === 'decision' &&
              current.resolution.state === 'provisional')
          const label =
            value.kind === 'update'
              ? 'Update published'
              : value.kind === 'owner-step'
                ? 'Owner step changed'
                : value.kind === 'decision'
                  ? 'Decision changed'
                  : value.kind === 'blocker'
                    ? 'Blocking condition changed'
                    : 'Evidence published'
          return [
            {
              ...row(
                label,
                value.body,
                value.kind === 'update' ? 'updates' : 'needs-you',
                action,
              ),
              item: value.id,
              anchor: itemAnchor(source, value.id),
            },
          ]
        }
        if (event.kind === 'reference-checked') {
          const reading = Schema.decodeUnknownResult(ProviderReading)(raw)
          return reading._tag === 'Failure'
            ? [row('Reference changed', 'Reading unavailable.')]
            : [
                {
                  ...row(
                    'Reference changed',
                    `${reading.success.reference.provider === 'linear' ? reading.success.reference.id : reading.success.reference.repository + (reading.success.reference.kind === 'pull' ? ' PR #' : ' issue #') + reading.success.reference.number} · ${reading.success.status} · checks ${reading.success.checks} · ${reading.success.freshness}`,
                    'reference',
                  ),
                  reference: reading.success.reference,
                },
              ]
        }
        if (event.kind === 'submitted') {
          return [
            {
              ...row(
                'Answers submitted',
                'Frozen answer wording saved; delivery is a separate event.',
                'answer-history',
              ),
              anchor: answerAnchor(source, event.id),
            },
          ]
        }
        if (event.kind === 'sent') {
          return payload.what === 'ask'
            ? [
                row(
                  payload.ok === true
                    ? 'Ask delivered'
                    : payload.ok === false
                      ? 'Ask delivery failed'
                      : 'Ask delivery recorded',
                  'Delivery does not acknowledge agent consumption.',
                ),
              ]
            : [
                {
                  ...row(
                    payload.ok === true
                      ? 'Answers delivered'
                      : payload.ok === false
                        ? 'Answer delivery failed'
                        : 'Answer delivery recorded',
                    'Delivery does not acknowledge agent consumption.',
                    'answer-history',
                  ),
                  anchor: answerAnchor(source, payload.submission ?? event.id),
                },
              ]
        }
        if (event.kind === 'replied') {
          return [
            {
              ...row('Reply to answers', payload.text ?? '', 'replies'),
              anchor: `agent-reply-${event.id}`,
            },
          ]
        }
        if (event.kind === 'revised') {
          return [
            {
              ...row(
                payload.kind === 'rewrite'
                  ? 'Question reasoning rewritten'
                  : 'Agent replied',
                payload.text ?? payload.prose?.join('\n\n') ?? '',
                payload.kind !== 'rewrite' && payload.askId != null
                  ? 'replies'
                  : question === undefined
                    ? 'overview'
                    : 'question',
                needsQuestion(question),
              ),
              ...(payload.kind !== 'rewrite' && payload.askId != null
                ? { anchor: `agent-answer-${event.id}` }
                : {}),
            },
          ]
        }
        if (event.kind === 'asked') {
          return [row('Discussion ask recorded', payload.text ?? '')]
        }
        if (event.kind === 'answered' || event.kind === 'cleared') {
          return [
            row(
              event.kind === 'answered' ? 'Answer saved' : 'Answer cleared',
              question ?? '',
              questionTarget,
              needsQuestion(question),
            ),
          ]
        }
        if (event.kind === 'renamed-round') {
          return [
            row(
              'Round renamed',
              `Round ${payload.round ?? '?'} · ${payload.name ?? ''}`,
            ),
          ]
        }
        if (event.kind === 'retired' || event.kind === 'restored') {
          return [
            row(
              event.kind === 'retired' ? 'Page retired' : 'Page restored',
              payload.reason ?? '',
              'overview',
            ),
          ]
        }
        if (event.kind.startsWith('drawing-')) {
          return [
            row(
              event.kind === 'drawing-requested'
                ? 'Drawing requested'
                : event.kind === 'drawing-published'
                  ? 'Drawing published'
                  : 'Drawing delivery recorded',
              payload.request === undefined ? '' : `Request ${payload.request}`,
            ),
          ]
        }
        const item =
          payload.item ??
          (linked?._tag === 'Success' ? linked.success.item : undefined)
        return [
          {
            ...row(
              event.kind === 'veto-requested'
                ? 'Veto requested'
                : 'Veto delivery recorded',
              'A request and delivery are separate from the owner outcome.',
              'needs-you',
            ),
            ...(item === undefined
              ? {}
              : { item, anchor: itemAnchor(source, item) }),
          },
        ]
      })
    })
    .sort((a, b) => b.at - a.at || b.event - a.event)
  const highWater = Object.fromEntries(
    sources.map(state => [
      state.grill.id,
      entries.reduce(
        (high, entry) =>
          entry.source === state.grill.id ? Math.max(high, entry.event) : high,
        0,
      ),
    ]),
  )
  const feed = {
    entries: entries.slice(0, 300),
    highWater,
    total: entries.length,
    truncated: entries.length > 300,
  }
  if (cache.size >= 32) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) {
      cache.delete(oldest)
    }
  }
  cache.set(page.state.grill.id, { signature, feed })
  feedCache.set(db, cache)
  return feed
}
