import type { Html, HtmlBuilder } from 'foldkit/html'

import { itemAnchor } from './activity'
import { channelItemKey } from './channel'
import { channelRevealAttributes } from './channelReveal'
import { sourceQuestionHref } from './channelView'
import type { Snapshot } from './domain'
import { Message, type Model } from './main'

type H = HtmlBuilder<Message>
const when = (at: number): string =>
  new Date(at).toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
const related = (
  snapshot: Snapshot,
  source: string,
  question: string | undefined,
  h: H,
): Html =>
  question === undefined
    ? h.empty
    : h.a(
        [
          h.Class('f-source-question-link'),
          h.Href(sourceQuestionHref(snapshot.grill.id, source, question)),
        ],
        [`${source} · ${question}`],
      )
const metadata = (source: string, session: string, at: number, h: H): Html =>
  h.p([h.Class('f-channel-meta')], [source, ' · ', session, ' · ', when(at)])
const status = (state: string, h: H): Html =>
  h.span([h.Class('f-channel-state')], [state])

type PublishedDecision = NonNullable<Snapshot['decisions']>[number]

/** One provisional decision with its Veto and receipts, on its own page. */
export const decisionArticle = (
  model: Model,
  snapshot: Snapshot,
  entry: PublishedDecision,
  h: H,
): Html => {
  const item = entry.item
  const key = channelItemKey(entry.source, item.id, item.revision)
  const attempt = model.vetoAttempts[key]
  const requested = entry.vetoes.some(
    receipt => receipt.revision === item.revision,
  )
  const resolved = item.resolution.state !== 'provisional'
  return h.keyed('article')(
    `${entry.source}::${item.id}`,
    [
      h.Class('f-channel-entry f-provisional-decision'),
      ...channelRevealAttributes(model, itemAnchor(entry.source, item.id), h),
    ],
    [
      h.div(
        [h.Class('f-channel-heading')],
        [
          h.h3([], [item.title?.trim() || item.id]),
          status(
            resolved
              ? item.resolution.state === 'withdrawn'
                ? 'Withdrawn by source'
                : 'Confirmed by source'
              : entry.window === 'open'
                ? 'Veto window open'
                : 'Veto window expired',
            h,
          ),
        ],
      ),
      metadata(entry.source, item.session, entry.at, h),
      h.p([h.Class('f-decision-words f-channel-words')], [item.body]),
      h.p([], [`Deadline ${when(item.deadline)}`]),
      item.affected.length === 0
        ? h.empty
        : h.p([h.Class('hint')], [`Affects: ${item.affected.join(', ')}`]),
      item.resolution.state === 'provisional'
        ? h.button(
            [
              h.Class('quiet-button f-veto-button'),
              h.Disabled(requested || attempt?._tag === 'Sending'),
              h.OnClick(
                Message.ClickedVeto({
                  source: entry.source,
                  item: item.id,
                  revision: item.revision,
                }),
              ),
            ],
            [
              requested
                ? 'Veto requested'
                : attempt?._tag === 'Sending'
                  ? 'Requesting veto…'
                  : entry.window === 'expired'
                    ? 'Request a late veto'
                    : 'Veto',
            ],
          )
        : h.p([], [item.resolution.reason]),
      !requested && attempt?._tag === 'Failed'
        ? h.p([h.Role('alert')], [attempt.error])
        : h.empty,
      ...entry.vetoes.map(receipt =>
        h.keyed('div')(
          String(receipt.event),
          [h.Class('f-veto-receipt')],
          [
            h.strong([], [`Receipt ${receipt.source}#${receipt.event}`]),
            h.p(
              [],
              [
                `${when(receipt.at)} · ${receipt.late ? 'Late request' : 'Within the veto window'}`,
              ],
            ),
            h.p(
              [h.Class('f-veto-delivery')],
              [
                receipt.delivery === 'pending'
                  ? 'Delivery unconfirmed'
                  : receipt.delivery === 'failed'
                    ? 'Delivery failed'
                    : 'Delivered to terminal',
                ' · ',
                receipt.detail,
              ],
            ),
            h.p(
              [h.Class('f-veto-outcome')],
              [
                receipt.acknowledgment === 'none'
                  ? 'Owner acknowledgment pending'
                  : receipt.acknowledgment === 'acknowledged'
                    ? 'Owner acknowledged'
                    : receipt.acknowledgment === 'stopped'
                      ? 'Owner reports action stopped'
                      : 'Owner reports action continued',
              ],
            ),
            receipt.response === ''
              ? h.empty
              : h.p([h.Class('f-channel-words')], [receipt.response]),
            h.details(
              [],
              [
                h.summary(
                  [],
                  [`Requested wording · revision ${receipt.revision}`],
                ),
                h.p([h.Class('f-channel-words')], [receipt.decision]),
              ],
            ),
          ],
        ),
      ),
      related(snapshot, entry.source, item.question, h),
    ],
  )
}
