import { Array } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { answerAnchor, itemAnchor } from './activity'
import { channelRevealAttributes } from './channelReveal'
import { OWN, type Question, type Snapshot, diffWords } from './domain'
import type { Message, Model } from './main'
import { sourceQuestionHref } from './sourceLinks'

export { sourceQuestionHref } from './sourceLinks'

type H = HtmlBuilder<Message>
type Update = NonNullable<Snapshot['updates']>[number]
type History = NonNullable<Snapshot['answerHistory']>[number]

const sourceLink = (
  snapshot: Snapshot,
  source: string,
  question: string,
  h: H,
): Html =>
  h.a(
    [
      h.Class('f-source-question-link'),
      h.Href(sourceQuestionHref(snapshot.grill.id, source, question)),
    ],
    [`${source} · ${question}`],
  )
const when = (at: number) =>
  new Date(at).toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })

const wording = (
  question: Pick<Question, 'title' | 'scope' | 'ask' | 'options'>,
): string =>
  [
    question.title,
    question.scope,
    question.ask,
    ...question.options.map(
      option =>
        `${option.key}${option.recommended ? ' · Recommended' : ''}: ${option.label}\n${option.effect}`,
    ),
  ].join('\n\n')

export const updatesView = (
  model: Model,
  snapshot: Snapshot,
  prose: (text: string, h: H) => Html,
  h: H,
): Html => {
  const updates = snapshot.updates ?? []
  const active = updates.filter(update => update.supersededBy === undefined)
  const earlier = updates.filter(update => update.supersededBy !== undefined)
  const entry = (update: Update): Html =>
    h.keyed('article')(
      `${update.source}::${update.item.id}`,
      [
        h.Class('f-channel-entry'),
        ...channelRevealAttributes(
          model,
          itemAnchor(update.source, update.item.id),
          h,
        ),
      ],
      [
        h.p(
          [h.Class('f-channel-meta')],
          [update.source, ' · ', update.item.session, ' · ', when(update.at)],
        ),
        prose(update.displayBody ?? update.item.body, h),
        update.item.question === undefined
          ? h.empty
          : h.p(
              [],
              [sourceLink(snapshot, update.source, update.item.question, h)],
            ),
      ],
    )
  return h.section(
    [h.Class('f-page f-updates')],
    [
      h.h1([], ['Updates']),
      h.p([h.Class('f-lead')], ['Progress and context from your agents.']),
      ...Array.match(active, {
        onEmpty: () => [
          h.p([h.Class('f-empty hint')], ['No current updates.']),
        ],
        onNonEmpty: entries => entries.map(entry),
      }),
      Array.isReadonlyArrayEmpty(earlier)
        ? h.empty
        : h.details(
            [h.Class('f-earlier-updates')],
            [
              h.summary([], [`Superseded updates · ${earlier.length}`]),
              ...earlier.map(entry),
            ],
          ),
    ],
  )
}

const savedAnswer = (
  snapshot: Snapshot,
  source: string,
  answer: History['answers'][number],
  h: H,
): Html => {
  const context = answer.context
  const option = context?.options.find(item => item.key === answer.key)
  const displayed =
    Object.entries(snapshot.questionOrigins ?? {}).find(
      ([, origin]) =>
        origin.grill === source && origin.question === answer.question,
    )?.[0] ?? (source === snapshot.grill.id ? answer.question : undefined)
  const current = snapshot.grill.steps.find(
    step => step.question.id === displayed,
  )?.question
  const currentRevision =
    displayed === undefined
      ? undefined
      : snapshot.questionRevisions?.[displayed]
  const canCompare =
    context !== null &&
    context.displayPage === snapshot.grill.id &&
    current !== undefined
  const changed =
    canCompare &&
    currentRevision !== undefined &&
    currentRevision !== context.revision
  return h.section(
    [h.Class('f-saved-answer')],
    [
      h.h3([], [sourceLink(snapshot, source, answer.question, h)]),
      context === null
        ? h.p([h.Class('hint')], ['Original question wording unavailable.'])
        : h.div(
            [],
            [
              h.p([h.Class('f-original-title')], [context.title]),
              h.p(
                [h.Class('hint')],
                [
                  `Answered as ${context.displayQuestion} on ${context.displayPage}.`,
                ],
              ),
              h.p([h.Class('hint')], [context.scope]),
              h.p([h.Class('f-original-ask')], [context.ask]),
            ],
          ),
      h.p(
        [h.Class('f-recorded-choice')],
        [
          answer.key === OWN
            ? answer.own
            : (option?.label ?? `Choice ${answer.key}`),
        ],
      ),
      answer.key === OWN || option === undefined
        ? h.empty
        : h.p([h.Class('f-saved-effect')], [option.effect]),
      answer.note === ''
        ? h.empty
        : h.p([], [h.strong([], ['Note: ']), answer.note]),
      context !== null &&
      answer.sendRevision !== null &&
      context.revision !== answer.sendRevision
        ? h.p(
            [h.Class('hint')],
            [
              'Question wording changed between answering and Send. The original wording is shown above.',
            ],
          )
        : h.empty,
      changed && current !== undefined && context !== null
        ? h.details(
            [h.Class('f-wording-changes')],
            [
              h.summary([], ['Compare original and current wording']),
              h.p(
                [h.Class('hint')],
                [
                  'Removed wording is struck through; added wording is highlighted. The saved answer stays unchanged.',
                ],
              ),
              h.div(
                [h.Class('diff f-wording-diff')],
                diffWords(wording(context), wording(current)).map(part =>
                  part._tag === 'Added'
                    ? h.ins([], [part.text])
                    : part._tag === 'Removed'
                      ? h.del([], [part.text])
                      : part.text,
                ),
              ),
            ],
          )
        : h.empty,
      context !== null && context.displayPage !== snapshot.grill.id
        ? h.p(
            [],
            [
              h.a(
                [
                  h.Href(
                    sourceQuestionHref(
                      context.displayPage,
                      source,
                      answer.question,
                    ),
                  ),
                ],
                ['Current question on the original page'],
              ),
            ],
          )
        : h.empty,
    ],
  )
}

type SentAnswer = Readonly<{
  receipt: History
  answer: History['answers'][number]
}>

const displayedQuestion = (
  snapshot: Snapshot,
  source: string,
  question: string,
): string | undefined =>
  Object.entries(snapshot.questionOrigins ?? {}).find(
    ([, origin]) => origin.grill === source && origin.question === question,
  )?.[0] ?? (source === snapshot.grill.id ? question : undefined)

/** Every send that carried an answer to this question, newest first. */
const sentAnswersFor = (
  snapshot: Snapshot,
  questionId: string,
): ReadonlyArray<SentAnswer> =>
  [...(snapshot.answerHistory ?? [])]
    .reverse()
    .flatMap(receipt =>
      receipt.answers
        .filter(
          answer =>
            displayedQuestion(snapshot, receipt.source, answer.question) ===
            questionId,
        )
        .map(answer => ({ receipt, answer })),
    )

const deliveryLabel = (state: History['state']): string =>
  state === 'delivered'
    ? 'Delivered'
    : state === 'pending'
      ? 'Delivery unconfirmed'
      : 'Delivery failed or partial'

/** On the question page: what you sent for it, and how its wording moved since. */
export const sentOnQuestionView = (
  snapshot: Snapshot,
  questionId: string,
  h: H,
): Html => {
  const sent = sentAnswersFor(snapshot, questionId)
  const latest = sent[0]
  return latest === undefined
    ? h.empty
    : h.details(
        [h.Class('f-sent-answer')],
        [
          h.summary(
            [],
            [
              h.b(
                [],
                [
                  `Sent ${latest.answer.key === OWN ? 'own answer' : latest.answer.key}`,
                ],
              ),
              ` · ${when(latest.receipt.at)} · ${deliveryLabel(latest.receipt.state)}`,
              sent.length > 1 ? ` · sent ${sent.length} times` : '',
            ],
          ),
          savedAnswer(snapshot, latest.receipt.source, latest.answer, h),
        ],
      )
}

/** The send log: each send with its delivery state and extra message. */
export const answerHistoryView = (
  model: Model,
  snapshot: Snapshot,
  h: H,
): Html => {
  const history = [...(snapshot.answerHistory ?? [])].reverse()
  const entry = (receipt: History): Html =>
    h.keyed('article')(
      `${receipt.source}::${receipt.event}`,
      [
        h.Class('f-log-entry'),
        ...channelRevealAttributes(
          model,
          answerAnchor(receipt.source, receipt.submission ?? receipt.event),
          h,
        ),
      ],
      [
        h.p(
          [h.Class('f-log-head')],
          [
            h.b(
              [],
              [
                receipt.submission === null
                  ? 'Earlier send'
                  : `Send ${receipt.submission}`,
              ],
            ),
            ` · ${receipt.source} · ${when(receipt.at)} · `,
            h.span(
              [h.Class(`f-log-state is-${receipt.state}`)],
              [deliveryLabel(receipt.state)],
            ),
          ],
        ),
        h.p(
          [h.Class('f-log-answers')],
          [
            [
              ...receipt.answers.map(answer => {
                const shown =
                  displayedQuestion(
                    snapshot,
                    receipt.source,
                    answer.question,
                  ) ?? answer.question
                return `${shown} ${answer.key === OWN ? 'own' : answer.key}`
              }),
              ...Object.keys(receipt.legacyLines),
            ].join(' · ') || 'No answers recorded',
          ],
        ),
        receipt.message === ''
          ? h.empty
          : h.p(
              [h.Class('f-log-message')],
              [h.b([], ['Extra message ']), receipt.message],
            ),
      ],
    )
  return h.section(
    [h.Class('f-page f-answer-history')],
    [
      h.h1([], ['Log']),
      h.p(
        [h.Class('f-lead')],
        [
          'Each send, newest first, with its delivery and any extra message. What you sent for a question, and how its wording moved since, is on that question’s page.',
        ],
      ),
      ...Array.match(history, {
        onEmpty: () => [
          h.p([h.Class('f-empty hint')], ['No sends recorded yet.']),
        ],
        onNonEmpty: entries => entries.map(entry),
      }),
    ],
  )
}
