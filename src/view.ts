import { Array, Match, Option, Record } from 'effect'
import { AsyncData } from 'foldkit'
import type { Document, Html, HtmlBuilder } from 'foldkit/html'

import {
  FORMAT_VERSION,
  OWN,
  type Plan,
  type PlanIssue,
  type PlanPhase,
  downstreamOf,
  openGatesOf,
  planPhaseOf,
  waitingOnYou,
  type DiffBlock,
  type DiffLine,
  type Grill,
  type Part,
  type Ref,
  type Relation,
  type Segment,
  type Snapshot,
  type Status,
  type Step,
  type UrgencyLevel,
  URGENCY_ORDER,
  blockOf,
  diffBlocks,
  mentionsOf,
  proseOf,
  relationsOf,
  answerLines,
  isSent,
  replyText,
  roundSteps,
  segments,
  splitParagraphs,
  statusOf,
  tally,
  cardOf,
  cardsOf,
  issuesOf,
  upstreamOf,
  urgencyOf,
  urgencyRank,
  usesUrgency,
  withQuestions,
  withRefs,
  withTerms,
} from './domain'
import type { Message as MessageType, Model, SidebarMode } from './main'
import {
  CARD_PAGE,
  DECIDED,
  FillBox,
  ISSUE_PAGE,
  LONG_CONCEPT,
  Message,
  OVERVIEW,
  PLAN,
  STATUS,
  URGENCY_PAGE,
  generalTargetOf,
  isCardPage,
  isWhyOpen,
  modesOf,
  pageQuestions,
  talkKeyOf,
  threadDraftKey,
} from './main'

type H = HtmlBuilder<MessageType>

export const view = (model: Model, h: H): Document =>
  AsyncData.match(model.page, {
    onIdle: () => shell('Grill', notice('Loading the grill…', h), h),
    onLoading: () => shell('Grill', notice('Loading the grill…', h), h),
    onFailure: error =>
      shell('Grill', notice(`The grill didn't load. ${error}`, h), h),
    onStale: ({ data }) => shell(data.grill.title, pageView(model, data, h), h),
    onRefreshing: data => shell(data.grill.title, pageView(model, data, h), h),
    onSuccess: data => shell(data.grill.title, pageView(model, data, h), h),
  })

const shell = (title: string, body: Html, h: H): Document => ({
  title,
  body: h.div([h.Class('page')], [body]),
})

const notice = (text: string, h: H): Html => h.p([h.Class('notice')], [text])

// TEXT

/**
 * How a run of text renders: `tips` gives names and terms an explanation card, `links` lets refs
 * and question ids be clicked. Text inside a button has no links; text inside a card has no cards.
 */
type TextMode = Readonly<{ tips: boolean; links: boolean }>

const tipCard = (head: Html, body: ReadonlyArray<Html | string>, h: H): Html =>
  h.span(
    [h.Class('tip'), h.Role('tooltip')],
    [h.span([h.Class('tip-card')], [head, ' ', ...body])],
  )

/** A word with its explanation in a card that opens on hover, close enough to reach its links. */
const tipped = (
  className: string,
  word: string,
  head: Html,
  body: ReadonlyArray<Html | string>,
  h: H,
): Html =>
  h.span([h.Class(`${className} has-tip`)], [word, tipCard(head, body, h)])

const tipBody = (
  text: string,
  grill: Grill,
  links: boolean,
  h: H,
): ReadonlyArray<Html | string> =>
  Array.map(
    withQuestions(
      links
        ? withRefs(segments(text, grill.entities), grill.refs)
        : segments(text, grill.entities),
      grill,
    ),
    segment => segmentView(segment, grill, { tips: false, links }, h),
  )

const segmentView = (
  segment: Segment,
  grill: Grill,
  mode: TextMode,
  h: H,
): Html | string =>
  Match.value(segment).pipe(
    Match.tagsExhaustive({
      Code: ({ text }) => h.code([], [text]),
      Entity: ({ text, entity }) => {
        const tone = `entity tone-${entity.tone}`
        return mode.tips
          ? tipped(
              tone,
              text,
              h.b([h.Class(tone)], [entity.name]),
              tipBody(entity.about, grill, mode.links, h),
              h,
            )
          : h.span([h.Class(tone)], [text])
      },
      Term: ({ text, term }) =>
        mode.tips
          ? tipped(
              'term',
              text,
              h.b([], [term.term]),
              tipBody(term.about, grill, mode.links, h),
              h,
            )
          : text,
      Ref: ({ text, ref }) => (mode.links ? refView(text, ref, h) : text),
      Question: ({ text: id }) =>
        mode.links
          ? questionLink(id, grill, mode, h)
          : h.span([h.Class('ref')], [id]),
      Text: ({ text }) => text,
    }),
  )

/** A question id that jumps to its question, with the question in a card on hover. */
const questionLink = (id: string, grill: Grill, mode: TextMode, h: H): Html => {
  const tip = Option.filter(stepOf(grill, id), () => mode.tips)
  return h.button(
    [
      h.Class(`ref${Option.isSome(tip) ? ' has-tip' : ''}`),
      h.AriaLabel(`Go to ${id}`),
      h.OnClick(Message.ClickedMapNode({ question: id })),
    ],
    [
      id,
      Option.match(tip, {
        onNone: () => h.empty,
        onSome: step =>
          tipCard(
            h.b([], [`${id} ${step.question.title}`]),
            tipBody(step.question.ask, grill, false, h),
            h,
          ),
      }),
    ],
  )
}

// Linear's state glyphs, and one for a pull request.
const GLYPHS: Readonly<Record<string, string>> = {
  triage: '◇',
  backlog: '◌',
  unstarted: '○',
  started: '◐',
  completed: '●',
  canceled: '⊘',
  pr: '⇄',
}

const refSummary = (key: string, ref: Ref): string =>
  [key, ...(ref.state === undefined ? [] : [ref.state]), ref.text].join(' · ')

/** A reference that links out and shows its summary on hover; text only without a url. */
const refView = (key: string, ref: Ref, h: H): Html => {
  const body = [
    ref.type === undefined
      ? h.empty
      : h.span(
          [h.Class('ref-glyph'), h.AriaHidden(true)],
          [GLYPHS[ref.type] ?? ''],
        ),
    key,
  ]
  const attributes = [
    h.Class('ref-link'),
    h.DataAttribute('summary', refSummary(key, ref)),
    h.AriaLabel(refSummary(key, ref)),
  ]
  return ref.url === undefined
    ? h.span(attributes, body)
    : h.a(
        [
          ...attributes,
          h.Href(ref.url),
          h.Target('_blank'),
          h.Rel('noreferrer'),
        ],
        body,
      )
}

/** The same reference as a label inside a button, where a link can't go. */
const refLabel = (grill: Grill, key: string, h: H): Html => {
  const ref = grill.refs?.[key]
  return h.span(
    [
      h.Class('ref-label'),
      h.Title(ref === undefined ? key : refSummary(key, ref)),
    ],
    [
      ref?.type === undefined
        ? h.empty
        : h.span(
            [h.Class('ref-glyph'), h.AriaHidden(true)],
            [GLYPHS[ref.type] ?? ''],
          ),
      key,
    ],
  )
}

const refOrKey = (grill: Grill, key: string, h: H): Html | string => {
  const ref = grill.refs?.[key]
  return ref === undefined ? key : refView(key, ref, h)
}

const URGENCY_WORDS: Readonly<Record<UrgencyLevel, string>> = {
  blocking: 'Blocking',
  unset: 'No urgency set',
  soon: 'Soon',
  wait: 'Can wait',
  fyi: 'FYI',
}

/** An urgency dot; `trailing` when it follows a title rather than leading a label. */
const urgencyDot = (level: UrgencyLevel, h: H, trailing = false): Html =>
  h.span([
    h.Class(`urgency${trailing ? ' is-trailing' : ''} u-${level}`),
    h.Title(URGENCY_WORDS[level]),
    h.AriaLabel(URGENCY_WORDS[level]),
  ])

/**
 * Who asked, linking to their session when the grill gives a link, and the card it came from,
 * linking to that card's page.
 */
const fromView = (model: Model, grill: Grill, step: Step, h: H): Html => {
  const from = step.question.from
  if (from === undefined) {
    return h.empty
  }
  const source = grill.sources?.[from]
  const row = step.question.row
  const cardLink = Option.match(cardOf(step.question), {
    onNone: () => row ?? '',
    onSome: card => {
      const rest = (row ?? card).slice(card.length)
      return model.currentPart === `${CARD_PAGE}${card}`
        ? `${card}${rest}`
        : h.span(
            [],
            [
              h.button(
                [
                  h.Class('from-card'),
                  h.Title(`Go to card ${card}`),
                  h.OnClick(
                    Message.ClickedConcept({ partId: `${CARD_PAGE}${card}` }),
                  ),
                ],
                [card],
              ),
              rest,
            ],
          )
    },
  })
  return h.span(
    [h.Class('from'), h.Title(source?.text ?? from)],
    [
      'from ',
      source?.link === undefined
        ? from
        : h.a(
            [h.Href(source.link), h.Target('_blank'), h.Rel('noreferrer')],
            [from],
          ),
      row === undefined ? '' : ' · ',
      cardLink,
    ],
  )
}

const inline = (
  text: string,
  grill: Grill,
  h: H,
): ReadonlyArray<Html | string> =>
  Array.map(
    withQuestions(
      withRefs(
        withTerms(segments(text, grill.entities), grill.terms),
        grill.refs,
      ),
      grill,
    ),
    segment => segmentView(segment, grill, { tips: true, links: true }, h),
  )

const plain = (
  text: string,
  grill: Grill,
  h: H,
): ReadonlyArray<Html | string> =>
  Array.map(segments(text, grill.entities), segment =>
    segmentView(segment, grill, { tips: true, links: false }, h),
  )

const paragraphView = (paragraph: string, grill: Grill, h: H): Html => {
  const block = blockOf(paragraph)
  return block._tag === 'Figure'
    ? h.pre([h.Class('figure')], [h.code([], [block.text])])
    : block._tag === 'Paragraph'
      ? h.p([], inline(block.text, grill, h))
      : h.div(
          [h.Class('list-block')],
          [
            Option.match(block.lead, {
              onNone: () => h.empty,
              onSome: lead => h.p([], inline(lead, grill, h)),
            }),
            h.ul(
              [],
              Array.map(block.items, item => h.li([], inline(item, grill, h))),
            ),
          ],
        )
}

// STATE HELPERS

const statusIn = (model: Model, grill: Grill, id: string): Status =>
  statusOf(grill, model.answers, id, model.skipped)

const isSkipped = (model: Model, grill: Grill, id: string): boolean =>
  Array.contains(model.skipped, id) &&
  statusIn(model, grill, id)._tag === 'Open'

const stateClass = (model: Model, grill: Grill, id: string): string => {
  const status = statusIn(model, grill, id)
  return isSkipped(model, grill, id)
    ? 'is-skipped'
    : status._tag === 'Answered'
      ? 'is-answered'
      : status._tag === 'Open'
        ? 'is-open'
        : status._tag === 'Waiting'
          ? 'is-waiting'
          : 'is-moot'
}

/** Questions whose answer already went out, unchanged, in an earlier send. */
const sentIdsOf = (model: Model, snapshot: Snapshot): ReadonlySet<string> => {
  const lines = answerLines(
    snapshot.grill,
    model.answers,
    model.notes,
    model.own,
  )
  const sent = snapshot.sent ?? {}
  return new Set(
    Array.filter(Record.keys(lines), id => isSent(sent, lines, id)),
  )
}

/** Answers that haven't gone out, or changed since they did: what a Send would carry. */
const freshAnswerCount = (model: Model, snapshot: Snapshot): number => {
  const sent = sentIdsOf(model, snapshot)
  return Array.filter(
    Record.keys(
      answerLines(snapshot.grill, model.answers, model.notes, model.own),
    ),
    id => !sent.has(id),
  ).length
}

const NOTHING_NEW = 'Nothing new to send: every answer already went out'

const stepOf = (grill: Grill, id: string): Option.Option<Step> =>
  Array.findFirst(grill.steps, step => step.question.id === id)

const stepsAbout = (grill: Grill, issue: string): ReadonlyArray<Step> =>
  grill.steps.filter(step => step.question.issue === issue)

const stepsOnCard = (grill: Grill, card: string): ReadonlyArray<Step> =>
  grill.steps.filter(step =>
    Option.exists(cardOf(step.question), found => found === card),
  )

const stepsIn = (grill: Grill, partId: string): ReadonlyArray<Step> =>
  Array.filter(grill.steps, step => step.part === partId)

const isOpen = (model: Model, grill: Grill, step: Step): boolean => {
  const id = step.question.id
  if (Option.exists(model.maybeJustAnswered, answered => answered === id)) {
    return true
  }
  return Option.match(Record.get(model.expanded, id), {
    onSome: open => open,
    onNone: () => {
      const status = statusIn(model, grill, id)
      if (status._tag === 'Answered' || status._tag === 'NotNeeded') {
        return false
      }
      return stepsIn(grill, step.part).length <= LONG_CONCEPT
    },
  })
}

const answerSummary = (
  model: Model,
  grill: Grill,
  step: Step,
  h: H,
): ReadonlyArray<Html | string> => {
  const id = step.question.id
  const status = statusIn(model, grill, id)
  if (isSkipped(model, grill, id)) {
    return ['Skipped for now']
  }
  if (status._tag === 'Answered') {
    if (status.key === OWN) {
      return [h.b([], ['Own answer'])]
    }
    return Option.match(
      Array.findFirst(
        step.question.options,
        option => option.key === status.key,
      ),
      {
        onNone: () => [status.key],
        onSome: option => [
          h.b([], [option.key]),
          ' ',
          ...plain(option.label, grill, h),
        ],
      },
    )
  }
  if (status._tag === 'Waiting') {
    return [`Waits for ${Array.join(status.on, ', ')}`]
  }
  if (status._tag === 'NotNeeded') {
    return ['Not needed']
  }
  return ['Open']
}

// The sidebar reads as a scale, most urgent first, with the unrated questions after it; sorting
// questions still ranks unset right after blocking (URGENCY_ORDER).
const URGENCY_NAV: ReadonlyArray<UrgencyLevel> = [
  'blocking',
  'soon',
  'wait',
  'fyi',
  'unset',
]

/**
 * The plan issue a card belongs to: the one the plan names for it, else the one every question
 * on the card is about (a later card for an issue already gated).
 */
const cardIssue = (grill: Grill, card: string): Option.Option<PlanIssue> => {
  const issues = grill.plan?.issues ?? []
  const named = Array.findFirst(issues, issue => issue.card === card)
  if (Option.isSome(named)) {
    return named
  }
  const about = Array.dedupe(
    Array.flatMap(stepsOnCard(grill, card), step =>
      step.question.issue === undefined ? [] : [step.question.issue],
    ),
  )
  return about.length === 1
    ? Array.findFirst(issues, issue => issue.id === about[0])
    : Option.none()
}

/** A card goes by its issue's title wherever the plan names it, so a link and its page agree. */
const cardName = (grill: Grill, card: string): string =>
  Option.getOrElse(
    Option.map(cardIssue(grill, card), issue => issue.title),
    () => `Card ${card}`,
  )

/** What a page is called, in the top bar and on the back link. */
const pageTitle = (model: Model, grill: Grill, page: string): string =>
  page === OVERVIEW
    ? 'Overview'
    : page === PLAN
      ? 'Plan'
      : page === STATUS
        ? 'Run status'
        : page === DECIDED
          ? 'Decided so far'
          : page.startsWith(CARD_PAGE)
            ? cardName(grill, page.slice(CARD_PAGE.length))
            : page.startsWith(ISSUE_PAGE)
              ? page.slice(ISSUE_PAGE.length)
              : Option.match(
                  Array.findFirst(
                    URGENCY_ORDER,
                    level => `${URGENCY_PAGE}${level}` === page,
                  ),
                  {
                    onSome: level => URGENCY_WORDS[level],
                    onNone: () =>
                      Option.getOrElse(
                        Option.map(
                          Array.findFirst(
                            grill.parts,
                            part => part.id === page,
                          ),
                          part => part.title,
                        ),
                        () => 'Overview',
                      ),
                  },
                )

/** Back to the page the reader came from, named, on every page but the starting ones. */
const backView = (model: Model, grill: Grill, h: H): Html =>
  Option.match(
    Option.filter(
      model.maybePrevious,
      page =>
        page !== model.currentPart &&
        model.currentPart !== PLAN &&
        model.currentPart !== STATUS &&
        model.currentPart !== OVERVIEW,
    ),
    {
      onNone: () => h.empty,
      onSome: page =>
        h.button(
          [h.Class('back-link'), h.OnClick(Message.ClickedBack())],
          [`← ${pageTitle(model, grill, page)}`],
        ),
    },
  )

const urgencyPageOf = (model: Model): Option.Option<UrgencyLevel> =>
  model.currentPart.startsWith(URGENCY_PAGE)
    ? Array.findFirst(
        URGENCY_ORDER,
        level => `${URGENCY_PAGE}${level}` === model.currentPart,
      )
    : Option.none()

/** Questions still to answer: neither answered nor ruled out. */
const isPending = (model: Model, grill: Grill, step: Step): boolean => {
  const tag = statusIn(model, grill, step.question.id)._tag
  return tag !== 'Answered' && tag !== 'NotNeeded'
}

const worstUrgency = (
  model: Model,
  grill: Grill,
  steps: ReadonlyArray<Step>,
): Option.Option<UrgencyLevel> =>
  Option.map(
    Array.head(
      Array.sort(
        Array.filter(steps, step => isPending(model, grill, step)),
        (a: Step, b: Step) =>
          Math.sign(urgencyRank(a.question) - urgencyRank(b.question)) as
            | -1
            | 0
            | 1,
      ),
    ),
    step => urgencyOf(step.question),
  )

const currentPartOf = (model: Model, grill: Grill): Option.Option<Part> =>
  model.currentPart === OVERVIEW
    ? Option.none()
    : Array.findFirst(grill.parts, part => part.id === model.currentPart)

/** The questions an urgency or issue page lists; none on any other page. */
const mixedPageSteps = (model: Model, grill: Grill): ReadonlyArray<Step> =>
  pageQuestions(grill, model.currentPart)

/** The concept Talk shows: the open one, or on a mixed page the one of the question in view. */
const talkPartOf = (model: Model, grill: Grill): Option.Option<Part> => {
  const steps = mixedPageSteps(model, grill)
  if (Array.isReadonlyArrayEmpty(steps)) {
    return currentPartOf(model, grill)
  }
  const partId = Option.getOrElse(
    Option.filter(model.maybeTalkPart, id =>
      Array.some(steps, step => step.part === id),
    ),
    () => steps[0]?.part ?? '',
  )
  return Array.findFirst(grill.parts, part => part.id === partId)
}

// PAGE

/** Where Send delivers: the agent's terminal, or nowhere named when the agent collects it. */
const toSession = (grill: Grill): string =>
  grill.session === '' ? '' : ` to ${grill.session}`

const pageView = (model: Model, snapshot: Snapshot, h: H): Html => {
  const grill = snapshot.grill
  const maybePart = currentPartOf(model, grill)
  const side =
    model.side === 'Map'
      ? Option.some(mapPanelView(model, snapshot, maybePart, h))
      : model.side === 'Talk'
        ? Option.map(talkPartOf(model, grill), part =>
            talkView(model, snapshot, part, h),
          )
        : Option.none()
  return h.div(
    [h.Class('app')],
    [
      topbarView(model, snapshot, maybePart, talkPartOf(model, grill), h),
      h.div(
        [h.Class(`frame${Option.isSome(side) ? ' with-side' : ''}`)],
        [
          navView(model, grill, h),
          h.main(
            [h.Class('main')],
            [
              backView(model, grill, h),
              Option.match(maybePart, {
                onNone: () =>
                  model.currentPart === DECIDED
                    ? decidedPageView(model, snapshot, h)
                    : model.currentPart === PLAN && grill.plan !== undefined
                      ? planPageView(model, grill, grill.plan, 'Board', h)
                      : model.currentPart === STATUS && grill.plan !== undefined
                        ? planPageView(model, grill, grill.plan, 'Status', h)
                        : model.currentPart.startsWith(ISSUE_PAGE)
                          ? issuePageView(
                              model,
                              snapshot,
                              model.currentPart.slice(ISSUE_PAGE.length),
                              h,
                            )
                          : model.currentPart.startsWith(CARD_PAGE)
                            ? cardPageView(
                                model,
                                snapshot,
                                model.currentPart.slice(CARD_PAGE.length),
                                h,
                              )
                            : Option.match(urgencyPageOf(model), {
                                onNone: () => overviewView(model, snapshot, h),
                                onSome: level =>
                                  urgencyPageView(model, snapshot, level, h),
                              }),
                onSome: part => conceptView(model, snapshot, part, h),
              }),
            ],
          ),
          Option.getOrElse(side, () => h.empty),
        ],
      ),
      model.isSendOpen ? sendDialogView(model, snapshot, h) : h.empty,
    ],
  )
}

// SEND

/** The review before Send: counts, every question with its answer folded away, and a message. */
const sendDialogView = (model: Model, snapshot: Snapshot, h: H): Html => {
  const grill = snapshot.grill
  const sentIds = sentIdsOf(model, snapshot)
  const steps = roundSteps(grill)
  const counts = tally(grill, model.answers, model.skipped, steps)
  const needed = counts.total - counts.notNeeded
  const isSending = model.send === 'Sending'
  const sentCount = Array.filter(steps, step =>
    sentIds.has(step.question.id),
  ).length
  return h.div(
    [h.Class('dialog-layer')],
    [
      h.div([
        h.Class('dialog-backdrop'),
        h.OnClick(Message.ClickedCancelSend()),
      ]),
      h.div(
        [
          h.Class('dialog send-dialog'),
          h.Role('dialog'),
          h.AriaModal(true),
          h.AriaLabelledBy('send-title'),
        ],
        [
          h.h2(
            [h.Id('send-title')],
            [`Send round ${grill.round}${toSession(grill)}`],
          ),
          h.p(
            [h.Class('send-counts')],
            [
              `${counts.answered} of ${needed} answered`,
              sentCount > 0
                ? `, ${sentCount} of them sent before and left out`
                : '',
              needed - counts.answered > 0
                ? `, ${needed - counts.answered} still open and listed as open`
                : '',
              counts.notNeeded > 0 ? `, ${counts.notNeeded} not needed` : '',
              '.',
            ],
          ),
          h.details(
            [h.Class('send-review')],
            [
              h.summary([], ['Questions and answers']),
              h.ul(
                [],
                Array.map(
                  Array.filter(steps, step => !sentIds.has(step.question.id)),
                  step =>
                    h.li(
                      [
                        h.Class(
                          `send-row ${stateClass(model, grill, step.question.id)}`,
                        ),
                      ],
                      [
                        h.span([h.Class('send-id')], [step.question.id]),
                        h.span([h.Class('send-title')], [step.question.title]),
                        h.span(
                          [h.Class('send-answer')],
                          answerSummary(model, grill, step, h),
                        ),
                      ],
                    ),
                ),
              ),
            ],
          ),
          h.label(
            [h.Class('label'), h.For('send-message')],
            ['A message with your answers (optional)'],
          ),
          h.textarea([
            h.Id('send-message'),
            h.Rows(4),
            h.OnMount(FillBox({ text: model.sendMessage })),
            h.Placeholder('Anything the agent should know about this round'),
            h.OnInput(value => Message.UpdatedSendMessage({ value })),
            h.OnKeyDownPreventDefault((key, { metaKey, ctrlKey }) =>
              key === 'Enter' && (metaKey || ctrlKey)
                ? Option.some(Message.ClickedConfirmSend())
                : Option.none(),
            ),
          ]),
          model.send === 'Failed'
            ? h.p([h.Class('send-error')], [`Not sent: ${model.sendDetail}`])
            : h.empty,
          h.div(
            [h.Class('send-actions')],
            [
              h.span([h.Class('hint')], ['Cmd+Enter sends']),
              h.button(
                [
                  h.Class('quiet-button'),
                  h.OnClick(Message.ClickedCancelSend()),
                ],
                ['Cancel'],
              ),
              h.button(
                [
                  h.Class('send-button'),
                  h.Disabled(
                    isSending || freshAnswerCount(model, snapshot) === 0,
                  ),
                  h.Title(
                    freshAnswerCount(model, snapshot) === 0 ? NOTHING_NEW : '',
                  ),
                  h.OnClick(Message.ClickedConfirmSend()),
                ],
                [isSending ? 'Sending…' : `Send${toSession(grill)}`],
              ),
            ],
          ),
        ],
      ),
    ],
  )
}

// TOP BAR

/** Talk and Map share the right sidebar, so their buttons are one switch: at most one is on. */
const sideSwitchView = (
  model: Model,
  maybeTalkPart: Option.Option<Part>,
  h: H,
): Html => {
  const choice = (
    side: 'Talk' | 'Map',
    label: string,
    isAvailable: boolean,
    title: string,
  ) =>
    h.button(
      [
        h.Class(
          `side-choice${model.side === side && isAvailable ? ' is-active' : ''}`,
        ),
        h.AriaPressed(String(model.side === side && isAvailable)),
        h.Disabled(!isAvailable),
        h.Title(title),
        h.OnClick(Message.ClickedSide({ side })),
      ],
      [label],
    )
  return h.div(
    [h.Class('side-switch'), h.Role('group'), h.AriaLabel('Right sidebar')],
    [
      choice(
        'Talk',
        'Talk',
        Option.isSome(maybeTalkPart),
        Option.isSome(maybeTalkPart)
          ? 'Talk about this concept in the sidebar'
          : 'Open a concept to talk about it',
      ),
      choice(
        'Map',
        'Map',
        true,
        'Show the map of all questions in the sidebar',
      ),
    ],
  )
}

const topbarView = (
  model: Model,
  snapshot: Snapshot,
  maybePart: Option.Option<Part>,
  maybeTalkPart: Option.Option<Part>,
  h: H,
): Html => {
  const grill = snapshot.grill
  const counts = tally(grill, model.answers, model.skipped)
  const needed = counts.total - counts.notNeeded
  const status =
    model.send === 'Sent'
      ? Option.some(
          `${model.sendDetail.charAt(0).toUpperCase()}${model.sendDetail.slice(1)}.`,
        )
      : model.send === 'Failed'
        ? Option.some(`Not sent: ${model.sendDetail}`)
        : model.maybeSaveError
  return h.header(
    [h.Class('topbar')],
    [
      h.div(
        [h.Class('topbar-inner')],
        [
          h.div(
            [h.Class('topbar-context')],
            [
              h.a(
                [h.Class('topbar-title'), h.Href('/'), h.Title('All grills')],
                [grill.title],
              ),
              h.span(
                [h.Class('where-part')],
                [pageTitle(model, grill, model.currentPart)],
              ),
              // Inline, so the bar keeps one line: the sidebars hang from its fixed height.
              h.span(
                [
                  h.Class(
                    `topbar-status${model.send === 'Failed' ? ' is-failed' : ''}`,
                  ),
                  h.AriaLive('polite'),
                  h.Title(Option.getOrElse(status, () => '')),
                ],
                [Option.getOrElse(status, () => '')],
              ),
            ],
          ),
          h.div(
            [h.Class('topbar-actions')],
            [
              h.span(
                [h.Class('topbar-count')],
                [
                  h.strong([], [`${counts.answered}/${needed}`]),
                  h.span([h.Class('wide-only')], [' answered']),
                ],
              ),
              sideSwitchView(model, maybeTalkPart, h),
              h.details(
                [h.Class('preview')],
                [
                  h.summary([h.Class('quiet-button')], ['Preview']),
                  h.pre(
                    [],
                    [
                      replyText(
                        grill,
                        model.answers,
                        model.notes,
                        model.own,
                        snapshot.sent,
                      ),
                    ],
                  ),
                ],
              ),
              h.button(
                [
                  h.Class('quiet-button copy-button'),
                  h.OnClick(Message.ClickedCopy()),
                ],
                [
                  model.copy === 'Copied'
                    ? 'Copied'
                    : model.copy === 'Failed'
                      ? 'Copy failed'
                      : 'Copy',
                ],
              ),
              h.button(
                [
                  h.Class('send-button'),
                  h.Disabled(
                    model.send === 'Sending' ||
                      freshAnswerCount(model, snapshot) === 0,
                  ),
                  h.Title(
                    freshAnswerCount(model, snapshot) === 0 ? NOTHING_NEW : '',
                  ),
                  h.OnClick(Message.ClickedSend()),
                ],
                model.send === 'Sending'
                  ? ['Sending…']
                  : [
                      'Send',
                      h.span([h.Class('wide-only')], [toSession(grill)]),
                    ],
              ),
            ],
          ),
        ],
      ),
    ],
  )
}

// CONCEPT NAVIGATION

const navView = (model: Model, grill: Grill, h: H): Html => {
  const hasUrgency = usesUrgency(grill)
  const issues = issuesOf(grill)
  const cards = cardsOf(grill)
  const modes = modesOf(grill)
  const item = (pageId: string, content: ReadonlyArray<Html>): Html =>
    h.keyed('button')(
      pageId,
      [
        h.Class(`concept${model.currentPart === pageId ? ' is-current' : ''}`),
        h.AriaCurrent(model.currentPart === pageId ? 'page' : 'false'),
        h.OnClick(Message.ClickedConcept({ partId: pageId })),
      ],
      content,
    )
  const answeredCount = grill.steps.filter(
    step => statusIn(model, grill, step.question.id)._tag === 'Answered',
  ).length
  const decidedCount = (grill.decided?.length ?? 0) + answeredCount
  // Titles read issue, name, then urgency; a concept with nothing left to answer has no dot.
  const navUrgency = (steps: ReadonlyArray<Step>): Html =>
    hasUrgency
      ? Option.match(worstUrgency(model, grill, steps), {
          onNone: () => h.empty,
          onSome: level => urgencyDot(level, h, true),
        })
      : h.empty
  const conceptItems = () => {
    return Array.map(grill.parts, part => {
      const steps = stepsIn(grill, part.id)
      const ids = Array.map(steps, step => step.question.id)
      const decided = Array.filter(
        ids,
        id => statusIn(model, grill, id)._tag === 'Answered',
      ).length
      return item(part.id, [
        h.span([h.Class('concept-name')], [part.title, navUrgency(steps)]),
        h.span(
          [h.Class('concept-count')],
          [`${decided} of ${ids.length} decided`],
        ),
        h.span(
          [h.Class('dots'), h.AriaHidden(true)],
          Array.map(ids, id =>
            h.span([
              h.Class(`dot ${stateClass(model, grill, id)}`),
              h.Title(id),
            ]),
          ),
        ),
      ])
    })
  }
  const urgencyItems = () =>
    Array.map(URGENCY_NAV, level => {
      const count = grill.steps.filter(
        step =>
          urgencyOf(step.question) === level && isPending(model, grill, step),
      ).length
      return item(`${URGENCY_PAGE}${level}`, [
        h.span(
          [h.Class('concept-name')],
          [urgencyDot(level, h), URGENCY_WORDS[level]],
        ),
        h.span([h.Class('concept-count')], [`${count} to answer`]),
      ])
    })
  const issueItems = () => {
    const ordered = hasUrgency
      ? Array.sort(issues, (a: string, b: string) => {
          const rank = (key: string) =>
            Option.match(worstUrgency(model, grill, stepsAbout(grill, key)), {
              onNone: () => URGENCY_ORDER.length,
              onSome: level => URGENCY_ORDER.indexOf(level),
            })
          return Math.sign(rank(a) - rank(b)) as -1 | 0 | 1
        })
      : issues
    return Array.map(ordered, key => {
      const steps = stepsAbout(grill, key)
      const ref = grill.refs?.[key]
      const decided = steps.filter(
        step => statusIn(model, grill, step.question.id)._tag === 'Answered',
      ).length
      return item(`${ISSUE_PAGE}${key}`, [
        h.span(
          [h.Class('concept-name')],
          [refLabel(grill, key, h), ref?.text ?? '', navUrgency(steps)],
        ),
        h.span(
          [h.Class('concept-count')],
          [
            `${ref?.state === undefined ? '' : `${ref.state} · `}${decided} of ${steps.length} decided`,
          ],
        ),
      ])
    })
  }
  const cardItems = () =>
    Array.map(cards, card => {
      const steps = stepsOnCard(grill, card)
      const decided = steps.filter(
        step => statusIn(model, grill, step.question.id)._tag === 'Answered',
      ).length
      const issue = cardIssue(grill, card)
      return item(`${CARD_PAGE}${card}`, [
        h.span(
          [h.Class('concept-name')],
          Option.match(issue, {
            onNone: () => [card, navUrgency(steps)],
            onSome: found => [
              refLabel(grill, found.id, h),
              found.title,
              navUrgency(steps),
            ],
          }),
        ),
        h.span(
          [h.Class('concept-count')],
          [
            `${Option.isSome(issue) ? `${card} · ` : ''}${decided} of ${steps.length} decided`,
          ],
        ),
      ])
    })
  const labels: Readonly<Record<SidebarMode, string>> = {
    Concepts: 'Concepts',
    Issues: 'Issues',
    Cards: 'Cards',
    Urgency: 'Urgency',
  }
  // The whole grill's pages first, then every list of the questions one under another, then
  // what is already decided.
  return h.nav(
    [h.Class('concepts'), h.AriaLabel('Pages')],
    [
      item(OVERVIEW, [
        h.span([h.Class('concept-name')], ['Overview']),
        h.span([h.Class('concept-count')], ['What this is about']),
      ]),
      grill.plan === undefined
        ? h.empty
        : item(PLAN, [
            h.span([h.Class('concept-name')], ['Plan']),
            h.span([h.Class('concept-count')], [planSummary(grill, model)]),
          ]),
      grill.plan === undefined
        ? h.empty
        : item(STATUS, [
            h.span([h.Class('concept-name')], ['Run status']),
            h.span(
              [h.Class('concept-count')],
              [statusSummary(grill, grill.plan, model)],
            ),
          ]),
      ...Array.flatMap(modes, mode => {
        const isFolded = Array.contains(model.navFolded, mode)
        return [
          h.button(
            [
              h.Class(`nav-section${isFolded ? '' : ' is-open'}`),
              h.AriaExpanded(!isFolded),
              h.OnClick(Message.ClickedToggleNavSection({ mode })),
            ],
            [h.span([h.Class('label')], [labels[mode]])],
          ),
          ...(isFolded
            ? []
            : mode === 'Urgency'
              ? urgencyItems()
              : mode === 'Issues'
                ? issueItems()
                : mode === 'Cards'
                  ? cardItems()
                  : conceptItems()),
        ]
      }),
      hasUrgency || grill.decided !== undefined
        ? item(DECIDED, [
            h.span([h.Class('concept-name')], ['Decided so far']),
            h.span([h.Class('concept-count')], [`${decidedCount} decisions`]),
          ])
        : h.empty,
    ],
  )
}

// PLAN

const PHASE_WORDS: Readonly<Record<PlanPhase, string>> = {
  building: 'Building now',
  review: 'In review',
  merged: 'Merged',
  ready: 'Ready to start',
  you: 'Waiting on you',
  stuck: 'Stuck, waiting on you',
  after: 'Waiting on another issue',
  outside: 'Outside the run',
}

const timeLeft = (deadline: string, now: number): string => {
  const hours = Math.max(
    0,
    Math.floor((new Date(deadline).getTime() - now) / 3_600_000),
  )
  return hours >= 24
    ? `${Math.floor(hours / 24)}d ${hours % 24}h left`
    : `${hours}h left`
}

const deadlineWords = (deadline: string): string =>
  new Date(deadline).toLocaleString('en-GB', {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })

/** The sidebar line under Plan: how many builds wait on Rob, and the time left. */
const planSummary = (grill: Grill, model: Model): string => {
  const waiting = waitingOnYou(grill, model.answers).length
  const deadline = grill.plan?.deadline
  return [
    waiting === 0
      ? 'Nothing waits on you'
      : `${waiting} ${waiting === 1 ? 'build waits' : 'builds wait'} on you`,
    ...(deadline === undefined || model.now === 0
      ? []
      : [timeLeft(deadline, model.now)]),
  ].join(' · ')
}

/** The sidebar line under Run status: how many issues are building, ready and merged. */
const statusSummary = (grill: Grill, plan: Plan, model: Model): string => {
  const count = (phases: ReadonlyArray<PlanPhase>): number =>
    Array.filter(plan.issues, issue =>
      phases.includes(planPhaseOf(grill, issue, model.answers)),
    ).length
  return [
    `${count(['building', 'review'])} building`,
    `${count(['ready'])} ready`,
    `${count(['merged'])} merged`,
  ].join(' · ')
}

const phasePill = (phase: PlanPhase, h: H): Html =>
  h.span([h.Class(`pill ph-${phase}`)], [PHASE_WORDS[phase]])

/** An issue's title, opening its card's questions when the plan names the card. */
const issueHeading = (issue: PlanIssue, h: H): Html =>
  issue.card === undefined
    ? h.span([h.Class('plan-title')], [issue.title])
    : h.button(
        [
          h.Class('plan-title'),
          h.Title(`Open card ${issue.card}`),
          h.OnClick(
            Message.ClickedConcept({ partId: `${CARD_PAGE}${issue.card}` }),
          ),
        ],
        [issue.title],
      )

const planLink = (grill: Grill, id: string, h: H): Html =>
  questionLink(id, grill, { tips: true, links: true }, h)

const planQuestion = (
  model: Model,
  grill: Grill,
  issue: PlanIssue,
  id: string,
  h: H,
): Html => {
  const also = Array.filter(
    grill.plan?.issues ?? [],
    other => other.id !== issue.id && (other.start ?? []).includes(id),
  )
  return h.div(
    [
      h.Class(
        `plan-q${statusIn(model, grill, id)._tag === 'Answered' ? ' is-done' : ''}`,
      ),
    ],
    [
      planLink(grill, id, h),
      h.span(
        [],
        [
          Option.match(stepOf(grill, id), {
            onNone: () => id,
            onSome: step => step.question.title,
          }),
          Array.isArrayEmpty(also)
            ? h.empty
            : h.span(
                [h.Class('plan-also')],
                [
                  ` also holds ${Array.join(
                    Array.map(also, other => other.id),
                    ', ',
                  )}`,
                ],
              ),
        ],
      ),
    ],
  )
}

const chainView = (
  grill: Grill,
  ids: ReadonlyArray<string>,
  h: H,
): ReadonlyArray<Html | string> =>
  Array.flatMap(ids, (id, index) => [
    index > 0 ? ' → ' : '',
    refOrKey(grill, id, h),
  ])

/** An issue waiting on Rob: the questions it needs by when, and what follows it. */
const waitingBlock = (
  model: Model,
  grill: Grill,
  issue: PlanIssue,
  rank: number,
  h: H,
): Html => {
  const critical = grill.plan?.critical ?? []
  const open = openGatesOf(grill, issue, model.answers)
  const answeredStart = Array.filter(
    issue.start ?? [],
    id => !open.includes(id),
  )
  const review = Array.filter(
    issue.review ?? [],
    id => statusIn(model, grill, id)._tag !== 'Answered',
  )
  const after = downstreamOf(grill, issue.id)
  return h.article(
    [h.Class(`plan-issue${rank === 1 ? ' is-first' : ''}`)],
    [
      h.div(
        [h.Class('plan-head')],
        [
          h.span(
            [h.Class('plan-rank')],
            [rank === 1 ? '1 · start here' : String(rank)],
          ),
          refOrKey(grill, issue.id, h),
          issueHeading(issue, h),
          phasePill(planPhaseOf(grill, issue, model.answers), h),
          critical.includes(issue.id)
            ? h.span([h.Class('plan-crit')], ['critical path'])
            : h.empty,
        ],
      ),
      Array.isReadonlyArrayEmpty(open)
        ? h.empty
        : h.div(
            [h.Class('plan-qs')],
            [
              h.span(
                [h.Class('label')],
                ['Its builder starts once you answer'],
              ),
              ...Array.map(open, id =>
                planQuestion(model, grill, issue, id, h),
              ),
            ],
          ),
      Array.isArrayEmpty(answeredStart)
        ? h.empty
        : h.p(
            [h.Class('plan-then')],
            [
              'Already answered for its start: ',
              ...Array.map(answeredStart, id => planLink(grill, id, h)),
            ],
          ),
      Array.isArrayEmpty(review)
        ? h.empty
        : h.div(
            [h.Class('plan-qs')],
            [
              h.span(
                [h.Class('label')],
                [
                  Array.isReadonlyArrayEmpty(open)
                    ? 'Its review needs your answer to'
                    : 'Can wait until its first review',
                ],
              ),
              ...Array.map(review, id =>
                planQuestion(model, grill, issue, id, h),
              ),
            ],
          ),
      Array.isReadonlyArrayEmpty(after)
        ? h.empty
        : h.p(
            [h.Class('plan-then')],
            ['Then ', ...chainView(grill, after, h), ' can follow'],
          ),
      issue.note === undefined
        ? h.empty
        : h.p([h.Class('plan-then')], [issue.note]),
    ],
  )
}

/** One line for an issue that needs nothing from Rob: what it is and what it waits for. */
const issueLine = (
  model: Model,
  grill: Grill,
  issue: PlanIssue,
  h: H,
): Html => {
  const phase = planPhaseOf(grill, issue, model.answers)
  const detail =
    phase === 'after'
      ? `after ${Array.join(issue.follows ?? [], ', ')}`
      : phase === 'ready'
        ? 'starts once you send the round and an agent is free'
        : (issue.agent ?? PHASE_WORDS[phase])
  return h.div(
    [h.Class('plan-line')],
    [
      h.span([], [refOrKey(grill, issue.id, h), ' ', issueHeading(issue, h)]),
      h.span([h.Class('plan-detail')], [detail]),
    ],
  )
}

/** The deadline, and why the first issue comes first: the critical chain it holds. */
const deadlineView = (model: Model, grill: Grill, plan: Plan, h: H): Html => {
  const chain = plan.critical ?? []
  const gates = Option.match(
    Array.findFirst(plan.issues, issue => issue.id === chain[0]),
    {
      onNone: () => [],
      onSome: issue => openGatesOf(grill, issue, model.answers),
    },
  )
  if (plan.deadline === undefined && Array.isReadonlyArrayEmpty(chain)) {
    return h.empty
  }
  return h.div(
    [h.Class('plan-deadline')],
    [
      plan.deadline === undefined
        ? h.empty
        : h.span(
            [h.Class('plan-when')],
            [
              'Deadline ',
              h.b([], [deadlineWords(plan.deadline)]),
              ...(model.now === 0
                ? []
                : [h.br([]), timeLeft(plan.deadline, model.now)]),
            ],
          ),
      Array.isReadonlyArrayEmpty(chain)
        ? h.empty
        : h.p(
            [],
            Array.isReadonlyArrayEmpty(gates)
              ? [
                  'The longest chain is ',
                  ...chainView(grill, chain, h),
                  '; nothing in it waits on you.',
                ]
              : [
                  'The longest chain is ',
                  ...chainView(grill, chain, h),
                  ', and none of it can start until you answer ',
                  ...Array.flatMap(gates, (id, index) => [
                    index > 0 ? ' ' : '',
                    planLink(grill, id, h),
                  ]),
                  '. That is why its questions come first.',
                ],
          ),
    ],
  )
}

const agentsView = (model: Model, grill: Grill, plan: Plan, h: H): Html => {
  if (plan.slots === undefined) {
    return h.empty
  }
  const busy = Array.filter(plan.issues, issue => {
    const phase = planPhaseOf(grill, issue, model.answers)
    return phase === 'building' || phase === 'review' || phase === 'stuck'
  })
  return h.p(
    [h.Class('plan-agents')],
    [
      h.span([h.Class('label')], [`Agents (${plan.slots})`]),
      ...Array.map(busy, issue =>
        h.span(
          [h.Class(`plan-slot${issue.phase === 'stuck' ? ' is-stuck' : ''}`)],
          [
            `${issue.id} · ${issue.agent ?? PHASE_WORDS[planPhaseOf(grill, issue, model.answers)]}`,
          ],
        ),
      ),
      ...Array.makeBy(Math.max(0, plan.slots - busy.length), () =>
        h.span([h.Class('plan-slot is-idle')], ['idle']),
      ),
    ],
  )
}

/** The run's plan: what waits on Rob first, ranked, then everything else, as a list or a board. */
/**
 * The run, two ways: the Plan's board (what waits on you, then columns by phase) or its status
 * (every issue under where it stands, merged and outside the run included).
 */
const planPageView = (
  model: Model,
  grill: Grill,
  plan: Plan,
  layout: 'Board' | 'Status',
  h: H,
): Html => {
  const waiting = waitingOnYou(grill, model.answers)
  const inPhase = (phases: ReadonlyArray<PlanPhase>) =>
    Array.filter(plan.issues, issue =>
      phases.includes(planPhaseOf(grill, issue, model.answers)),
    )
  const columns: ReadonlyArray<readonly [string, ReadonlyArray<PlanIssue>]> = [
    [
      'Building now',
      Array.filter(
        inPhase(['building', 'review']),
        issue => !waiting.some(other => other.id === issue.id),
      ),
    ],
    ['Ready to start', inPhase(['ready'])],
    ['Waiting on another issue', inPhase(['after'])],
  ]
  const footnotes: ReadonlyArray<readonly [string, ReadonlyArray<PlanIssue>]> =
    [
      ['Merged', inPhase(['merged'])],
      ['Outside the run', inPhase(['outside'])],
    ]
  const waitingColumn = h.div(
    [h.Class('plan-col is-waiting')],
    [
      h.h2([], ['Waiting on you, most urgent first']),
      ...(Array.isReadonlyArrayEmpty(waiting)
        ? [h.p([h.Class('hint')], ['Nothing waits on you.'])]
        : Array.map(waiting, (issue, index) =>
            waitingBlock(model, grill, issue, index + 1, h),
          )),
    ],
  )
  const group = (
    title: string,
    issues: ReadonlyArray<PlanIssue>,
    asCards: boolean,
  ): Html =>
    h.section(
      [h.Class(asCards ? 'plan-col' : 'plan-group')],
      [
        h.h2([], [title]),
        ...(Array.isReadonlyArrayEmpty(issues)
          ? [h.p([h.Class('hint')], ['None.'])]
          : Array.map(issues, issue =>
              asCards
                ? h.article(
                    [
                      h.Class(
                        `plan-card${(plan.critical ?? []).includes(issue.id) ? ' is-crit' : ''}`,
                      ),
                    ],
                    [issueLine(model, grill, issue, h)],
                  )
                : issueLine(model, grill, issue, h),
            )),
      ],
    )
  const isBoard = layout === 'Board'
  return h.div(
    [h.Class(`concept-page plan-page${isBoard ? ' is-board' : ''}`)],
    [
      h.h1([h.Class('concept-title')], [isBoard ? 'Plan' : 'Run status']),
      deadlineView(model, grill, plan, h),
      agentsView(model, grill, plan, h),
      h.div(
        [h.Class(isBoard ? 'plan-board' : 'plan-list')],
        isBoard
          ? [
              waitingColumn,
              ...Array.map(columns, ([title, issues]) =>
                group(title, issues, true),
              ),
            ]
          : [
              waitingColumn,
              // What is moving, then what waits on other issues or isn't the run's.
              ...Array.map(
                [
                  [columns[0], columns[1], footnotes[0]],
                  [columns[2], footnotes[1]],
                ],
                panel =>
                  h.div(
                    [h.Class('plan-rest')],
                    Array.flatMap(panel, entry =>
                      entry === undefined ||
                      Array.isReadonlyArrayEmpty(entry[1])
                        ? []
                        : [group(entry[0], entry[1], false)],
                    ),
                  ),
              ),
            ],
      ),
      isBoard
        ? h.p(
            [h.Class('plan-then')],
            Array.flatMap(footnotes, ([title, issues]) =>
              Array.isReadonlyArrayEmpty(issues)
                ? []
                : [
                    `${title}: `,
                    ...chainView(
                      grill,
                      Array.map(issues, issue => issue.id),
                      h,
                    ),
                    '. ',
                  ],
            ),
          )
        : h.empty,
    ],
  )
}

// OVERVIEW

const overviewView = (model: Model, snapshot: Snapshot, h: H): Html => {
  const grill = snapshot.grill
  return h.div(
    [h.Class('concept-page')],
    [
      (grill.version ?? 1) > FORMAT_VERSION
        ? h.p(
            [h.Class('hint')],
            [
              `This grill uses format ${grill.version}; this page reads up to ${FORMAT_VERSION}, so some parts may not show. Pull grill-flow to see them.`,
            ],
          )
        : h.empty,
      h.h1([h.Class('concept-title')], [grill.title]),
      h.div(
        [h.Class('prose')],
        Array.map(grill.intro, paragraph => paragraphView(paragraph, grill, h)),
      ),
      grill.entities.length > 0
        ? h.dl(
            [h.Class('who')],
            Array.flatMap(grill.entities, entity => [
              h.dt(
                [],
                [
                  h.span(
                    [h.Class(`entity tone-${entity.tone}`)],
                    [entity.name],
                  ),
                ],
              ),
              h.dd([], [entity.about]),
            ]),
          )
        : h.empty,
      h.section(
        [h.Class('overview-map')],
        [
          h.h2([h.Class('section-title')], ['The whole map']),
          h.p(
            [h.Class('hint')],
            [
              'One row per concept. A solid line waits for an answer; a dashed line mentions it. Hover to see links, click to go.',
            ],
          ),
          mapView(
            model,
            snapshot,
            {
              orientation: 'Rows',
              maybeFocus: Option.none(),
              maybeCurrent: Option.none(),
            },
            h,
          ),
        ],
      ),
      grill.terms.length > 0
        ? h.section(
            [h.Class('glossary')],
            [
              h.h2([h.Class('section-title')], ['Words used on this page']),
              h.dl(
                [h.Class('who')],
                Array.flatMap(grill.terms, term => [
                  h.dt([], [h.b([], [term.term])]),
                  h.dd([], [term.about]),
                ]),
              ),
            ],
          )
        : h.empty,
      h.section(
        [h.Class('prose')],
        [
          h.h2([h.Class('section-title')], ['After this round']),
          ...Array.map(grill.next, paragraph =>
            paragraphView(paragraph, grill, h),
          ),
        ],
      ),
    ],
  )
}

// URGENCY AND DECIDED PAGES

const urgencyPageView = (
  model: Model,
  snapshot: Snapshot,
  level: UrgencyLevel,
  h: H,
): Html => {
  const grill = snapshot.grill
  const steps = mixedPageSteps(model, grill)
  return h.div(
    [h.Class('concept-page')],
    [
      h.h1(
        [h.Class('concept-title')],
        [urgencyDot(level, h), ' ', URGENCY_WORDS[level]],
      ),
      h.p(
        [h.Class('concept-def')],
        [
          'Every question at this urgency, across issues.',
          grill.refsAt === undefined
            ? ''
            : ` Linear states as of ${grill.refsAt}.`,
        ],
      ),
      Array.isReadonlyArrayEmpty(steps)
        ? h.p([h.Class('hint')], ['Nothing here.'])
        : h.div(
            [h.Class('questions')],
            Array.map(steps, step =>
              questionView(model, snapshot, step, h, true),
            ),
          ),
    ],
  )
}

const issuePageView = (
  model: Model,
  snapshot: Snapshot,
  key: string,
  h: H,
): Html => {
  const grill = snapshot.grill
  const ref = grill.refs?.[key]
  return h.div(
    [h.Class('concept-page')],
    [
      h.p(
        [h.Class('issue-head')],
        [refOrKey(grill, key, h), ' ', ref?.state ?? ''],
      ),
      h.h1([h.Class('concept-title')], [ref?.text ?? key]),
      h.p(
        [h.Class('concept-def')],
        ['Every question about this issue, from whichever concept asks it.'],
      ),
      h.div(
        [h.Class('questions')],
        Array.map(mixedPageSteps(model, grill), step =>
          questionView(model, snapshot, step, h),
        ),
      ),
    ],
  )
}

const cardPageView = (
  model: Model,
  snapshot: Snapshot,
  card: string,
  h: H,
): Html =>
  h.div(
    [h.Class('concept-page')],
    [
      // A card is one issue's design gate: say which, and where it stands in the plan.
      Option.match(cardIssue(snapshot.grill, card), {
        onNone: () => h.empty,
        onSome: issue =>
          h.p(
            [h.Class('issue-head')],
            [
              refOrKey(snapshot.grill, issue.id, h),
              ' ',
              phasePill(planPhaseOf(snapshot.grill, issue, model.answers), h),
              ' ',
              h.button(
                [
                  h.Class('text-button'),
                  h.OnClick(Message.ClickedConcept({ partId: PLAN })),
                ],
                ['See it in the Plan'],
              ),
            ],
          ),
      }),
      h.h1([h.Class('concept-title')], [cardName(snapshot.grill, card)]),
      h.p(
        [h.Class('concept-def')],
        [
          `Card ${card}: the questions its design gate left for you, from whichever concept asks them.`,
        ],
      ),
      h.div(
        [h.Class('questions')],
        Array.map(mixedPageSteps(model, snapshot.grill), step =>
          questionView(model, snapshot, step, h, true),
        ),
      ),
    ],
  )

const decidedPageView = (model: Model, snapshot: Snapshot, h: H): Html => {
  const grill = snapshot.grill
  const answered = grill.steps.filter(
    step => statusIn(model, grill, step.question.id)._tag === 'Answered',
  )
  return h.div(
    [h.Class('concept-page')],
    [
      h.h1([h.Class('concept-title')], ['Decided so far']),
      h.ul(
        [h.Class('decided')],
        [
          ...Array.map(grill.decided ?? [], decision =>
            h.li(
              [],
              [
                h.span([h.Class('decided-id')], [decision.id]),
                h.span([], inline(decision.text, grill, h)),
              ],
            ),
          ),
          ...Array.map(answered, step =>
            h.li(
              [],
              [
                h.button(
                  [
                    h.Class('ref decided-id'),
                    h.OnClick(
                      Message.ClickedMapNode({ question: step.question.id }),
                    ),
                  ],
                  [step.question.id],
                ),
                h.span(
                  [],
                  [
                    `${step.question.title}: `,
                    ...answerSummary(model, grill, step, h),
                    ' (this round)',
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    ],
  )
}

// CONCEPT PAGE

const conceptView = (
  model: Model,
  snapshot: Snapshot,
  part: Part,
  h: H,
): Html => {
  const grill = snapshot.grill
  const steps = stepsIn(grill, part.id)
  return h.div(
    [h.Class('concept-page')],
    [
      part.issue === undefined
        ? h.empty
        : h.p(
            [h.Class('issue-head')],
            [
              refOrKey(grill, part.issue, h),
              ' ',
              grill.refs?.[part.issue]?.state ?? '',
            ],
          ),
      h.h1([h.Class('concept-title')], [part.title]),
      h.p([h.Class('concept-def')], inline(part.summary, grill, h)),
      h.section(
        [
          h.Class(
            `concept-map${model.isConceptMapOpen ? ' is-open' : ' is-folded'}`,
          ),
        ],
        [
          h.button(
            [
              h.Class('fold-toggle'),
              h.AriaExpanded(model.isConceptMapOpen),
              h.OnClick(Message.ClickedToggleConceptMap()),
            ],
            ['This concept on the map'],
          ),
          ...(model.isConceptMapOpen
            ? [
                h.p(
                  [h.Class('hint')],
                  [
                    'What it builds on and what it feeds. Hover a question to see its links.',
                  ],
                ),
                mapView(
                  model,
                  snapshot,
                  {
                    orientation: 'Rows',
                    maybeFocus: Option.some(part.id),
                    maybeCurrent: Option.none(),
                  },
                  h,
                ),
              ]
            : []),
        ],
      ),
      h.div(
        [h.Class(`shape${model.isShapeOpen ? ' is-open' : ''}`)],
        [
          h.button(
            [
              h.Class('fold-toggle'),
              h.AriaExpanded(model.isShapeOpen),
              h.OnClick(Message.ClickedToggleShape()),
            ],
            [
              'The shape so far',
              h.span(
                [h.Class('fold-count')],
                [
                  `${Array.filter(steps, step => statusIn(model, grill, step.question.id)._tag === 'Answered').length} of ${steps.length} decided`,
                ],
              ),
            ],
          ),
          model.isShapeOpen
            ? h.ul(
                [],
                Array.map(steps, step =>
                  h.li(
                    [],
                    [
                      h.button(
                        [
                          h.Class('ref'),
                          h.OnClick(
                            Message.ClickedMapNode({
                              question: step.question.id,
                            }),
                          ),
                        ],
                        [step.question.id],
                      ),
                      ` ${step.question.title}: `,
                      ...answerSummary(model, grill, step, h),
                    ],
                  ),
                ),
              )
            : h.empty,
        ],
      ),
      h.div(
        [h.Class('questions')],
        Array.map(steps, step => questionView(model, snapshot, step, h, true)),
      ),
    ],
  )
}

const questionView = (
  model: Model,
  snapshot: Snapshot,
  step: Step,
  h: H,
  showIssue = false,
): Html => {
  const grill = snapshot.grill
  const id = step.question.id
  const open = isOpen(model, grill, step)
  const isSentBefore = sentIdsOf(model, snapshot).has(id)
  return h.keyed('section')(
    step.id,
    [
      h.Class(
        `question ${stateClass(model, grill, id)}${isSentBefore ? ' is-sent' : ''}${open ? ' is-expanded' : ''}`,
      ),
      h.Id(`q-${id}`),
    ],
    [
      h.button(
        [
          h.Class('row'),
          h.AriaExpanded(open),
          h.OnClick(
            Message.ClickedToggleQuestion({ question: id, open: !open }),
          ),
        ],
        [
          h.span([h.Class('row-id')], [id]),
          h.span(
            [h.Class('row-main')],
            [
              h.span(
                [h.Class('row-title')],
                [
                  showIssue && !open && step.question.issue !== undefined
                    ? refLabel(grill, step.question.issue, h)
                    : h.empty,
                  step.heading,
                  usesUrgency(grill)
                    ? urgencyDot(urgencyOf(step.question), h, true)
                    : h.empty,
                ],
              ),
              step.question.scope === ''
                ? h.empty
                : h.span([h.Class('scope')], [step.question.scope]),
            ],
          ),
          h.span(
            [h.Class('row-state')],
            [
              ...answerSummary(model, grill, step, h),
              isSentBefore
                ? h.span(
                    [
                      h.Class('sent-tag'),
                      h.Title(
                        'Already sent; Send leaves it out unless you change it',
                      ),
                    ],
                    ['sent'],
                  )
                : h.empty,
            ],
          ),
        ],
      ),
      open ? questionBodyView(model, snapshot, step, h) : h.empty,
    ],
  )
}

const questionBodyView = (
  model: Model,
  snapshot: Snapshot,
  step: Step,
  h: H,
): Html => {
  const grill = snapshot.grill
  const question = step.question
  const id = question.id
  const status = statusIn(model, grill, id)
  const inactive = status._tag === 'Waiting' || status._tag === 'NotNeeded'
  const selected = Record.get(model.answers, id)
  const note = Option.getOrElse(Record.get(model.notes, id), () => '')
  const hasListedPick = Option.exists(selected, key =>
    Array.some(question.options, option => option.key === key),
  )
  return h.div(
    [h.Class('question-body')],
    [
      statusLine(model, grill, step, status, h),
      h.div(
        [h.Class('question-links')],
        [
          question.issue === undefined
            ? h.empty
            : refOrKey(grill, question.issue, h),
          whyLink(step, h),
          status._tag === 'Open' && !Array.contains(model.skipped, id)
            ? h.button(
                [
                  h.Class('text-button'),
                  h.OnClick(Message.ClickedSkip({ question: id })),
                ],
                ['Skip for now'],
              )
            : h.empty,
          Option.isSome(selected)
            ? h.button(
                [
                  h.Class('text-button'),
                  h.OnClick(Message.ClickedClearAnswer({ question: id })),
                ],
                ['Clear my answer'],
              )
            : h.empty,
        ],
      ),
      h.p(
        [h.Class('question-ask'), h.Id(`ask-text-${id}`)],
        inline(question.ask, grill, h),
      ),
      h.div(
        [
          h.Class('options'),
          h.Role('radiogroup'),
          h.AriaLabelledBy(`ask-text-${id}`),
        ],
        [
          ...Array.map(question.options, option => {
            const isSelected = Option.exists(
              selected,
              key => key === option.key,
            )
            return h.keyed('div')(
              option.key,
              [h.Class(`option${isSelected ? ' is-selected' : ''}`)],
              [
                h.button(
                  [
                    h.Type('button'),
                    h.Role('radio'),
                    h.AriaChecked(isSelected),
                    h.Disabled(inactive),
                    h.Class('option-pick'),
                    h.OnClick(
                      Message.SelectedOption({ question: id, key: option.key }),
                    ),
                  ],
                  [
                    h.span([h.Class('option-key')], [option.key]),
                    h.span(
                      [h.Class('option-body')],
                      [
                        h.span(
                          [h.Class('option-label')],
                          [
                            ...plain(option.label, grill, h),
                            option.recommended
                              ? h.span(
                                  [h.Class('recommended')],
                                  ['Recommended'],
                                )
                              : h.empty,
                          ],
                        ),
                        h.span(
                          [h.Class('option-effect')],
                          plain(option.effect, grill, h),
                        ),
                      ],
                    ),
                  ],
                ),
                isSelected ? noteBox(id, note, inactive, h) : h.empty,
              ],
            )
          }),
          ownOptionView(model, id, inactive, h),
        ],
      ),
      // A note left without a listed pick stays editable rather than hidden.
      note !== '' && !hasListedPick ? noteBox(id, note, inactive, h) : h.empty,
      question.from === undefined && !hasOutside(snapshot, step)
        ? h.empty
        : h.div(
            [h.Class('question-meta')],
            [
              outsideView(model, snapshot, step, h),
              fromView(model, grill, step, h),
            ],
          ),
    ],
  )
}

const outsideOf = (snapshot: Snapshot, step: Step): ReadonlyArray<string> =>
  Array.filter(
    Array.dedupe(
      Array.appendAll(upstreamOf(step.question), mentionsOf(snapshot, step)),
    ),
    other =>
      Option.exists(
        stepOf(snapshot.grill, other),
        found => found.part !== step.part,
      ),
  )

const hasOutside = (snapshot: Snapshot, step: Step): boolean =>
  !Array.isReadonlyArrayEmpty(outsideOf(snapshot, step))

/** Questions from other concepts this one builds on or names, as chips that open a card in place. */
const outsideView = (
  model: Model,
  snapshot: Snapshot,
  step: Step,
  h: H,
): Html => {
  const grill = snapshot.grill
  const id = step.question.id
  return Array.match(outsideOf(snapshot, step), {
    onEmpty: () => h.empty,
    onNonEmpty: ids =>
      h.div(
        [h.Class('outside')],
        [
          h.div(
            [h.Class('chips')],
            [
              h.span([h.Class('label')], ['From other concepts']),
              ...Array.flatMap(ids, other =>
                Option.match(stepOf(grill, other), {
                  onNone: () => [],
                  onSome: otherStep => [
                    h.button(
                      [
                        h.Class(
                          `chip${Array.contains(model.peeks, `${id}>${other}`) ? ' is-on' : ''}`,
                        ),
                        h.AriaExpanded(
                          Array.contains(model.peeks, `${id}>${other}`),
                        ),
                        h.OnClick(
                          Message.ClickedPeek({ key: `${id}>${other}` }),
                        ),
                      ],
                      [
                        h.b([], [other]),
                        ` ${otherStep.question.title} · `,
                        ...answerSummary(model, grill, otherStep, h),
                      ],
                    ),
                  ],
                }),
              ),
            ],
          ),
          ...Array.flatMap(ids, other =>
            Array.contains(model.peeks, `${id}>${other}`)
              ? Option.match(stepOf(grill, other), {
                  onNone: () => [],
                  onSome: otherStep => [peekView(model, grill, otherStep, h)],
                })
              : [],
          ),
        ],
      ),
  })
}

const whyLink = (step: Step, h: H): Html =>
  h.button(
    [
      h.Class('why-link'),
      h.Title('Opens the reasoning in Talk'),
      h.OnClick(
        Message.ClickedWhy({ partId: step.part, question: step.question.id }),
      ),
    ],
    ["Why we're asking"],
  )

const peekView = (model: Model, grill: Grill, step: Step, h: H): Html =>
  h.div(
    [h.Class('peek')],
    [
      h.p(
        [h.Class('peek-title')],
        [
          h.span([h.Class('question-id')], [`${step.question.id} `]),
          step.heading,
        ],
      ),
      step.question.scope === ''
        ? h.empty
        : h.p(
            [h.Class('applies')],
            [h.span([h.Class('label')], ['Applies']), step.question.scope],
          ),
      h.p([], inline(step.question.ask, grill, h)),
      h.p([h.Class('peek-answer')], answerSummary(model, grill, step, h)),
      h.button(
        [
          h.Class('text-button'),
          h.OnClick(Message.ClickedMapNode({ question: step.question.id })),
        ],
        [`Go to ${step.question.id}`],
      ),
    ],
  )

const statusLine = (
  model: Model,
  grill: Grill,
  step: Step,
  status: Status,
  h: H,
): Html => {
  const id = step.question.id
  if (status._tag === 'Waiting') {
    return h.p(
      [h.Class('status-line')],
      [
        'Waits for ',
        ...Array.flatMap(status.on, (other, index) => [
          index > 0 ? ' and ' : '',
          h.button(
            [
              h.Class('ref'),
              h.OnClick(Message.ClickedMapNode({ question: other })),
            ],
            [other],
          ),
        ]),
        '. Skip that one to answer this now.',
      ],
    )
  }
  if (status._tag === 'NotNeeded') {
    return h.p(
      [h.Class('status-line')],
      [`Not needed, because ${status.because}.`],
    )
  }
  if (isSkipped(model, grill, id)) {
    return h.p(
      [h.Class('status-line skip-line')],
      [
        'Skipped for now. The questions that wait on it are open meanwhile. ',
        h.button(
          [
            h.Class('text-button'),
            h.OnClick(Message.ClickedUnskip({ question: id })),
          ],
          ['Answer now'],
        ),
      ],
    )
  }
  const skippedUpstream = Array.filter(
    upstreamOf(step.question),
    other =>
      Array.contains(model.skipped, other) && !Record.has(model.answers, other),
  )
  return Array.match(skippedUpstream, {
    onEmpty: () => h.empty,
    onNonEmpty: ids =>
      h.p(
        [h.Class('status-line')],
        [
          `${Array.join(ids, ' and ')} ${ids.length > 1 ? 'are' : 'is'} skipped for now, so this answer may change.`,
        ],
      ),
  })
}

const noteBox = (id: string, note: string, inactive: boolean, h: H): Html =>
  h.textarea([
    h.Id(`note-${id}`),
    h.Class('note-box'),
    h.Rows(2),
    h.Value(note),
    h.Disabled(inactive),
    h.AriaLabel(`Note for the agent on ${id}`),
    h.Placeholder('Note for the agent: a condition or a doubt (optional)'),
    h.OnInput(value => Message.UpdatedNote({ question: id, value })),
    h.OnBlur(Message.BlurredNote({ question: id })),
  ])

const ownOptionView = (
  model: Model,
  id: string,
  inactive: boolean,
  h: H,
): Html => {
  const isSelected = Option.exists(
    Record.get(model.answers, id),
    key => key === OWN,
  )
  const text = Option.getOrElse(Record.get(model.own, id), () => '')
  return h.keyed('div')(
    OWN,
    [h.Class(`option own${isSelected ? ' is-selected' : ''}`)],
    [
      h.button(
        [
          h.Type('button'),
          h.Role('radio'),
          h.AriaChecked(isSelected),
          h.Disabled(inactive),
          h.Class('option-pick'),
          h.OnClick(Message.SelectedOwnAnswer({ question: id })),
        ],
        [
          h.span([h.Class('option-key')], ['?']),
          h.span(
            [h.Class('option-body')],
            [
              h.span(
                [h.Class('option-label'), h.Title('None of these fits')],
                ['My own answer'],
              ),
            ],
          ),
        ],
      ),
      isSelected
        ? h.textarea([
            h.Id(`own-${id}`),
            h.Class('own-text'),
            h.Rows(3),
            h.Value(text),
            h.AriaLabel(`Your own answer to ${id}`),
            h.Placeholder('Your answer, in your words'),
            h.OnInput(value =>
              Message.UpdatedOwnAnswer({ question: id, value }),
            ),
            h.OnBlur(Message.BlurredOwnAnswer({ question: id })),
          ])
        : h.empty,
    ],
  )
}

// REASONING

const reasoningView = (
  model: Model,
  snapshot: Snapshot,
  step: Step,
  h: H,
): Html => {
  const grill = snapshot.grill
  const prose = proseOf(snapshot, step)
  const showDiff = Option.getOrElse(
    Record.get(model.diffShown, step.id),
    () => false,
  )
  return Option.match(prose.previous, {
    onNone: () =>
      h.div(
        [h.Class('prose')],
        Array.map(prose.paragraphs, p => paragraphView(p, grill, h)),
      ),
    onSome: previous =>
      h.div(
        [h.Class('prose is-revised')],
        [
          h.p(
            [h.Class('revision-line')],
            [
              'Rewritten on your ask. ',
              h.button(
                [
                  h.Class('text-button'),
                  h.OnClick(Message.ClickedToggleDiff({ stepId: step.id })),
                ],
                [showDiff ? 'Hide changes' : 'Show changes'],
              ),
            ],
          ),
          showDiff
            ? h.div(
                [h.Class('prose diff')],
                Array.map(
                  diffBlocks(
                    Array.join(previous, '\n\n'),
                    Array.join(prose.paragraphs, '\n\n'),
                  ),
                  block => diffBlockView(block, grill, h),
                ),
              )
            : h.div(
                [h.Class('prose')],
                Array.map(prose.paragraphs, p => paragraphView(p, grill, h)),
              ),
        ],
      ),
  })
}

const diffLineView = (
  line: DiffLine,
  grill: Grill,
  h: H,
): ReadonlyArray<Html | string> =>
  Array.map(line, part => {
    const content = plain(part.text, grill, h)
    return part._tag === 'Added'
      ? h.ins([], content)
      : part._tag === 'Removed'
        ? h.del([], content)
        : h.span([], content)
  })

const diffBlockView = (block: DiffBlock, grill: Grill, h: H): Html =>
  block._tag === 'Paragraph'
    ? h.p([], diffLineView(block.parts, grill, h))
    : h.div(
        [h.Class('list-block')],
        [
          block.lead.length > 0
            ? h.p([], diffLineView(block.lead, grill, h))
            : h.empty,
          h.ul(
            [],
            Array.map(block.items, item =>
              h.li([], diffLineView(item, grill, h)),
            ),
          ),
        ],
      )

// CONVERSATION

type Said = Readonly<{
  at: number
  who: 'you' | 'agent'
  body: ReadonlyArray<Html | string>
}>

const bySaidTime = (a: Said, b: Said): -1 | 0 | 1 =>
  a.at < b.at ? -1 : a.at > b.at ? 1 : 0

/** The asks on one target and the agent's replies, oldest first. */
const saidOn = (
  snapshot: Snapshot,
  target: string,
  label: string,
  h: H,
): ReadonlyArray<Said> => {
  const grill = snapshot.grill
  const asks = Array.filter(snapshot.asks, ask => ask.stepId === target)
  const said = Array.flatMap(asks, (ask): ReadonlyArray<Said> => {
    const mine: Said = {
      at: ask.at,
      who: 'you',
      body: [h.p([], inline(ask.text, grill, h))],
    }
    const replies = Array.filter(
      snapshot.revisions,
      revision => revision.askId === ask.id,
    )
    if (Array.isArrayEmpty(replies)) {
      return [
        mine,
        {
          at: ask.at + 1,
          who: 'agent',
          body: [h.p([], [h.em([], ['Working on it…'])])],
        },
      ]
    }
    return [
      mine,
      ...Array.map(replies, (reply): Said => ({
        at: reply.at,
        who: 'agent',
        body:
          reply.kind === 'rewrite'
            ? [
                h.p(
                  [],
                  [
                    `I rewrote the reasoning for ${label}. `,
                    h.button(
                      [
                        h.Class('text-button'),
                        h.OnClick(
                          Message.ClickedShowChanges({
                            question: label,
                            stepId: reply.stepId,
                          }),
                        ),
                      ],
                      ['Show the changes'],
                    ),
                  ],
                ),
              ]
            : Array.map(splitParagraphs(reply.text), paragraph =>
                paragraphView(paragraph, grill, h),
              ),
      })),
    ]
  })
  return Array.sort(said, bySaidTime)
}

const saidView = (message: Said, h: H): Html =>
  h.div(
    [h.Class(`message from-${message.who}`)],
    [
      h.p([h.Class('message-who')], [message.who === 'you' ? 'You' : 'Agent']),
      h.div([h.Class('message-body')], message.body),
    ],
  )

const messageCount = (said: ReadonlyArray<Said>): string =>
  said.length === 1 ? '1 message' : `${said.length} messages`

// Each question's reasoning opens its own conversation, and folds with it (isWhyOpen).
const whyMessage = (
  model: Model,
  snapshot: Snapshot,
  step: Step,
  open: boolean,
  h: H,
): Html => {
  const said = saidOn(snapshot, step.id, step.question.id, h)
  return h.div(
    [
      h.Id(`why-${step.id}`),
      h.Class(`thread why-message${open ? ' is-open' : ''}`),
    ],
    [
      // Folded, the whole card opens it; open, its header folds it.
      open
        ? h.div(
            [h.Class('message from-agent why-card')],
            [
              h.button(
                [
                  h.Class('why-head why-toggle'),
                  h.AriaExpanded(true),
                  h.OnClick(
                    Message.ClickedToggleWhy({ stepId: step.id, open: false }),
                  ),
                ],
                [`Agent · why we're asking ${step.question.id}`],
              ),
              h.div(
                [h.Class('message-body why-body')],
                [reasoningView(model, snapshot, step, h)],
              ),
            ],
          )
        : h.button(
            [
              h.Class('message from-agent why-card'),
              h.AriaExpanded(false),
              h.OnClick(
                Message.ClickedToggleWhy({ stepId: step.id, open: true }),
              ),
            ],
            [
              h.span(
                [h.Class('why-head why-toggle')],
                [
                  `Agent · why we're asking ${step.question.id}`,
                  Array.isReadonlyArrayEmpty(said)
                    ? ''
                    : ` · ${messageCount(said)}`,
                ],
              ),
              h.span([h.Class('why-folded')], [step.question.title]),
            ],
          ),
      open
        ? h.div(
            [h.Class('replies')],
            [
              ...Array.map(said, message => saidView(message, h)),
              threadBox(model, step, h),
            ],
          )
        : h.empty,
    ],
  )
}

/** A small box under a question's reasoning, for asking about that question in place. */
const threadBox = (model: Model, step: Step, h: H): Html =>
  h.form(
    [
      h.Class('thread-box'),
      h.OnSubmit(Message.SubmittedThread({ stepId: step.id })),
    ],
    [
      h.keyed('textarea')(`thread-${step.id}-${model.talkGeneration}`, [
        h.Id(`thread-box-${step.id}`),
        h.Rows(1),
        h.OnMount(
          FillBox({
            text: Option.getOrElse(
              Record.get(model.talkDrafts, threadDraftKey(step.id)),
              () => '',
            ),
          }),
        ),
        h.AriaLabel(`Message to the agent about ${step.question.id}`),
        h.Placeholder(`Ask about ${step.question.id}`),
        h.OnInput(value =>
          Message.UpdatedTalkDraft({
            partId: threadDraftKey(step.id),
            value,
          }),
        ),
        h.OnKeyDownPreventDefault((pressed, { shiftKey }) =>
          pressed === 'Enter' && !shiftKey
            ? Option.some(Message.SubmittedThread({ stepId: step.id }))
            : Option.none(),
        ),
      ]),
      h.button([h.Type('submit'), h.Class('quiet-button')], ['Send']),
    ],
  )

const talkView = (model: Model, snapshot: Snapshot, part: Part, h: H): Html => {
  const grill = snapshot.grill
  const steps = stepsIn(grill, part.id)
  // A mixed page offers every question it lists; picking one from another concept moves Talk there.
  const mixedSteps = mixedPageSteps(model, grill)
  const aboutSteps = Array.isReadonlyArrayEmpty(mixedSteps) ? steps : mixedSteps
  const onCard = isCardPage(model.currentPart)
  const key = talkKeyOf(model.currentPart, part.id)
  const card = model.currentPart.slice(CARD_PAGE.length)
  const title = onCard ? cardName(grill, card) : part.title
  const whole = onCard ? 'the whole card' : 'the whole concept'
  const isHere = (step: Step): boolean => onCard || step.part === part.id
  // Unpicked, Talk is about the open question on the page, else the page as a whole.
  const about = Option.getOrElse(
    Option.orElse(
      Option.filter(
        Record.get(model.talkAbout, key),
        picked =>
          picked === 'concept' ||
          Array.some(aboutSteps, step => step.question.id === picked),
      ),
      () =>
        Option.map(
          Array.findFirst(
            aboutSteps,
            step => isHere(step) && isOpen(model, grill, step),
          ),
          step => step.question.id,
        ),
    ),
    () => 'concept',
  )
  const general = saidOn(snapshot, generalTargetOf(key), whole, h)
  const draft = Option.getOrElse(Record.get(model.talkDrafts, key), () => '')
  return h.aside(
    [h.Class('side talk'), h.AriaLabel(`Conversation about ${title}`)],
    [
      h.header(
        [h.Class('side-head')],
        [
          h.div(
            [],
            [
              h.p(
                [h.Class('label')],
                [
                  grill.session === ''
                    ? 'Talking with the agent'
                    : `Talking with the agent in ${grill.session}`,
                ],
              ),
              h.h2([], [title]),
            ],
          ),
          h.button(
            [
              h.Class('text-button'),
              h.OnClick(Message.ClickedSide({ side: 'None' })),
            ],
            ['Close'],
          ),
        ],
      ),
      h.div(
        [h.Class('messages')],
        [
          ...Array.map(aboutSteps, step =>
            whyMessage(
              model,
              snapshot,
              step,
              isWhyOpen(
                model.whyOpen,
                step.id,
                isHere(step) && about === step.question.id,
                aboutSteps.length === 1,
              ),
              h,
            ),
          ),
          h.div(
            [
              h.Class(
                `thread general${about === 'concept' ? ' is-about' : ''}`,
              ),
            ],
            [
              h.p([h.Class('thread-label')], [`About ${whole}`]),
              ...Array.match(general, {
                onEmpty: () => [
                  h.p([h.Class('hint')], [`Nothing asked about ${whole} yet.`]),
                ],
                onNonEmpty: all =>
                  Array.map(all, message => saidView(message, h)),
              }),
            ],
          ),
        ],
      ),
      h.form(
        [
          h.Class('composer'),
          h.OnSubmit(Message.SubmittedTalk({ partId: key, about })),
        ],
        [
          h.div(
            [h.Class('about')],
            [
              h.span([h.Class('label')], ['About']),
              h.button(
                [
                  h.Type('button'),
                  h.Class(
                    `quiet-button${about === 'concept' ? ' is-active' : ''}`,
                  ),
                  h.OnClick(
                    Message.ClickedTalkAbout({ partId: key, about: 'concept' }),
                  ),
                ],
                [onCard ? 'The whole card' : 'The whole concept'],
              ),
              ...Array.map(aboutSteps, step =>
                h.button(
                  [
                    h.Type('button'),
                    h.Class(
                      `quiet-button${isHere(step) && about === step.question.id ? ' is-active' : ''}${statusIn(model, grill, step.question.id)._tag === 'Answered' ? ' is-answered' : ''}`,
                    ),
                    h.Title(step.question.title),
                    h.OnClick(
                      Message.ClickedTalkAbout({
                        partId: talkKeyOf(model.currentPart, step.part),
                        about: step.question.id,
                      }),
                    ),
                  ],
                  [step.question.id],
                ),
              ),
            ],
          ),
          h.keyed('textarea')(`talk-${key}-${model.talkGeneration}`, [
            h.Id('talk-box'),
            h.Rows(4),
            h.OnMount(FillBox({ text: draft })),
            h.AriaLabel('Message to the agent'),
            h.Placeholder('Ask, push back, or ask for a clearer rewrite'),
            h.OnInput(value =>
              Message.UpdatedTalkDraft({ partId: key, value }),
            ),
            h.OnKeyDownPreventDefault((pressed, { shiftKey }) =>
              pressed === 'Enter' && !shiftKey
                ? Option.some(Message.SubmittedTalk({ partId: key, about }))
                : Option.none(),
            ),
          ]),
          h.div(
            [h.Class('composer-foot')],
            [
              h.span(
                [h.Class('hint')],
                [
                  `Enter sends, Shift+Enter for a new line. ${grill.session === '' ? 'The agent picks it up from here' : `Goes to ${grill.session}`}; the reply lands here.`,
                ],
              ),
              h.button([h.Type('submit'), h.Class('send-button')], ['Send']),
            ],
          ),
        ],
      ),
    ],
  )
}

// MAP

const NODE_W = 120
const NODE_H = 30
const GAP_X = 8
const LANE = 124
const LINE = NODE_H + 10
const LANE_GAP = 26
const TOP = 16
// The concept map sits in the reading column, so a concept's row wraps after this many questions.
const FOCUS_COLUMNS = 4
// The sidebar map is the map turned on its side, a column per concept, sized so seven
// concepts fit the sidebar without scaling the text down.
const COLUMN_W = 66
const CELL_W = 56
const CELL_H = 28
const CELL_LINE = 40
const HEAD = 44
const LABEL_CHARS = 11

type Orientation = 'Rows' | 'Columns'
type Node = Readonly<{
  step: Step
  lane: number
  x: number
  y: number
  w: number
  h: number
}>
type Lane = Readonly<{
  part: Part
  x: number
  y: number
  lines: ReadonlyArray<string>
  start: number
  end: number
}>
type Layout = Readonly<{
  nodes: ReadonlyArray<Node>
  lanes: ReadonlyArray<Lane>
}>

const rowsLayout = (grill: Grill, columns: number): Layout =>
  Array.reduce(
    grill.parts,
    { nodes: [], lanes: [] } as Layout,
    (built, part, lane) => {
      const start = Option.match(Array.last(built.lanes), {
        onNone: () => TOP,
        onSome: last => last.end + LANE_GAP,
      })
      const steps = stepsIn(grill, part.id)
      const lines = Math.max(1, Math.ceil(steps.length / columns))
      const placed = Array.map(steps, (step, index): Node => ({
        step,
        lane,
        x: LANE + (index % columns) * (NODE_W + GAP_X),
        y: start + Math.floor(index / columns) * LINE,
        w: NODE_W,
        h: NODE_H,
      }))
      return {
        nodes: Array.appendAll(built.nodes, placed),
        lanes: Array.append(built.lanes, {
          part,
          x: 0,
          y: start + NODE_H / 2 + 4,
          lines: [shortTitle(part.title, 20)],
          start,
          end: start + (lines - 1) * LINE + NODE_H,
        }),
      }
    },
  )

const columnsLayout = (grill: Grill): Layout => ({
  nodes: Array.flatMap(grill.parts, (part, lane) =>
    Array.map(stepsIn(grill, part.id), (step, index): Node => ({
      step,
      lane,
      x: lane * COLUMN_W,
      y: HEAD + index * CELL_LINE,
      w: CELL_W,
      h: CELL_H,
    })),
  ),
  lanes: Array.map(grill.parts, (part, lane): Lane => {
    const count = stepsIn(grill, part.id).length
    return {
      part,
      x: lane * COLUMN_W + CELL_W / 2,
      y: 14,
      lines: wrapLabel(part.title),
      start: HEAD,
      end: HEAD + Math.max(0, count - 1) * CELL_LINE + CELL_H,
    }
  }),
})

/** Up to two lines of a concept's title for a column head; the second is cut short if needed. */
const wrapLabel = (title: string): ReadonlyArray<string> => {
  const words = title.split(' ')
  let taken = 1
  while (
    taken < words.length &&
    words.slice(0, taken + 1).join(' ').length <= LABEL_CHARS
  ) {
    taken += 1
  }
  const rest = words.slice(taken).join(' ')
  return rest === ''
    ? [words.slice(0, taken).join(' ')]
    : [words.slice(0, taken).join(' '), shortTitle(rest, LABEL_CHARS)]
}

const edgePath = (from: Node, to: Node, orientation: Orientation): string => {
  if (orientation === 'Columns') {
    if (from.x === to.x) {
      const [upper, lower] = from.y < to.y ? [from, to] : [to, from]
      const x = upper.x + upper.w
      const y1 = upper.y + upper.h / 2
      const y2 = lower.y + lower.h / 2
      return `M ${x} ${y1} C ${x + 14} ${y1}, ${x + 14} ${y2}, ${x} ${y2}`
    }
    const [left, right] = from.x < to.x ? [from, to] : [to, from]
    const sx = left.x + left.w
    const sy = left.y + left.h / 2
    const ex = right.x
    const ey = right.y + right.h / 2
    const middle = (sx + ex) / 2
    return `M ${sx} ${sy} C ${middle} ${sy}, ${middle} ${ey}, ${ex} ${ey}`
  }
  if (from.y === to.y) {
    const x1 = from.x + from.w / 2
    const x2 = to.x + to.w / 2
    return `M ${x1} ${from.y} C ${x1} ${from.y - 16}, ${x2} ${to.y - 16}, ${x2} ${to.y}`
  }
  const [upper, lower] = from.y < to.y ? [from, to] : [to, from]
  const sx = upper.x + upper.w / 2
  const ex = lower.x + lower.w / 2
  const sy = upper.y + upper.h
  const ey = lower.y
  const middle = (sy + ey) / 2
  return `M ${sx} ${sy} C ${sx} ${middle}, ${ex} ${middle}, ${ex} ${ey}`
}

const shortTitle = (text: string, length: number): string =>
  text.length > length ? `${text.slice(0, length - 1).trimEnd()}…` : text

const STATUS_WORDS: Record<string, string> = {
  'is-answered': 'answered',
  'is-open': 'open',
  'is-waiting': 'waiting',
  'is-skipped': 'skipped',
  'is-moot': 'not needed',
}

const statusWord = (model: Model, grill: Grill, id: string): string =>
  Option.getOrElse(
    Array.findFirst(
      stateClass(model, grill, id).split(' '),
      name => name in STATUS_WORDS,
    ).pipe(Option.map(name => STATUS_WORDS[name] ?? '')),
    () => '',
  )

type MapShape = Readonly<{
  orientation: Orientation
  maybeFocus: Option.Option<string>
  maybeCurrent: Option.Option<string>
}>

/**
 * The whole map. With a focus concept, everything it doesn't touch is greyed and the view
 * crops to its rows; the current concept is only marked.
 */
const mapView = (
  model: Model,
  snapshot: Snapshot,
  shape: MapShape,
  h: H,
): Html => {
  const grill = snapshot.grill
  const { orientation, maybeFocus } = shape
  const isFull = Option.isNone(maybeFocus)
  const isColumns = orientation === 'Columns'
  const placed = isColumns
    ? columnsLayout(grill)
    : rowsLayout(
        grill,
        isFull
          ? Math.max(
              ...Array.map(grill.parts, part => stepsIn(grill, part.id).length),
            )
          : FOCUS_COLUMNS,
      )
  const nodes = placed.nodes
  const relations = relationsOf(snapshot)
  const nodeOf = (id: string) =>
    Array.findFirst(nodes, node => node.step.question.id === id)
  const current = Option.orElse(maybeFocus, () => shape.maybeCurrent)
  const idsIn = (maybePart: Option.Option<string>) =>
    new Set(
      Option.match(maybePart, {
        onNone: () => [],
        onSome: partId =>
          Array.map(stepsIn(grill, partId), step => step.question.id),
      }),
    )
  const focusIds = idsIn(maybeFocus)
  const currentIds = idsIn(current)
  const relevant = new Set(
    isFull
      ? Array.map(nodes, node => node.step.question.id)
      : [
          ...focusIds,
          ...Array.flatMap(relations, relation =>
            focusIds.has(relation.to)
              ? [relation.from]
              : focusIds.has(relation.from)
                ? [relation.to]
                : [],
          ),
        ],
  )
  const hover = Option.getOrElse(model.maybeHover, () => '')
  const touchesHover = (relation: Relation) =>
    relation.from === hover || relation.to === hover
  const hoverNear = new Set(
    hover === ''
      ? []
      : [
          hover,
          ...relations
            .filter(touchesHover)
            .flatMap(relation => [relation.from, relation.to]),
        ],
  )
  const shownLanes = Array.map(
    Array.filter(nodes, node => relevant.has(node.step.question.id)),
    node => node.lane,
  )
  const minLane =
    isFull || Array.isArrayEmpty(shownLanes) ? 0 : Math.min(...shownLanes)
  const maxLane =
    isFull || Array.isArrayEmpty(shownLanes)
      ? grill.parts.length - 1
      : Math.max(...shownLanes)
  const inLanes = (node: Node) => node.lane >= minLane && node.lane <= maxLane
  const lanes = placed.lanes.filter(
    (_, index) => index >= minLane && index <= maxLane,
  )
  const right =
    Math.max(...nodes.filter(inLanes).map(node => node.x + node.w)) +
    (isColumns ? 18 : 8)
  const top = isColumns ? 0 : (lanes[0]?.start ?? TOP) - 22
  const height = Math.max(...Array.map(lanes, lane => lane.end)) - top + 10
  // Row maps keep the drawing's own scale; the sidebar's columns stretch to fill it.
  const isNatural = !isColumns
  const edgeClass = (relation: Relation): string => {
    const lit = hover !== '' && touchesHover(relation)
    const inFocus =
      isFull || focusIds.has(relation.to) || focusIds.has(relation.from)
    const faint = !inFocus || (hover !== '' && !lit)
    return `edge${relation.kind === 'mentions' ? ' is-mention' : ''}${lit ? ' is-lit' : ''}${faint ? ' is-faint' : ''}`
  }
  const hovered = Option.flatMap(model.maybeHover, nodeOf)
  return h.div(
    [
      h.Class(
        `map${isFull ? '' : ' is-focused'}${isColumns ? ' is-columns' : ''}`,
      ),
    ],
    [
      h.div(
        [h.Class('map-frame')],
        [
          h.svg(
            [
              h.ViewBox(`-4 ${top} ${right + 4} ${height}`),
              h.Width(isNatural ? String(right + 4) : '100%'),
              h.Height(isNatural ? String(height) : 'auto'),
              h.Role('img'),
              h.AriaLabel('Map of the questions and how they link'),
              h.Class('map-svg'),
            ],
            [
              h.g(
                [],
                Array.map(lanes, lane =>
                  h.text(
                    [
                      h.X(String(lane.x)),
                      h.Y(String(lane.y)),
                      h.Class(
                        `lane${Option.exists(current, id => id === lane.part.id) ? ' is-current' : ''}`,
                      ),
                      h.OnClick(
                        Message.ClickedMapConcept({ partId: lane.part.id }),
                      ),
                    ],
                    [
                      h.title([], [lane.part.title]),
                      ...Array.map(lane.lines, (line, index) =>
                        h.tspan(
                          [h.X(String(lane.x)), h.Dy(index === 0 ? '0' : '13')],
                          [line],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              h.g(
                [],
                Array.flatMap(relations, relation =>
                  Option.match(
                    Option.all([nodeOf(relation.from), nodeOf(relation.to)]),
                    {
                      onNone: () => [],
                      onSome: ([from, to]) =>
                        inLanes(from) && inLanes(to)
                          ? [
                              h.path([
                                h.D(edgePath(from, to, orientation)),
                                h.Class(edgeClass(relation)),
                              ]),
                            ]
                          : [],
                    },
                  ),
                ),
              ),
              h.g(
                [],
                nodes.filter(inLanes).flatMap(node => {
                  const id = node.step.question.id
                  const dim =
                    !relevant.has(id) || (hover !== '' && !hoverNear.has(id))
                  const middle = String(node.y + node.h / 2 + 4)
                  return [
                    h.g(
                      [
                        h.Class(
                          `node ${stateClass(model, grill, id)}${currentIds.has(id) ? ' is-current' : ''}${dim ? ' is-dim' : ''}${id === hover ? ' is-hover' : ''}`,
                        ),
                        h.OnMouseEnter(
                          Message.HoveredMapNode({ question: id }),
                        ),
                        h.OnMouseLeave(Message.LeftMapNode()),
                        h.OnClick(Message.ClickedMapNode({ question: id })),
                        h.Role('link'),
                        h.Tabindex(0),
                        h.AriaLabel(`${id}: ${node.step.question.title}`),
                      ],
                      [
                        h.title([], [`${id}: ${node.step.heading}`]),
                        h.rect([
                          h.X(String(node.x)),
                          h.Y(String(node.y)),
                          h.Width(String(node.w)),
                          h.Height(String(node.h)),
                          h.Rx('3'),
                        ]),
                        ...(isColumns
                          ? [
                              h.text(
                                [
                                  h.X(String(node.x + node.w / 2)),
                                  h.Y(middle),
                                  h.Class('node-id'),
                                ],
                                [id],
                              ),
                            ]
                          : [
                              h.text(
                                [
                                  h.X(String(node.x + 7)),
                                  h.Y(middle),
                                  h.Class('node-id'),
                                ],
                                [id],
                              ),
                              h.text(
                                [
                                  h.X(String(node.x + 36)),
                                  h.Y(middle),
                                  h.Class('node-title'),
                                ],
                                [shortTitle(node.step.question.title, 13)],
                              ),
                            ]),
                      ],
                    ),
                  ]
                }),
              ),
            ],
          ),
        ],
      ),
      isColumns
        ? h.p(
            [h.Class('map-readout')],
            Option.match(hovered, {
              onNone: () => [
                'Hover a question for its title. Click it, or a concept, to go there.',
              ],
              onSome: node => [
                h.strong([], [node.step.question.id]),
                ` ${node.step.question.title} · ${statusWord(model, grill, node.step.question.id)} · ${node.step.question.scope}`,
              ],
            }),
          )
        : h.empty,
      h.p(
        [h.Class('legend')],
        [
          legendItem('is-answered', 'answered', h),
          legendItem('is-open', 'open', h),
          legendItem('is-waiting', 'waiting', h),
          legendItem('is-skipped', 'skipped', h),
          legendItem('is-moot', 'not needed', h),
          h.span([h.Class('legend-line')], ['solid: waits for']),
          h.span([h.Class('legend-line is-mention')], ['dashed: mentions']),
        ],
      ),
    ],
  )
}

const legendItem = (status: string, label: string, h: H): Html =>
  h.span(
    [h.Class(`legend-item ${status}`)],
    [h.span([h.Class('swatch')]), label],
  )

const mapPanelView = (
  model: Model,
  snapshot: Snapshot,
  maybePart: Option.Option<Part>,
  h: H,
): Html =>
  h.aside(
    [h.Class('side map-panel'), h.AriaLabel('Map of all questions')],
    [
      h.header(
        [h.Class('side-head')],
        [
          h.div(
            [],
            [h.p([h.Class('label')], ['All questions']), h.h2([], ['Map'])],
          ),
          h.button(
            [
              h.Class('text-button'),
              h.OnClick(Message.ClickedSide({ side: 'None' })),
            ],
            ['Close'],
          ),
        ],
      ),
      h.div(
        [h.Class('side-body')],
        [
          mapView(
            model,
            snapshot,
            {
              orientation: 'Columns',
              maybeFocus: Option.none(),
              maybeCurrent: Option.map(maybePart, part => part.id),
            },
            h,
          ),
        ],
      ),
    ],
  )
