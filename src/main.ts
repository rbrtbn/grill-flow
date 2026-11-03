import {
  Array,
  Clock,
  Duration,
  Effect,
  Option,
  Record,
  Result,
  Schema,
  Stream,
  pipe,
} from 'effect'
import {
  AsyncData,
  Command,
  Dom,
  Mount,
  Navigation,
  Runtime,
  Subscription,
  Update,
  Url,
} from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import {
  type Grill,
  OWN,
  Snapshot,
  type Step,
  cardOf,
  cardsOf,
  issuesOf,
  replyText,
  statusOf,
  urgencyOf,
  usesUrgency,
} from './domain'

const POLL_INTERVAL = Duration.seconds(4)

// A concept with more questions than this opens as rows, one question at a time.
export const LONG_CONCEPT = 6

export const OVERVIEW = 'overview'
// A squad grill with a plan gets a page of which builds wait on what.
export const PLAN = 'plan'
// Pages the urgency sidebar adds beside the concepts: one per urgency, and the decided list.
export const URGENCY_PAGE = 'urgency:'
export const ISSUE_PAGE = 'issue:'
// A squad grill's questions grouped by the run card they came from.
export const CARD_PAGE = 'card:'
export const DECIDED = 'decided'

// MODEL

export const PageData = AsyncData.Schema(Snapshot, Schema.String)
type PageData = typeof PageData.schema.Type

export const SendState = Schema.Literals(['Idle', 'Sending', 'Sent', 'Failed'])
export type SendState = typeof SendState.Type

export const CopyState = Schema.Literals(['Idle', 'Copied', 'Failed'])
export type CopyState = typeof CopyState.Type

/** What fills the right sidebar: the concept's conversation, the map of every question, or nothing. */
export const Side = Schema.Literals(['Talk', 'Map', 'None'])
export type Side = typeof Side.Type

/** The lists the left sidebar stacks the questions in. */
export const SidebarMode = Schema.Literals([
  'Concepts',
  'Issues',
  'Cards',
  'Urgency',
])
export type SidebarMode = typeof SidebarMode.Type

/** How the Plan page lays out the run: a ranked list, or a board of columns by phase. */
export const PlanView = Schema.Literals(['List', 'Board'])
export type PlanView = typeof PlanView.Type

export const Model = Schema.Struct({
  page: PageData.schema,
  answers: Schema.Record(Schema.String, Schema.String),
  notes: Schema.Record(Schema.String, Schema.String),
  own: Schema.Record(Schema.String, Schema.String),
  talkDrafts: Schema.Record(Schema.String, Schema.String),
  // Talk state is keyed by the page's general conversation: a concept id, or on a card page the
  // page itself (`card:<card>`). See talkKeyOf.
  talkAbout: Schema.Record(Schema.String, Schema.String),
  diffShown: Schema.Record(Schema.String, Schema.Boolean),
  whyOpen: Schema.Record(Schema.String, Schema.Boolean),
  send: SendState,
  isSendOpen: Schema.Boolean,
  sendMessage: Schema.String,
  // Bumped after each sent talk message, so the box remounts empty.
  talkGeneration: Schema.Number,
  sendDetail: Schema.String,
  copy: CopyState,
  maybeSaveError: Schema.Option(Schema.String),
  maybeBuild: Schema.Option(Schema.String),
  currentPart: Schema.String,
  side: Side,
  // The page the reader came from, for the back link.
  maybePrevious: Schema.Option(Schema.String),
  planView: PlanView,
  // The clock a plan's deadline counts down against, read by the clock subscription.
  now: Schema.Number,
  skipped: Schema.Array(Schema.String),
  expanded: Schema.Record(Schema.String, Schema.Boolean),
  peeks: Schema.Array(Schema.String),
  maybeHover: Schema.Option(Schema.String),
  // A concept page's map of what it builds on and feeds; folded until the reader opens it.
  isConceptMapOpen: Schema.Boolean,
  // A concept page's list of its questions and answers so far; folded the same way.
  isShapeOpen: Schema.Boolean,
  maybeJustAnswered: Schema.Option(Schema.String),
  // An urgency or issue page mixes concepts; Talk there shows this one, while the page lists it.
  maybeTalkPart: Schema.Option(Schema.String),
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  CompletedLoadGrill: { result: Schema.Result(Snapshot, Schema.String) },
  TickedPoll: {},
  CompletedCheckBuild: { maybeBuild: Schema.Option(Schema.String) },
  CompletedReloadPage: {},
  CompletedRestoreDrafts: {
    talkDrafts: Schema.Record(Schema.String, Schema.String),
    notes: Schema.Record(Schema.String, Schema.String),
    own: Schema.Record(Schema.String, Schema.String),
    skipped: Schema.Array(Schema.String),
    expanded: Schema.Record(Schema.String, Schema.Boolean),
    currentPart: Schema.String,
  },
  SelectedOption: { question: Schema.String, key: Schema.String },
  SelectedOwnAnswer: { question: Schema.String },
  UpdatedOwnAnswer: { question: Schema.String, value: Schema.String },
  BlurredOwnAnswer: { question: Schema.String },
  ClickedClearAnswer: { question: Schema.String },
  UpdatedNote: { question: Schema.String, value: Schema.String },
  BlurredNote: { question: Schema.String },
  CompletedPostEvent: { result: Schema.Result(Snapshot, Schema.String) },
  ClickedSend: {},
  ClickedConfirmSend: {},
  ClickedCancelSend: {},
  UpdatedSendMessage: { value: Schema.String },
  CompletedSendAnswers: { result: Schema.Result(Snapshot, Schema.String) },
  ClickedCopy: {},
  CompletedCopyReply: { copied: Schema.Boolean },
  ClickedToggleDiff: { stepId: Schema.String },
  ClickedToggleWhy: { stepId: Schema.String, open: Schema.Boolean },
  ClickedWhy: { partId: Schema.String, question: Schema.String },
  ClickedConcept: { partId: Schema.String },
  ClickedBack: {},
  ChangedUrl: { url: Url.Url },
  RequestedUrl: { request: Navigation.UrlRequest },
  CompletedNavigate: {},
  ClickedToggleQuestion: { question: Schema.String, open: Schema.Boolean },
  ClickedPeek: { key: Schema.String },
  ClickedSkip: { question: Schema.String },
  ClickedUnskip: { question: Schema.String },
  ClickedSide: { side: Side },
  ClickedToggleConceptMap: {},
  ClickedToggleShape: {},
  ClickedPlanView: { view: PlanView },
  TickedClock: { now: Schema.Number },
  ClickedTalkAbout: { partId: Schema.String, about: Schema.String },
  UpdatedTalkDraft: { partId: Schema.String, value: Schema.String },
  // `about` is what the About row shows, which may be the page's default rather than a pick.
  SubmittedTalk: { partId: Schema.String, about: Schema.String },
  ReadTalkBox: {
    partId: Schema.String,
    about: Schema.String,
    text: Schema.String,
  },
  SubmittedThread: { stepId: Schema.String },
  ReadThreadBox: { stepId: Schema.String, text: Schema.String },
  ReadSendBox: { text: Schema.String },
  ScrolledToAbout: { partId: Schema.String, about: Schema.String },
  ScrolledToQuestion: { question: Schema.String },
  CompletedFillBox: {},
  ClickedAskAbout: { partId: Schema.String, question: Schema.String },
  ClickedShowChanges: { question: Schema.String, stepId: Schema.String },
  HoveredMapNode: { question: Schema.String },
  LeftMapNode: {},
  ClickedMapNode: { question: Schema.String },
  ClickedMapConcept: { partId: Schema.String },
  CompletedScroll: {},
  LeftAnswered: {
    question: Schema.String,
    maybeBottomAbove: Schema.Option(Schema.Number),
  },
  CompletedFocus: {},
})
export type Message = typeof Message.Type

// UPDATE

type UpdateReturn = Update.Return<Model, Message>

const grillIdOf = (model: Model): Option.Option<string> =>
  pipe(
    AsyncData.getData(model.page),
    Option.map(snapshot => snapshot.grill.id),
  )

const postEvent = (model: Model, body: Record<string, unknown>): UpdateReturn =>
  Option.match(grillIdOf(model), {
    onNone: () => ({ model }),
    onSome: grillId => ({
      model,
      commands: [PostEvent({ grillId, body: JSON.stringify(body) })],
    }),
  })

const refreshPage = (model: Model, snapshot: Snapshot): Model =>
  modifyFields(model, {
    page: () => PageData.Success({ data: snapshot }),
    maybeSaveError: () => Option.none(),
  })

const partOf = (snapshot: Snapshot, question: string): Option.Option<string> =>
  pipe(
    Array.findFirst(
      snapshot.grill.steps,
      step => step.question.id === question,
    ),
    Option.map(step => step.part),
  )

const questionsIn = (
  snapshot: Snapshot,
  partId: string,
): ReadonlyArray<string> =>
  pipe(
    snapshot.grill.steps,
    Array.filter(step => step.part === partId),
    Array.map(step => step.question.id),
  )

const stepIdOf = (
  snapshot: Snapshot,
  question: string,
): Option.Option<string> =>
  pipe(
    Array.findFirst(
      snapshot.grill.steps,
      step => step.question.id === question,
    ),
    Option.map(step => step.id),
  )

export const isCardPage = (page: string): boolean => page.startsWith(CARD_PAGE)

/** Where Talk keeps a question's state: under its card on a card page, else its concept. */
export const talkKeyOf = (page: string, partId: string): string =>
  isCardPage(page) ? page : partId

/** The conversation a Talk key's general messages go to: the whole card, or the whole concept. */
export const generalTargetOf = (key: string): string =>
  isCardPage(key) ? key : `part:${key}`

// Talk follows the open question, so one folded away hands Talk back to the page's default.
const forgetAbout = (model: Model, questions: ReadonlyArray<string>): Model =>
  modifyFields(model, {
    talkAbout: Record.filter(about => !Array.contains(questions, about)),
  })

/** Open one question; in a long concept, close the others so one is open at a time. */
const openQuestion = (
  model: Model,
  snapshot: Snapshot,
  question: string,
): Model => {
  const partId = Option.getOrElse(partOf(snapshot, question), () => '')
  const siblings = questionsIn(snapshot, partId)
  const closed =
    siblings.length > LONG_CONCEPT
      ? Array.reduce(siblings, model.expanded, (expanded, id) =>
          Record.set(expanded, id, false),
        )
      : model.expanded
  return modifyFields(
    siblings.length > LONG_CONCEPT
      ? forgetAbout(
          model,
          Array.filter(siblings, id => id !== question),
        )
      : model,
    { expanded: () => Record.set(closed, question, true) },
  )
}

const withSnapshot = (
  model: Model,
  f: (snapshot: Snapshot) => UpdateReturn,
): UpdateReturn =>
  Option.match(AsyncData.getData(model.page), {
    onNone: () => ({ model }),
    onSome: f,
  })

const answered = (model: Model, question: string): Model =>
  modifyFields(model, {
    skipped: Array.filter(id => id !== question),
    maybeJustAnswered: () => Option.some(question),
  })

/** Clears a pick and keeps the question open, so a choice made by mistake can be undone. */
const unpicked = (model: Model, question: string): UpdateReturn =>
  postEvent(
    modifyFields(model, {
      answers: Record.remove(question),
      expanded: Record.set(question, true),
      maybeJustAnswered: () => Option.none(),
    }),
    { kind: 'cleared', question },
  )

export const update = (model: Model, message: Message) =>
  Message.match<UpdateReturn>(message, {
    CompletedLoadGrill: ({ result }) => settleLoad(model, result),

    TickedPoll: () => ({ model, commands: [LoadGrill(), CheckBuild()] }),

    CompletedCheckBuild: ({ maybeBuild }) =>
      Option.match(maybeBuild, {
        onNone: () => ({ model }),
        onSome: build =>
          Option.match(model.maybeBuild, {
            onNone: () => ({
              model: modifyFields(model, {
                maybeBuild: () => Option.some(build),
              }),
            }),
            onSome: known =>
              known === build
                ? { model }
                : {
                    model,
                    commands: [
                      ReloadPage({
                        drafts: JSON.stringify({
                          talkDrafts: model.talkDrafts,
                          notes: model.notes,
                          own: model.own,
                          skipped: model.skipped,
                          expanded: model.expanded,
                          currentPart: model.currentPart,
                        }),
                      }),
                    ],
                  },
          }),
      }),

    CompletedReloadPage: () => ({ model }),

    CompletedRestoreDrafts: ({
      talkDrafts,
      notes,
      own,
      skipped,
      expanded,
      currentPart,
    }) => ({
      model: modifyFields(model, {
        skipped: current => Array.dedupe(Array.appendAll(current, skipped)),
        expanded: current => ({ ...expanded, ...current }),
        talkDrafts: current => ({ ...talkDrafts, ...current }),
        notes: current => ({ ...current, ...notes }),
        own: current => ({ ...current, ...own }),
        currentPart: current => (current === '' ? currentPart : current),
      }),
    }),

    SelectedOption: ({ question, key }) =>
      Option.exists(
        Record.get(model.answers, question),
        picked => picked === key,
      )
        ? unpicked(model, question)
        : postEvent(
            answered(
              modifyFields(model, { answers: Record.set(question, key) }),
              question,
            ),
            {
              kind: 'answered',
              question,
              key,
            },
          ),

    SelectedOwnAnswer: ({ question }) =>
      Option.exists(
        Record.get(model.answers, question),
        picked => picked === OWN,
      )
        ? unpicked(model, question)
        : postEvent(
            answered(
              modifyFields(model, { answers: Record.set(question, OWN) }),
              question,
            ),
            {
              kind: 'answered',
              question,
              key: OWN,
              text: Option.getOrElse(Record.get(model.own, question), () => ''),
            },
          ),

    UpdatedOwnAnswer: ({ question, value }) => ({
      model: modifyFields(model, { own: Record.set(question, value) }),
    }),

    BlurredOwnAnswer: ({ question }) =>
      Option.exists(Record.get(model.answers, question), key => key === OWN)
        ? postEvent(model, {
            kind: 'answered',
            question,
            key: OWN,
            text: Option.getOrElse(Record.get(model.own, question), () => ''),
          })
        : { model },

    ClickedClearAnswer: ({ question }) => unpicked(model, question),

    UpdatedNote: ({ question, value }) => ({
      model: modifyFields(model, { notes: Record.set(question, value) }),
    }),

    BlurredNote: ({ question }) =>
      postEvent(model, {
        kind: 'noted',
        question,
        text: Option.getOrElse(Record.get(model.notes, question), () => ''),
      }),

    CompletedPostEvent: ({ result }) => settleWrite(model, result),

    ClickedSend: () => ({
      model: modifyFields(model, { isSendOpen: () => true }),
      commands: [FocusSendBox()],
    }),

    ClickedCancelSend: () => ({
      model: modifyFields(model, { isSendOpen: () => false }),
    }),

    UpdatedSendMessage: ({ value }) => ({
      model: modifyFields(model, { sendMessage: () => value }),
    }),

    ClickedConfirmSend: () => ({
      model,
      commands: [ReadSendBoxCommand()],
    }),

    ReadSendBox: ({ text }) =>
      Option.match(grillIdOf(model), {
        onNone: () => ({ model }),
        onSome: grillId => ({
          model: modifyFields(model, {
            send: () => 'Sending' as const,
            sendDetail: () => '',
            sendMessage: () => text,
          }),
          commands: [SendAnswers({ grillId, message: text })],
        }),
      }),

    CompletedFillBox: () => ({ model }),

    ScrolledToAbout: ({ partId, about }) => ({
      model: modifyFields(model, { talkAbout: Record.set(partId, about) }),
    }),

    ScrolledToQuestion: ({ question }) =>
      withSnapshot(model, snapshot =>
        Option.match(partOf(snapshot, question), {
          onNone: () => ({ model }),
          onSome: partId => ({
            model: modifyFields(model, {
              maybeTalkPart: () => Option.some(partId),
              talkAbout: Record.set(
                talkKeyOf(model.currentPart, partId),
                question,
              ),
            }),
          }),
        }),
      ),

    CompletedSendAnswers: ({ result }) =>
      result._tag === 'Success'
        ? {
            model: modifyFields(refreshPage(model, result.success), {
              send: () => latestSendState(result.success),
              sendDetail: () => latestSendDetail(result.success),
              isSendOpen: () => latestSendState(result.success) !== 'Sent',
              sendMessage: message =>
                latestSendState(result.success) === 'Sent' ? '' : message,
            }),
          }
        : {
            model: modifyFields(model, {
              send: () => 'Failed' as const,
              sendDetail: () => result.failure,
            }),
          },

    ClickedCopy: () =>
      withSnapshot(model, snapshot => ({
        model,
        commands: [
          CopyReply({
            text: replyText(
              snapshot.grill,
              model.answers,
              model.notes,
              model.own,
            ),
          }),
        ],
      })),

    CompletedCopyReply: ({ copied }) => ({
      model: modifyFields(model, {
        copy: () => (copied ? 'Copied' : 'Failed') as CopyState,
      }),
    }),

    ClickedToggleDiff: ({ stepId }) => ({
      model: modifyFields(model, {
        diffShown: Record.set(
          stepId,
          !Option.getOrElse(Record.get(model.diffShown, stepId), () => false),
        ),
      }),
    }),

    // Unfolding a question's reasoning in Talk also brings that question up on the page.
    ClickedToggleWhy: ({ stepId, open }) =>
      withSnapshot(model, snapshot => {
        const folded = modifyFields(model, {
          whyOpen: Record.set(stepId, open),
        })
        const maybeStep = Array.findFirst(
          snapshot.grill.steps,
          step => step.id === stepId,
        )
        if (!open || Option.isNone(maybeStep)) {
          return { model: folded }
        }
        const step = maybeStep.value
        const question = step.question.id
        return {
          model: modifyFields(openQuestion(folded, snapshot, question), {
            talkAbout: Record.set(
              talkKeyOf(model.currentPart, step.part),
              question,
            ),
          }),
          commands: [ScrollToQuestion({ question })],
        }
      }),

    ClickedWhy: ({ partId, question }) =>
      withSnapshot(model, snapshot => {
        const stepId = Option.getOrElse(
          stepIdOf(snapshot, question),
          () => question,
        )
        return {
          model: modifyFields(model, {
            side: () => 'Talk',
            talkAbout: Record.set(
              talkKeyOf(model.currentPart, partId),
              question,
            ),
            maybeTalkPart: () => Option.some(partId),
            whyOpen: Record.set(stepId, true),
          }),
          commands: [ScrollToWhy({ stepId })],
        }
      }),

    ClickedConcept: ({ partId }) =>
      withSnapshot(model, snapshot => {
        const next = modifyFields(goTo(model, snapshot.grill, partId), {
          maybeJustAnswered: () => Option.none(),
        })
        return {
          model: next,
          commands: [
            ...pushIfMoved(model, next, snapshot.grill),
            ScrollToTop(),
          ],
        }
      }),

    ClickedBack: () =>
      withSnapshot(model, snapshot =>
        Option.match(model.maybePrevious, {
          onNone: () => ({ model }),
          onSome: page => {
            const next = modifyFields(goTo(model, snapshot.grill, page), {
              maybeJustAnswered: () => Option.none(),
            })
            return {
              model: next,
              commands: [
                ...pushIfMoved(model, next, snapshot.grill),
                ScrollToTop(),
              ],
            }
          },
        }),
      ),

    // Back, forward, or our own push: show the page the address names.
    ChangedUrl: ({ url }) =>
      withSnapshot(model, snapshot => {
        const page = pageOfPath(url.pathname)
        return page === '' || page === model.currentPart
          ? { model }
          : {
              model: modifyFields(goTo(model, snapshot.grill, page), {
                maybeJustAnswered: () => Option.none(),
              }),
              commands: [ScrollToTop()],
            }
      }),

    // A link inside this grill moves within the page; anything else, the dashboard included, loads.
    RequestedUrl: ({ request }) =>
      withSnapshot(model, snapshot =>
        request._tag === 'Internal' &&
        request.url.pathname.startsWith(
          `/g/${encodeURIComponent(snapshot.grill.id)}`,
        )
          ? { model, commands: [PushPage({ url: Url.toString(request.url) })] }
          : {
              model,
              commands: [
                LoadUrl({
                  href:
                    request._tag === 'Internal'
                      ? Url.toString(request.url)
                      : request.href,
                }),
              ],
            },
      ),

    CompletedNavigate: () => ({ model }),

    ClickedToggleQuestion: ({ question, open }) =>
      withSnapshot(model, snapshot => ({
        model: modifyFields(
          open
            ? openQuestion(model, snapshot, question)
            : modifyFields(forgetAbout(model, [question]), {
                expanded: Record.set(question, false),
              }),
          { maybeJustAnswered: () => Option.none() },
        ),
      })),

    ClickedPeek: ({ key }) => ({
      model: modifyFields(model, {
        peeks: peeks =>
          Array.contains(peeks, key)
            ? Array.filter(peeks, k => k !== key)
            : Array.append(peeks, key),
      }),
    }),

    ClickedSkip: ({ question }) =>
      withSnapshot(model, snapshot => {
        const skipped = Array.dedupe(Array.append(model.skipped, question))
        const partId = Option.getOrElse(partOf(snapshot, question), () => '')
        const skippedModel = modifyFields(model, {
          skipped: () => skipped,
          expanded: Record.set(question, false),
          maybeJustAnswered: () => Option.none(),
        })
        return Option.match(
          Array.findFirst(
            questionsIn(snapshot, partId),
            id =>
              id !== question &&
              !Array.contains(skipped, id) &&
              statusOf(snapshot.grill, model.answers, id, skipped)._tag ===
                'Open',
          ),
          {
            onNone: () => ({ model: skippedModel }),
            onSome: next => ({
              model: openQuestion(skippedModel, snapshot, next),
              commands: [ScrollToQuestion({ question: next })],
            }),
          },
        )
      }),

    ClickedUnskip: ({ question }) => ({
      model: modifyFields(model, {
        skipped: Array.filter(id => id !== question),
        expanded: Record.set(question, true),
      }),
    }),

    ClickedPlanView: ({ view }) => ({
      model: modifyFields(model, { planView: () => view }),
    }),

    TickedClock: ({ now }) => ({
      model: modifyFields(model, { now: () => now }),
    }),

    ClickedToggleConceptMap: () => ({
      model: modifyFields(model, { isConceptMapOpen: open => !open }),
    }),

    ClickedToggleShape: () => ({
      model: modifyFields(model, { isShapeOpen: open => !open }),
    }),

    ClickedSide: ({ side }) => ({
      model: modifyFields(model, {
        side: current => (current === side ? 'None' : side),
        maybeHover: () => Option.none(),
      }),
    }),

    ClickedTalkAbout: ({ partId, about }) => ({
      model: modifyFields(model, {
        talkAbout: Record.set(partId, about),
        maybeTalkPart: () => Option.some(partId),
      }),
    }),

    SubmittedThread: ({ stepId }) => ({
      model,
      commands: [ReadThreadBox({ stepId })],
    }),

    ReadThreadBox: ({ stepId, text: boxText }) => {
      const text = boxText.trim()
      return text === ''
        ? { model }
        : postEvent(
            modifyFields(model, {
              talkDrafts: Record.remove(threadDraftKey(stepId)),
              talkGeneration: generation => generation + 1,
            }),
            { kind: 'asked', stepId, text },
          )
    },

    UpdatedTalkDraft: ({ partId, value }) => ({
      model: modifyFields(model, { talkDrafts: Record.set(partId, value) }),
    }),

    SubmittedTalk: ({ partId, about }) => ({
      model,
      commands: [ReadTalkBoxCommand({ partId, about })],
    }),

    ReadTalkBox: ({ partId, about, text: boxText }) =>
      withSnapshot(model, snapshot => {
        const text = boxText.trim()
        const target =
          about === 'concept'
            ? generalTargetOf(partId)
            : Option.getOrElse(stepIdOf(snapshot, about), () =>
                generalTargetOf(partId),
              )
        if (text === '') {
          return { model }
        }
        return postEvent(
          modifyFields(model, {
            talkDrafts: Record.remove(partId),
            talkGeneration: generation => generation + 1,
          }),
          {
            kind: 'asked',
            stepId: target,
            text,
          },
        )
      }),

    ClickedAskAbout: ({ partId, question }) => ({
      model: modifyFields(model, {
        side: () => 'Talk',
        talkAbout: Record.set(talkKeyOf(model.currentPart, partId), question),
        maybeTalkPart: () => Option.some(partId),
      }),
      commands: [FocusTalkBox()],
    }),

    ClickedShowChanges: ({ question, stepId }) =>
      withSnapshot(model, snapshot => {
        const next = modifyFields(
          goTo(
            openQuestion(model, snapshot, question),
            snapshot.grill,
            pageForQuestion(model, snapshot, question),
          ),
          {
            side: () => 'Talk',
            diffShown: Record.set(stepId, true),
            whyOpen: Record.set(stepId, true),
          },
        )
        return {
          model: next,
          commands: [
            ...pushIfMoved(model, next, snapshot.grill),
            ScrollToWhy({ stepId }),
          ],
        }
      }),

    HoveredMapNode: ({ question }) => ({
      model: modifyFields(model, { maybeHover: () => Option.some(question) }),
    }),

    LeftMapNode: () => ({
      model: modifyFields(model, { maybeHover: () => Option.none() }),
    }),

    ClickedMapNode: ({ question }) =>
      withSnapshot(model, snapshot => {
        const next = goTo(
          openQuestion(model, snapshot, question),
          snapshot.grill,
          pageForQuestion(model, snapshot, question),
        )
        return {
          model: next,
          commands: [
            ...pushIfMoved(model, next, snapshot.grill),
            ScrollToQuestion({ question }),
          ],
        }
      }),

    ClickedMapConcept: ({ partId }) => ({
      model: modifyFields(model, { currentPart: () => partId }),
      commands: [ScrollToTop()],
    }),

    CompletedScroll: () => ({ model }),

    LeftAnswered: ({ question, maybeBottomAbove }) =>
      Option.exists(model.maybeJustAnswered, id => id === question)
        ? {
            model: modifyFields(forgetAbout(model, [question]), {
              expanded: Record.set(question, false),
              maybeJustAnswered: () => Option.none(),
            }),
            commands: Option.match(maybeBottomAbove, {
              onNone: () => [],
              onSome: bottom => [KeepPlaceBelow({ question, bottom })],
            }),
          }
        : { model },

    CompletedFocus: () => ({ model }),
  })

const latestSendState = (snapshot: Snapshot): SendState =>
  Option.match(Array.last(snapshot.sends), {
    onNone: () => 'Idle',
    onSome: send => (send.ok ? 'Sent' : 'Failed'),
  })

const latestSendDetail = (snapshot: Snapshot): string =>
  Option.match(Array.last(snapshot.sends), {
    onNone: () => '',
    onSome: send => send.detail,
  })

type SnapshotResult = Result.Result<Snapshot, string>

const settleWrite = (model: Model, result: SnapshotResult): UpdateReturn =>
  result._tag === 'Success'
    ? { model: refreshPage(model, result.success) }
    : {
        model: modifyFields(model, {
          maybeSaveError: () => Option.some(result.failure),
        }),
      }

// The first concept that still has something open, so a fresh page starts where work is left.
// NAVIGATION

/**
 * The lists the left sidebar stacks, top to bottom. A squad's questions carry their issue on
 * every row, so it lists by urgency, concept and the run card that raised them, with no issue
 * list; any other grill lists by concept, and by issue when its questions name issues.
 */
export const modesOf = (grill: Grill): ReadonlyArray<SidebarMode> =>
  grill.kind === 'squad'
    ? [
        ...(usesUrgency(grill) ? ['Urgency' as const] : []),
        'Concepts',
        ...(Array.isReadonlyArrayEmpty(cardsOf(grill))
          ? []
          : ['Cards' as const]),
      ]
    : [
        'Concepts',
        ...(Array.isReadonlyArrayEmpty(issuesOf(grill))
          ? []
          : ['Issues' as const]),
      ]

/** The questions a card, issue or urgency page lists; none on any other page. */
export const pageQuestions = (
  grill: Grill,
  page: string,
): ReadonlyArray<Step> =>
  page.startsWith(CARD_PAGE)
    ? grill.steps.filter(step =>
        Option.exists(
          cardOf(step.question),
          card => card === page.slice(CARD_PAGE.length),
        ),
      )
    : page.startsWith(ISSUE_PAGE)
      ? grill.steps.filter(
          step => step.question.issue === page.slice(ISSUE_PAGE.length),
        )
      : page.startsWith(URGENCY_PAGE)
        ? grill.steps.filter(
            step => `${URGENCY_PAGE}${urgencyOf(step.question)}` === page,
          )
        : []

/** Moves to a page, remembering where the reader was. */
const goTo = (model: Model, grill: Grill, page: string): Model =>
  page === model.currentPart
    ? model
    : modifyFields(model, {
        currentPart: () => page,
        maybePrevious: () =>
          model.currentPart === ''
            ? Option.none()
            : Option.some(model.currentPart),
        peeks: () => [],
      })

/** Where a question opens: the page already listing it, else its concept. */
const pageForQuestion = (
  model: Model,
  snapshot: Snapshot,
  question: string,
): string =>
  pageQuestions(snapshot.grill, model.currentPart).some(
    step => step.question.id === question,
  )
    ? model.currentPart
    : Option.getOrElse(partOf(snapshot, question), () => model.currentPart)

// Each page has its own address under /g/<grill id>, so the browser's back and forward walk the
// pages read; the server serves the page for every such path.
const PAGE_PATHS: ReadonlyArray<readonly [string, string]> = [
  [CARD_PAGE, 'card/'],
  [ISSUE_PAGE, 'issue/'],
  [URGENCY_PAGE, 'urgency/'],
]

export const pathOfPage = (grillId: string, page: string): string => {
  const base = `/g/${encodeURIComponent(grillId)}`
  if (page === '' || page === OVERVIEW || page === PLAN || page === DECIDED) {
    return page === '' ? base : `${base}/${page}`
  }
  return Option.match(
    Array.findFirst(PAGE_PATHS, ([prefix]) => page.startsWith(prefix)),
    {
      onSome: ([prefix, path]) =>
        `${base}/${path}${encodeURIComponent(page.slice(prefix.length))}`,
      onNone: () => `${base}/concept/${encodeURIComponent(page)}`,
    },
  )
}

/** The page a path names, or '' when it names none (the grill's own starting page then). */
export const pageOfPath = (pathname: string): string => {
  const [, , kind, value] = pathname.split('/').filter(part => part !== '')
  const decoded = value === undefined ? '' : decodeURIComponent(value)
  return kind === OVERVIEW || kind === PLAN || kind === DECIDED
    ? kind
    : kind === 'concept'
      ? decoded
      : Option.getOrElse(
          Option.map(
            Array.findFirst(PAGE_PATHS, ([, path]) => path === `${kind}/`),
            ([prefix]) => (decoded === '' ? '' : `${prefix}${decoded}`),
          ),
          () => '',
        )
}

export const PushPage = Command.define('PushPage', {
  args: { url: Schema.String },
  messages: [Message.CompletedNavigate],
  execute: ({ url }) =>
    Navigation.pushUrl(url).pipe(Effect.map(() => Message.CompletedNavigate())),
})

export const ReplacePage = Command.define('ReplacePage', {
  args: { url: Schema.String },
  messages: [Message.CompletedNavigate],
  execute: ({ url }) =>
    Navigation.replaceUrl(url).pipe(
      Effect.map(() => Message.CompletedNavigate()),
    ),
})

export const LoadUrl = Command.define('LoadUrl', {
  args: { href: Schema.String },
  messages: [Message.CompletedNavigate],
  execute: ({ href }) =>
    Navigation.load(href).pipe(Effect.map(() => Message.CompletedNavigate())),
})

/** The address command for moving from one model's page to the next's. */
const pushIfMoved = (
  before: Model,
  after: Model,
  grill: Grill,
): ReadonlyArray<ReturnType<typeof PushPage>> =>
  after.currentPart === before.currentPart
    ? []
    : [PushPage({ url: pathOfPage(grill.id, after.currentPart) })]

const startingPart = (snapshot: Snapshot): string =>
  snapshot.grill.plan !== undefined
    ? PLAN
    : Option.getOrElse(
        pipe(
          Array.findFirst(
            snapshot.grill.steps,
            step => !Record.has(snapshot.answers, step.question.id),
          ),
          Option.map(step => step.part),
        ),
        () => OVERVIEW,
      )

const settleLoad = (model: Model, result: SnapshotResult): UpdateReturn => {
  if (result._tag === 'Failure') {
    return AsyncData.hasData(model.page)
      ? { model }
      : {
          model: modifyFields(model, {
            page: () => PageData.Failure({ error: result.failure }),
          }),
        }
  }
  const snapshot = result.success
  if (AsyncData.hasData(model.page)) {
    return { model: refreshPage(model, snapshot) }
  }
  const first = model.currentPart === ''
  const next = modifyFields(refreshPage(model, snapshot), {
    answers: () => snapshot.answers,
    notes: restored => ({ ...snapshot.notes, ...restored }),
    own: restored => ({ ...snapshot.own, ...restored }),
    send: () => latestSendState(snapshot),
    sendDetail: () => latestSendDetail(snapshot),
    currentPart: current => (first ? startingPart(snapshot) : current),
  })
  return {
    model: next,
    commands: first
      ? [ReplacePage({ url: pathOfPage(snapshot.grill.id, next.currentPart) })]
      : [],
  }
}

// INIT

export const init: Runtime.RoutingApplicationInit<Model, Message> = url => ({
  model: {
    page: PageData.Loading(),
    answers: {},
    notes: {},
    own: {},
    talkDrafts: {},
    talkAbout: {},
    diffShown: {},
    whyOpen: {},
    isConceptMapOpen: false,
    isShapeOpen: false,
    send: 'Idle',
    isSendOpen: false,
    sendMessage: '',
    talkGeneration: 0,
    sendDetail: '',
    copy: 'Idle',
    maybeSaveError: Option.none(),
    maybeBuild: Option.none(),
    currentPart: pageOfPath(url.pathname),
    side: 'Talk',
    maybePrevious: Option.none(),
    planView: 'List',
    now: 0,
    skipped: [],
    expanded: {},
    peeks: [],
    maybeHover: Option.none(),
    maybeTalkPart: Option.none(),
    maybeJustAnswered: Option.none(),
  },
  commands: [LoadGrill(), CheckBuild(), RestoreDrafts()],
})

// COMMAND

const SnapshotFromJson = Schema.decodeUnknownEffect(Snapshot)

const requestSnapshot = (input: string, init?: RequestInit) =>
  pipe(
    Effect.tryPromise(async () => {
      const response = await fetch(input, {
        credentials: 'same-origin',
        ...init,
      })
      const body: unknown = await response.json()
      if (!response.ok) {
        const error = (body as { error?: unknown }).error
        throw new Error(
          typeof error === 'string'
            ? error
            : `The server answered ${response.status}.`,
        )
      }
      return body
    }),
    Effect.flatMap(body => SnapshotFromJson(body)),
    Effect.mapError(error =>
      error instanceof Error
        ? error.message
        : 'The page data could not be read.',
    ),
    Effect.result,
  )

export const LoadGrill = Command.define('LoadGrill', {
  messages: [Message.CompletedLoadGrill],
  execute: pipe(
    Effect.sync(() =>
      window.location.pathname.split('/').filter(part => part !== ''),
    ),
    Effect.flatMap(parts =>
      requestSnapshot(`/api/grills/${encodeURIComponent(parts[1] ?? '')}`),
    ),
    Effect.map(result => Message.CompletedLoadGrill({ result })),
  ),
})

export const PostEvent = Command.define('PostEvent', {
  args: { grillId: Schema.String, body: Schema.String },
  messages: [Message.CompletedPostEvent],
  execute: ({ grillId, body }) =>
    pipe(
      requestSnapshot(`/api/grills/${encodeURIComponent(grillId)}/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      }),
      Effect.map(result => Message.CompletedPostEvent({ result })),
    ),
})

export const SendAnswers = Command.define('SendAnswers', {
  args: { grillId: Schema.String, message: Schema.String },
  messages: [Message.CompletedSendAnswers],
  execute: ({ grillId, message }) =>
    pipe(
      requestSnapshot(`/api/grills/${encodeURIComponent(grillId)}/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message }),
      }),
      Effect.map(result => Message.CompletedSendAnswers({ result })),
    ),
})

export const CopyReply = Command.define('CopyReply', {
  args: { text: Schema.String },
  messages: [Message.CompletedCopyReply],
  execute: ({ text }) =>
    pipe(
      Effect.tryPromise(() => navigator.clipboard.writeText(text)),
      Effect.map(() => Message.CompletedCopyReply({ copied: true })),
      Effect.catch(() =>
        Effect.succeed(Message.CompletedCopyReply({ copied: false })),
      ),
    ),
})

export const ScrollToQuestion = Command.define('ScrollToQuestion', {
  args: { question: Schema.String },
  messages: [Message.CompletedScroll],
  execute: ({ question }) =>
    pipe(
      Dom.scrollIntoViewAfterPaint(`#q-${question}`),
      Effect.catch(() => Effect.void),
      Effect.map(() => Message.CompletedScroll()),
    ),
})

export const ScrollToWhy = Command.define('ScrollToWhy', {
  args: { stepId: Schema.String },
  messages: [Message.CompletedScroll],
  execute: ({ stepId }) =>
    pipe(
      Dom.scrollIntoViewAfterPaint(`#why-${stepId}`),
      Effect.catch(() => Effect.void),
      Effect.map(() => Message.CompletedScroll()),
    ),
})

/**
 * Whether Talk shows a question's reasoning unfolded: as the reader set it, otherwise when
 * Talk is about that question or the panel has no other.
 */
export const isWhyOpen = (
  whyOpen: Readonly<Record<string, boolean>>,
  stepId: string,
  isAbout: boolean,
  isOnly: boolean,
): boolean =>
  Option.getOrElse(Record.get(whyOpen, stepId), () => isAbout || isOnly)

export const ScrollToTop = Command.define('ScrollToTop', {
  messages: [Message.CompletedScroll],
  execute: pipe(
    Effect.sync(() => window.scrollTo({ top: 0 })),
    Effect.map(() => Message.CompletedScroll()),
  ),
})

const afterPaint = Effect.callback<void>(resume => {
  requestAnimationFrame(() => requestAnimationFrame(() => resume(Effect.void)))
})

/** Scrolls by what a folded question above the view lost, so what you were reading stays put. */
export const KeepPlaceBelow = Command.define('KeepPlaceBelow', {
  args: { question: Schema.String, bottom: Schema.Number },
  messages: [Message.CompletedScroll],
  execute: ({ question, bottom }) =>
    pipe(
      afterPaint,
      Effect.map(() => {
        const element = document.getElementById(`q-${question}`)
        if (element !== null) {
          window.scrollBy({
            top: element.getBoundingClientRect().bottom - bottom,
            behavior: 'instant',
          })
        }
        return Message.CompletedScroll()
      }),
    ),
})

export const FocusTalkBox = Command.define('FocusTalkBox', {
  messages: [Message.CompletedFocus],
  execute: pipe(
    Effect.sleep(Duration.millis(30)),
    Effect.flatMap(() => Dom.focus('#talk-box')),
    Effect.catch(() => Effect.void),
    Effect.map(() => Message.CompletedFocus()),
  ),
})

// Dictation tools can set a box's text without an input event, which a value bound to the
// Model would undo at once. So these boxes own their text: the Model fills them when they
// mount and reads them when they send.

const boxText = (id: string): string => {
  const element = document.getElementById(id)
  return element instanceof HTMLTextAreaElement ? element.value : ''
}

/** Where a question's own reply box keeps its draft, beside the Talk keys. */
export const threadDraftKey = (stepId: string): string => `ask:${stepId}`

export const ReadThreadBox = Command.define('ReadThreadBox', {
  args: { stepId: Schema.String },
  messages: [Message.ReadThreadBox],
  execute: ({ stepId }) =>
    Effect.sync(() =>
      Message.ReadThreadBox({ stepId, text: boxText(`thread-box-${stepId}`) }),
    ),
})

export const ReadTalkBoxCommand = Command.define('ReadTalkBox', {
  args: { partId: Schema.String, about: Schema.String },
  messages: [Message.ReadTalkBox],
  execute: ({ partId, about }) =>
    Effect.sync(() =>
      Message.ReadTalkBox({ partId, about, text: boxText('talk-box') }),
    ),
})

export const ReadSendBoxCommand = Command.define('ReadSendBox', {
  messages: [Message.ReadSendBox],
  execute: Effect.sync(() =>
    Message.ReadSendBox({ text: boxText('send-message') }),
  ),
})

export const FillBox = Mount.define('FillBox', {
  args: { text: Schema.String },
  messages: [Message.CompletedFillBox],
  execute: ({ element, text }) =>
    Effect.sync(() => {
      if (element instanceof HTMLTextAreaElement && element.value === '') {
        element.value = text
      }
      return Message.CompletedFillBox()
    }),
})

export const FocusSendBox = Command.define('FocusSendBox', {
  messages: [Message.CompletedFocus],
  execute: pipe(
    Effect.sleep(Duration.millis(30)),
    Effect.flatMap(() => Dom.focus('#send-message')),
    Effect.catch(() => Effect.void),
    Effect.map(() => Message.CompletedFocus()),
  ),
})

const DRAFTS_KEY = 'grill-flow:drafts'

export const CheckBuild = Command.define('CheckBuild', {
  messages: [Message.CompletedCheckBuild],
  execute: pipe(
    Effect.tryPromise(async () => {
      const response = await fetch('/api/build', {
        credentials: 'same-origin',
      })
      const body = (await response.json()) as { build?: unknown }
      return typeof body.build === 'string' && body.build !== ''
        ? Option.some(body.build)
        : Option.none<string>()
    }),
    Effect.catch(() => Effect.succeed(Option.none<string>())),
    Effect.map(maybeBuild => Message.CompletedCheckBuild({ maybeBuild })),
  ),
})

// Unsent drafts survive the reload in this tab only; answers and saved notes live on the server.
export const ReloadPage = Command.define('ReloadPage', {
  args: { drafts: Schema.String },
  messages: [Message.CompletedReloadPage],
  execute: ({ drafts }) =>
    pipe(
      Effect.sync(() => {
        try {
          window.sessionStorage.setItem(DRAFTS_KEY, drafts)
        } catch {
          // Storage can be off; the reload still brings the new build.
        }
        window.location.reload()
      }),
      Effect.map(() => Message.CompletedReloadPage()),
    ),
})

const DraftRecords = Schema.Struct({
  talkDrafts: Schema.Record(Schema.String, Schema.String),
  notes: Schema.Record(Schema.String, Schema.String),
  own: Schema.Record(Schema.String, Schema.String),
  skipped: Schema.Array(Schema.String),
  expanded: Schema.Record(Schema.String, Schema.Boolean),
  currentPart: Schema.String,
})

export const RestoreDrafts = Command.define('RestoreDrafts', {
  messages: [Message.CompletedRestoreDrafts],
  execute: pipe(
    Effect.sync(() => {
      try {
        const raw = window.sessionStorage.getItem(DRAFTS_KEY)
        window.sessionStorage.removeItem(DRAFTS_KEY)
        return raw ?? '{}'
      } catch {
        return '{}'
      }
    }),
    Effect.flatMap(raw => Effect.try(() => JSON.parse(raw) as unknown)),
    Effect.flatMap(parsed => Schema.decodeUnknownEffect(DraftRecords)(parsed)),
    Effect.catch(() =>
      Effect.succeed({
        talkDrafts: {},
        notes: {},
        own: {},
        skipped: [],
        expanded: {},
        currentPart: '',
      }),
    ),
    Effect.map(drafts => Message.CompletedRestoreDrafts(drafts)),
  ),
})

// SUBSCRIPTION

/**
 * How a question sits outside the view: above under the top bar (with its bottom edge, to
 * keep the page still when it folds), below the fold, or not out of view at all.
 */
const outOfView = (question: string): Option.Option<Option.Option<number>> => {
  const element = document.getElementById(`q-${question}`)
  if (element === null) {
    return Option.none()
  }
  const box = element.getBoundingClientRect()
  const barBottom =
    document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0
  return box.bottom < barBottom
    ? Option.some(Option.some(box.bottom))
    : box.top > window.innerHeight
      ? Option.some(Option.none())
      : Option.none()
}

/**
 * Some once the pointer is over something outside the question, carrying its bottom when its top
 * is under the bar, so folding it can keep what's below in place.
 */
const pointerLeft = (
  question: string,
  target: EventTarget | null,
): Option.Option<Option.Option<number>> => {
  const element = document.getElementById(`q-${question}`)
  if (
    element === null ||
    !(target instanceof Node) ||
    element.contains(target)
  ) {
    return Option.none()
  }
  const box = element.getBoundingClientRect()
  const barBottom =
    document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0
  return Option.some(
    box.top < barBottom ? Option.some(box.bottom) : Option.none(),
  )
}

/**
 * What the reader is on: the concept while its title shows, else the question under a reading
 * line a third of the way down the view, or the nearest one to it.
 */
const onScreenAbout = (): Option.Option<string> => {
  const barBottom =
    document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0
  const title = document.querySelector('.concept-title')
  if (title !== null && title.getBoundingClientRect().bottom > barBottom) {
    return Option.some('concept')
  }
  const line = barBottom + (window.innerHeight - barBottom) / 3
  const distance = (box: DOMRect): number =>
    box.top <= line && box.bottom >= line
      ? 0
      : Math.min(Math.abs(box.top - line), Math.abs(box.bottom - line))
  return Option.map(
    Array.head(
      Array.sort(
        Array.map(
          Array.fromIterable(
            document.querySelectorAll('.questions .question.is-expanded'),
          ),
          section => ({
            id: section.id.replace(/^q-/, ''),
            distance: distance(section.getBoundingClientRect()),
          }),
        ),
        (a: { distance: number }, b: { distance: number }) =>
          Math.sign(a.distance - b.distance) as -1 | 0 | 1,
      ),
    ),
    entry => entry.id,
  )
}

const isConceptPage = (page: string): boolean =>
  page !== OVERVIEW &&
  page !== PLAN &&
  page !== DECIDED &&
  !page.startsWith(URGENCY_PAGE) &&
  !page.startsWith(ISSUE_PAGE) &&
  !page.startsWith(CARD_PAGE)

/** Pages that list questions from several concepts. */
const isMixedPage = (page: string): boolean =>
  page.startsWith(URGENCY_PAGE) ||
  page.startsWith(ISSUE_PAGE) ||
  page.startsWith(CARD_PAGE)

export const subscriptions = Subscription.make<Model, Message>()(entry => ({
  // While Talk is open, its About follows what the reader scrolls to; on an urgency or issue page
  // the concept Talk shows follows too.
  followQuestion: entry(
    { page: Schema.String },
    {
      modelToDependencies: model => ({
        page:
          model.side === 'Talk' &&
          (isConceptPage(model.currentPart) || isMixedPage(model.currentPart))
            ? model.currentPart
            : '',
      }),
      dependenciesToStream: ({ page }) =>
        Stream.when(
          Dom.streamFromEventFilterMap({
            target: window,
            type: 'scroll',
            filterMapEvent: () =>
              isMixedPage(page)
                ? Option.filter(onScreenAbout(), about => about !== 'concept')
                : onScreenAbout(),
          }).pipe(
            Stream.changes,
            Stream.map(about =>
              isMixedPage(page)
                ? Message.ScrolledToQuestion({ question: about })
                : Message.ScrolledToAbout({ partId: page, about }),
            ),
          ),
          Effect.sync(() => page !== ''),
        ),
    },
  ),
  // The question just answered stays open until the pointer leaves it or it scrolls out of view,
  // then folds to its row.
  collapseAnswered: entry(
    { justAnswered: Schema.String },
    {
      modelToDependencies: model => ({
        justAnswered: Option.getOrElse(model.maybeJustAnswered, () => ''),
      }),
      dependenciesToStream: ({ justAnswered }) =>
        Stream.when(
          Stream.merge(
            Dom.streamFromEventFilterMap({
              target: window,
              type: 'scroll',
              filterMapEvent: () => outOfView(justAnswered),
            }),
            Dom.streamFromEventFilterMap({
              target: document,
              type: 'mouseover',
              filterMapEvent: event => pointerLeft(justAnswered, event.target),
            }),
          ).pipe(
            Stream.map(maybeBottomAbove =>
              Message.LeftAnswered({
                question: justAnswered,
                maybeBottomAbove,
              }),
            ),
          ),
          Effect.sync(() => justAnswered !== ''),
        ),
    },
  ),
  // Only a grill with a plan shows a countdown, so only it keeps the clock.
  clock: entry(
    { hasPlan: Schema.Boolean },
    {
      modelToDependencies: model => ({
        hasPlan: Option.exists(
          AsyncData.getData(model.page),
          snapshot => snapshot.grill.plan !== undefined,
        ),
      }),
      dependenciesToStream: ({ hasPlan }) =>
        Stream.when(
          Stream.tick(Duration.minutes(1)).pipe(
            Stream.mapEffect(() => Clock.currentTimeMillis),
            Stream.map(now => Message.TickedClock({ now })),
          ),
          Effect.sync(() => hasPlan),
        ),
    },
  ),
  poll: entry(
    { isLoaded: Schema.Boolean },
    {
      modelToDependencies: model => ({
        isLoaded: AsyncData.hasData(model.page),
      }),
      dependenciesToStream: ({ isLoaded }) =>
        Stream.when(
          Stream.tick(POLL_INTERVAL).pipe(
            Stream.drop(1),
            Stream.map(Message.TickedPoll),
          ),
          Effect.sync(() => isLoaded),
        ),
    },
  ),
}))
