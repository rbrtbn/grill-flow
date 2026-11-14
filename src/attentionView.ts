import { Array } from 'effect'
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

export const attentionView = (model: Model, snapshot: Snapshot, h: H): Html => {
  const owners = snapshot.ownerSteps ?? []
  const active = owners.filter(entry => entry.item.progress.state === 'open')
  const earlier = owners.filter(entry => entry.item.progress.state !== 'open')
  const owner = (entry: (typeof owners)[number]): Html => {
    const item = entry.item
    const key = channelItemKey(entry.source, item.id, item.revision)
    const progress = item.progress
    const destination = model.ownerDestinations[key]
    return h.keyed('article')(
      `${entry.source}::${item.id}`,
      [
        h.Class('f-channel-entry f-owner-step'),
        ...channelRevealAttributes(model, itemAnchor(entry.source, item.id), h),
      ],
      [
        h.div(
          [h.Class('f-channel-heading')],
          [
            h.h3([], [item.title?.trim() || item.id]),
            status(
              progress.state === 'open'
                ? item.urgency === 'wait'
                  ? 'Can wait'
                  : item.urgency === 'fyi'
                    ? 'FYI'
                    : item.urgency === 'blocking'
                      ? 'Blocking'
                      : 'Soon'
                : progress.state === 'completed'
                  ? 'Reported completed'
                  : 'Withdrawn',
              h,
            ),
          ],
        ),
        metadata(entry.source, item.session, entry.at, h),
        h.p(
          [h.Class('f-owner-destination')],
          [
            `On ${item.host} · `,
            typeof item.destination === 'string'
              ? h.a([h.Href(item.destination)], ['Open destination'])
              : h.button(
                  [
                    h.Class('text-button'),
                    h.Disabled(destination?._tag === 'Opening'),
                    h.OnClick(
                      Message.ClickedOwnerDestination({
                        source: entry.source,
                        item: item.id,
                        revision: item.revision,
                      }),
                    ),
                  ],
                  [`Open session ${item.destination.address}`],
                ),
          ],
        ),
        destination?._tag === 'Failed'
          ? h.p([h.Role('status')], [destination.error])
          : destination?._tag === 'Opened'
            ? h.p([h.Role('status')], ['Session opened.'])
            : h.empty,
        h.pre([h.Class('f-owner-action')], [h.code([], [item.action])]),
        h.p([h.Class('f-channel-words')], [item.body]),
        progress.state === 'open'
          ? h.div(
              [h.Class('f-actions')],
              [
                h.button(
                  [
                    h.Class('quiet-button'),
                    h.OnClick(
                      Message.ClickedCopyOwnerStep({
                        source: entry.source,
                        item: item.id,
                        revision: item.revision,
                      }),
                    ),
                  ],
                  [
                    model.ownerCopies[key] === 'Copied'
                      ? 'Copied action'
                      : 'Copy action',
                  ],
                ),
                model.ownerCopies[key] === 'Failed'
                  ? h.span(
                      [h.Role('status')],
                      ['Could not copy. Select the action text above.'],
                    )
                  : h.empty,
              ],
            )
          : progress.state === 'completed'
            ? h.p(
                [h.Class('f-owner-proof')],
                [
                  'Agent-reported proof: ',
                  h.a([h.Href(progress.proof)], ['Open evidence']),
                  ` · checked ${when(progress.checkedAt)}`,
                  progress.validUntil !== undefined &&
                  progress.validUntil <= (snapshot.channelNow ?? 0)
                    ? ' · Evidence expired'
                    : '',
                ],
              )
            : h.p([], [progress.reason]),
        item.blockers.length > 0
          ? h.p(
              [h.Class('hint')],
              [`Related blockers: ${item.blockers.join(', ')}`],
            )
          : h.empty,
        related(snapshot, entry.source, item.question, h),
      ],
    )
  }
  const decisions = snapshot.decisions ?? []
  const blockers = snapshot.blockers ?? []
  return h.div(
    [h.Class('f-channel-attention')],
    [
      owners.length > 0 || snapshot.grill.kind === 'squad'
        ? h.section(
            [h.Class('f-owner-section')],
            [
              h.h2([], ['Owner steps']),
              h.p(
                [h.Class('hint')],
                ['The owning agent reports completion with a proof link.'],
              ),
              ...Array.match(active, {
                onEmpty: () => [
                  h.p([h.Class('hint')], ['No open owner actions reported.']),
                ],
                onNonEmpty: entries => entries.map(owner),
              }),
              earlier.length === 0
                ? h.empty
                : h.details(
                    [h.Class('f-earlier-owner-steps')],
                    [
                      h.summary(
                        [],
                        [`Completed or withdrawn · ${earlier.length}`],
                      ),
                      ...earlier.map(owner),
                    ],
                  ),
            ],
          )
        : h.empty,
      decisions.length === 0
        ? h.empty
        : h.section(
            [h.Class('f-provisional-decisions')],
            [
              h.h2([], ['Provisional decisions']),
              h.p(
                [h.Class('hint')],
                [
                  "A veto is a request. Its owner's acknowledgment and outcome appear separately.",
                ],
              ),
              ...decisions.map(entry =>
                decisionArticle(model, snapshot, entry, h),
              ),
            ],
          ),
      blockers.length === 0
        ? h.empty
        : h.section(
            [h.Class('f-blocker-section')],
            [
              h.h2([], ['Blocking conditions']),
              ...blockers.map(entry =>
                h.keyed('article')(
                  `${entry.source}::${entry.item.id}`,
                  [
                    h.Class('f-channel-entry f-blocker'),
                    ...channelRevealAttributes(
                      model,
                      itemAnchor(entry.source, entry.item.id),
                      h,
                    ),
                  ],
                  [
                    h.div(
                      [h.Class('f-channel-heading')],
                      [
                        h.h3([], [entry.item.title?.trim() || entry.item.id]),
                        status(
                          entry.state === 'clear'
                            ? 'Condition met'
                            : entry.state === 'blocked'
                              ? 'Blocked'
                              : 'Unknown',
                          h,
                        ),
                      ],
                    ),
                    h.p([h.Class('f-channel-words')], [entry.item.body]),
                    h.p([], [entry.detail]),
                    h.p(
                      [h.Class('hint')],
                      [
                        entry.checkedAt === null
                          ? 'No current evidence'
                          : `Checked ${when(entry.checkedAt)}`,
                      ],
                    ),
                    entry.proof === undefined
                      ? h.empty
                      : h.a([h.Href(entry.proof)], ['Open evidence']),
                    entry.item.condition.kind === 'question'
                      ? related(
                          snapshot,
                          entry.item.condition.source,
                          entry.item.condition.question,
                          h,
                        )
                      : h.empty,
                    related(snapshot, entry.source, entry.item.question, h),
                  ],
                ),
              ),
            ],
          ),
    ],
  )
}
