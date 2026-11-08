import type { Html, HtmlBuilder } from 'foldkit/html'

import {
  type ActivityEntry,
  activityUnreadCount,
  unreadActivity,
} from './activity'
import { sourceQuestionHref } from './channelView'
import type { Snapshot } from './domain'
import { Message, type Model } from './main'
import { referenceUrl } from './references'

type H = HtmlBuilder<Message>
const href = (page: string, entry: ActivityEntry): string =>
  entry.target === 'question' && entry.question !== undefined
    ? sourceQuestionHref(page, entry.source, entry.question)
    : entry.target === 'reference' && entry.reference !== undefined
      ? referenceUrl(entry.reference)
      : `/g/${encodeURIComponent(entry.source)}/${entry.target}${entry.anchor === undefined ? '' : '#' + entry.anchor}`

export const activityView = (model: Model, snapshot: Snapshot, h: H): Html => {
  const feed = snapshot.activity
  const filter = model.workspace.activityFilter
  const read = model.workspace.activityRead
  const entries = (feed?.entries ?? []).filter(
    entry =>
      filter === 'All' ||
      (filter === 'Unread' ? unreadActivity(entry, read) : entry.needsAction),
  )
  const groups = entries.reduce((all, entry) => {
    all.set(entry.source, (all.get(entry.source) ?? []).concat(entry))
    return all
  }, new Map<string, Array<ActivityEntry>>())
  const row = (entry: ActivityEntry) =>
    h.keyed('li')(
      `${entry.source}:${entry.event}`,
      [h.Class('f-activity-entry')],
      [
        h.div(
          [h.Class('f-activity-meta')],
          [
            h.span(
              [h.Class('f-activity-read')],
              [unreadActivity(entry, read) ? 'Unread' : 'Seen'],
            ),
            h.time(
              [h.Datetime(new Date(entry.at).toISOString())],
              [new Date(entry.at).toLocaleString('en-GB')],
            ),
            `${entry.source} #${entry.event}`,
            entry.needsAction
              ? h.span([h.Class('f-activity-action')], ['Needs action'])
              : h.empty,
          ],
        ),
        h.h3(
          [],
          [
            h.a(
              [
                h.Href(href(snapshot.grill.id, entry)),
                ...(entry.target === 'reference'
                  ? [h.Target('_blank'), h.Rel('noreferrer')]
                  : []),
              ],
              [entry.label],
            ),
          ],
        ),
        entry.summary === '' ? h.empty : h.p([], [entry.summary]),
        entry.question === undefined
          ? h.empty
          : h.p([h.Class('hint')], [`Recorded question ${entry.question}`]),
      ],
    )
  return h.section(
    [h.Class('f-page f-activity')],
    [
      h.h1([], ['What changed']),
      h.p(
        [h.Class('f-lead')],
        [
          'Changes grouped by source. Seen is saved in this browser; it does not answer, acknowledge, grant or veto anything.',
        ],
      ),
      h.div(
        [h.Class('f-activity-tools')],
        [
          h.div(
            [h.Role('group'), h.AriaLabel('Activity filter')],
            (
              [
                ['Unread', 'Unread'],
                ['All', 'All'],
                ['NeedsAction', 'Needs action'],
              ] satisfies ReadonlyArray<
                readonly [typeof model.workspace.activityFilter, string]
              >
            ).map(([value, label]) =>
              h.button(
                [
                  h.AriaPressed(filter === value ? 'true' : 'false'),
                  h.OnClick(Message.SelectedActivityFilter({ filter: value })),
                ],
                [label],
              ),
            ),
          ),
          h.button(
            [
              h.Disabled(
                feed === undefined || activityUnreadCount(feed, read) === '0',
              ),
              h.OnClick(Message.ClickedMarkActivitySeen()),
            ],
            ['Mark all seen'],
          ),
        ],
      ),
      h.p(
        [h.Class('hint f-activity-count')],
        [`${activityUnreadCount(feed, read)} unread · ${entries.length} shown`],
      ),
      h.p(
        [h.Class('hint')],
        [
          'Needs action shows current open questions, drafts, owner steps and provisional decisions. Marking them seen does not complete them.',
        ],
      ),
      feed === undefined
        ? h.p(
            [h.Class('f-empty hint')],
            [
              'Activity is unavailable in this older snapshot. Reload to check for a current feed.',
            ],
          )
        : h.empty,
      feed?.truncated
        ? h.p(
            [h.Role('status'), h.Class('f-activity-truncated')],
            [
              `Showing the latest ${feed.entries.length} of ${feed.total} changes. An unread count with + is a lower bound. Older records remain in source event history.`,
            ],
          )
        : h.empty,
      feed !== undefined && entries.length === 0
        ? h.p(
            [h.Class('f-empty')],
            [
              filter === 'Unread'
                ? 'No unread changes in this feed.'
                : filter === 'NeedsAction'
                  ? 'No changes needing action in this feed.'
                  : 'No changes recorded yet.',
            ],
          )
        : h.empty,
      ...[...groups.entries()].map(([source, items]) =>
        h.keyed('section')(
          source,
          [h.Class('f-activity-source')],
          [
            h.h2([], [items[0]!.member]),
            h.p([h.Class('hint')], [source]),
            h.ol([], items.map(row)),
          ],
        ),
      ),
    ],
  )
}
