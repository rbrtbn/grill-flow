import {
  Array,
  Clock,
  Duration,
  Effect,
  Option,
  Order,
  Record,
  Result,
  Schema,
  Stream,
  pipe,
} from 'effect'
import { SecureRandom } from 'effect/crypto'
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
import { afterCommit } from 'foldkit/render'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'

import { BrowserCrypto } from '@effect/platform-browser'

import {
  ActivityCursors,
  ActivityFilter,
  activityCursorOf,
  activityReadFrom,
  revealAnchorFrom,
} from './activity'
import {
  BROWSER_NOTICES_KEY,
  BrowserNoticeState,
  NoticeCandidate,
  NoticeResult,
  disableBrowserNotices,
  enableBrowserNotices,
  initialBrowserNotices,
  noticeCandidates,
  noticeHref,
  restoreBrowserNotices,
  syncBrowserNotices,
} from './browserNotifications'
import { channelItemKey } from './channel'
import { DiagramView } from './diagram'
import {
  type Grill,
  OWN,
  Snapshot,
  type Step,
  TEXT_LIMIT,
  agentMessagesOf,
  cardOf,
  cardsOf,
  isOverTextLimit,
  issuesOf,
  replyText,
  roundOf,
  statusOf,
  unreadOf,
  urgencyOf,
  usesUrgency,
} from './domain'
import { drawingAttemptKey } from './drawings'
import {
  ALL_SCOPES,
  INBOX,
  ITEM_PAGE,
  InboxUi,
  RUNS,
  RUN_PAGE,
  RequestUpdateState,
  SessionGroup,
  SessionOrder,
  UpdateScope,
  filtersFrom,
  initialInboxUi,
  narrowedSnapshot,
  queryOf,
  toggleFacet,
} from './inbox'
import { isFixtureQuestion, withFixtureQuestions } from './questionFixture'
import {
  QUOTE_BOX,
  QUOTE_DRAFT,
  QuoteSelection,
  QuotedText,
  isInsideQuotePopover,
  quoteDestination,
  quotedAsk,
  readQuoteSelection,
  withQuote,
} from './quote'
import {
  HOLD_SECONDS,
  IDLE_NUDGE_SECONDS,
  readySteps,
  roundSteps,
  trayOrder,
  unsentSteps,
} from './sendShortcuts'
import {
  ANSWER_HISTORY,
  CHANGES,
  CONVERSATIONS,
  CatalogData,
  GRILLS,
  NEEDS,
  QUESTION_PAGE,
  QuestionFilter,
  QuestionGrouping,
  QuestionSort,
  QuestionUrgencyFilter,
  REPLIES,
  REVIEW,
  RUN_TARGET,
  SQUAD,
  UPDATES,
  WorkSection,
  Workspace,
  adjacentQuestion,
  draftAnswerIds,
  initialWorkspace,
  isWorkspacePage,
  questionFilterFrom,
  questionOnPage,
  questionSortFrom,
  questionUrgencyFilterFrom,
  revealQuestion,
  roundIsCollapsed,
  roundScopesFrom,
  workspaceLines,
} from './workspace'

const POLL_INTERVAL = Duration.seconds(4)
export const TOAST_LIFETIME_MS = 4_000

export const OVERVIEW = 'overview'
// A squad grill with a plan gets a page of which builds wait on what.
export const PLAN = 'plan'
// Every issue of the run under where it stands, beside the Plan's board.
export const STATUS = 'status'
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

export const QuickSendState = Schema.Literals(['Idle', 'Reading', 'Saving'])

// A one-click send waiting out its undo window (docs/adr/0035). `left` reaches zero when the
// window ends while another send is still in flight; it then goes as soon as that one settles.
export const HeldSend = Schema.Struct({
  questions: Schema.Array(Schema.String),
  left: Schema.Number,
})

// A link to another page the reader followed with ready drafts unsent; `isSending` once they
// chose to send them first.
export const Leaving = Schema.Struct({
  href: Schema.String,
  isSending: Schema.Boolean,
})

export const TrayKey = Schema.Literals([
  'Up',
  'Down',
  'Toggle',
  'Keep',
  'Send',
  'Close',
])

export const CopyState = Schema.Literals(['Idle', 'Copied', 'Failed'])
export type CopyState = typeof CopyState.Type

const DrawingAttempt = defineTaggedUnion({
  Requesting: { previous: Schema.Number },
  Failed: { previous: Schema.Number, error: Schema.String },
})
const OwnerDestinationState = defineTaggedUnion({
  Opening: {},
  Opened: {},
  Failed: { error: Schema.String },
})
const VetoAttemptState = defineTaggedUnion({
  Sending: {},
  Failed: { error: Schema.String },
})

/**
 * What fills the right sidebar: the concept's conversation, the map of every question, every
 * message from the agent, or nothing.
 */
export const Side = Schema.Literals(['Talk', 'Map', 'Replies', 'None'])
export type Side = typeof Side.Type

/** The lists the left sidebar stacks the questions in. */
export const SidebarMode = Schema.Literals([
  'Concepts',
  'Issues',
  'Cards',
  'Urgency',
])
export type SidebarMode = typeof SidebarMode.Type

/** The sidebar edges a reader can drag: the left list's and the right sidebar's. */
export const SidebarEdge = Schema.Literals(['Nav', 'Side'])
export type SidebarEdge = typeof SidebarEdge.Type

/** How narrow and wide a dragged sidebar may go, in px. */
export const SIDEBAR_BOUNDS: Readonly<
  Record<SidebarEdge, Readonly<{ min: number; max: number }>>
> = {
  Nav: { min: 260, max: 480 },
  Side: { min: 320, max: 960 },
}

export const clampSidebarWidth = (edge: SidebarEdge, width: number): number =>
  Math.round(
    Math.min(
      Math.max(width, SIDEBAR_BOUNDS[edge].min),
      SIDEBAR_BOUNDS[edge].max,
    ),
  )

export const ChannelReveal = defineTaggedUnion({
  None: {},
  Pending: { id: Schema.String },
  Completed: { id: Schema.String },
})

export const Model = Schema.Struct({
  page: PageData.schema,
  workspace: Workspace,
  pendingEvents: Schema.Number,
  failedWrites: Schema.Array(Schema.String),
  answers: Schema.Record(Schema.String, Schema.String),
  notes: Schema.Record(Schema.String, Schema.String),
  own: Schema.Record(Schema.String, Schema.String),
  talkDrafts: Schema.Record(Schema.String, Schema.String),
  // Talk state is keyed by the page's general conversation: a concept id, or on a card page the
  // page itself (`card:<card>`). See talkKeyOf.
  talkAbout: Schema.Record(Schema.String, Schema.String),
  diffShown: Schema.Record(Schema.String, Schema.Boolean),
  // What each diagram shows, keyed by diagramKey (view.ts).
  diagramViews: Schema.Record(Schema.String, DiagramView),
  whyOpen: Schema.Record(Schema.String, Schema.Boolean),
  send: SendState,
  quickSend: QuickSendState,
  isCommandHeld: Schema.Boolean,
  isSendOpen: Schema.Boolean,
  sendMessage: Schema.String,
  // Bumped after each sent talk message, so the box remounts empty.
  talkGeneration: Schema.Number,
  sendDetail: Schema.String,
  // The questions of a one-click send from its click until the server answers; none sends the
  // Review selection.
  maybeSendSubset: Schema.Option(Schema.Array(Schema.String)),
  maybeHeldSend: Schema.Option(HeldSend),
  // Drafts the reader holds on purpose: left out of the unsent count, nudges and Review's
  // default selection. Kept per grill in the browser.
  keptBack: Schema.Array(Schema.String),
  isTrayOpen: Schema.Boolean,
  trayCursor: Schema.Number,
  // Bumped by each answer or note write; the idle nudge counts quiet time from the latest.
  answerActivity: Schema.Number,
  isNudging: Schema.Boolean,
  maybeLeaving: Schema.Option(Leaving),
  copy: CopyState,
  channelReveal: ChannelReveal,
  browserNotices: BrowserNoticeState,
  drawingAttempts: Schema.Record(Schema.String, DrawingAttempt),
  ownerDestinations: Schema.Record(Schema.String, OwnerDestinationState),
  ownerCopies: Schema.Record(
    Schema.String,
    Schema.Literals(['Copied', 'Failed']),
  ),
  vetoAttempts: Schema.Record(Schema.String, VetoAttemptState),
  keyCopies: Schema.Record(
    Schema.String,
    Schema.Literals(['Copied', 'Failed']),
  ),
  maybeSaveError: Schema.Option(Schema.String),
  maybeBuild: Schema.Option(Schema.String),
  currentPart: Schema.String,
  side: Side,
  // The page the reader came from, for the back link.
  maybePrevious: Schema.Option(Schema.String),
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
  // Left sidebar lists the reader folded; kept in the browser, the same for every grill.
  navFolded: Schema.Array(SidebarMode),
  // Sidebar widths the reader dragged to, in px; none keeps the layout's own. Kept in the browser,
  // the same for every grill.
  maybeNavWidth: Schema.Option(Schema.Number),
  maybeSideWidth: Schema.Option(Schema.Number),
  maybeResizing: Schema.Option(SidebarEdge),
  // What the reader has seen of the agent's messages: everything up to `readSince` (none until
  // the browser's record is read), and each later one in `readIds`. Kept per grill in the browser.
  readSince: Schema.Option(Schema.Number),
  readIds: Schema.Array(Schema.String),
  // Timeouts hide cards while their replies remain unread.
  hiddenToastIds: Schema.Array(Schema.String),
  notificationTray: Schema.Literals(['Expanded', 'Collapsed']),
  // The agent message the reader closed in the top bar; a newer one brings the line back. Kept
  // per grill in the browser.
  maybeClosedLine: Schema.Option(Schema.String),
  maybeJustAnswered: Schema.Option(Schema.String),
  // An urgency or issue page mixes concepts; Talk there shows this one, while the page lists it.
  maybeTalkPart: Schema.Option(Schema.String),
  // The address's query string without its `?`: Inbox filters, Questions filters.
  pageQuery: Schema.String,
  inbox: InboxUi,
})
export type Model = typeof Model.Type

// MESSAGE

export const DiscussionState = Schema.Struct({
  open: Schema.Boolean,
  expanded: Schema.Boolean,
  target: Schema.String,
  scroll: Schema.Record(Schema.String, Schema.Number),
})
const closedDiscussion: typeof DiscussionState.Type = {
  open: false,
  expanded: false,
  target: '',
  scroll: {},
}

export const Message = defineMessageUnion({
  CompletedLoadGrill: {
    result: Schema.Result(Snapshot, Schema.String),
    discussion: Schema.optionalKey(
      Schema.Struct({ target: Schema.String, atBottom: Schema.Boolean }),
    ),
  },
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
    sendMessage: Schema.String,
  },
  SelectedOption: { question: Schema.String, key: Schema.String },
  SelectedOwnAnswer: { question: Schema.String },
  UpdatedOwnAnswer: { question: Schema.String, value: Schema.String },
  BlurredOwnAnswer: { question: Schema.String },
  CompletedReadOwnBox: {
    question: Schema.String,
    maybeText: Schema.Option(Schema.String),
  },
  ClickedClearAnswer: { question: Schema.String },
  UpdatedNote: { question: Schema.String, value: Schema.String },
  BlurredNote: { question: Schema.String },
  CompletedReadNoteBox: {
    question: Schema.String,
    maybeText: Schema.Option(Schema.String),
  },
  CompletedPostEvent: {
    result: Schema.Result(Snapshot, Schema.String),
    body: Schema.optionalKey(Schema.String),
  },
  ClickedRetrySaves: {},
  ClickedWorkspacePage: { page: Schema.String },
  PressedWorkspaceShortcut: {},
  PressedRoundSendShortcut: {},
  ClickedSendQuestions: { questions: Schema.Array(Schema.String) },
  TickedHeldSend: {},
  ClickedUndoSend: {},
  ClickedSendHeldNow: {},
  ClickedUnsentTray: {},
  PressedTrayKey: { key: TrayKey },
  ClickedKeepBack: { question: Schema.String, kept: Schema.Boolean },
  RestoredKeptBack: { questions: Schema.Array(Schema.String) },
  CompletedSaveKeptBack: {},
  ElapsedAnswerIdle: { activity: Schema.Number },
  ClickedNotYet: {},
  ClickedLeaveLink: { href: Schema.String },
  ClickedStay: {},
  ClickedLeave: {},
  ClickedSendAndLeave: {},
  CompletedLeavePage: {},
  WarnedBeforeUnload: {},
  UpdatedCommandHeld: { held: Schema.Boolean },
  ClickedQuickSend: {},
  CompletedReadQuickSendEditors: {
    own: Schema.Record(Schema.String, Schema.String),
    notes: Schema.Record(Schema.String, Schema.String),
    message: Schema.String,
  },
  FailedReadQuickSendEditors: {},
  ClickedQuestionNote: { question: Schema.String },
  UpdatedReviewQuery: { value: Schema.String },
  ClickedReviewDetail: { question: Schema.String },
  SelectedWorkSection: { section: WorkSection },
  ClickedRefreshCatalog: {},
  CompletedLoadCatalog: {
    result: Schema.Result(Schema.Array(Snapshot), Schema.String),
  },
  ClickedQuestionArrow: { direction: Schema.Literals(['Previous', 'Next']) },
  PressedQuestionArrow: { direction: Schema.Literals(['Previous', 'Next']) },
  ChangedQuestionFilter: { filter: QuestionFilter },
  ChangedQuestionUrgencyFilter: { urgencyFilter: QuestionUrgencyFilter },
  ChangedQuestionGrouping: { grouping: QuestionGrouping },
  SelectedQuestionView: {
    filter: QuestionFilter,
    urgencyFilter: QuestionUrgencyFilter,
  },
  SelectedRoundScopes: { rounds: Schema.Array(Schema.Number) },
  SelectedQuestionSort: { sort: QuestionSort },
  ClickedCustomFilters: {},
  ClickedAgentGroup: { session: Schema.String },
  ClickedRenameRound: { round: Schema.Number },
  UpdatedRoundName: { name: Schema.String },
  SubmittedRoundName: { round: Schema.Number },
  CancelledRoundName: {},
  ClickedQuestionBranch: { question: Schema.String },
  UpdatedQuestionSearch: { value: Schema.String },
  ClickedRound: { round: Schema.Number },
  ClickedSettings: {},
  ClosedSettings: {},
  ClickedEnableBrowserNotices: {},
  ClickedDisableBrowserNotices: {},
  CompletedRestoreBrowserNotices: { result: NoticeResult },
  CompletedEnableBrowserNotices: { result: NoticeResult },
  CompletedDisableBrowserNotices: {
    result: NoticeResult,
    failed: Schema.Boolean,
  },
  CompletedSyncBrowserNotices: { result: NoticeResult },
  BrowserNoticePreferencesChanged: {},
  BrowserNoticeDeliveryFailed: {},
  RequestedBrowserNoticeNavigation: { href: Schema.String },
  CompletedOpenBrowserNotice: {},
  ChangedHighlights: {},
  ChangedCollapseSentRounds: {},
  RestoredWorkspaceSettings: {
    navigation: Schema.optionalKey(Schema.Literals(['Reload', 'Navigate'])),
    filter: QuestionFilter,
    urgencyFilter: QuestionUrgencyFilter,
    grouping: QuestionGrouping,
    sort: Schema.optionalKey(QuestionSort),
    activityRead: Schema.optionalKey(ActivityCursors),
    roundScopes: Schema.optionalKey(Schema.Unknown),
    highlightTerms: Schema.Boolean,
    collapseSentRounds: Schema.Boolean,
  },
  CompletedSaveWorkspaceSettings: {},
  ClickedMarkActivitySeen: {},
  SelectedActivityFilter: { filter: ActivityFilter },
  CompletedRevealChannelItem: { id: Schema.String },
  RestoredDiscussionState: { state: DiscussionState },
  ChangedDiscussionState: { grillId: Schema.String, state: DiscussionState },
  CompletedSaveDiscussionState: {},
  ScrolledDiscussion: { target: Schema.String, top: Schema.Number },
  CompletedRestoreDiscussionScroll: {},
  CompletedRestoreDiscussionPosition: {},
  ClickedDiscussion: { target: Schema.String },
  ClickedCloseDiscussion: {},
  ClickedExpandDiscussion: {},
  ClickedReturnConversation: { open: Schema.Boolean },
  SelectedDiscussionTarget: { target: Schema.String },
  ClickedConversationStarter: { target: Schema.String, text: Schema.String },
  SelectedQuoteText: { quoted: QuotedText },
  ClearedQuoteSelection: {},
  DismissedQuote: {},
  ClickedQuoteInDiscussion: {},
  ClickedQuoteReply: {},
  SubmittedQuoteReply: {},
  CompletedReadQuoteBox: { text: Schema.String },
  ClickedRedeliverAsk: {
    askId: Schema.Number,
    stepId: Schema.String,
    route: Schema.Literals(['own', 'fallback']),
  },
  SubmittedWorkspaceDiscussion: { target: Schema.String },
  ReadWorkspaceDiscussion: { target: Schema.String, text: Schema.String },
  ToggledReviewAnswer: { question: Schema.String },
  ClickedSelectReview: { selected: Schema.Boolean },
  ClickedSend: {},
  ClickedConfirmSend: {},
  ClickedCancelSend: {},
  UpdatedSendMessage: { value: Schema.String },
  CompletedSendAnswers: { result: Schema.Result(Snapshot, Schema.String) },
  ClickedDrawing: { question: Schema.String },
  CompletedRequestDrawing: {
    grillId: Schema.String,
    question: Schema.String,
    previous: Schema.Number,
    result: Schema.Result(Snapshot, Schema.String),
  },
  ClickedVeto: {
    source: Schema.String,
    item: Schema.String,
    revision: Schema.Number,
  },
  CompletedPostVeto: {
    source: Schema.String,
    item: Schema.String,
    revision: Schema.Number,
    result: Schema.Result(Snapshot, Schema.String),
  },
  ClickedOwnerDestination: {
    source: Schema.String,
    item: Schema.String,
    revision: Schema.Number,
  },
  CompletedOpenOwnerDestination: {
    key: Schema.String,
    result: Schema.Result(Snapshot, Schema.String),
  },
  ClickedCopyOwnerStep: {
    source: Schema.String,
    item: Schema.String,
    revision: Schema.Number,
  },
  CompletedCopyOwnerStep: { key: Schema.String, copied: Schema.Boolean },
  ClickedCopy: {},
  ClickedQuestionKey: { key: Schema.String },
  CompletedCopyQuestionKey: { key: Schema.String, copied: Schema.Boolean },
  CompletedCopyReply: { copied: Schema.Boolean },
  ClickedToggleDiff: { stepId: Schema.String },
  ClickedDiagramState: { diagram: Schema.String, state: Schema.String },
  HoveredDiagramParagraph: { diagram: Schema.String, title: Schema.String },
  ScrolledPinnedDiagram: { diagram: Schema.String, title: Schema.String },
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
  ClickedToggleNavSection: { mode: SidebarMode },
  RestoredNavFolded: { folded: Schema.Array(SidebarMode) },
  CompletedSaveNavFolded: {},
  PressedResizeHandle: { edge: SidebarEdge },
  MovedResizePointer: { edge: SidebarEdge, width: Schema.Number },
  ReleasedResizeHandle: {},
  // `step` is in px, positive to widen.
  PressedResizeKey: { edge: SidebarEdge, step: Schema.Number },
  CompletedMeasureSidebar: {
    edge: SidebarEdge,
    maybeWidth: Schema.Option(Schema.Number),
    step: Schema.Number,
  },
  DoubleClickedResizeHandle: { edge: SidebarEdge },
  RestoredSidebarWidths: {
    maybeNav: Schema.Option(Schema.Number),
    maybeSide: Schema.Option(Schema.Number),
  },
  CompletedSaveSidebarWidths: {},
  RestoredRead: {
    maybeSince: Schema.Option(Schema.Number),
    ids: Schema.Array(Schema.String),
  },
  CompletedSaveRead: {},
  ClickedCloseAgentLine: { id: Schema.String },
  RestoredClosedLine: { maybeId: Schema.Option(Schema.String) },
  CompletedSaveClosedLine: {},
  // `inReplies` opens the message in the Replies panel; otherwise where it was said.
  ClickedAgentMessage: { id: Schema.String, inReplies: Schema.Boolean },
  DismissedAgentMessage: { id: Schema.String },
  EndedToastCountdown: { id: Schema.String },
  ClickedNotificationTray: {},
  SawAgentMessages: { ids: Schema.Array(Schema.String) },
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
  CompletedClearSendBox: {},
  PastedText: { text: Schema.String },
  CompletedInsertPastedText: {},
  ClickedAskAbout: { partId: Schema.String, question: Schema.String },
  ClickedShowChanges: { question: Schema.String, stepId: Schema.String },
  HoveredMapNode: { question: Schema.String },
  LeftMapNode: {},
  ClickedMapNode: { question: Schema.String },
  ClickedOpenInConcept: { question: Schema.String },
  ClickedMapConcept: { partId: Schema.String },
  CompletedScroll: {},
  LeftAnswered: {
    question: Schema.String,
    maybeBottomAbove: Schema.Option(Schema.Number),
  },
  CompletedFocus: {},
  CompletedDetectFixture: { isFixture: Schema.Boolean },
  ClickedInboxFacet: {
    facet: Schema.Literals(['kind', 'urgency', 'session']),
    value: Schema.String,
  },
  SelectedInboxGroupBy: {
    groupBy: Schema.Literals(['urgency', 'place', 'kind', 'session']),
  },
  ClickedClearInboxFilters: {},
  ClickedInboxView: { query: Schema.String },
  ClickedSaveInboxView: { name: Schema.String },
  ClickedCopyPageLink: {},
  CompletedCopyPageLink: { copied: Schema.Boolean },
  ClickedToggleInboxTask: { id: Schema.String },
  ClickedToggleQuestionLine: { group: Schema.String },
  ClickedToggleRecentlyDone: {},
  ClickedQuickLook: {},
  PressedQuickLookKey: { key: Schema.Literals(['Toggle', 'Close']) },
  ClickedRequestUpdate: { sessions: Schema.Array(Schema.String) },
  ClickedUpdateScope: { scope: UpdateScope },
  ClickedUpdateSession: { session: Schema.String },
  ClickedSendUpdateRequest: { ended: Schema.Array(Schema.String) },
  ClickedRequestStatus: { session: Schema.String, isEnded: Schema.Boolean },
  UpdatedThreadDraft: { item: Schema.String, text: Schema.String },
  SubmittedThreadMessage: { item: Schema.String },
  ClickedCopyInboxLine: { key: Schema.String, text: Schema.String },
  ClickedSessions: {},
  ClickedOpenSession: { target: Schema.String },
  ClickedSessionsBack: {},
  UpdatedSessionSearch: { value: Schema.String },
  SelectedSessionGroup: { group: SessionGroup },
  SelectedSessionOrder: { order: SessionOrder },
  ClickedPinSession: { address: Schema.String },
  ClickedNestedThread: { key: Schema.String },
  ClickedStartSideThread: {},
  ClickedSideThreadWith: { key: Schema.String },
  ClickedQuestionList: {},
  ClickedCopyAndFocus: {
    source: Schema.String,
    item: Schema.String,
    revision: Schema.Number,
  },
})
export type Message = typeof Message.Type

// UPDATE

type UpdateReturn = Update.Return<Model, Message>

const grillIdOf = (model: Model): Option.Option<string> =>
  pipe(
    AsyncData.getData(model.page),
    Option.map(snapshot => snapshot.grill.id),
  )

const withQuoteSelection = (model: Model, quote: QuoteSelection): Model =>
  modifyFields(model, {
    workspace: value => modifyFields(value, { quote: () => quote }),
  })

const quotedTextOf = (quote: QuoteSelection): Option.Option<QuotedText> =>
  quote._tag === 'Idle' ? Option.none() : Option.some(quote.quoted)

const quoteTargetOf = (model: Model, quoted: QuotedText): string =>
  quoteDestination(
    model.side === 'Talk',
    model.workspace.maybeDiscussionTarget,
    quoted.stepId,
  )

// A question's own thread shows on its page, so only other targets open the sessions panel.
const openDiscussionOn = (model: Model, target: string): Model =>
  modifyFields(model, {
    side: side =>
      Option.exists(AsyncData.getData(model.page), snapshot =>
        Option.exists(
          questionOnPage(snapshot, model.currentPart),
          step => step.id === target,
        ),
      )
        ? side
        : 'Talk',
    talkGeneration: count => count + 1,
    inbox: inbox => modifyFields(inbox, { isSessionDirectory: () => false }),
    workspace: value =>
      modifyFields(value, {
        maybeDiscussionTarget: () => Option.some(target),
      }),
  })

const postEvent = (
  model: Model,
  body: Record<string, unknown>,
): UpdateReturn => {
  const question = typeof body.question === 'string' ? body.question : ''
  const contextRevision = Option.flatMap(
    AsyncData.getData(model.page),
    snapshot => Option.fromUndefinedOr(snapshot.questionRevisions?.[question]),
  )
  const payload =
    body.kind !== 'answered'
      ? body
      : {
          ...body,
          ...Option.match(contextRevision, {
            onNone: () => ({}),
            onSome: revision => ({ contextRevision: revision }),
          }),
        }
  const isDraftEdit = ['answered', 'noted', 'cleared'].includes(
    String(body.kind),
  )
  if (
    isFixtureQuestion(question) ||
    isFixtureQuestion(typeof body.stepId === 'string' ? body.stepId : '')
  ) {
    return {
      model: modifyFields(model, {
        answerActivity: count => (isDraftEdit ? count + 1 : count),
      }),
    }
  }
  return Option.match(grillIdOf(model), {
    onNone: () => ({ model }),
    onSome: grillId => ({
      model: modifyFields(model, {
        pendingEvents: count => count + 1,
        answerActivity: count => (isDraftEdit ? count + 1 : count),
        isNudging: nudging => nudging && !isDraftEdit,
      }),
      commands: [PostEvent({ grillId, body: JSON.stringify(payload) })],
    }),
  })
}

const sendDraftAnswers = (model: Model, text: string): UpdateReturn =>
  withSnapshot(model, snapshot => {
    const unsent = modifyFields(model, {
      maybeSendSubset: () => Option.none(),
    })
    if (
      model.send === 'Sending' ||
      model.pendingEvents > 0 ||
      Option.isSome(model.maybeSaveError)
    ) {
      return { model: unsent }
    }
    const isWorkspace = isWorkspacePage(model.currentPart)
    const drafts = draftAnswerIds(
      snapshot,
      model.answers,
      model.notes,
      model.own,
    ).filter(id => !isFixtureQuestion(id))
    const questions = Option.match(model.maybeSendSubset, {
      onNone: () =>
        drafts.filter(
          id =>
            !model.workspace.excluded.includes(id) &&
            !model.keptBack.includes(id),
        ),
      onSome: subset => drafts.filter(id => subset.includes(id)),
    })
    if (
      (isWorkspace || Option.isSome(model.maybeSendSubset)) &&
      Array.isArrayEmpty(questions)
    ) {
      return { model: unsent }
    }
    // A one-click send carries no covering message; the Review box keeps its text.
    const message = Option.isSome(model.maybeSendSubset) ? '' : text
    return {
      model: modifyFields(model, {
        send: () => 'Sending',
        sendDetail: () => '',
        sendMessage: current =>
          Option.isSome(model.maybeSendSubset) ? current : text,
      }),
      commands: [
        SendAnswers({
          grillId: snapshot.grill.id,
          message,
          maybeQuestions:
            isWorkspace || Option.isSome(model.maybeSendSubset)
              ? Option.some(questions)
              : Option.none(),
          expectedLines: workspaceLines(
            snapshot,
            model.answers,
            model.notes,
            model.own,
          ),
        }),
      ],
    }
  })

const continueQuickSend = (model: Model): UpdateReturn => {
  if (model.quickSend !== 'Saving') {
    return { model }
  }
  if (
    !isWorkspacePage(model.currentPart) ||
    Option.isSome(model.maybeSaveError) ||
    Array.isReadonlyArrayNonEmpty(model.failedWrites)
  ) {
    return {
      model: modifyFields(model, {
        quickSend: () => 'Idle',
        maybeSendSubset: () => Option.none(),
      }),
    }
  }
  // A blur's save may still be in flight, and the send must not overtake it.
  if (model.pendingEvents > 0) {
    return { model }
  }
  return withSnapshot(model, snapshot => {
    const questions = snapshot.grill.steps.map(step => step.question.id)
    const bodies: ReadonlyArray<Record<string, unknown>> = [
      ...Object.entries(model.own).flatMap(([question, text]) =>
        questions.includes(question) &&
        model.answers[question] === OWN &&
        text !== (snapshot.own[question] ?? '')
          ? [{ kind: 'answered', question, key: OWN, text }]
          : [],
      ),
      ...Object.entries(model.notes).flatMap(([question, text]) =>
        questions.includes(question) &&
        text !== (snapshot.notes[question] ?? '')
          ? [{ kind: 'noted', question, text }]
          : [],
      ),
    ]
    if (
      bodies.some(
        body => typeof body.text === 'string' && isOverTextLimit(body.text),
      )
    ) {
      return {
        model: modifyFields(model, {
          quickSend: () => 'Idle',
          maybeSendSubset: () => Option.none(),
          send: () => 'Failed',
          sendDetail: () =>
            `An answer or note exceeds ${TEXT_LIMIT.toLocaleString('en-GB')} characters. Shorten it and try again; your draft is kept.`,
        }),
      }
    }
    if (Array.isReadonlyArrayNonEmpty(bodies)) {
      return bodies.reduce<UpdateReturn>(
        (pending, body) => {
          const write = postEvent(pending.model, body)
          return {
            model: write.model,
            commands: [...(pending.commands ?? []), ...(write.commands ?? [])],
          }
        },
        { model },
      )
    }
    return sendDraftAnswers(
      modifyFields(model, { quickSend: () => 'Idle' }),
      model.sendMessage,
    )
  })
}

export const readyOf = (model: Model, snapshot: Snapshot) =>
  readySteps(snapshot, model.answers, model.notes, model.own, model.keptBack)

// The tray's ticked drafts: ready ones, minus those unticked here or in Review.
export const traySelection = (
  model: Model,
  snapshot: Snapshot,
): ReadonlyArray<string> =>
  readyOf(model, snapshot)
    .map(step => step.question.id)
    .filter(id => !model.workspace.excluded.includes(id))

// One-click sends wait out an undo window first (docs/adr/0035). A second one inside the
// window joins the first and restarts it, so only one send is ever pending.
const holdSend = (
  model: Model,
  questions: ReadonlyArray<string>,
): UpdateReturn =>
  withSnapshot(model, snapshot => {
    const unsent = unsentSteps(
      snapshot,
      model.answers,
      model.notes,
      model.own,
    ).map(step => step.question.id)
    const fresh = questions.filter(id => unsent.includes(id))
    if (Array.isReadonlyArrayEmpty(fresh)) {
      return { model }
    }
    const held = Option.match(model.maybeHeldSend, {
      onNone: () => fresh,
      onSome: current => Array.dedupe([...current.questions, ...fresh]),
    })
    return {
      model: modifyFields(model, {
        maybeHeldSend: () =>
          Option.some({ questions: held, left: HOLD_SECONDS }),
        isTrayOpen: () => false,
        isNudging: () => false,
      }),
    }
  })

// Ends the undo window: the held answers go through quick send's save-then-send, or wait at
// zero while another send is in flight.
const releaseHeldSend = (model: Model): UpdateReturn =>
  Option.match(model.maybeHeldSend, {
    onNone: () => ({ model }),
    onSome: held => {
      if (model.send === 'Sending' || model.quickSend !== 'Idle') {
        return {
          model: modifyFields(model, {
            maybeHeldSend: () => Option.some({ ...held, left: 0 }),
          }),
        }
      }
      const released = modifyFields(model, {
        maybeHeldSend: () => Option.none(),
      })
      if (Option.isSome(model.maybeSaveError)) {
        return {
          model: modifyFields(released, {
            send: () => 'Failed',
            sendDetail: () =>
              'a draft could not be saved, so nothing was sent. Retry saving, then send again; your drafts are kept',
          }),
        }
      }
      return withSnapshot(released, snapshot => ({
        model: modifyFields(released, {
          quickSend: () => 'Reading',
          maybeSendSubset: () => Option.some(held.questions),
        }),
        commands: [
          ReadQuickSendEditors({
            questions: snapshot.grill.steps.map(step => step.question.id),
            message: model.sendMessage,
          }),
        ],
      }))
    },
  })

// After a send settles: a held send that waited for it goes now; a reader leaving after
// "Send and leave" goes once it delivered, and stays to see the failure otherwise.
const afterSend = (model: Model, isSent: boolean): UpdateReturn => {
  if (Option.exists(model.maybeHeldSend, held => held.left === 0)) {
    return releaseHeldSend(model)
  }
  return Option.match(model.maybeLeaving, {
    onNone: () => ({ model }),
    onSome: leaving =>
      !leaving.isSending
        ? { model }
        : isSent
          ? { model, commands: [LeavePage({ href: leaving.href })] }
          : {
              model: modifyFields(model, {
                maybeLeaving: () => Option.none(),
              }),
            },
  })
}

// Ticking a kept-back draft in Review or the tray returns it, so a tick always means "send
// this".
const toggleReview = (model: Model, question: string): UpdateReturn =>
  model.keptBack.includes(question)
    ? keepBack(
        modifyFields(model, {
          workspace: value =>
            modifyFields(value, {
              excluded: ids => ids.filter(id => id !== question),
            }),
        }),
        question,
        false,
      )
    : {
        model: modifyFields(model, {
          workspace: value =>
            modifyFields(value, {
              excluded: ids =>
                ids.includes(question)
                  ? ids.filter(id => id !== question)
                  : Array.append(ids, question),
            }),
        }),
      }

const saveKeptBack = (model: Model): UpdateReturn =>
  Option.match(grillIdOf(model), {
    onNone: () => ({ model }),
    onSome: grillId => ({
      model,
      commands: [SaveKeptBack({ grillId, questions: model.keptBack })],
    }),
  })

const keepBack = (
  model: Model,
  question: string,
  kept: boolean,
): UpdateReturn =>
  saveKeptBack(
    modifyFields(model, {
      keptBack: ids =>
        kept
          ? Array.dedupe([...ids, question])
          : ids.filter(id => id !== question),
    }),
  )

const refreshPage = (model: Model, snapshot: Snapshot): Model =>
  modifyFields(model, {
    page: () => PageData.Success({ data: snapshot }),
    maybeSaveError: () =>
      model.failedWrites.length > 0 ? model.maybeSaveError : Option.none(),
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

const markRead = (model: Model, ids: ReadonlyArray<string>): UpdateReturn => {
  const readIds = Array.dedupe(Array.appendAll(model.readIds, ids))
  return {
    model: modifyFields(model, { readIds: () => readIds }),
    commands: Option.match(
      Option.all({ grillId: grillIdOf(model), since: model.readSince }),
      {
        onNone: () => [],
        onSome: ({ grillId, since }) => [
          SaveRead({ grillId, since, ids: readIds }),
        ],
      },
    ),
  }
}

/** Opens Talk where an ask was answered: its question unfolded, or the page's own thread. */
const openAnswer = (
  model: Model,
  snapshot: Snapshot,
  stepId: string,
): Model => {
  const grill = snapshot.grill
  if (stepId === RUN_TARGET)
    return modifyFields(model, {
      side: () => 'Talk',
      workspace: value =>
        modifyFields(value, {
          maybeDiscussionTarget: () => Option.some(RUN_TARGET),
        }),
    })
  if (
    isWorkspacePage(model.currentPart) &&
    (stepId.startsWith('part:') || isCardPage(stepId))
  )
    return modifyFields(goTo(model, grill, CONVERSATIONS), {
      workspace: value =>
        modifyFields(value, {
          maybeDiscussionTarget: () => Option.some(stepId),
        }),
    })
  if (stepId.startsWith('part:') || isCardPage(stepId)) {
    const page = stepId.startsWith('part:') ? stepId.slice(5) : stepId
    return modifyFields(goTo(model, grill, page), {
      side: () => 'Talk',
      talkAbout: Record.set(page, 'concept'),
      ...(stepId.startsWith('part:')
        ? { maybeTalkPart: () => Option.some(page) }
        : {}),
    })
  }
  return Option.match(
    Array.findFirst(grill.steps, step => step.id === stepId),
    {
      onNone: () => modifyFields(model, { side: () => 'Talk' }),
      onSome: step => {
        const question = step.question.id
        const page = pageForQuestion(model, snapshot, question)
        const moved = goTo(openQuestion(model, question), grill, page)
        return modifyFields(moved, {
          side: () => 'Talk',
          workspace: value =>
            modifyFields(value, {
              maybeDiscussionTarget: () => Option.some(step.id),
            }),
          whyOpen: Record.set(step.id, true),
          maybeTalkPart: () => Option.some(step.part),
          talkAbout: Record.set(talkKeyOf(page, step.part), question),
        })
      },
    },
  )
}

const openQuestion = (model: Model, question: string): Model =>
  modifyFields(model, { expanded: Record.set(question, true) })

const followQuestion = (
  model: Model,
  snapshot: Snapshot,
  partId: string,
  question: string,
): UpdateReturn => {
  const status = statusOf(
    snapshot.grill,
    model.answers,
    question,
    model.skipped,
  )
  if (
    model.side !== 'Talk' ||
    (status._tag !== 'Open' && status._tag !== 'Waiting') ||
    Array.contains(model.skipped, question)
  ) {
    return { model }
  }
  return Option.match(stepIdOf(snapshot, question), {
    onNone: () => ({ model }),
    onSome: stepId => ({
      model: modifyFields(model, {
        maybeTalkPart: () => Option.some(partId),
        talkAbout: Record.set(talkKeyOf(model.currentPart, partId), question),
        whyOpen: Record.set(stepId, true),
      }),
      commands: [ScrollToWhy({ stepId })],
    }),
  })
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
    CompletedLoadGrill: ({ result, discussion }) => {
      const loaded = settleLoad(model, result)
      const previous = AsyncData.getData(model.page)
      if (
        result._tag === 'Failure' ||
        !discussion?.atBottom ||
        Option.isNone(previous)
      ) {
        return loaded
      }
      const seen = new Set(agentMessagesOf(previous.value).map(item => item.id))
      const next = agentMessagesOf(result.success).find(
        item =>
          item.kind === 'answer' &&
          item.stepId === discussion.target &&
          !seen.has(item.id),
      )
      return next === undefined
        ? loaded
        : {
            model: loaded.model,
            commands: [
              ...(loaded.commands ?? []),
              ScrollDiscussion({
                target: discussion.target,
                maybeMessage: Option.some(next.id),
              }),
            ],
          }
    },

    ClickedWorkspacePage: ({ page }) => {
      const [part, query] = splitPage(page)
      const closed = modifyFields(model, {
        isTrayOpen: () => false,
        inbox: inbox =>
          modifyFields(inbox, {
            isQuickLookOpen: () => false,
            requestUpdate: () => RequestUpdateState.Closed(),
          }),
      })
      return part === model.currentPart
        ? withSnapshot(closed, snapshot => {
            const next = modifyFields(closed, { pageQuery: () => query })
            return {
              model: next,
              commands: pushIfMoved(model, next, snapshot.grill),
            }
          })
        : workspaceNavigate(
            modifyFields(closed, { pageQuery: () => query }),
            part,
          )
    },
    CompletedDetectFixture: ({ isFixture }) => {
      const flagged = modifyFields(model, {
        inbox: inbox => modifyFields(inbox, { isFixture: () => isFixture }),
      })
      return {
        model: Option.match(AsyncData.getData(model.page), {
          onNone: () => flagged,
          onSome: snapshot =>
            isFixture
              ? refreshPage(flagged, withFixtureQuestions(snapshot))
              : flagged,
        }),
      }
    },
    ClickedInboxFacet: ({ facet, value }) =>
      replaceQuery(
        model,
        queryOf(toggleFacet(filtersFrom(model.pageQuery), facet, value)),
      ),
    SelectedInboxGroupBy: ({ groupBy }) =>
      replaceQuery(
        model,
        queryOf({
          ...filtersFrom(model.pageQuery),
          groupBy,
        }),
      ),
    ClickedClearInboxFilters: () =>
      replaceQuery(
        model,
        queryOf({
          ...filtersFrom(model.pageQuery),
          kind: [],
          urgency: [],
          session: [],
        }),
      ),
    ClickedInboxView: ({ query }) => replaceQuery(model, query),
    ClickedSaveInboxView: ({ name }) => ({
      model: modifyFields(model, {
        inbox: inbox =>
          modifyFields(inbox, {
            savedViews: views => [
              ...views.filter(view => view.name !== name),
              { name, query: model.pageQuery },
            ],
          }),
      }),
    }),
    ClickedCopyPageLink: () => ({ model, commands: [CopyPageLink()] }),
    CompletedCopyPageLink: ({ copied }) => ({
      model: modifyFields(model, {
        ownerCopies: copies =>
          Record.set(copies, PAGE_LINK_COPY, copied ? 'Copied' : 'Failed'),
      }),
    }),
    ClickedToggleInboxTask: ({ id }) => ({
      model: modifyFields(model, {
        inbox: inbox =>
          modifyFields(inbox, { expanded: ids => toggled(ids, id) }),
      }),
    }),
    ClickedToggleQuestionLine: ({ group }) => ({
      model: modifyFields(model, {
        inbox: inbox =>
          modifyFields(inbox, {
            openQuestionLines: groups => toggled(groups, group),
          }),
      }),
    }),
    ClickedToggleRecentlyDone: () => ({
      model: modifyFields(model, {
        inbox: inbox => modifyFields(inbox, { isDoneShown: shown => !shown }),
      }),
    }),
    ClickedQuickLook: () => ({
      model: modifyFields(model, {
        isTrayOpen: () => false,
        inbox: inbox => modifyFields(inbox, { isQuickLookOpen: open => !open }),
      }),
    }),
    PressedQuickLookKey: ({ key }) => ({
      model: modifyFields(model, {
        isTrayOpen: open => (key === 'Toggle' ? false : open),
        inbox: inbox =>
          modifyFields(inbox, {
            isQuickLookOpen: open => key === 'Toggle' && !open,
            requestUpdate: state =>
              key === 'Close' ? RequestUpdateState.Closed() : state,
          }),
      }),
    }),
    ClickedRequestUpdate: ({ sessions }) => ({
      model: modifyFields(model, {
        inbox: inbox =>
          modifyFields(inbox, {
            isQuickLookOpen: () => false,
            requestUpdate: state =>
              state._tag === 'Open'
                ? RequestUpdateState.Closed()
                : RequestUpdateState.Open({ scope: ALL_SCOPES, sessions }),
          }),
      }),
    }),
    ClickedUpdateScope: ({ scope }) => ({
      model: modifyFields(model, {
        inbox: inbox =>
          modifyFields(inbox, {
            requestUpdate: state =>
              state._tag === 'Open'
                ? RequestUpdateState.Open({
                    scope: toggled(state.scope, scope),
                    sessions: state.sessions,
                  })
                : state,
          }),
      }),
    }),
    ClickedUpdateSession: ({ session }) => ({
      model: modifyFields(model, {
        inbox: inbox =>
          modifyFields(inbox, {
            requestUpdate: state =>
              state._tag === 'Open'
                ? RequestUpdateState.Open({
                    scope: state.scope,
                    sessions: toggled(state.sessions, session),
                  })
                : state,
          }),
      }),
    }),
    ClickedSendUpdateRequest: ({ ended }) => ({
      model: modifyFields(model, {
        inbox: inbox =>
          inbox.requestUpdate._tag === 'Open'
            ? modifyFields(inbox, {
                requestUpdate: () => RequestUpdateState.Closed(),
                requests: requests => [
                  ...recordRequests(
                    inbox.requestUpdate._tag === 'Open'
                      ? inbox.requestUpdate
                      : { scope: [], sessions: [] },
                    ended,
                    model.now,
                  ),
                  ...requests,
                ],
              })
            : inbox,
      }),
    }),
    ClickedRequestStatus: ({ session, isEnded }) => ({
      model: modifyFields(model, {
        inbox: inbox =>
          modifyFields(inbox, {
            requests: requests => [
              ...recordRequests(
                { scope: ['status'], sessions: [session] },
                isEnded ? [session] : [],
                model.now,
              ),
              ...requests,
            ],
          }),
      }),
    }),
    UpdatedThreadDraft: ({ item, text }) => ({
      model: modifyFields(model, {
        inbox: inbox =>
          modifyFields(inbox, {
            threadDrafts: drafts => Record.set(drafts, item, text),
          }),
      }),
    }),
    SubmittedThreadMessage: ({ item }) => {
      const text = (model.inbox.threadDrafts[item] ?? '').trim()
      return text === ''
        ? { model }
        : {
            model: modifyFields(model, {
              inbox: inbox =>
                modifyFields(inbox, {
                  threadDrafts: drafts => Record.remove(drafts, item),
                  threads: threads =>
                    Record.set(threads, item, [
                      ...(threads[item] ?? []),
                      { from: 'You' as const, text, at: model.now },
                    ]),
                }),
            }),
          }
    },
    ClickedSessions: () => ({
      model: modifyFields(model, {
        side: side => (side === 'Talk' ? 'None' : 'Talk'),
        inbox: inbox => modifyFields(inbox, { isSessionDirectory: () => true }),
      }),
    }),
    ClickedOpenSession: ({ target }) => ({
      model: modifyFields(model, {
        // The Conversations page shows the conversation in its own middle pane.
        side: side => (model.currentPart === CONVERSATIONS ? side : 'Talk'),
        workspace: value =>
          modifyFields(value, {
            maybeDiscussionTarget: () => Option.some(target),
          }),
        inbox: inbox =>
          modifyFields(inbox, { isSessionDirectory: () => false }),
      }),
      commands: [FocusTalkBox()],
    }),
    ClickedSessionsBack: () => ({
      model: modifyFields(model, {
        inbox: inbox => modifyFields(inbox, { isSessionDirectory: () => true }),
      }),
    }),
    UpdatedSessionSearch: ({ value }) => ({
      model: modifyFields(model, {
        inbox: inbox => modifyFields(inbox, { sessionSearch: () => value }),
      }),
    }),
    SelectedSessionGroup: ({ group }) => ({
      model: modifyFields(model, {
        inbox: inbox => modifyFields(inbox, { sessionGroup: () => group }),
      }),
    }),
    SelectedSessionOrder: ({ order }) => ({
      model: modifyFields(model, {
        inbox: inbox => modifyFields(inbox, { sessionOrder: () => order }),
      }),
    }),
    ClickedPinSession: ({ address }) => ({
      model: modifyFields(model, {
        inbox: inbox =>
          modifyFields(inbox, { pinned: pins => toggled(pins, address) }),
      }),
    }),
    ClickedNestedThread: ({ key }) => ({
      model: modifyFields(model, {
        inbox: inbox =>
          modifyFields(inbox, {
            maybeOpenThread: current =>
              Option.contains(current, key) ? Option.none() : Option.some(key),
          }),
      }),
    }),
    ClickedStartSideThread: () => ({
      model: modifyFields(model, {
        inbox: inbox =>
          modifyFields(inbox, { isSidePickerOpen: open => !open }),
      }),
    }),
    ClickedSideThreadWith: ({ key }) => ({
      model: modifyFields(model, {
        inbox: inbox =>
          modifyFields(inbox, {
            isSidePickerOpen: () => false,
            sideThreads: keys => (keys.includes(key) ? keys : [...keys, key]),
            maybeOpenThread: () => Option.some(key),
          }),
      }),
    }),
    ClickedQuestionList: () => ({
      model: modifyFields(model, {
        inbox: inbox =>
          modifyFields(inbox, {
            isQuestionListOpen: open => !open,
          }),
      }),
    }),
    ClickedCopyAndFocus: ({ source, item, revision }): UpdateReturn => {
      const copied: UpdateReturn = update(
        model,
        Message.ClickedCopyOwnerStep({ source, item, revision }),
      )
      const focused: UpdateReturn = update(
        copied.model,
        Message.ClickedOwnerDestination({ source, item, revision }),
      )
      return {
        model: focused.model,
        commands: [...(copied.commands ?? []), ...(focused.commands ?? [])],
      }
    },
    ClickedCopyInboxLine: ({ key, text }) => ({
      model,
      commands: [CopyOwnerStep({ key, text })],
    }),
    ClickedQuestionNote: ({ question }) => ({
      model: modifyFields(model, {
        workspace: value =>
          modifyFields(value, {
            noteOpen: ids =>
              ids.includes(question)
                ? ids.filter(id => id !== question)
                : Array.append(ids, question),
          }),
      }),
    }),
    UpdatedReviewQuery: ({ value }) => ({
      model: modifyFields(model, {
        workspace: workspace =>
          modifyFields(workspace, { reviewQuery: () => value }),
      }),
    }),
    ClickedReviewDetail: ({ question }) => ({
      model: modifyFields(model, {
        workspace: value =>
          modifyFields(value, {
            reviewExpanded: ids =>
              ids.includes(question)
                ? ids.filter(id => id !== question)
                : Array.append(ids, question),
          }),
      }),
    }),
    SelectedWorkSection: ({ section }) => ({
      model: modifyFields(model, {
        workspace: value => modifyFields(value, { workSection: () => section }),
      }),
    }),
    ClickedRefreshCatalog: () => ({
      model: modifyFields(model, {
        workspace: value =>
          modifyFields(value, { catalog: () => CatalogData.Loading() }),
      }),
      commands: [LoadWorkspaceCatalog()],
    }),
    CompletedLoadCatalog: ({ result }) => ({
      model: modifyFields(model, {
        workspace: value =>
          modifyFields(value, {
            catalog: () =>
              result._tag === 'Success'
                ? CatalogData.Success({ data: result.success })
                : CatalogData.Failure({ error: result.failure }),
          }),
      }),
    }),
    // ⌘↵ sends what is in front of the reader: the tray's selection, the question's own
    // draft, or (with neither) opens Review as before.
    PressedWorkspaceShortcut: () =>
      withSnapshot(model, snapshot => {
        if (model.isTrayOpen) {
          return holdSend(model, traySelection(model, snapshot))
        }
        if (model.currentPart === REVIEW) {
          return { model, commands: [ReadSendBoxCommand()] }
        }
        if (!model.currentPart.startsWith(QUESTION_PAGE)) {
          return { model }
        }
        const unsent = unsentSteps(
          snapshot,
          model.answers,
          model.notes,
          model.own,
        )
        return Option.match(questionOnPage(snapshot, model.currentPart), {
          onNone: () => reviewFromQuestion(model),
          onSome: step =>
            unsent.some(item => item.question.id === step.question.id)
              ? holdSend(model, [step.question.id])
              : reviewFromQuestion(model),
        })
      }),
    UpdatedCommandHeld: ({ held }) => ({
      model: modifyFields(model, { isCommandHeld: () => held }),
    }),
    ClickedQuickSend: () =>
      withSnapshot(model, snapshot =>
        model.send === 'Sending' ||
        model.quickSend !== 'Idle' ||
        Option.isSome(model.maybeSaveError)
          ? { model }
          : {
              model: modifyFields(model, { quickSend: () => 'Reading' }),
              commands: [
                ReadQuickSendEditors({
                  questions: snapshot.grill.steps.map(step => step.question.id),
                  message: model.sendMessage,
                }),
              ],
            },
      ),
    CompletedReadQuickSendEditors: ({ own, notes, message }) =>
      model.quickSend !== 'Reading'
        ? { model }
        : continueQuickSend(
            modifyFields(model, {
              quickSend: () => 'Saving',
              own: current =>
                Record.fromEntries([
                  ...Object.entries(current),
                  ...Object.entries(own),
                ]),
              notes: current =>
                Record.fromEntries([
                  ...Object.entries(current),
                  ...Object.entries(notes),
                ]),
              sendMessage: () => message,
            }),
          ),
    FailedReadQuickSendEditors: () => ({
      model: modifyFields(model, {
        quickSend: () => 'Idle',
        send: () => 'Failed',
        sendDetail: () => 'Could not read your drafts. Try again.',
      }),
    }),
    ClickedQuestionArrow: ({ direction }) => navigateQuestion(model, direction),
    PressedQuestionArrow: ({ direction }) => navigateQuestion(model, direction),
    ChangedQuestionFilter: ({ filter }) =>
      saveWorkspacePreferences(
        model,
        modifyFields(model.workspace, {
          filter: () => filter,
        }),
      ),
    ChangedQuestionUrgencyFilter: ({ urgencyFilter }) =>
      saveWorkspacePreferences(
        model,
        modifyFields(model.workspace, {
          urgencyFilter: () => urgencyFilter,
        }),
      ),
    SelectedQuestionView: ({ filter, urgencyFilter }) =>
      saveWorkspacePreferences(
        model,
        modifyFields(model.workspace, {
          filter: () => filter,
          urgencyFilter: () => urgencyFilter,
        }),
      ),
    SelectedQuestionSort: ({ sort }) =>
      saveWorkspacePreferences(
        model,
        modifyFields(model.workspace, { sort: () => sort }),
      ),
    SelectedRoundScopes: ({ rounds }) =>
      withSnapshot(model, snapshot => {
        const selected = Array.dedupe(rounds).filter(round =>
          snapshot.grill.steps.some(
            step => roundOf(snapshot.grill, step.question) === round,
          ),
        )
        return saveWorkspacePreferences(
          model,
          modifyFields(model.workspace, {
            roundScopes: scopes =>
              Array.isReadonlyArrayEmpty(selected)
                ? Record.remove(scopes, snapshot.grill.id)
                : Record.set(scopes, snapshot.grill.id, selected),
            expandedRounds: rounds => Array.dedupe([...rounds, ...selected]),
            foldedRounds: rounds =>
              rounds.filter(round => !selected.includes(round)),
          }),
        )
      }),
    ClickedCustomFilters: () => ({
      model: modifyFields(model, {
        workspace: workspace =>
          modifyFields(workspace, {
            customFilters: value =>
              value === 'Expanded' ? 'Collapsed' : 'Expanded',
          }),
      }),
    }),
    UpdatedQuestionSearch: ({ value }) => ({
      model: modifyFields(model, {
        workspace: workspace =>
          modifyFields(workspace, { search: () => value }),
      }),
    }),
    ChangedQuestionGrouping: ({ grouping }) =>
      saveWorkspacePreferences(
        model,
        modifyFields(model.workspace, {
          grouping: () => grouping,
        }),
      ),
    ClickedAgentGroup: ({ session }) => ({
      model: modifyFields(model, {
        workspace: value =>
          modifyFields(value, {
            foldedAgents: agents =>
              agents.includes(session)
                ? agents.filter(agent => agent !== session)
                : Array.append(agents, session),
          }),
      }),
    }),
    ClickedRenameRound: ({ round }) =>
      withSnapshot(model, snapshot => ({
        model: modifyFields(model, {
          workspace: value =>
            modifyFields(value, {
              maybeEditingRound: () => Option.some(round),
              roundNameDraft: () =>
                snapshot.grill.roundNames?.[String(round)] ?? '',
            }),
        }),
      })),
    UpdatedRoundName: ({ name }) => ({
      model: modifyFields(model, {
        workspace: value => modifyFields(value, { roundNameDraft: () => name }),
      }),
    }),
    CancelledRoundName: () => ({
      model: modifyFields(model, {
        workspace: value =>
          modifyFields(value, { maybeEditingRound: () => Option.none() }),
      }),
    }),
    SubmittedRoundName: ({ round }) =>
      postEvent(
        modifyFields(model, {
          workspace: value =>
            modifyFields(value, { maybeEditingRound: () => Option.none() }),
        }),
        {
          kind: 'renamed-round',
          round,
          name: model.workspace.roundNameDraft.trim(),
        },
      ),
    ClickedQuestionBranch: ({ question }) => ({
      model: modifyFields(model, {
        workspace: value =>
          modifyFields(value, {
            foldedQuestions: questions =>
              questions.includes(question)
                ? questions.filter(id => id !== question)
                : Array.append(questions, question),
          }),
      }),
    }),
    ClickedRound: ({ round }) =>
      withSnapshot(model, snapshot => {
        const collapsed = roundIsCollapsed(
          model.workspace,
          snapshot,
          round,
          model.answers,
          model.notes,
          model.own,
        )
        return {
          model: modifyFields(model, {
            workspace: value =>
              modifyFields(value, {
                foldedRounds: rounds =>
                  collapsed
                    ? rounds.filter(item => item !== round)
                    : Array.append(rounds, round),
                expandedRounds: rounds =>
                  collapsed
                    ? Array.append(rounds, round)
                    : rounds.filter(item => item !== round),
              }),
          }),
        }
      }),
    ClickedSettings: () => ({
      model: modifyFields(model, {
        workspace: value => modifyFields(value, { isSettingsOpen: () => true }),
      }),
      commands: [OpenWorkspaceSettings(), RestoreBrowserNotices()],
    }),
    ClickedEnableBrowserNotices: () =>
      model.browserNotices.asking || !model.browserNotices.ready
        ? { model }
        : {
            model: modifyFields(model, {
              browserNotices: state =>
                modifyFields(state, { asking: () => true }),
            }),
            commands: [EnableBrowserNotices()],
          },
    ClickedDisableBrowserNotices: () => ({
      model: modifyFields(model, {
        browserNotices: state =>
          modifyFields(state, { enabled: () => false, primed: () => false }),
      }),
      commands: [DisableBrowserNotices({ failed: false })],
    }),
    CompletedRestoreBrowserNotices: ({ result }) =>
      scheduleBrowserNotices({
        model: modifyFields(model, {
          browserNotices: state =>
            modifyFields(state, {
              enabled: () => result.enabled,
              status: () => result.status,
              ready: () => true,
              primed: () =>
                state.enabled && result.enabled ? state.primed : false,
            }),
        }),
      }),
    CompletedEnableBrowserNotices: ({ result }) =>
      scheduleBrowserNotices({
        model: modifyFields(model, {
          browserNotices: state =>
            modifyFields(state, {
              enabled: () => result.enabled,
              status: () => result.status,
              ready: () => true,
              asking: () => false,
              primed: () => false,
            }),
        }),
      }),
    CompletedDisableBrowserNotices: ({ result, failed }) => ({
      model: modifyFields(model, {
        browserNotices: state =>
          modifyFields(state, {
            enabled: () => false,
            status: () => (failed ? 'Failed' : result.status),
            primed: () => false,
          }),
      }),
    }),
    CompletedSyncBrowserNotices: ({ result }) => ({
      model: modifyFields(model, {
        browserNotices: state =>
          modifyFields(state, {
            enabled: () => state.enabled && result.enabled,
            status: () => result.status,
            pending: () => false,
            primed: () => true,
          }),
      }),
    }),
    BrowserNoticePreferencesChanged: () => ({
      model,
      commands: [RestoreBrowserNotices()],
    }),
    BrowserNoticeDeliveryFailed: () => ({
      model: modifyFields(model, {
        browserNotices: state =>
          modifyFields(state, {
            enabled: () => false,
            status: () => 'Failed',
          }),
      }),
      commands: [DisableBrowserNotices({ failed: true })],
    }),
    RequestedBrowserNoticeNavigation: ({ href }) => ({
      model,
      ...(noticeHref(href) ? { commands: [OpenBrowserNotice({ href })] } : {}),
    }),
    CompletedOpenBrowserNotice: () => ({ model }),
    ClosedSettings: () => ({
      model: modifyFields(model, {
        workspace: value =>
          modifyFields(value, { isSettingsOpen: () => false }),
      }),
      commands: [CloseWorkspaceSettings()],
    }),
    ChangedHighlights: () => saveWorkspaceSetting(model, 'highlightTerms'),
    ChangedCollapseSentRounds: () =>
      saveWorkspaceSetting(model, 'collapseSentRounds'),
    RestoredWorkspaceSettings: ({
      filter,
      urgencyFilter,
      highlightTerms,
      collapseSentRounds,
      roundScopes,
      sort,
      activityRead,
      navigation,
    }) => {
      const restored: Model = modifyFields(model, {
        workspace: value =>
          modifyFields(value, {
            filter: () => filter,
            urgencyFilter: () => urgencyFilter,
            grouping: () => 'Round',
            sort: () => sort ?? 'Round',
            roundScopes: () => roundScopesFrom(roundScopes),
            activityRead: () => activityReadFrom(activityRead),
            scopeRestoration: () =>
              navigation === 'Reload' ? 'Preserve' : 'Reveal',
            highlightTerms: () => highlightTerms,
            collapseSentRounds: () => collapseSentRounds,
          }),
      })
      return withSnapshot(restored, snapshot => ({
        model: modifyFields(restored, {
          workspace: workspace =>
            navigation === 'Reload'
              ? workspace
              : Option.match(questionOnPage(snapshot, model.currentPart), {
                  onNone: () => workspace,
                  onSome: step =>
                    revealQuestion(
                      workspace,
                      snapshot,
                      model.answers,
                      model.notes,
                      model.own,
                      step.question.id,
                    ),
                }),
        }),
        ...(model.channelReveal._tag !== 'None'
          ? {}
          : { commands: [ScrollToTop()] }),
      }))
    },
    CompletedSaveWorkspaceSettings: () => ({ model }),
    CompletedRevealChannelItem: ({ id }) => ({
      model:
        model.channelReveal._tag === 'Pending' && model.channelReveal.id === id
          ? modifyFields(model, {
              channelReveal: () => ChannelReveal.Completed({ id }),
            })
          : model,
    }),
    SelectedActivityFilter: ({ filter }) => ({
      model: modifyFields(model, {
        workspace: workspace =>
          modifyFields(workspace, { activityFilter: () => filter }),
      }),
    }),
    ClickedMarkActivitySeen: () =>
      withSnapshot(model, snapshot => {
        if (snapshot.activity === undefined) {
          return { model }
        }
        const next = modifyFields(model, {
          workspace: workspace =>
            modifyFields(workspace, {
              activityRead: read =>
                Object.fromEntries(
                  [
                    ...new Set(
                      Object.keys(read).concat(
                        Object.keys(snapshot.activity?.highWater ?? {}),
                      ),
                    ),
                  ].map(source => [
                    source,
                    Math.max(
                      activityCursorOf(read, source),
                      activityCursorOf(
                        snapshot.activity?.highWater ?? {},
                        source,
                      ),
                    ),
                  ]),
                ),
            }),
        })
        return {
          model: next,
          commands: [
            SaveWorkspaceSettings({ settings: JSON.stringify(next.workspace) }),
          ],
        }
      }),
    RestoredDiscussionState: ({ state }) => ({
      model: modifyFields(model, {
        side: side => (state.open ? 'Talk' : side),
        workspace: value =>
          modifyFields(value, {
            discussionRestored: () => true,
            isDiscussionExpanded: () => state.expanded,
            maybeDiscussionTarget: () =>
              state.target === '' ? Option.none() : Option.some(state.target),
            discussionScroll: () => state.scroll,
          }),
      }),
    }),
    ChangedDiscussionState: ({ grillId, state }) => ({
      model,
      commands: [SaveDiscussionState({ grillId, json: JSON.stringify(state) })],
    }),
    CompletedSaveDiscussionState: () => ({ model }),
    CompletedRestoreDiscussionScroll: () => ({ model }),
    CompletedRestoreDiscussionPosition: () => ({ model }),
    ScrolledDiscussion: ({ target, top }) => ({
      model: modifyFields(model, {
        workspace: value =>
          modifyFields(value, { discussionScroll: Record.set(target, top) }),
      }),
    }),

    ClickedDiscussion: ({ target }) => ({
      model: modifyFields(model, {
        side: () => 'Talk',
        inbox: inbox =>
          modifyFields(inbox, { isSessionDirectory: () => false }),
        workspace: value =>
          modifyFields(value, {
            maybeDiscussionTarget: () => Option.some(target),
          }),
      }),
      commands: [FocusTalkBox()],
    }),
    ClickedCloseDiscussion: () => ({
      model: modifyFields(model, { side: () => 'None' }),
    }),
    ClickedReturnConversation: ({ open }) =>
      withSnapshot(model, snapshot => {
        const step = snapshot.grill.steps.find(item =>
          Option.contains(model.workspace.maybeDiscussionTarget, item.id),
        )
        const page =
          step === undefined
            ? Option.getOrElse(
                Option.filter(
                  model.maybePrevious,
                  value => value !== CONVERSATIONS,
                ),
                () => OVERVIEW,
              )
            : `${QUESTION_PAGE}${step.question.id}`
        const moved = workspaceNavigate(model, page)
        return {
          model: modifyFields(moved.model, {
            side: () => (open ? 'Talk' : 'None'),
            workspace: value =>
              modifyFields(value, { isDiscussionExpanded: () => false }),
          }),
          commands: moved.commands ?? [],
        }
      }),
    ClickedExpandDiscussion: () => ({
      model: modifyFields(model, {
        workspace: value =>
          modifyFields(value, {
            isDiscussionExpanded: current => !current,
          }),
      }),
    }),
    SelectedDiscussionTarget: ({ target }) => ({
      model: modifyFields(model, {
        workspace: value =>
          modifyFields(value, {
            maybeDiscussionTarget: () => Option.some(target),
          }),
      }),
      commands: [
        RestoreDiscussionPosition({
          top: model.workspace.discussionScroll[target] ?? 0,
        }),
        FocusTalkBox(),
      ],
    }),
    // Starters send on click; the reply lands in the question's conversation.
    ClickedConversationStarter: ({ target, text }) =>
      postEvent(model, { kind: 'asked', stepId: target, text }),
    SelectedQuoteText: ({ quoted }) =>
      model.workspace.quote._tag === 'Composing'
        ? { model }
        : {
            model: withQuoteSelection(
              model,
              QuoteSelection.Offered({ quoted }),
            ),
          },
    ClearedQuoteSelection: () =>
      model.workspace.quote._tag === 'Offered'
        ? { model: withQuoteSelection(model, QuoteSelection.Idle()) }
        : { model },
    DismissedQuote: () => ({
      model: modifyFields(withQuoteSelection(model, QuoteSelection.Idle()), {
        talkDrafts: Record.remove(QUOTE_DRAFT),
      }),
    }),
    ClickedQuoteReply: () =>
      model.workspace.quote._tag === 'Offered'
        ? {
            model: withQuoteSelection(
              model,
              QuoteSelection.Composing({
                quoted: model.workspace.quote.quoted,
              }),
            ),
            commands: [FocusQuoteBox()],
          }
        : { model },
    ClickedQuoteInDiscussion: () =>
      Option.match(quotedTextOf(model.workspace.quote), {
        onNone: () => ({ model }),
        onSome: quoted => {
          const target = quoteTargetOf(model, quoted)
          return {
            model: modifyFields(
              openDiscussionOn(
                withQuoteSelection(model, QuoteSelection.Idle()),
                target,
              ),
              {
                talkDrafts: drafts =>
                  Record.set(
                    drafts,
                    threadDraftKey(target),
                    withQuote(
                      drafts[threadDraftKey(target)] ?? '',
                      quoted.text,
                    ),
                  ),
              },
            ),
            commands: [FocusDraftBox({ key: threadDraftKey(target) })],
          }
        },
      }),
    SubmittedQuoteReply: () => ({ model, commands: [ReadQuoteBox()] }),
    CompletedReadQuoteBox: ({ text }) =>
      Option.match(quotedTextOf(model.workspace.quote), {
        onNone: () => ({ model }),
        onSome: quoted => {
          const ask = quotedAsk(quoted.text, text)
          if (text.trim() === '' || isOverTextLimit(ask)) {
            return { model }
          }
          const target = quoteTargetOf(model, quoted)
          return postEvent(
            modifyFields(
              openDiscussionOn(
                withQuoteSelection(model, QuoteSelection.Idle()),
                target,
              ),
              { talkDrafts: Record.remove(QUOTE_DRAFT) },
            ),
            {
              kind: 'asked',
              stepId: target,
              text: ask,
            },
          )
        },
      }),
    ClickedRedeliverAsk: ({ askId, stepId, route }) =>
      postEvent(model, { kind: 'redelivered', askId, stepId, route }),
    SubmittedWorkspaceDiscussion: ({ target }) => ({
      model,
      commands: [ReadWorkspaceDiscussionBox({ target })],
    }),
    ReadWorkspaceDiscussion: ({ target, text }) => {
      if (text.trim() === '' || isOverTextLimit(text.trim())) {
        return { model }
      }
      const posted = postEvent(
        modifyFields(model, {
          talkDrafts: Record.remove(threadDraftKey(target)),
          talkGeneration: count => count + 1,
        }),
        { kind: 'asked', stepId: target, text: text.trim() },
      )
      return {
        model: posted.model,
        commands: [...(posted.commands ?? []), FocusTalkBox()],
      }
    },
    ToggledReviewAnswer: ({ question }) => toggleReview(model, question),
    ClickedSelectReview: ({ selected }) =>
      withSnapshot(model, snapshot => {
        const chosen = modifyFields(model, {
          workspace: value =>
            modifyFields(value, {
              excluded: () =>
                selected
                  ? []
                  : draftAnswerIds(
                      snapshot,
                      model.answers,
                      model.notes,
                      model.own,
                    ),
            }),
        })
        return selected && Array.isReadonlyArrayNonEmpty(model.keptBack)
          ? saveKeptBack(modifyFields(chosen, { keptBack: () => [] }))
          : { model: chosen }
      }),

    ClickedSendQuestions: ({ questions }) => {
      const real = questions.filter(id => !isFixtureQuestion(id))
      return Array.isReadonlyArrayEmpty(real)
        ? {
            model: modifyFields(model, {
              maybeSaveError: () =>
                Option.some(
                  'Sample questions stay in this browser; the preview does not send them.',
                ),
            }),
          }
        : holdSend(model, real)
    },
    TickedHeldSend: () =>
      Option.match(model.maybeHeldSend, {
        onNone: () => ({ model }),
        onSome: held =>
          held.left > 1
            ? {
                model: modifyFields(model, {
                  maybeHeldSend: () =>
                    Option.some({ ...held, left: held.left - 1 }),
                }),
              }
            : held.left === 1
              ? releaseHeldSend(model)
              : { model },
      }),
    ClickedUndoSend: () => ({
      model: modifyFields(model, { maybeHeldSend: () => Option.none() }),
    }),
    ClickedSendHeldNow: () => releaseHeldSend(model),
    PressedRoundSendShortcut: () =>
      withSnapshot(model, snapshot =>
        Option.match(questionOnPage(snapshot, model.currentPart), {
          onNone: () => ({ model }),
          onSome: step =>
            holdSend(
              model,
              roundSteps(
                snapshot.grill,
                readyOf(model, snapshot),
                roundOf(snapshot.grill, step.question),
              ).map(item => item.question.id),
            ),
        }),
      ),
    ClickedUnsentTray: () => ({
      model: modifyFields(model, {
        isTrayOpen: open => !open,
        trayCursor: () => 0,
        isNudging: () => false,
      }),
    }),
    PressedTrayKey: ({ key }) =>
      withSnapshot(model, snapshot => {
        const order = trayOrder(snapshot.grill, readyOf(model, snapshot))
        const current = Option.map(
          Array.get(order, model.trayCursor),
          step => step.question.id,
        )
        const clamp = (cursor: number) =>
          Math.max(0, Math.min(order.length - 1, cursor))
        switch (key) {
          case 'Up':
          case 'Down':
            return {
              model: modifyFields(model, {
                trayCursor: cursor => clamp(cursor + (key === 'Up' ? -1 : 1)),
              }),
            }
          case 'Toggle':
            return Option.match(current, {
              onNone: () => ({ model }),
              onSome: question => toggleReview(model, question),
            })
          case 'Keep':
            return Option.match(current, {
              onNone: () => ({ model }),
              onSome: question => {
                const kept = keepBack(model, question, true)
                return {
                  ...kept,
                  model: modifyFields(kept.model, {
                    trayCursor: cursor =>
                      Math.max(0, Math.min(order.length - 2, cursor)),
                  }),
                }
              },
            })
          case 'Send':
            return holdSend(model, traySelection(model, snapshot))
          case 'Close':
            return {
              model: modifyFields(model, { isTrayOpen: () => false }),
            }
        }
      }),
    ClickedKeepBack: ({ question, kept }) => keepBack(model, question, kept),
    RestoredKeptBack: ({ questions }) => ({
      model: modifyFields(model, { keptBack: () => questions }),
    }),
    CompletedSaveKeptBack: () => ({ model }),
    ElapsedAnswerIdle: ({ activity }) =>
      withSnapshot(model, snapshot => ({
        model: modifyFields(model, {
          isNudging: nudging =>
            nudging ||
            (activity === model.answerActivity &&
              !model.isTrayOpen &&
              Option.isNone(model.maybeHeldSend) &&
              Array.isReadonlyArrayNonEmpty(readyOf(model, snapshot))),
        }),
      })),
    ClickedNotYet: () => ({
      model: modifyFields(model, { isNudging: () => false }),
    }),
    ClickedLeaveLink: ({ href }) => ({
      model: modifyFields(model, {
        maybeLeaving: () => Option.some({ href, isSending: false }),
        isTrayOpen: () => false,
      }),
    }),
    ClickedStay: () => ({
      model: modifyFields(model, { maybeLeaving: () => Option.none() }),
    }),
    ClickedLeave: () =>
      Option.match(model.maybeLeaving, {
        onNone: () => ({ model }),
        onSome: ({ href }) => ({ model, commands: [LeavePage({ href })] }),
      }),
    // Leaving ends the undo window, so these go at once rather than after a hold.
    ClickedSendAndLeave: () =>
      withSnapshot(model, snapshot =>
        Option.match(model.maybeLeaving, {
          onNone: () => ({ model }),
          onSome: leaving =>
            releaseHeldSend(
              modifyFields(model, {
                maybeLeaving: () =>
                  Option.some({ ...leaving, isSending: true }),
                maybeHeldSend: () =>
                  Option.some({
                    questions: Array.dedupe([
                      ...Option.match(model.maybeHeldSend, {
                        onNone: () => [],
                        onSome: held => held.questions,
                      }),
                      ...readyOf(model, snapshot).map(step => step.question.id),
                    ]),
                    left: 0,
                  }),
              }),
            ),
        }),
      ),
    CompletedLeavePage: () => ({ model }),
    WarnedBeforeUnload: () => ({ model }),

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
                        talkDrafts: model.talkDrafts,
                        notes: model.notes,
                        own: model.own,
                        skipped: model.skipped,
                        expanded: model.expanded,
                        currentPart: model.currentPart,
                        sendMessage: model.sendMessage,
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
      sendMessage,
    }) => ({
      model: modifyFields(model, {
        sendMessage: current => (current === '' ? sendMessage : current),
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

    BlurredOwnAnswer: ({ question }) => ({
      model,
      commands: [ReadOwnBox({ question })],
    }),

    CompletedReadOwnBox: ({ question, maybeText }) => {
      const text = Option.getOrElse(maybeText, () =>
        Option.getOrElse(Record.get(model.own, question), () => ''),
      )
      const read = modifyFields(model, { own: Record.set(question, text) })
      return Option.exists(
        Record.get(model.answers, question),
        key => key === OWN,
      )
        ? postEvent(read, { kind: 'answered', question, key: OWN, text })
        : { model: read }
    },

    ClickedClearAnswer: ({ question }) => unpicked(model, question),

    UpdatedNote: ({ question, value }) => ({
      model: modifyFields(model, { notes: Record.set(question, value) }),
    }),

    BlurredNote: ({ question }) => ({
      model,
      commands: [ReadNoteBox({ question })],
    }),

    CompletedReadNoteBox: ({ question, maybeText }) => {
      const text = Option.getOrElse(maybeText, () =>
        Option.getOrElse(Record.get(model.notes, question), () => ''),
      )
      return postEvent(
        modifyFields(model, { notes: Record.set(question, text) }),
        { kind: 'noted', question, text },
      )
    },

    CompletedPostEvent: ({ result, body }) => {
      const written = Update.combine(model, [
        stepModel => settleWrite(stepModel, result, body),
        continueQuickSend,
      ])
      if (result._tag === 'Failure' || body === undefined) {
        return written
      }
      const ask = Schema.decodeUnknownResult(
        Schema.Struct({
          kind: Schema.Literal('asked'),
          stepId: Schema.String,
        }),
      )(JSON.parse(body))
      return ask._tag === 'Failure'
        ? written
        : {
            model: written.model,
            commands: [
              ...(written.commands ?? []),
              ScrollDiscussion({
                target: ask.success.stepId,
                maybeMessage: Option.none(),
              }),
            ],
          }
    },
    ClickedRetrySaves: () =>
      Option.match(grillIdOf(model), {
        onNone: () => ({ model }),
        onSome: grillId =>
          model.pendingEvents > 0
            ? { model }
            : {
                model: modifyFields(model, {
                  pendingEvents: count => count + model.failedWrites.length,
                }),
                commands: model.failedWrites.map(body =>
                  PostEvent({ grillId, body }),
                ),
              },
      }),

    ClickedSend: () =>
      isWorkspacePage(model.currentPart)
        ? workspaceNavigate(model, REVIEW)
        : {
            model: modifyFields(model, { isSendOpen: () => true }),
            commands: [FocusSendBox()],
          },

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

    ReadSendBox: ({ text }) => sendDraftAnswers(model, text),

    CompletedFillBox: () => ({ model }),
    CompletedClearSendBox: () => ({ model }),
    PastedText: ({ text }) => ({
      model,
      commands: [InsertPastedText({ text })],
    }),
    CompletedInsertPastedText: () => ({ model }),

    ScrolledToAbout: ({ partId, about }) =>
      about === 'concept'
        ? {
            model: modifyFields(model, {
              talkAbout: Record.set(partId, about),
            }),
          }
        : withSnapshot(model, snapshot =>
            followQuestion(model, snapshot, partId, about),
          ),

    ScrolledToQuestion: ({ question }) =>
      withSnapshot(model, snapshot =>
        Option.match(partOf(snapshot, question), {
          onNone: () => ({ model }),
          onSome: partId => followQuestion(model, snapshot, partId, question),
        }),
      ),

    CompletedSendAnswers: ({ result }) => {
      if (result._tag === 'Failure') {
        return afterSend(
          modifyFields(model, {
            send: () => 'Failed' as const,
            sendDetail: () => result.failure,
            maybeSendSubset: () => Option.none(),
          }),
          false,
        )
      }
      const isSent = latestSendState(result.success) === 'Sent'
      // A one-click send leaves the Review message for a later Review send.
      const clearsMessage = isSent && Option.isNone(model.maybeSendSubset)
      const settled = modifyFields(refreshPage(model, result.success), {
        send: () => latestSendState(result.success),
        sendDetail: () => latestSendDetail(result.success),
        isSendOpen: () => !isWorkspacePage(model.currentPart) && !isSent,
        sendMessage: message => (clearsMessage ? '' : message),
        maybeSendSubset: () => Option.none(),
      })
      const next = afterSend(settled, isSent)
      return clearsMessage
        ? { ...next, commands: [ClearSendBox(), ...(next.commands ?? [])] }
        : next
    },

    ClickedDrawing: ({ question }) =>
      withSnapshot(model, snapshot => {
        const revision = snapshot.questionRevisions?.[question]
        const key = drawingAttemptKey(snapshot.grill.id, question)
        const drawing = snapshot.drawings?.find(
          entry => entry.displayQuestion === question,
        )
        if (
          revision === undefined ||
          model.drawingAttempts[key]?._tag === 'Requesting' ||
          (drawing !== undefined &&
            drawing.response === undefined &&
            !drawing.stale &&
            drawing.delivery !== 'failed')
        ) {
          return { model }
        }
        const previous = drawing?.request ?? 0
        return {
          model: modifyFields(model, {
            drawingAttempts: attempts =>
              Record.set(
                attempts,
                key,
                DrawingAttempt.Requesting({ previous }),
              ),
          }),
          commands: [
            RequestDrawing({
              grillId: snapshot.grill.id,
              question,
              contextRevision: revision,
              previous,
            }),
          ],
        }
      }),
    CompletedRequestDrawing: ({ grillId, question, previous, result }) => {
      if (
        !AsyncData.hasData(model.page) ||
        Option.getOrThrow(AsyncData.getData(model.page)).grill.id !== grillId
      ) {
        return { model }
      }
      const loaded = settleLoad(model, result)
      const key = drawingAttemptKey(grillId, question)
      return {
        model: modifyFields(loaded.model, {
          drawingAttempts: attempts =>
            result._tag === 'Success'
              ? Record.remove(attempts, key)
              : Record.set(
                  attempts,
                  key,
                  DrawingAttempt.Failed({ previous, error: result.failure }),
                ),
        }),
      }
    },
    ClickedVeto: ({ source, item, revision }) =>
      withSnapshot(model, snapshot => {
        const key = channelItemKey(source, item, revision)
        const decision = snapshot.decisions?.find(
          entry =>
            entry.source === source &&
            entry.item.id === item &&
            entry.item.revision === revision,
        )
        if (
          model.vetoAttempts[key]?._tag === 'Sending' ||
          decision === undefined ||
          decision.item.resolution.state !== 'provisional' ||
          decision.vetoes.some(receipt => receipt.revision === revision)
        ) {
          return { model }
        }
        return {
          model: modifyFields(model, {
            vetoAttempts: attempts =>
              Record.set(attempts, key, VetoAttemptState.Sending()),
          }),
          commands: [
            PostVeto({ grillId: snapshot.grill.id, source, item, revision }),
          ],
        }
      }),
    CompletedPostVeto: ({ source, item, revision, result }) => {
      const key = channelItemKey(source, item, revision)
      const loaded = settleLoad(model, result)
      return {
        model: modifyFields(loaded.model, {
          vetoAttempts: attempts =>
            result._tag === 'Success'
              ? Record.remove(attempts, key)
              : Record.set(
                  attempts,
                  key,
                  VetoAttemptState.Failed({ error: result.failure }),
                ),
        }),
      }
    },
    ClickedOwnerDestination: ({ source, item, revision }) =>
      withSnapshot(model, snapshot => {
        const step = snapshot.ownerSteps?.find(
          entry =>
            entry.source === source &&
            entry.item.id === item &&
            entry.item.revision === revision,
        )
        const key = channelItemKey(source, item, revision)
        if (
          step === undefined ||
          typeof step.item.destination === 'string' ||
          model.ownerDestinations[key]?._tag === 'Opening'
        ) {
          return { model }
        }
        return {
          model: modifyFields(model, {
            ownerDestinations: destinations =>
              Record.set(destinations, key, OwnerDestinationState.Opening()),
          }),
          commands: [
            OpenOwnerDestination({
              grillId: snapshot.grill.id,
              source,
              item,
              revision,
              key,
            }),
          ],
        }
      }),
    CompletedOpenOwnerDestination: ({ key, result }) => ({
      model: modifyFields(model, {
        ownerDestinations: destinations =>
          Record.set(
            destinations,
            key,
            result._tag === 'Success'
              ? OwnerDestinationState.Opened()
              : OwnerDestinationState.Failed({ error: result.failure }),
          ),
      }),
    }),
    ClickedCopyOwnerStep: ({ source, item, revision }) =>
      withSnapshot(model, snapshot => {
        const step = snapshot.ownerSteps?.find(
          entry =>
            entry.source === source &&
            entry.item.id === item &&
            entry.item.revision === revision,
        )
        return step === undefined
          ? { model }
          : {
              model,
              commands: [
                CopyOwnerStep({
                  key: channelItemKey(source, item, revision),
                  text: step.item.action,
                }),
              ],
            }
      }),
    CompletedCopyOwnerStep: ({ key, copied }) => ({
      model: modifyFields(model, {
        ownerCopies: copies =>
          Record.set(copies, key, copied ? 'Copied' : 'Failed'),
      }),
    }),
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

    ClickedQuestionKey: ({ key }) => ({
      model,
      commands: [CopyQuestionKey({ key })],
    }),
    CompletedCopyQuestionKey: ({ key, copied }) => ({
      model: modifyFields(model, {
        keyCopies: copies =>
          Record.set(copies, key, copied ? 'Copied' : 'Failed'),
      }),
    }),

    CompletedCopyReply: ({ copied }) => ({
      model: modifyFields(model, {
        copy: () => (copied ? 'Copied' : 'Failed') as CopyState,
      }),
    }),

    ClickedDiagramState: ({ diagram, state }) => ({
      model: modifyFields(model, {
        diagramViews: Record.set(diagram, DiagramView.Chosen({ state })),
      }),
    }),
    HoveredDiagramParagraph: ({ diagram, title }) => ({
      model: modifyFields(model, {
        diagramViews: Record.set(diagram, DiagramView.Following({ title })),
      }),
    }),
    ScrolledPinnedDiagram: ({ diagram, title }) => ({
      model: modifyFields(model, {
        diagramViews: Record.set(diagram, DiagramView.Following({ title })),
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
          model: modifyFields(openQuestion(folded, question), {
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
        const query = queryFromSearch(url.search)
        return page === '' || page === model.currentPart
          ? { model: modifyFields(model, { pageQuery: () => query }) }
          : {
              model: modifyFields(goTo(model, snapshot.grill, page), {
                pageQuery: () => query,
                maybeJustAnswered: () => Option.none(),
                workspace: value =>
                  modifyFields(
                    Option.match(questionOnPage(snapshot, page), {
                      onNone: () => value,
                      onSome: step =>
                        revealQuestion(
                          value,
                          snapshot,
                          model.answers,
                          model.notes,
                          model.own,
                          step.question.id,
                        ),
                    }),
                    {
                      maybeDiscussionTarget: () =>
                        Option.map(
                          questionOnPage(snapshot, page),
                          step => step.id,
                        ),
                    },
                  ),
              }),
              commands: [ScrollToTop()],
            }
      }),

    // Local IDs need server resolution even when they resemble shared Q numbers (ADR 0012).
    RequestedUrl: ({ request }) =>
      withSnapshot(model, snapshot =>
        request._tag === 'Internal' &&
        !new URL(Url.toString(request.url)).searchParams.has('source') &&
        Option.isNone(revealAnchorFrom(request.url.hash)) &&
        (request.url.pathname ===
          `/g/${encodeURIComponent(snapshot.grill.id)}` ||
          request.url.pathname.startsWith(
            `/g/${encodeURIComponent(snapshot.grill.id)}/`,
          ))
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

    // Talk's reasoning for the question folds with it; ClickedToggleWhy mirrors the other way.
    ClickedToggleQuestion: ({ question, open }) =>
      withSnapshot(model, snapshot => {
        const toggled = modifyFields(
          open
            ? openQuestion(model, question)
            : modifyFields(forgetAbout(model, [question]), {
                expanded: Record.set(question, false),
              }),
          { maybeJustAnswered: () => Option.none() },
        )
        return {
          model: Option.match(stepIdOf(snapshot, question), {
            onNone: () => toggled,
            onSome: stepId =>
              modifyFields(toggled, { whyOpen: Record.set(stepId, open) }),
          }),
        }
      }),

    ClickedPeek: ({ key }) => ({
      model: modifyFields(model, {
        peeks: peeks =>
          Array.contains(peeks, key)
            ? Array.filter(peeks, k => k !== key)
            : Array.append(peeks, key),
      }),
    }),

    ClickedSkip: ({ question }) =>
      isWorkspacePage(model.currentPart)
        ? withSnapshot(model, snapshot => {
            const skipped = modifyFields(model, {
              skipped: ids => Array.dedupe(Array.append(ids, question)),
            })
            return Option.match(
              adjacentQuestion(
                skipped.workspace,
                snapshot,
                skipped.answers,
                skipped.notes,
                skipped.own,
                skipped.currentPart,
                'Next',
              ),
              {
                onNone: () => ({ model: skipped }),
                onSome: step =>
                  workspaceNavigate(
                    skipped,
                    `${QUESTION_PAGE}${step.question.id}`,
                  ),
              },
            )
          })
        : withSnapshot(model, snapshot => {
            const skipped = Array.dedupe(Array.append(model.skipped, question))
            const partId = Option.getOrElse(
              partOf(snapshot, question),
              () => '',
            )
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
                  model: openQuestion(skippedModel, next),
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

    TickedClock: ({ now }) => ({
      model: modifyFields(model, { now: () => now }),
    }),

    ClickedToggleConceptMap: () => ({
      model: modifyFields(model, { isConceptMapOpen: open => !open }),
    }),

    ClickedToggleNavSection: ({ mode }) => {
      const folded = Array.contains(model.navFolded, mode)
        ? Array.filter(model.navFolded, other => other !== mode)
        : Array.append(model.navFolded, mode)
      return {
        model: modifyFields(model, { navFolded: () => folded }),
        commands: [SaveNavFolded({ folded })],
      }
    },

    RestoredNavFolded: ({ folded }) => ({
      model: modifyFields(model, { navFolded: () => folded }),
    }),

    CompletedSaveNavFolded: () => ({ model }),

    PressedResizeHandle: ({ edge }) => ({
      model: modifyFields(model, { maybeResizing: () => Option.some(edge) }),
    }),

    MovedResizePointer: ({ edge, width }) => ({
      model: withSidebarWidth(model, edge, Option.some(width)),
    }),

    ReleasedResizeHandle: () => {
      const released = modifyFields(model, {
        maybeResizing: () => Option.none(),
      })
      return { model: released, commands: [saveSidebarWidths(released)] }
    },

    PressedResizeKey: ({ edge, step }) => ({
      model,
      commands: [MeasureSidebar({ edge, step })],
    }),

    CompletedMeasureSidebar: ({ edge, maybeWidth, step }) =>
      Option.match(maybeWidth, {
        onNone: () => ({ model }),
        onSome: width => {
          const resized = withSidebarWidth(
            model,
            edge,
            Option.some(width + step),
          )
          return { model: resized, commands: [saveSidebarWidths(resized)] }
        },
      }),

    DoubleClickedResizeHandle: ({ edge }) => {
      const reset = withSidebarWidth(model, edge, Option.none())
      return { model: reset, commands: [saveSidebarWidths(reset)] }
    },

    RestoredSidebarWidths: ({ maybeNav, maybeSide }) => ({
      model: withSidebarWidth(
        withSidebarWidth(model, 'Nav', maybeNav),
        'Side',
        maybeSide,
      ),
    }),

    CompletedSaveSidebarWidths: () => ({ model }),

    RestoredRead: ({ maybeSince, ids }) =>
      withSnapshot(model, snapshot => {
        // A first visit counts everything already said as read, so old answers don't pop up.
        const since = Option.getOrElse(maybeSince, () =>
          Array.reduce(agentMessagesOf(snapshot), 0, (latest, message) =>
            Math.max(latest, message.at),
          ),
        )
        return {
          model: modifyFields(model, {
            readSince: () => Option.some(since),
            readIds: () => ids,
          }),
          commands: Option.isNone(maybeSince)
            ? [SaveRead({ grillId: snapshot.grill.id, since, ids })]
            : [],
        }
      }),

    CompletedSaveRead: () => ({ model }),

    DismissedAgentMessage: ({ id }) => markRead(model, [id]),

    EndedToastCountdown: ({ id }) => ({
      model: modifyFields(model, {
        hiddenToastIds: ids => (ids.includes(id) ? ids : Array.append(ids, id)),
      }),
    }),

    ClickedNotificationTray: () => {
      const reopening = Array.isReadonlyArrayEmpty(visibleToastsOf(model))
      return {
        model: modifyFields(model, {
          notificationTray: () => (reopening ? 'Expanded' : 'Collapsed'),
          hiddenToastIds: ids => (reopening ? [] : ids),
        }),
      }
    },

    ClickedCloseAgentLine: ({ id }) => {
      const read = markRead(model, [id])
      return {
        model: modifyFields(read.model, {
          maybeClosedLine: () => Option.some(id),
        }),
        commands: [
          ...(read.commands ?? []),
          ...Option.match(grillIdOf(model), {
            onNone: () => [],
            onSome: grillId => [SaveClosedLine({ grillId, id })],
          }),
        ],
      }
    },

    RestoredClosedLine: ({ maybeId }) => ({
      model: modifyFields(model, { maybeClosedLine: () => maybeId }),
    }),

    CompletedSaveClosedLine: () => ({ model }),

    SawAgentMessages: ({ ids }) => markRead(model, ids),

    ClickedAgentMessage: ({ id, inReplies }) =>
      withSnapshot(model, snapshot => {
        const read = markRead(model, [id])
        const maybeMessage = Array.findFirst(
          agentMessagesOf(snapshot),
          message => message.id === id,
        )
        if (
          inReplies ||
          Option.isNone(maybeMessage) ||
          maybeMessage.value.kind === 'reply'
        ) {
          if (isWorkspacePage(model.currentPart)) {
            const moved = workspaceNavigate(read.model, REPLIES)
            return {
              model: modifyFields(moved.model, { side: () => 'None' }),
              commands: [
                ...(read.commands ?? []),
                ...(moved.commands ?? []),
                ScrollToAgent({ selector: `#agent-${id}` }),
              ],
            }
          }
          return {
            model: modifyFields(read.model, { side: () => 'Replies' }),
            commands: [
              ...(read.commands ?? []),
              ScrollToAgent({ selector: `#agent-${id}` }),
            ],
          }
        }
        const next = openAnswer(read.model, snapshot, maybeMessage.value.stepId)
        return {
          model: next,
          commands: [
            ...(read.commands ?? []),
            ...pushIfMoved(model, next, snapshot.grill),
            ScrollToAgent({ selector: `#talk-agent-${id}` }),
          ],
        }
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
      return text === '' || isOverTextLimit(text)
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
        if (text === '' || isOverTextLimit(text)) {
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
      isWorkspacePage(model.currentPart)
        ? (() => {
            const moved = workspaceNavigate(
              model,
              `${QUESTION_PAGE}${question}`,
            )
            return {
              model: modifyFields(moved.model, {
                diffShown: Record.set(stepId, true),
              }),
              commands: [
                ...(moved.commands ?? []),
                ScrollToAgent({ selector: '#workspace-reasoning' }),
              ],
            }
          })()
        : withSnapshot(model, snapshot => {
            const next = modifyFields(
              goTo(
                openQuestion(model, question),
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
      isWorkspacePage(model.currentPart)
        ? workspaceNavigate(model, `${QUESTION_PAGE}${question}`)
        : withSnapshot(model, snapshot => {
            const next = goTo(
              openQuestion(model, question),
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

    // Unlike ClickedMapNode, this leaves a page that lists the question for its concept's own.
    ClickedOpenInConcept: ({ question }) =>
      withSnapshot(model, snapshot =>
        Option.match(partOf(snapshot, question), {
          onNone: () => ({ model }),
          onSome: partId => {
            const next = goTo(
              openQuestion(model, question),
              snapshot.grill,
              partId,
            )
            return {
              model: next,
              commands: [
                ...pushIfMoved(model, next, snapshot.grill),
                ScrollToQuestion({ question }),
              ],
            }
          },
        }),
      ),

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

const writeKey = (body: string): string => {
  const parsed: unknown = JSON.parse(body)
  const decoded = Schema.decodeUnknownResult(
    Schema.Struct({
      kind: Schema.String,
      question: Schema.optionalKey(Schema.String),
    }),
  )(parsed)
  if (decoded._tag === 'Failure' || decoded.success.question === undefined)
    return body
  const kind = decoded.success.kind
  return `${kind === 'answered' || kind === 'cleared' ? 'answer' : kind}:${decoded.success.question}`
}

const settleWrite = (
  model: Model,
  result: SnapshotResult,
  body?: string,
): UpdateReturn => {
  const pending = modifyFields(model, {
    pendingEvents: count => Math.max(0, count - 1),
  })
  if (result._tag === 'Failure')
    return {
      model: modifyFields(pending, {
        maybeSaveError: () => Option.some(result.failure),
        failedWrites: writes =>
          body === undefined || writes.includes(body)
            ? writes
            : Array.append(writes, body),
      }),
    }
  const failed = model.failedWrites.filter(
    write => body === undefined || writeKey(write) !== writeKey(body),
  )
  return {
    model: modifyFields(refreshPage(pending, result.success), {
      failedWrites: () => failed,
      maybeSaveError: () =>
        failed.length === 0 ? Option.none() : model.maybeSaveError,
    }),
  }
}

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
  isWorkspacePage(model.currentPart)
    ? `${QUESTION_PAGE}${question}`
    : pageQuestions(snapshot.grill, model.currentPart).some(
          step => step.question.id === question,
        )
      ? model.currentPart
      : Option.getOrElse(partOf(snapshot, question), () => model.currentPart)

// Each page has its own address under /g/<grill id>, so the browser's back and forward walk the
// pages read; the server serves the page for every such path.
const PAGE_PATHS: ReadonlyArray<readonly [string, string]> = [
  [QUESTION_PAGE, 'question/'],
  [RUN_PAGE, 'runs/'],
  [ITEM_PAGE, 'item/'],
  [CARD_PAGE, 'card/'],
  [ISSUE_PAGE, 'issue/'],
  [URGENCY_PAGE, 'urgency/'],
]

export const pathOfPage = (grillId: string, page: string): string => {
  const base = `/g/${encodeURIComponent(grillId)}`
  if (
    page === '' ||
    page === OVERVIEW ||
    page === PLAN ||
    page === STATUS ||
    page === DECIDED ||
    [
      REVIEW,
      CONVERSATIONS,
      REPLIES,
      NEEDS,
      SQUAD,
      GRILLS,
      UPDATES,
      ANSWER_HISTORY,
      CHANGES,
      INBOX,
      RUNS,
    ].includes(page)
  ) {
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
  if (kind === RUNS) {
    return decoded === '' ? RUNS : `${RUN_PAGE}${decoded}`
  }
  return kind === OVERVIEW ||
    kind === PLAN ||
    kind === STATUS ||
    kind === DECIDED ||
    [
      REVIEW,
      CONVERSATIONS,
      REPLIES,
      NEEDS,
      SQUAD,
      GRILLS,
      UPDATES,
      ANSWER_HISTORY,
      CHANGES,
      INBOX,
    ].includes(kind ?? '')
    ? (kind ?? '')
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

const toggled = <A extends string>(
  values: ReadonlyArray<A>,
  value: A,
): ReadonlyArray<A> =>
  values.includes(value)
    ? values.filter(current => current !== value)
    : [...values, value]

// The Inbox only records a request for now; delivery joins the ask path with the business logic.
const recordRequests = (
  request: Readonly<{
    scope: ReadonlyArray<UpdateScope>
    sessions: ReadonlyArray<string>
  }>,
  ended: ReadonlyArray<string>,
  at: number,
) =>
  request.sessions.map(session => ({
    session,
    at,
    scope: request.scope,
    delivery: ended.includes(session)
      ? ('Undeliverable' as const)
      : ('Pending' as const),
  }))

export const PAGE_LINK_COPY = 'page-link'

/** The address command for moving from one model's page to the next's. */
const pushIfMoved = (
  before: Model,
  after: Model,
  grill: Grill,
): ReadonlyArray<ReturnType<typeof PushPage>> =>
  after.currentPart === before.currentPart &&
  after.pageQuery === before.pageQuery
    ? []
    : [PushPage({ url: addressOf(grill.id, after) })]

const addressOf = (grillId: string, model: Model): string =>
  `${pathOfPage(grillId, model.currentPart)}${model.pageQuery === '' ? '' : `?${model.pageQuery}`}`

const queryFromSearch = (search: Option.Option<string>): string =>
  Option.getOrElse(search, () => '').replace(/^\?/, '')

/** A page as links name it: its part, then an optional `?query`. */
const splitPage = (page: string): readonly [string, string] => {
  const at = page.indexOf('?')
  return at === -1 ? [page, ''] : [page.slice(0, at), page.slice(at + 1)]
}

/** Swaps the address's query in place, without a history entry, as filters change. */
const replaceQuery = (model: Model, query: string): UpdateReturn =>
  withSnapshot(model, snapshot => {
    const next = modifyFields(model, { pageQuery: () => query })
    return {
      model: next,
      commands: [ReplacePage({ url: addressOf(snapshot.grill.id, next) })],
    }
  })

// Sample-question answers live only in this browser, so a reload from the server keeps them.
const fixtureAnswers = (
  local: Readonly<Record<string, string>>,
): Record<string, string> =>
  Record.filter(local, (_value, key) => isFixtureQuestion(key))

const mergeRemoteRecord = (
  previous: Readonly<Record<string, string>>,
  local: Readonly<Record<string, string>>,
  incoming: Readonly<Record<string, string>>,
): Record<string, string> =>
  Record.fromEntries(
    Array.dedupe([
      ...Object.keys(previous),
      ...Object.keys(local),
      ...Object.keys(incoming),
    ]).flatMap(key => {
      const value = local[key] !== previous[key] ? local[key] : incoming[key]
      return value === undefined
        ? []
        : [[key, value] satisfies readonly [string, string]]
    }),
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
  const snapshot = model.inbox.isFixture
    ? withFixtureQuestions(result.success)
    : result.success
  if (AsyncData.hasData(model.page)) {
    const previous = Option.getOrThrow(AsyncData.getData(model.page))
    return scheduleBrowserNotices({
      model: modifyFields(refreshPage(model, snapshot), {
        answers: local =>
          model.pendingEvents > 0 || model.failedWrites.length > 0
            ? mergeRemoteRecord(previous.answers, local, snapshot.answers)
            : { ...snapshot.answers, ...fixtureAnswers(local) },
        notes: local =>
          mergeRemoteRecord(previous.notes, local, snapshot.notes),
        own: local => mergeRemoteRecord(previous.own, local, snapshot.own),
      }),
    })
  }
  const first = model.currentPart === ''
  const next = modifyFields(refreshPage(model, snapshot), {
    answers: () => snapshot.answers,
    notes: restored => ({ ...snapshot.notes, ...restored }),
    own: restored => ({ ...snapshot.own, ...restored }),
    send: () => latestSendState(snapshot),
    sendDetail: () => latestSendDetail(snapshot),
    currentPart: current => (first ? INBOX : current),
  })
  return scheduleBrowserNotices({
    model: modifyFields(next, {
      workspace: workspace =>
        workspace.scopeRestoration === 'Preserve'
          ? workspace
          : Option.match(questionOnPage(snapshot, next.currentPart), {
              onNone: () => workspace,
              onSome: step =>
                revealQuestion(
                  workspace,
                  snapshot,
                  next.answers,
                  next.notes,
                  next.own,
                  step.question.id,
                ),
            }),
    }),
    commands: [
      ...(first
        ? [
            ReplacePage({
              url: pathOfPage(snapshot.grill.id, next.currentPart),
            }),
          ]
        : []),
      ...(model.channelReveal._tag !== 'None' ? [] : [ScrollToTop()]),
      RestoreRead({ grillId: snapshot.grill.id }),
      RestoreClosedLine({ grillId: snapshot.grill.id }),
      RestoreKeptBack({ grillId: snapshot.grill.id }),
      ...([SQUAD, GRILLS].includes(next.currentPart)
        ? [LoadWorkspaceCatalog()]
        : []),
    ],
  })
}

const scheduleBrowserNotices = (change: UpdateReturn): UpdateReturn => {
  const state = change.model.browserNotices
  const snapshot = AsyncData.getData(change.model.page)
  if (
    !state.ready ||
    !state.enabled ||
    state.asking ||
    state.pending ||
    Option.isNone(snapshot)
  )
    return change
  return {
    model: modifyFields(change.model, {
      browserNotices: current => modifyFields(current, { pending: () => true }),
    }),
    commands: [
      ...(change.commands ?? []),
      SyncBrowserNotices({
        candidates: noticeCandidates(snapshot.value),
        baseline: !state.primed,
      }),
    ],
  }
}

const withSidebarWidth = (
  model: Model,
  edge: SidebarEdge,
  maybeWidth: Option.Option<number>,
): Model => {
  const clamped = Option.map(maybeWidth, width =>
    clampSidebarWidth(edge, width),
  )
  return edge === 'Nav'
    ? modifyFields(model, { maybeNavWidth: () => clamped })
    : modifyFields(model, { maybeSideWidth: () => clamped })
}

const saveSidebarWidths = (model: Model) =>
  SaveSidebarWidths({
    widths: JSON.stringify({
      nav: Option.getOrNull(model.maybeNavWidth),
      side: Option.getOrNull(model.maybeSideWidth),
    }),
  })

const workspaceNavigate = (model: Model, page: string): UpdateReturn =>
  withSnapshot(model, snapshot => {
    const moved = goTo(model, snapshot.grill, page)
    const question = questionOnPage(snapshot, page)
    const workspace = Option.match(question, {
      onNone: () => moved.workspace,
      onSome: step =>
        revealQuestion(
          moved.workspace,
          snapshot,
          model.answers,
          model.notes,
          model.own,
          step.question.id,
        ),
    })
    const next = modifyFields(moved, {
      channelReveal: () => ChannelReveal.None(),
      workspace: () =>
        modifyFields(workspace, {
          maybeDiscussionTarget: current =>
            page === CONVERSATIONS
              ? Option.orElse(current, () =>
                  Option.map(
                    questionOnPage(snapshot, model.currentPart),
                    step => step.id,
                  ),
                )
              : Option.map(question, step => step.id),
        }),
    })
    return {
      model: next,
      commands: [
        ...pushIfMoved(model, next, snapshot.grill),
        ScrollToTop(),
        ...([SQUAD, GRILLS].includes(page) &&
        !AsyncData.hasData(model.workspace.catalog)
          ? [LoadWorkspaceCatalog()]
          : []),
      ],
    }
  })

const navigateQuestion = (
  model: Model,
  direction: 'Previous' | 'Next',
): UpdateReturn =>
  withSnapshot(model, snapshot => {
    return Option.match(
      adjacentQuestion(
        model.workspace,
        narrowedSnapshot(snapshot, model.pageQuery),
        model.answers,
        model.notes,
        model.own,
        model.currentPart,
        direction,
      ),
      {
        onNone: () => ({ model }),
        onSome: step =>
          workspaceNavigate(model, `${QUESTION_PAGE}${step.question.id}`),
      },
    )
  })

// Removing a focused editor does not fire blur, so keyboard review must save it explicitly.
const reviewFromQuestion = (model: Model): UpdateReturn =>
  withSnapshot(model, snapshot => {
    const step = questionOnPage(snapshot, model.currentPart)
    if (Option.isNone(step)) return workspaceNavigate(model, REVIEW)
    const question = step.value.question.id
    const own = model.own[question] ?? ''
    const note = model.notes[question] ?? ''
    const bodies: ReadonlyArray<Record<string, unknown>> = [
      ...(model.answers[question] === OWN &&
      own !== (snapshot.own[question] ?? '')
        ? [{ kind: 'answered', question, key: OWN, text: own }]
        : []),
      ...(note !== (snapshot.notes[question] ?? '')
        ? [{ kind: 'noted', question, text: note }]
        : []),
    ]
    const saved = bodies.reduce<UpdateReturn>(
      (pending, body) => {
        const write = postEvent(pending.model, body)
        return {
          model: write.model,
          commands: [...(pending.commands ?? []), ...(write.commands ?? [])],
        }
      },
      { model },
    )
    const moved = workspaceNavigate(saved.model, REVIEW)
    return {
      model: moved.model,
      commands: [...(saved.commands ?? []), ...(moved.commands ?? [])],
    }
  })

const saveWorkspacePreferences = (
  model: Model,
  workspace: Workspace,
): UpdateReturn => ({
  model: modifyFields(model, { workspace: () => workspace }),
  commands: [SaveWorkspaceSettings({ settings: JSON.stringify(workspace) })],
})

const saveWorkspaceSetting = (
  model: Model,
  key: 'highlightTerms' | 'collapseSentRounds',
): UpdateReturn => {
  const next = modifyFields(model, {
    workspace: value =>
      key === 'highlightTerms'
        ? modifyFields(value, { highlightTerms: current => !current })
        : modifyFields(value, { collapseSentRounds: current => !current }),
  })
  return {
    model: next,
    commands: [
      SaveWorkspaceSettings({ settings: JSON.stringify(next.workspace) }),
    ],
  }
}

// INIT

export const init: Runtime.RoutingApplicationInit<Model, Message> = url => ({
  model: {
    page: PageData.Loading(),
    workspace: initialWorkspace,
    pendingEvents: 0,
    failedWrites: [],
    answers: {},
    notes: {},
    own: {},
    talkDrafts: {},
    talkAbout: {},
    diffShown: {},
    diagramViews: {},
    whyOpen: {},
    isConceptMapOpen: false,
    isShapeOpen: false,
    navFolded: [],
    maybeNavWidth: Option.none(),
    maybeSideWidth: Option.none(),
    maybeResizing: Option.none(),
    readSince: Option.none(),
    readIds: [],
    hiddenToastIds: [],
    notificationTray: 'Expanded',
    browserNotices: initialBrowserNotices,
    maybeClosedLine: Option.none(),
    send: 'Idle',
    quickSend: 'Idle',
    isCommandHeld: false,
    isSendOpen: false,
    sendMessage: '',
    talkGeneration: 0,
    sendDetail: '',
    maybeSendSubset: Option.none(),
    maybeHeldSend: Option.none(),
    keptBack: [],
    isTrayOpen: false,
    trayCursor: 0,
    answerActivity: 0,
    isNudging: false,
    maybeLeaving: Option.none(),
    copy: 'Idle',
    channelReveal: Option.match(revealAnchorFrom(url.hash), {
      onNone: () => ChannelReveal.None(),
      onSome: id => ChannelReveal.Pending({ id }),
    }),
    drawingAttempts: {},
    ownerCopies: {},
    keyCopies: {},
    ownerDestinations: {},
    vetoAttempts: {},
    maybeSaveError: Option.none(),
    maybeBuild: Option.none(),
    currentPart: pageOfPath(url.pathname),
    side: 'None',
    maybePrevious: Option.none(),
    now: 0,
    skipped: [],
    expanded: {},
    peeks: [],
    maybeHover: Option.none(),
    maybeTalkPart: Option.none(),
    maybeJustAnswered: Option.none(),
    pageQuery: queryFromSearch(url.search),
    inbox: initialInboxUi,
  },
  commands: [
    LoadGrill(),
    DetectFixture(),
    CheckBuild(),
    RestoreDrafts(),
    RestoreNavFolded(),
    RestoreSidebarWidths(),
    RestoreWorkspaceSettings(),
    RestoreBrowserNotices(),
    RestoreDiscussionState(),
  ],
})

// COMMAND

export const RestoreBrowserNotices = Command.define('RestoreBrowserNotices', {
  messages: [Message.CompletedRestoreBrowserNotices],
  execute: Effect.sync(restoreBrowserNotices).pipe(
    Effect.map(result => Message.CompletedRestoreBrowserNotices({ result })),
  ),
})
export const EnableBrowserNotices = Command.define('EnableBrowserNotices', {
  messages: [Message.CompletedEnableBrowserNotices],
  execute: Effect.promise(enableBrowserNotices).pipe(
    Effect.map(result => Message.CompletedEnableBrowserNotices({ result })),
  ),
})
export const DisableBrowserNotices = Command.define('DisableBrowserNotices', {
  args: { failed: Schema.Boolean },
  messages: [Message.CompletedDisableBrowserNotices],
  execute: ({ failed }) =>
    Effect.promise(disableBrowserNotices).pipe(
      Effect.map(result =>
        Message.CompletedDisableBrowserNotices({ result, failed }),
      ),
    ),
})
export const SyncBrowserNotices = Command.define('SyncBrowserNotices', {
  args: { candidates: Schema.Array(NoticeCandidate), baseline: Schema.Boolean },
  messages: [Message.CompletedSyncBrowserNotices],
  execute: ({ candidates, baseline }) =>
    Effect.promise(() => syncBrowserNotices(candidates, baseline)).pipe(
      Effect.map(result => Message.CompletedSyncBrowserNotices({ result })),
    ),
})
export const OpenBrowserNotice = Command.define('OpenBrowserNotice', {
  args: { href: Schema.String },
  messages: [Message.CompletedOpenBrowserNotice],
  execute: ({ href }) =>
    Effect.sync(() => {
      // A new tab preserves uncontrolled drafts in the page that produced the alert.
      if (noticeHref(href)) window.open(href, '_blank', 'noopener')
      return Message.CompletedOpenBrowserNotice()
    }),
})

const WORKSPACE_SETTINGS_KEY = 'grill-flow:workspace-settings'

const discussionKey = (grillId: string) => `grill-flow:discussion:${grillId}`

export const RestoreDiscussionState = Command.define('RestoreDiscussionState', {
  messages: [Message.RestoredDiscussionState],
  execute: Effect.sync(() => {
    const id = decodeURIComponent(window.location.pathname.split('/')[2] ?? '')
    const state = Schema.decodeUnknownSync(DiscussionState)(
      JSON.parse(
        localStorage.getItem(discussionKey(id)) ??
          JSON.stringify(closedDiscussion),
      ),
    )
    return Message.RestoredDiscussionState({ state })
  }).pipe(
    Effect.catch(() =>
      Effect.succeed(
        Message.RestoredDiscussionState({ state: closedDiscussion }),
      ),
    ),
  ),
})

export const SaveDiscussionState = Command.define('SaveDiscussionState', {
  args: { grillId: Schema.String, json: Schema.String },
  messages: [Message.CompletedSaveDiscussionState],
  execute: ({ grillId, json }) =>
    Effect.sync(() => localStorage.setItem(discussionKey(grillId), json)).pipe(
      Effect.catch(() => Effect.void),
      Effect.map(() => Message.CompletedSaveDiscussionState()),
    ),
})

export const RestoreDiscussionPosition = Command.define(
  'RestoreDiscussionPosition',
  {
    args: { top: Schema.Number },
    messages: [Message.CompletedRestoreDiscussionPosition],
    execute: ({ top }) =>
      afterCommit.pipe(
        Effect.andThen(() =>
          Effect.sync(() => {
            const element = document.querySelector('.f-discussion-messages')
            if (element instanceof HTMLElement) {
              element.scrollTop = top
            }
          }),
        ),
        Effect.catch(() => Effect.void),
        Effect.map(() => Message.CompletedRestoreDiscussionPosition()),
      ),
  },
)

export const ScrollDiscussion = Command.define('ScrollDiscussion', {
  args: { target: Schema.String, maybeMessage: Schema.Option(Schema.String) },
  messages: [Message.CompletedScroll],
  execute: ({ target, maybeMessage }) =>
    afterCommit.pipe(
      Effect.andThen(() =>
        Effect.sync(() => {
          const pane = document.querySelector('.f-discussion-messages')
          if (
            !(pane instanceof HTMLElement) ||
            pane.dataset.discussionTarget !== target
          ) {
            return
          }
          const message = Option.match(maybeMessage, {
            onNone: () => null,
            onSome: id => document.getElementById(`talk-agent-${id}`),
          })
          if (
            Option.isSome(maybeMessage) &&
            (message === null || !pane.contains(message))
          ) {
            return
          }
          pane.scrollTo({
            top:
              message === null
                ? pane.scrollHeight
                : pane.scrollTop +
                  message.getBoundingClientRect().top -
                  pane.getBoundingClientRect().top -
                  16,
            behavior: 'instant',
          })
        }),
      ),
      Effect.catch(() => Effect.void),
      Effect.map(() => Message.CompletedScroll()),
    ),
})

export const RestoreDiscussionScroll = Mount.define('RestoreDiscussionScroll', {
  args: { top: Schema.Number },
  messages: [Message.CompletedRestoreDiscussionScroll],
  execute: ({ element, top }) =>
    Effect.sync(() => {
      if (element instanceof HTMLElement) {
        element.scrollTop = top
      }
      return Message.CompletedRestoreDiscussionScroll()
    }),
})

const WorkspacePreferences = Schema.Struct({
  filter: Schema.optionalKey(Schema.Unknown),
  urgencyFilter: Schema.optionalKey(Schema.Unknown),
  grouping: Schema.optionalKey(Schema.String),
  sort: Schema.optionalKey(Schema.Unknown),
  roundScopes: Schema.optionalKey(Schema.Unknown),
  activityRead: Schema.optionalKey(Schema.Unknown),
  highlightTerms: Schema.optionalKey(Schema.Boolean),
  collapseSentRounds: Schema.optionalKey(Schema.Boolean),
})

export const SaveWorkspaceSettings = Command.define('SaveWorkspaceSettings', {
  args: { settings: Schema.String },
  messages: [Message.CompletedSaveWorkspaceSettings],
  execute: ({ settings }) =>
    Effect.sync(() =>
      localStorage.setItem(
        WORKSPACE_SETTINGS_KEY,
        JSON.stringify(
          Schema.decodeUnknownSync(WorkspacePreferences)(JSON.parse(settings)),
        ),
      ),
    ).pipe(
      Effect.catch(() => Effect.void),
      Effect.map(() => Message.CompletedSaveWorkspaceSettings()),
    ),
})

export const RestoreWorkspaceSettings = Command.define(
  'RestoreWorkspaceSettings',
  {
    messages: [Message.RestoredWorkspaceSettings],
    execute: Effect.sync(() => {
      const raw: unknown = JSON.parse(
        localStorage.getItem(WORKSPACE_SETTINGS_KEY) ?? '{}',
      )
      const settings = Schema.decodeUnknownSync(WorkspacePreferences)(raw)
      return Message.RestoredWorkspaceSettings({
        filter: questionFilterFrom(settings.filter),
        urgencyFilter: questionUrgencyFilterFrom(settings.urgencyFilter),
        grouping: 'Round',
        sort: questionSortFrom(settings.sort),
        roundScopes: roundScopesFrom(settings.roundScopes),
        activityRead: activityReadFrom(settings.activityRead),
        navigation: performance
          .getEntriesByType('navigation')
          .some(entry => 'type' in entry && entry.type === 'reload')
          ? 'Reload'
          : 'Navigate',
        highlightTerms: settings.highlightTerms ?? false,
        collapseSentRounds: settings.collapseSentRounds ?? true,
      })
    }).pipe(
      Effect.catch(() =>
        Effect.succeed(
          Message.RestoredWorkspaceSettings({
            filter: 'All',
            urgencyFilter: 'All',
            grouping: 'Round',
            highlightTerms: false,
            collapseSentRounds: true,
          }),
        ),
      ),
    ),
  },
)

export const OpenWorkspaceSettings = Command.define('OpenWorkspaceSettings', {
  messages: [Message.CompletedFocus],
  execute: Effect.sleep(Duration.millis(20)).pipe(
    Effect.flatMap(() =>
      Dom.showDialog('#workspace-settings', {
        isModal: true,
        focusSelector: '#workspace-settings-close',
      }),
    ),
    Effect.catch(() => Effect.void),
    Effect.map(() => Message.CompletedFocus()),
  ),
})

export const CloseWorkspaceSettings = Command.define('CloseWorkspaceSettings', {
  messages: [Message.CompletedFocus],
  execute: Dom.closeDialog('#workspace-settings').pipe(
    Effect.catch(() => Effect.void),
    Effect.map(() => Message.CompletedFocus()),
  ),
})

export const ReadWorkspaceDiscussionBox = Command.define(
  'ReadWorkspaceDiscussionBox',
  {
    args: { target: Schema.String },
    messages: [Message.ReadWorkspaceDiscussion],
    execute: ({ target }) =>
      Effect.sync(() =>
        Message.ReadWorkspaceDiscussion({
          target,
          text: draftBoxText(threadDraftKey(target)),
        }),
      ),
  },
)

const SnapshotFromJson = Schema.decodeUnknownEffect(Snapshot)

const requestSnapshot = (input: string, init?: RequestInit) =>
  pipe(
    Effect.tryPromise({
      try: async () => {
        const response = await fetch(input, {
          credentials: 'same-origin',
          ...init,
        })
        const body: unknown = await response.json()
        if (!response.ok) {
          const error = Schema.decodeUnknownResult(
            Schema.Struct({ error: Schema.String }),
          )(body)
          throw new Error(
            error._tag === 'Success'
              ? error.success.error
              : `The server answered ${response.status}.`,
          )
        }
        return body
      },
      catch: error =>
        error instanceof Error
          ? error
          : new Error('The page data could not be read.'),
    }),
    Effect.flatMap(body => SnapshotFromJson(body)),
    Effect.mapError(error =>
      error instanceof Error
        ? error.message
        : 'The page data could not be read.',
    ),
    Effect.result,
  )

export const LoadWorkspaceCatalog = Command.define('LoadWorkspaceCatalog', {
  messages: [Message.CompletedLoadCatalog],
  execute: Effect.tryPromise(async () => {
    const response = await fetch('/api/grills', { credentials: 'same-origin' })
    if (!response.ok)
      throw new Error('The list of grills could not be loaded. Try Refresh.')
    const raw: unknown = await response.json()
    return Schema.decodeUnknownSync(
      Schema.Array(Schema.Struct({ id: Schema.String })),
    )(raw)
  }).pipe(
    Effect.flatMap(rows =>
      Effect.forEach(
        rows,
        row => requestSnapshot(`/api/grills/${encodeURIComponent(row.id)}`),
        { concurrency: 4 },
      ),
    ),
    Effect.flatMap(results => {
      const failed = results.find(result => result._tag === 'Failure')
      return failed?._tag === 'Failure'
        ? Effect.fail(failed.failure)
        : Effect.succeed(
            results.flatMap(result =>
              result._tag === 'Success' ? [result.success] : [],
            ),
          )
    }),
    Effect.mapError(error =>
      error instanceof Error
        ? error.message
        : 'Grills could not be loaded. Try Refresh.',
    ),
    Effect.result,
    Effect.map(result => Message.CompletedLoadCatalog({ result })),
  ),
})

export const LoadGrill = Command.define('LoadGrill', {
  messages: [Message.CompletedLoadGrill],
  execute: pipe(
    Effect.sync(() =>
      window.location.pathname.split('/').filter(part => part !== ''),
    ),
    Effect.flatMap(parts =>
      requestSnapshot(`/api/grills/${encodeURIComponent(parts[1] ?? '')}`),
    ),
    Effect.map(result => {
      const pane = document.querySelector('.f-discussion-messages')
      const target =
        pane instanceof HTMLElement ? pane.dataset.discussionTarget : undefined
      return Message.CompletedLoadGrill({
        result,
        ...(pane instanceof HTMLElement && target !== undefined
          ? {
              discussion: {
                target,
                atBottom:
                  pane.scrollHeight - pane.clientHeight - pane.scrollTop <= 8,
              },
            }
          : {}),
      })
    }),
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
      Effect.map(result => Message.CompletedPostEvent({ result, body })),
    ),
})

export const SendAnswers = Command.define('SendAnswers', {
  args: {
    grillId: Schema.String,
    message: Schema.String,
    maybeQuestions: Schema.Option(Schema.Array(Schema.String)),
    expectedLines: Schema.Record(Schema.String, Schema.String),
  },
  messages: [Message.CompletedSendAnswers],
  execute: ({ grillId, message, maybeQuestions, expectedLines }) =>
    pipe(
      SecureRandom.SecureRandom.use(random => random.uuidV4()).pipe(
        Effect.provide(BrowserCrypto.layerSecureRandom),
      ),
      Effect.flatMap(requestId =>
        requestSnapshot(`/api/grills/${encodeURIComponent(grillId)}/send`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(
            Option.match(maybeQuestions, {
              onNone: () => ({ requestId, message }),
              onSome: questions => ({
                requestId,
                message,
                questions,
                expectedLines,
              }),
            }),
          ),
        }),
      ),
      Effect.map(result => Message.CompletedSendAnswers({ result })),
    ),
})

export const RequestDrawing = Command.define('RequestDrawing', {
  args: {
    grillId: Schema.String,
    question: Schema.String,
    contextRevision: Schema.String,
    previous: Schema.Number,
  },
  messages: [Message.CompletedRequestDrawing],
  execute: ({ grillId, question, contextRevision, previous }) =>
    SecureRandom.SecureRandom.use(random => random.uuidV4()).pipe(
      Effect.provide(BrowserCrypto.layerSecureRandom),
      Effect.flatMap(requestId =>
        requestSnapshot(`/api/grills/${encodeURIComponent(grillId)}/events`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            kind: 'drawing-requested',
            question,
            contextRevision,
            previous,
            requestId,
          }),
        }),
      ),
      Effect.catch(error => Effect.succeed(Result.fail(String(error)))),
      Effect.map(result =>
        Message.CompletedRequestDrawing({
          grillId,
          question,
          previous,
          result,
        }),
      ),
    ),
})

export const PostVeto = Command.define('PostVeto', {
  args: {
    grillId: Schema.String,
    source: Schema.String,
    item: Schema.String,
    revision: Schema.Number,
  },
  messages: [Message.CompletedPostVeto],
  execute: ({ grillId, source, item, revision }) =>
    SecureRandom.SecureRandom.use(random => random.uuidV4()).pipe(
      Effect.provide(BrowserCrypto.layerSecureRandom),
      Effect.flatMap(requestId =>
        requestSnapshot(`/api/grills/${encodeURIComponent(grillId)}/events`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            kind: 'veto-requested',
            source,
            item,
            revision,
            requestId,
          }),
        }),
      ),
      Effect.catch(error => Effect.succeed(Result.fail(String(error)))),
      Effect.map(result =>
        Message.CompletedPostVeto({ source, item, revision, result }),
      ),
    ),
})
export const OpenOwnerDestination = Command.define('OpenOwnerDestination', {
  args: {
    grillId: Schema.String,
    source: Schema.String,
    item: Schema.String,
    revision: Schema.Number,
    key: Schema.String,
  },
  messages: [Message.CompletedOpenOwnerDestination],
  execute: ({ grillId, source, item, revision, key }) =>
    requestSnapshot(`/api/grills/${encodeURIComponent(grillId)}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'owner-focused', source, item, revision }),
    }).pipe(
      Effect.map(result =>
        Message.CompletedOpenOwnerDestination({ key, result }),
      ),
    ),
})

export const CopyOwnerStep = Command.define('CopyOwnerStep', {
  args: { key: Schema.String, text: Schema.String },
  messages: [Message.CompletedCopyOwnerStep],
  execute: ({ key, text }) =>
    Effect.tryPromise(() => navigator.clipboard.writeText(text)).pipe(
      Effect.map(() => Message.CompletedCopyOwnerStep({ key, copied: true })),
      Effect.catch(() =>
        Effect.succeed(Message.CompletedCopyOwnerStep({ key, copied: false })),
      ),
    ),
})

export const DetectFixture = Command.define('DetectFixture', {
  messages: [Message.CompletedDetectFixture],
  execute: Effect.sync(() => {
    const preview = document.body.dataset.gfPreview === 'true'
    const asked =
      new URLSearchParams(window.location.search).get('fixture') ===
      'owner-actions'
    if (preview && asked) {
      sessionStorage.setItem(FIXTURE_KEY, 'owner-actions')
    }
    return Message.CompletedDetectFixture({
      isFixture:
        preview &&
        (asked || sessionStorage.getItem(FIXTURE_KEY) === 'owner-actions'),
    })
  }).pipe(
    Effect.catch(() =>
      Effect.succeed(Message.CompletedDetectFixture({ isFixture: false })),
    ),
  ),
})
const FIXTURE_KEY = 'grill-flow:fixture'

export const CopyPageLink = Command.define('CopyPageLink', {
  messages: [Message.CompletedCopyPageLink],
  execute: Effect.tryPromise(() =>
    navigator.clipboard.writeText(window.location.href),
  ).pipe(
    Effect.map(() => Message.CompletedCopyPageLink({ copied: true })),
    Effect.catch(() =>
      Effect.succeed(Message.CompletedCopyPageLink({ copied: false })),
    ),
  ),
})

export const CopyQuestionKey = Command.define('CopyQuestionKey', {
  args: { key: Schema.String },
  messages: [Message.CompletedCopyQuestionKey],
  execute: ({ key }) =>
    Effect.tryPromise(() => navigator.clipboard.writeText(key)).pipe(
      Effect.map(() => Message.CompletedCopyQuestionKey({ key, copied: true })),
      Effect.catch(() =>
        Effect.succeed(
          Message.CompletedCopyQuestionKey({ key, copied: false }),
        ),
      ),
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
      afterCommit,
      Effect.andThen(() =>
        Effect.try(() => {
          const thread = document.getElementById(`why-${stepId}`)
          const messages = thread?.closest('.messages')
          if (thread === null || messages === null || messages === undefined) {
            return
          }
          // Scrolling an ancestor chain would also move the question page.
          messages.scrollTo({
            top:
              messages.scrollTop +
              thread.getBoundingClientRect().top -
              messages.getBoundingClientRect().top -
              16,
            behavior: 'instant',
          })
        }),
      ),
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
    Dom.scrollIntoViewAfterPaint('#workspace-top'),
    Effect.catch(() => Effect.sync(() => window.scrollTo({ top: 0 }))),
    Effect.flatMap(() =>
      Effect.all([
        Dom.scrollIntoViewIfNotVisible('.f-question-item.is-current', {
          block: 'nearest',
        }).pipe(Effect.catch(() => Effect.void)),
        Dom.scrollIntoViewIfNotVisible('.f-round-rail button.is-current', {
          block: 'nearest',
        }).pipe(Effect.catch(() => Effect.void)),
      ]),
    ),
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

// The quoted question's composer may be on the page or in the sessions panel; its draft key finds it.
export const FocusDraftBox = Command.define('FocusDraftBox', {
  args: { key: Schema.String },
  messages: [Message.CompletedFocus],
  execute: ({ key }) =>
    pipe(
      Effect.sleep(Duration.millis(30)),
      Effect.flatMap(() =>
        Dom.focus(`textarea[data-${DRAFT_ATTRIBUTE}="${CSS.escape(key)}"]`),
      ),
      Effect.catch(() => Effect.void),
      Effect.map(() => Message.CompletedFocus()),
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

export const FocusQuoteBox = Command.define('FocusQuoteBox', {
  messages: [Message.CompletedFocus],
  execute: pipe(
    Dom.focus(`#${QUOTE_BOX}`),
    Effect.catch(() => Effect.void),
    Effect.map(() => Message.CompletedFocus()),
  ),
})

// Dictation tools can set a box's text without an input event, which a value bound to the
// Model would undo at once. So every draft box owns its text: the Model fills it when it
// mounts and reads it when it blurs, submits, sends or the page reloads.

const boxText = (id: string): string => {
  const element = document.getElementById(id)
  return element instanceof HTMLTextAreaElement ? element.value : ''
}

// A conversation's composer can show on the question page and in the sessions panel at once;
// its draft key, not an element id, says which box holds the text.
const draftBoxText = (key: string): string => {
  const element = document.querySelector(
    `textarea[data-${DRAFT_ATTRIBUTE}="${CSS.escape(key)}"]`,
  )
  return element instanceof HTMLTextAreaElement ? element.value : ''
}

const maybeBoxText = (id: string): Option.Option<string> => {
  const element = document.getElementById(id)
  return element instanceof HTMLTextAreaElement
    ? Option.some(element.value)
    : Option.none()
}

/** Names the talk draft a box holds, so a reload can carry the box's text under that key. */
export const DRAFT_ATTRIBUTE = 'draft'

const boxTexts = (
  selector: string,
  keyOf: (box: HTMLTextAreaElement) => string,
): Record<string, string> =>
  Record.fromEntries(
    Array.fromIterable(
      document.querySelectorAll<HTMLTextAreaElement>(selector),
    ).map(box => [keyOf(box), box.value] satisfies readonly [string, string]),
  )

const textsByPrefix = (prefix: string): Record<string, string> =>
  boxTexts(`textarea[id^="${prefix}"]`, box => box.id.slice(prefix.length))

const talkDraftTexts = (): Record<string, string> =>
  boxTexts(
    `textarea[data-${DRAFT_ATTRIBUTE}]`,
    box => box.dataset[DRAFT_ATTRIBUTE] ?? '',
  )

export const ReadOwnBox = Command.define('ReadOwnBox', {
  args: { question: Schema.String },
  messages: [Message.CompletedReadOwnBox],
  execute: ({ question }) =>
    Effect.sync(() =>
      Message.CompletedReadOwnBox({
        question,
        maybeText: maybeBoxText(`own-${question}`),
      }),
    ),
})

export const ReadNoteBox = Command.define('ReadNoteBox', {
  args: { question: Schema.String },
  messages: [Message.CompletedReadNoteBox],
  execute: ({ question }) =>
    Effect.sync(() =>
      Message.CompletedReadNoteBox({
        question,
        maybeText: maybeBoxText(`note-${question}`),
      }),
    ),
})

const isTextBox = (
  target: unknown,
): target is HTMLTextAreaElement | HTMLInputElement =>
  target instanceof HTMLTextAreaElement ||
  (target instanceof HTMLInputElement &&
    ['text', 'search', 'url', 'email', 'tel'].includes(target.type))

// A dictation tool that pastes through a clipboard it takes back at once can leave the
// browser's own paste with nothing to insert: the paste event fires and no text follows. The
// text is still readable inside that event, so the page reads it there and inserts it itself.
// `insertText` keeps undo working and raises the input event the boxes' drafts follow.
export const InsertPastedText = Command.define('InsertPastedText', {
  args: { text: Schema.String },
  messages: [Message.CompletedInsertPastedText],
  execute: ({ text }) =>
    Effect.sync(() => {
      const box = document.activeElement
      if (isTextBox(box) && !document.execCommand('insertText', false, text)) {
        const end = box.value.length
        box.setRangeText(
          text,
          box.selectionStart ?? end,
          box.selectionEnd ?? end,
          'end',
        )
        box.dispatchEvent(
          new InputEvent('input', { bubbles: true, inputType: 'insertText' }),
        )
      }
      return Message.CompletedInsertPastedText()
    }).pipe(
      Effect.catch(() => Effect.succeed(Message.CompletedInsertPastedText())),
    ),
})

export const ClearSendBox = Command.define('ClearSendBox', {
  messages: [Message.CompletedClearSendBox],
  execute: Effect.sync(() => {
    const element = document.getElementById('send-message')
    if (element instanceof HTMLTextAreaElement) {
      element.value = ''
    }
    return Message.CompletedClearSendBox()
  }),
})

const editorTexts = (
  prefix: string,
  questions: ReadonlyArray<string>,
): Record<string, string> =>
  Record.fromEntries(
    questions.flatMap(question => {
      const element = document.getElementById(`${prefix}-${question}`)
      return element instanceof HTMLTextAreaElement
        ? [[question, element.value] satisfies readonly [string, string]]
        : []
    }),
  )

export const ReadQuickSendEditors = Command.define('ReadQuickSendEditors', {
  args: { questions: Schema.Array(Schema.String), message: Schema.String },
  messages: [
    Message.CompletedReadQuickSendEditors,
    Message.FailedReadQuickSendEditors,
  ],
  execute: ({ questions, message }) =>
    Effect.sync(() => {
      const composer = document.getElementById('send-message')
      return Message.CompletedReadQuickSendEditors({
        own: editorTexts('own', questions),
        notes: editorTexts('note', questions),
        message:
          composer instanceof HTMLTextAreaElement ? composer.value : message,
      })
    }).pipe(
      Effect.catch(() => Effect.succeed(Message.FailedReadQuickSendEditors())),
    ),
})

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

export const ReadQuoteBox = Command.define('ReadQuoteBox', {
  messages: [Message.CompletedReadQuoteBox],
  execute: Effect.sync(() =>
    Message.CompletedReadQuoteBox({ text: boxText(QUOTE_BOX) }),
  ),
})

const REFOCUS_KEY = 'grill-flow:refocus'
const REFOCUS_WINDOW_MS = 15_000

// A reload that lands while someone is dictating must leave the caret where the text is about
// to arrive, so the box that had focus takes it back when it mounts again.
const refocusAfterReload = (
  element: HTMLTextAreaElement,
  now: number,
): void => {
  try {
    const stored = window.sessionStorage.getItem(REFOCUS_KEY)
    if (stored === null) {
      return
    }
    const [id, at] = stored.split('\n')
    if (now - Number(at) > REFOCUS_WINDOW_MS) {
      window.sessionStorage.removeItem(REFOCUS_KEY)
    } else if (id === element.id) {
      window.sessionStorage.removeItem(REFOCUS_KEY)
      element.focus({ preventScroll: true })
      element.setSelectionRange(element.value.length, element.value.length)
    }
  } catch {
    // Storage can be off; the box then stays unfocused, as after any reload.
  }
}

export const FillBox = Mount.define('FillBox', {
  args: { text: Schema.String },
  messages: [Message.CompletedFillBox],
  execute: ({ element, text }) =>
    pipe(
      Clock.currentTimeMillis,
      Effect.map(now => {
        if (element instanceof HTMLTextAreaElement) {
          if (element.value === '') {
            element.value = text
          }
          refocusAfterReload(element, now)
        }
        return Message.CompletedFillBox()
      }),
    ),
})

// A pinned diagram follows the first of its paragraphs still readable under it, once it is stuck
// or the scroller can go no further, in whichever box scrolls it: Talk, the Replies list, or the
// window.
const READABLE_PX = 60

const isAtEnd = (scroller: EventTarget): boolean =>
  scroller instanceof Element
    ? scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2
    : window.scrollY + window.innerHeight >=
      document.documentElement.scrollHeight - 2

const followedTitle = (section: Element): Option.Option<string> => {
  const figure = section.querySelector('.diagram')
  if (figure === null) {
    return Option.none()
  }
  const box = figure.getBoundingClientRect()
  const isStuck = box.top > section.getBoundingClientRect().top + 1
  if (!isStuck && !isAtEnd(scrollerOf(section))) {
    return Option.none()
  }
  const paragraphs = Array.fromIterable(
    section.querySelectorAll('[data-follow]'),
  )
  return pipe(
    Array.findFirst(
      paragraphs,
      paragraph =>
        paragraph.getBoundingClientRect().bottom > box.bottom + READABLE_PX,
    ),
    Option.orElse(() => Array.last(paragraphs)),
    Option.flatMap(paragraph =>
      Option.fromNullishOr(paragraph.getAttribute('data-follow')),
    ),
  )
}

const scrollerOf = (element: Element): EventTarget => {
  const parent = element.parentElement
  if (parent === null) {
    return window
  }
  const overflow = getComputedStyle(parent).overflowY
  return overflow === 'auto' || overflow === 'scroll'
    ? parent
    : scrollerOf(parent)
}

export const FollowPinnedDiagram = Mount.defineStream('FollowPinnedDiagram', {
  args: { diagram: Schema.String },
  messages: [Message.ScrolledPinnedDiagram],
  execute: ({ element, diagram }) =>
    Dom.streamFromEventFilterMap({
      target: (): EventTarget => scrollerOf(element),
      type: 'scroll',
      filterMapEvent: () => followedTitle(element),
      options: { passive: true },
    }).pipe(
      Stream.changes,
      Stream.map(title => Message.ScrolledPinnedDiagram({ diagram, title })),
    ),
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

const DraftRecords = Schema.Struct({
  talkDrafts: Schema.Record(Schema.String, Schema.String),
  notes: Schema.Record(Schema.String, Schema.String),
  own: Schema.Record(Schema.String, Schema.String),
  skipped: Schema.Array(Schema.String),
  expanded: Schema.Record(Schema.String, Schema.Boolean),
  currentPart: Schema.String,
  // Absent in drafts stored by a build that did not carry the send message.
  sendMessage: Schema.optionalKey(Schema.String),
})

// Unsent drafts survive the reload in this tab only; answers and saved notes live on the server.
// What a box holds wins over the Model's copy, which misses text that came with no input event.
export const ReloadPage = Command.define('ReloadPage', {
  args: {
    talkDrafts: Schema.Record(Schema.String, Schema.String),
    notes: Schema.Record(Schema.String, Schema.String),
    own: Schema.Record(Schema.String, Schema.String),
    skipped: Schema.Array(Schema.String),
    expanded: Schema.Record(Schema.String, Schema.Boolean),
    currentPart: Schema.String,
    sendMessage: Schema.String,
  },
  messages: [Message.CompletedReloadPage],
  execute: drafts =>
    pipe(
      Clock.currentTimeMillis,
      Effect.map(now => {
        try {
          window.sessionStorage.setItem(
            DRAFTS_KEY,
            JSON.stringify({
              talkDrafts: { ...drafts.talkDrafts, ...talkDraftTexts() },
              notes: { ...drafts.notes, ...textsByPrefix('note-') },
              own: { ...drafts.own, ...textsByPrefix('own-') },
              skipped: drafts.skipped,
              expanded: drafts.expanded,
              currentPart: drafts.currentPart,
              sendMessage: Option.getOrElse(
                maybeBoxText('send-message'),
                () => drafts.sendMessage,
              ),
            } satisfies typeof DraftRecords.Type),
          )
          const focused = document.activeElement
          if (focused instanceof HTMLTextAreaElement && focused.id !== '') {
            window.sessionStorage.setItem(REFOCUS_KEY, `${focused.id}\n${now}`)
          }
        } catch {
          // Storage can be off; the reload still brings the new build.
        }
        window.location.reload()
        return Message.CompletedReloadPage()
      }),
    ),
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
      Effect.succeed<typeof DraftRecords.Type>({
        talkDrafts: {},
        notes: {},
        own: {},
        skipped: [],
        expanded: {},
        currentPart: '',
      }),
    ),
    Effect.map(drafts =>
      Message.CompletedRestoreDrafts({
        talkDrafts: drafts.talkDrafts,
        notes: drafts.notes,
        own: drafts.own,
        skipped: drafts.skipped,
        expanded: drafts.expanded,
        currentPart: drafts.currentPart,
        sendMessage: drafts.sendMessage ?? '',
      }),
    ),
  ),
})

const readKey = (grillId: string): string => `grill-flow:read:${grillId}`

const closedLineKey = (grillId: string): string =>
  `grill-flow:closed-line:${grillId}`

const keptBackKey = (grillId: string): string =>
  `grill-flow:kept-back:${grillId}`

export const SaveKeptBack = Command.define('SaveKeptBack', {
  args: { grillId: Schema.String, questions: Schema.Array(Schema.String) },
  messages: [Message.CompletedSaveKeptBack],
  execute: ({ grillId, questions }) =>
    Effect.sync(() => {
      try {
        window.localStorage.setItem(
          keptBackKey(grillId),
          JSON.stringify(questions),
        )
      } catch {
        // Storage can be off; the drafts then count as unsent again after a reload.
      }
      return Message.CompletedSaveKeptBack()
    }),
})

export const RestoreKeptBack = Command.define('RestoreKeptBack', {
  args: { grillId: Schema.String },
  messages: [Message.RestoredKeptBack],
  execute: ({ grillId }) =>
    pipe(
      Effect.try((): unknown =>
        JSON.parse(window.localStorage.getItem(keptBackKey(grillId)) ?? '[]'),
      ),
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Schema.String))),
      Effect.catch(() => Effect.succeed<ReadonlyArray<string>>([])),
      Effect.map(questions => Message.RestoredKeptBack({ questions })),
    ),
})

export const LeavePage = Command.define('LeavePage', {
  args: { href: Schema.String },
  messages: [Message.CompletedLeavePage],
  execute: ({ href }) =>
    Effect.sync(() => {
      window.location.assign(href)
      return Message.CompletedLeavePage()
    }),
})

export const SaveClosedLine = Command.define('SaveClosedLine', {
  args: { grillId: Schema.String, id: Schema.String },
  messages: [Message.CompletedSaveClosedLine],
  execute: ({ grillId, id }) =>
    Effect.sync(() => {
      try {
        window.localStorage.setItem(closedLineKey(grillId), id)
      } catch {
        // Storage can be off; the line then comes back on the reload.
      }
      return Message.CompletedSaveClosedLine()
    }),
})

export const RestoreClosedLine = Command.define('RestoreClosedLine', {
  args: { grillId: Schema.String },
  messages: [Message.RestoredClosedLine],
  execute: ({ grillId }) =>
    Effect.sync(() => {
      try {
        return Message.RestoredClosedLine({
          maybeId: Option.fromNullOr(
            window.localStorage.getItem(closedLineKey(grillId)),
          ),
        })
      } catch {
        return Message.RestoredClosedLine({ maybeId: Option.none() })
      }
    }),
})

const SavedRead = Schema.Struct({
  since: Schema.Number,
  ids: Schema.Array(Schema.String),
})

export const SaveRead = Command.define('SaveRead', {
  args: {
    grillId: Schema.String,
    since: Schema.Number,
    ids: Schema.Array(Schema.String),
  },
  messages: [Message.CompletedSaveRead],
  execute: ({ grillId, since, ids }) =>
    Effect.sync(() => {
      try {
        window.localStorage.setItem(
          readKey(grillId),
          JSON.stringify({ since, ids }),
        )
      } catch {
        // Storage can be off; what was read then resets on the reload.
      }
      return Message.CompletedSaveRead()
    }),
})

export const RestoreRead = Command.define('RestoreRead', {
  args: { grillId: Schema.String },
  messages: [Message.RestoredRead],
  execute: ({ grillId }) =>
    pipe(
      Effect.sync(() => {
        try {
          return window.localStorage.getItem(readKey(grillId)) ?? 'null'
        } catch {
          return 'null'
        }
      }),
      Effect.flatMap(raw => Effect.try((): unknown => JSON.parse(raw))),
      Effect.flatMap(parsed => Schema.decodeUnknownEffect(SavedRead)(parsed)),
      Effect.map(saved =>
        Message.RestoredRead({
          maybeSince: Option.some(saved.since),
          ids: saved.ids,
        }),
      ),
      Effect.catch(() =>
        Effect.succeed(
          Message.RestoredRead({ maybeSince: Option.none(), ids: [] }),
        ),
      ),
    ),
})

export const RevealChannelItem = Mount.define('RevealChannelItem', {
  args: { id: Schema.String },
  messages: [Message.CompletedRevealChannelItem],
  execute: ({ id, element }) =>
    Effect.sync(() => {
      // Open once; native details keep later user toggles intact across polls.
      const archive = element.closest('details')
      if (archive instanceof HTMLDetailsElement) {
        archive.open = true
      }
      return '#' + CSS.escape(element.id)
    }).pipe(
      Effect.flatMap(selector =>
        // Font reflow can move a fragment after its first scroll.
        Effect.promise(() => element.ownerDocument.fonts.ready).pipe(
          Effect.timeoutOption(Duration.seconds(3)),
          Effect.andThen(
            Dom.scrollIntoViewAfterPaint(selector, { block: 'start' }),
          ),
          Effect.andThen(
            Dom.focus(selector, { preventScroll: true, makeFocusable: true }),
          ),
        ),
      ),
      Effect.catch(() => Effect.void),
      Effect.map(() => Message.CompletedRevealChannelItem({ id })),
    ),
})

export const ScrollToAgent = Command.define('ScrollToAgent', {
  args: { selector: Schema.String },
  messages: [Message.CompletedScroll],
  execute: ({ selector }) =>
    pipe(
      Dom.scrollIntoViewAfterPaint(selector),
      Effect.catch(() => Effect.void),
      Effect.map(() => Message.CompletedScroll()),
    ),
})

/** The agent's messages the reader hasn't seen yet; none until the browser's record is read. */
export const unreadMessagesOf = (model: Model) =>
  Option.match(
    Option.all({
      snapshot: AsyncData.getData(model.page),
      since: model.readSince,
    }),
    {
      onNone: () => [],
      onSome: ({ snapshot, since }) =>
        unreadOf(agentMessagesOf(snapshot), since, model.readIds),
    },
  )

export const visibleToastsOf = (model: Model) =>
  model.notificationTray === 'Collapsed'
    ? []
    : Array.reverse(Array.takeRight(unreadMessagesOf(model), 3)).filter(
        message => !model.hiddenToastIds.includes(message.id),
      )

const NAV_FOLDED_KEY = 'grill-flow:nav-folded'

export const SaveNavFolded = Command.define('SaveNavFolded', {
  args: { folded: Schema.Array(SidebarMode) },
  messages: [Message.CompletedSaveNavFolded],
  execute: ({ folded }) =>
    Effect.sync(() => {
      try {
        window.localStorage.setItem(NAV_FOLDED_KEY, JSON.stringify(folded))
      } catch {
        // Storage can be off; the folds then last until the reload.
      }
      return Message.CompletedSaveNavFolded()
    }),
})

export const RestoreNavFolded = Command.define('RestoreNavFolded', {
  messages: [Message.RestoredNavFolded],
  execute: pipe(
    Effect.sync(() => {
      try {
        return window.localStorage.getItem(NAV_FOLDED_KEY) ?? '[]'
      } catch {
        return '[]'
      }
    }),
    Effect.flatMap(raw => Effect.try((): unknown => JSON.parse(raw))),
    Effect.flatMap(parsed =>
      Schema.decodeUnknownEffect(Schema.Array(SidebarMode))(parsed),
    ),
    Effect.catch(() => Effect.succeed([])),
    Effect.map(folded => Message.RestoredNavFolded({ folded })),
  ),
})

const SIDEBAR_WIDTHS_KEY = 'grill-flow:sidebar-widths'

const StoredSidebarWidths = Schema.Struct({
  nav: Schema.NullOr(Schema.Number),
  side: Schema.NullOr(Schema.Number),
})

export const SaveSidebarWidths = Command.define('SaveSidebarWidths', {
  args: { widths: Schema.String },
  messages: [Message.CompletedSaveSidebarWidths],
  execute: ({ widths }) =>
    Effect.sync(() => {
      try {
        window.localStorage.setItem(SIDEBAR_WIDTHS_KEY, widths)
      } catch {
        // Storage can be off; the widths then last until the reload.
      }
      return Message.CompletedSaveSidebarWidths()
    }),
})

export const RestoreSidebarWidths = Command.define('RestoreSidebarWidths', {
  messages: [Message.RestoredSidebarWidths],
  execute: pipe(
    Effect.sync(() => {
      try {
        return window.localStorage.getItem(SIDEBAR_WIDTHS_KEY) ?? 'null'
      } catch {
        return 'null'
      }
    }),
    Effect.flatMap(raw => Effect.try((): unknown => JSON.parse(raw))),
    Effect.flatMap(parsed =>
      Schema.decodeUnknownEffect(StoredSidebarWidths)(parsed),
    ),
    Effect.map(({ nav, side }) =>
      Message.RestoredSidebarWidths({
        maybeNav: Option.fromNullOr(nav),
        maybeSide: Option.fromNullOr(side),
      }),
    ),
    Effect.catch(() =>
      Effect.succeed(
        Message.RestoredSidebarWidths({
          maybeNav: Option.none(),
          maybeSide: Option.none(),
        }),
      ),
    ),
  ),
})

const SIDEBAR_SELECTOR: Readonly<Record<SidebarEdge, string>> = {
  Nav: '.f-navigation, .concepts',
  Side: '.f-discussion, .side',
}

// A key press steps from the width on screen, which is the layout's own until the first drag.
export const MeasureSidebar = Command.define('MeasureSidebar', {
  args: { edge: SidebarEdge, step: Schema.Number },
  messages: [Message.CompletedMeasureSidebar],
  execute: ({ edge, step }) =>
    Effect.sync(() =>
      Message.CompletedMeasureSidebar({
        edge,
        maybeWidth: Option.map(
          Option.fromNullOr(document.querySelector(SIDEBAR_SELECTOR[edge])),
          element => element.getBoundingClientRect().width,
        ),
        step,
      }),
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
 * Visible unanswered questions take precedence over the concept title. A reading line a third
 * of the way down the view keeps Talk stable while a question spans several screens.
 */
const onScreenAbout = (): Option.Option<string> => {
  const barBottom =
    document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0
  const title = document.querySelector('.concept-title')
  const line = barBottom + (window.innerHeight - barBottom) / 3
  const distance = (box: DOMRect): number =>
    box.top <= line && box.bottom >= line
      ? 0
      : Math.min(Math.abs(box.top - line), Math.abs(box.bottom - line))
  const maybeQuestion = Option.map(
    Array.head(
      Array.sort(
        Array.map(
          Array.filter(
            Array.fromIterable(
              document.querySelectorAll(
                '.questions .question:is(.is-open, .is-waiting)',
              ),
            ),
            section => {
              const box = section.getBoundingClientRect()
              return box.bottom > barBottom && box.top < window.innerHeight
            },
          ),
          section => ({
            id: section.id.replace(/^q-/, ''),
            distance: distance(section.getBoundingClientRect()),
          }),
        ),
        Order.mapInput(
          Order.Number,
          (entry: { distance: number }) => entry.distance,
        ),
      ),
    ),
    entry => entry.id,
  )
  return Option.orElse(maybeQuestion, () =>
    title !== null && title.getBoundingClientRect().bottom > barBottom
      ? Option.some('concept')
      : Option.none(),
  )
}

/** Which of these agent messages are on screen, in Talk or in Replies, inside their panel. */
const onScreenAgent = (ids: ReadonlyArray<string>): ReadonlyArray<string> =>
  Array.filter(ids, id =>
    Array.some([`talk-agent-${id}`, `agent-${id}`], elementId => {
      const element = document.getElementById(elementId)
      if (
        element === null ||
        getComputedStyle(element).visibility !== 'visible'
      ) {
        return false
      }
      const box = element.getBoundingClientRect()
      if (box.width <= 0 || box.height <= 0) {
        return false
      }
      const frame = (
        element.closest(
          '.messages, .replies-list, .f-discussion-messages, .f-page-scroller',
        ) ?? document.body
      ).getBoundingClientRect()
      const top = Math.max(box.top, frame.top, 0)
      const bottom = Math.min(box.bottom, frame.bottom, window.innerHeight)
      const left = Math.max(box.left, frame.left, 0)
      const right = Math.min(box.right, frame.right, window.innerWidth)
      return (
        bottom - top >= Math.min(40, box.height) &&
        right - left >= Math.min(40, box.width)
      )
    }),
  )

const isConceptPage = (page: string): boolean =>
  page !== OVERVIEW &&
  page !== PLAN &&
  page !== STATUS &&
  page !== DECIDED &&
  !page.startsWith(URGENCY_PAGE) &&
  !page.startsWith(ISSUE_PAGE) &&
  !page.startsWith(CARD_PAGE) &&
  !isWorkspacePage(page)

/** Pages that list questions from several concepts. */
const isMixedPage = (page: string): boolean =>
  page.startsWith(URGENCY_PAGE) ||
  page.startsWith(ISSUE_PAGE) ||
  page.startsWith(CARD_PAGE)

// Keys typed into a field belong to the field; checkboxes and buttons don't take letters.
const isTypingTarget = (target: EventTarget | null): boolean =>
  target instanceof Element &&
  target.closest(
    'input:not([type="checkbox"]), textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"]',
  ) !== null

export const subscriptions = Subscription.make<Model, Message>()(entry => ({
  // The clipboard must be read while the paste event is being dispatched (InsertPastedText).
  // An empty read, such as a pasted image, is left to the browser.
  pastedText: entry(
    {},
    {
      modelToDependencies: () => ({}),
      dependenciesToStream: () =>
        Dom.streamFromEventFilterMapPreventDefault({
          target: document,
          type: 'paste',
          filterMapEvent: event => {
            const text = isTextBox(event.target)
              ? (event.clipboardData?.getData('text/plain') ?? '')
              : ''
            return text === ''
              ? Option.none()
              : Option.some(Message.PastedText({ text }))
          },
        }),
    },
  ),
  browserNoticeEvents: entry(
    {},
    {
      modelToDependencies: () => ({}),
      dependenciesToStream: () =>
        Stream.mergeAll(
          [
            Dom.streamFromEvent({
              target: window,
              type: 'grill-flow-notice-open',
              mapEvent: event =>
                Message.RequestedBrowserNoticeNavigation({
                  href: event.detail,
                }),
            }),
            Dom.streamFromEvent({
              target: window,
              type: 'grill-flow-notice-failed',
              mapEvent: () => Message.BrowserNoticeDeliveryFailed(),
            }),
            Dom.streamFromEventFilterMap({
              target: window,
              type: 'storage',
              filterMapEvent: event =>
                event.key === BROWSER_NOTICES_KEY
                  ? Option.some(Message.BrowserNoticePreferencesChanged())
                  : Option.none(),
            }),
          ],
          { concurrency: 'unbounded' },
        ),
    },
  ),
  quoteSelection: entry(
    { enabled: Schema.Boolean },
    {
      modelToDependencies: model => ({
        enabled: model.currentPart.startsWith(QUESTION_PAGE),
      }),
      dependenciesToStream: ({ enabled }) =>
        !enabled
          ? Stream.empty
          : Stream.mergeAll(
              [
                Dom.streamFromEventFilterMap({
                  target: document,
                  type: 'pointerup',
                  filterMapEvent: event =>
                    isInsideQuotePopover(event.target)
                      ? Option.none()
                      : Option.some(undefined),
                }),
                Dom.streamFromEventFilterMap({
                  target: document,
                  type: 'keyup',
                  filterMapEvent: event =>
                    event.shiftKey && !isInsideQuotePopover(event.target)
                      ? Option.some(undefined)
                      : Option.none(),
                }),
              ],
              { concurrency: 'unbounded' },
            ).pipe(
              // A click inside a selection collapses it only after pointerup.
              Stream.mapEffect(() =>
                Effect.as(Effect.sleep(Duration.millis(0)), undefined),
              ),
              Stream.map(() =>
                Option.match(readQuoteSelection(), {
                  onNone: () => Message.ClearedQuoteSelection(),
                  onSome: quoted => Message.SelectedQuoteText({ quoted }),
                }),
              ),
              Stream.merge(
                Dom.streamFromEventFilterMap({
                  target: document,
                  type: 'keydown',
                  filterMapEvent: event =>
                    event.key === 'Escape'
                      ? Option.some(Message.DismissedQuote())
                      : Option.none(),
                }),
              ),
            ),
    },
  ),
  commandHeld: entry(
    { enabled: Schema.Boolean },
    {
      modelToDependencies: model => ({
        enabled: isWorkspacePage(model.currentPart),
      }),
      dependenciesToStream: ({ enabled }) =>
        !enabled
          ? Stream.empty
          : Stream.mergeAll(
              [
                Dom.streamFromEvent({
                  target: document,
                  type: 'keydown',
                  mapEvent: event => event.metaKey,
                }),
                Dom.streamFromEvent({
                  target: document,
                  type: 'keyup',
                  mapEvent: event => event.metaKey,
                }),
                Dom.streamFromEvent({
                  target: window,
                  type: 'blur',
                  mapEvent: () => false,
                }),
              ],
              { concurrency: 'unbounded' },
            ).pipe(
              Stream.changes,
              Stream.map(held => Message.UpdatedCommandHeld({ held })),
            ),
    },
  ),
  quickSendClick: entry(
    { enabled: Schema.Boolean },
    {
      modelToDependencies: model => ({
        enabled: isWorkspacePage(model.currentPart),
      }),
      dependenciesToStream: ({ enabled }) =>
        !enabled
          ? Stream.empty
          : Dom.streamFromEventFilterMapPreventDefault({
              target: document,
              type: 'click',
              options: { capture: true },
              filterMapEvent: event => {
                if (
                  !event.metaKey ||
                  event.button !== 0 ||
                  !(event.target instanceof Element) ||
                  event.target.closest('#workspace-review-send') === null
                ) {
                  return Option.none()
                }
                event.stopPropagation()
                return Option.some(Message.ClickedQuickSend())
              },
            }),
    },
  ),
  discussionState: entry(
    { ready: Schema.Boolean, grillId: Schema.String, state: DiscussionState },
    {
      modelToDependencies: model => ({
        ready: model.workspace.discussionRestored,
        grillId: Option.match(AsyncData.getData(model.page), {
          onNone: () => '',
          onSome: snapshot => snapshot.grill.id,
        }),
        state: {
          open: model.side === 'Talk',
          expanded: model.workspace.isDiscussionExpanded,
          target: Option.getOrElse(
            model.workspace.maybeDiscussionTarget,
            () => '',
          ),
          scroll: model.workspace.discussionScroll,
        },
      }),
      dependenciesToStream: ({ ready, grillId, state }) =>
        ready && grillId !== ''
          ? Stream.succeed(Message.ChangedDiscussionState({ grillId, state }))
          : Stream.empty,
    },
  ),
  workspaceShortcut: entry(
    { page: Schema.String },
    {
      modelToDependencies: model => ({
        page:
          !model.workspace.isSettingsOpen &&
          !model.isTrayOpen &&
          (model.currentPart === REVIEW ||
            model.currentPart.startsWith(QUESTION_PAGE))
            ? model.currentPart
            : '',
      }),
      dependenciesToStream: ({ page }) =>
        page === ''
          ? Stream.empty
          : Dom.streamFromEventFilterMapPreventDefault({
              target: document,
              type: 'keydown',
              filterMapEvent: event =>
                event.key !== 'Enter' ||
                !(event.metaKey || event.ctrlKey) ||
                event.repeat ||
                event.isComposing ||
                event.defaultPrevented ||
                (event.target instanceof Element &&
                  event.target.closest('.f-discussion') !== null)
                  ? Option.none()
                  : Option.some(
                      event.shiftKey && page.startsWith(QUESTION_PAGE)
                        ? Message.PressedRoundSendShortcut()
                        : Message.PressedWorkspaceShortcut(),
                    ),
            }),
    },
  ),
  heldSendTick: entry(
    { holding: Schema.Boolean },
    {
      modelToDependencies: model => ({
        holding: Option.exists(model.maybeHeldSend, held => held.left > 0),
      }),
      dependenciesToStream: ({ holding }) =>
        holding
          ? Stream.tick(Duration.seconds(1)).pipe(
              Stream.drop(1),
              Stream.map(() => Message.TickedHeldSend()),
            )
          : Stream.empty,
    },
  ),
  // While a send is held nothing has left the page, so closing it would drop the send; the
  // browser asks first.
  heldSendUnload: entry(
    { holding: Schema.Boolean },
    {
      modelToDependencies: model => ({
        holding: Option.isSome(model.maybeHeldSend),
      }),
      dependenciesToStream: ({ holding }) =>
        holding
          ? Dom.streamFromEventFilterMapPreventDefault({
              target: window,
              type: 'beforeunload',
              filterMapEvent: () => Option.some(Message.WarnedBeforeUnload()),
            })
          : Stream.empty,
    },
  ),
  undoShortcut: entry(
    { enabled: Schema.Boolean },
    {
      modelToDependencies: model => ({
        enabled: Option.isSome(model.maybeHeldSend),
      }),
      dependenciesToStream: ({ enabled }) =>
        enabled
          ? Dom.streamFromEventFilterMapPreventDefault({
              target: document,
              type: 'keydown',
              filterMapEvent: event =>
                event.key.toLowerCase() !== 'z' ||
                !(event.metaKey || event.ctrlKey) ||
                event.shiftKey ||
                event.defaultPrevented ||
                isTypingTarget(event.target)
                  ? Option.none()
                  : Option.some(Message.ClickedUndoSend()),
            })
          : Stream.empty,
    },
  ),
  quickLookKeys: entry(
    { enabled: Schema.Boolean, open: Schema.Boolean },
    {
      modelToDependencies: model => ({
        enabled:
          isWorkspacePage(model.currentPart) &&
          !model.isTrayOpen &&
          !model.workspace.isSettingsOpen &&
          Option.isNone(model.maybeLeaving),
        open:
          model.inbox.isQuickLookOpen ||
          model.inbox.requestUpdate._tag === 'Open',
      }),
      dependenciesToStream: ({ enabled, open }) =>
        enabled
          ? Dom.streamFromEventFilterMapPreventDefault({
              target: document,
              type: 'keydown',
              filterMapEvent: event =>
                event.metaKey ||
                event.ctrlKey ||
                event.altKey ||
                event.repeat ||
                event.defaultPrevented ||
                isTypingTarget(event.target)
                  ? Option.none()
                  : event.key === '.'
                    ? Option.some(
                        Message.PressedQuickLookKey({ key: 'Toggle' }),
                      )
                    : event.key === 'Escape' && open
                      ? Option.some(
                          Message.PressedQuickLookKey({ key: 'Close' }),
                        )
                      : Option.none(),
            })
          : Stream.empty,
    },
  ),
  openTrayKey: entry(
    { enabled: Schema.Boolean },
    {
      modelToDependencies: model => ({
        enabled:
          isWorkspacePage(model.currentPart) &&
          !model.isTrayOpen &&
          !model.workspace.isSettingsOpen &&
          Option.isNone(model.maybeLeaving),
      }),
      dependenciesToStream: ({ enabled }) =>
        enabled
          ? Dom.streamFromEventFilterMapPreventDefault({
              target: document,
              type: 'keydown',
              filterMapEvent: event =>
                event.key !== 'u' ||
                event.metaKey ||
                event.ctrlKey ||
                event.altKey ||
                event.repeat ||
                event.defaultPrevented ||
                isTypingTarget(event.target)
                  ? Option.none()
                  : Option.some(Message.ClickedUnsentTray()),
            })
          : Stream.empty,
    },
  ),
  trayKeys: entry(
    { open: Schema.Boolean },
    {
      modelToDependencies: model => ({ open: model.isTrayOpen }),
      dependenciesToStream: ({ open }) =>
        open
          ? Dom.streamFromEventFilterMapPreventDefault({
              target: document,
              type: 'keydown',
              filterMapEvent: event => {
                if (event.defaultPrevented || event.isComposing) {
                  return Option.none()
                }
                if (event.key === 'Escape') {
                  return Option.some(Message.PressedTrayKey({ key: 'Close' }))
                }
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  return Option.some(Message.PressedTrayKey({ key: 'Send' }))
                }
                if (
                  event.metaKey ||
                  event.ctrlKey ||
                  event.altKey ||
                  isTypingTarget(event.target)
                ) {
                  return Option.none()
                }
                const key =
                  event.key === 'ArrowUp'
                    ? 'Up'
                    : event.key === 'ArrowDown'
                      ? 'Down'
                      : event.key === ' ' &&
                          !(
                            event.target instanceof Element &&
                            event.target.closest('input, button') !== null
                          )
                        ? 'Toggle'
                        : event.key === 'k'
                          ? 'Keep'
                          : event.key === 'u'
                            ? 'Close'
                            : undefined
                return key === undefined
                  ? Option.none()
                  : Option.some(Message.PressedTrayKey({ key }))
              },
            })
          : Stream.empty,
    },
  ),
  idleNudge: entry(
    { activity: Schema.Number, armed: Schema.Boolean },
    {
      modelToDependencies: model => ({
        activity: model.answerActivity,
        armed: model.answerActivity > 0 && !model.isNudging,
      }),
      dependenciesToStream: ({ activity, armed }) =>
        armed
          ? Stream.fromEffect(
              Effect.sleep(Duration.seconds(IDLE_NUDGE_SECONDS)).pipe(
                Effect.as(Message.ElapsedAnswerIdle({ activity })),
              ),
            )
          : Stream.empty,
    },
  ),
  // A plain click on a link to another grill-flow page, with ready drafts unsent, asks first.
  leaveLinks: entry(
    { grillId: Schema.String },
    {
      modelToDependencies: model => ({
        grillId: Option.match(AsyncData.getData(model.page), {
          onNone: () => '',
          onSome: snapshot =>
            isWorkspacePage(model.currentPart) &&
            Option.isNone(model.maybeLeaving) &&
            Array.isReadonlyArrayNonEmpty(readyOf(model, snapshot))
              ? snapshot.grill.id
              : '',
        }),
      }),
      dependenciesToStream: ({ grillId }) =>
        grillId === ''
          ? Stream.empty
          : Dom.streamFromEventFilterMapPreventDefault({
              target: document,
              type: 'click',
              options: { capture: true },
              filterMapEvent: event => {
                const anchor =
                  event.target instanceof Element
                    ? event.target.closest('a[href]')
                    : null
                if (
                  !(anchor instanceof HTMLAnchorElement) ||
                  event.button !== 0 ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey ||
                  (anchor.target !== '' && anchor.target !== '_self')
                ) {
                  return Option.none()
                }
                const url = new URL(anchor.href, window.location.href)
                const own = `/g/${grillId}`
                if (
                  url.origin !== window.location.origin ||
                  !url.pathname.startsWith('/g/') ||
                  url.pathname === own ||
                  url.pathname.startsWith(`${own}/`)
                ) {
                  return Option.none()
                }
                event.stopPropagation()
                return Option.some(Message.ClickedLeaveLink({ href: url.href }))
              },
            }),
    },
  ),
  questionArrows: entry(
    { enabled: Schema.Boolean },
    {
      modelToDependencies: model => ({
        enabled:
          model.currentPart.startsWith(QUESTION_PAGE) &&
          !model.workspace.isSettingsOpen &&
          !model.workspace.isDiscussionExpanded,
      }),
      dependenciesToStream: ({ enabled }) =>
        !enabled
          ? Stream.empty
          : Dom.streamFromEventFilterMapPreventDefault({
              target: document,
              type: 'keydown',
              filterMapEvent: event => {
                if (
                  (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') ||
                  event.altKey ||
                  event.ctrlKey ||
                  event.metaKey ||
                  event.shiftKey ||
                  event.repeat ||
                  event.isComposing ||
                  event.defaultPrevented ||
                  (event.target instanceof Element &&
                    event.target.closest(
                      'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="slider"], [role="spinbutton"], [role="tab"], [role="dialog"], dialog, .f-discussion',
                    ) !== null)
                ) {
                  return Option.none()
                }
                return Option.some(
                  Message.PressedQuestionArrow({
                    direction: event.key === 'ArrowLeft' ? 'Previous' : 'Next',
                  }),
                )
              },
            }),
    },
  ),
  // While a sidebar edge is held, the pointer sets its width; the left list starts at the
  // window's left edge and the right sidebar ends at its right one.
  resizeSidebar: entry(
    { edge: Schema.Literals(['Nav', 'Side', 'None']) },
    {
      modelToDependencies: model => ({
        edge: Option.getOrElse(
          model.maybeResizing,
          (): SidebarEdge | 'None' => 'None',
        ),
      }),
      dependenciesToStream: ({ edge }) =>
        edge === 'None'
          ? Stream.empty
          : Stream.merge(
              Dom.streamFromEventFilterMap({
                target: document,
                type: 'pointermove',
                filterMapEvent: event =>
                  Option.some(
                    Message.MovedResizePointer({
                      edge,
                      width:
                        edge === 'Nav'
                          ? event.clientX
                          : document.documentElement.clientWidth -
                            event.clientX,
                    }),
                  ),
              }),
              Stream.merge(
                Dom.streamFromEventFilterMap({
                  target: document,
                  type: 'pointerup',
                  filterMapEvent: () =>
                    Option.some(Message.ReleasedResizeHandle()),
                }),
                Dom.streamFromEventFilterMap({
                  target: document,
                  type: 'pointercancel',
                  filterMapEvent: () =>
                    Option.some(Message.ReleasedResizeHandle()),
                }),
              ),
            ),
    },
  ),
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
  // An unread message on screen at two checks in a row, a second apart, counts as seen.
  seeAgent: entry(
    { unread: Schema.String },
    {
      modelToDependencies: model => ({
        unread: Array.join(
          Array.map(unreadMessagesOf(model), message => message.id),
          ',',
        ),
      }),
      dependenciesToStream: ({ unread }) =>
        Stream.when(
          Stream.tick(Duration.seconds(1)).pipe(
            Stream.map(() => onScreenAgent(unread.split(','))),
            Stream.mapAccum(
              (): ReadonlyArray<string> => [],
              (before: ReadonlyArray<string>, now: ReadonlyArray<string>) =>
                [now, [Array.filter(now, id => before.includes(id))]] as const,
            ),
            Stream.filter(ids => !Array.isReadonlyArrayEmpty(ids)),
            Stream.map(ids => Message.SawAgentMessages({ ids })),
          ),
          Effect.sync(() => unread !== ''),
        ),
    },
  ),
  // A plan's countdown and a squad page's "… ago" lines keep the clock; other grills show neither.
  clock: entry(
    { isTimed: Schema.Boolean },
    {
      modelToDependencies: model => ({
        isTimed: Option.exists(
          AsyncData.getData(model.page),
          snapshot =>
            snapshot.grill.plan !== undefined ||
            snapshot.grill.kind === 'squad',
        ),
      }),
      dependenciesToStream: ({ isTimed }) =>
        Stream.when(
          Stream.tick(Duration.minutes(1)).pipe(
            Stream.mapEffect(() => Clock.currentTimeMillis),
            Stream.map(now => Message.TickedClock({ now })),
          ),
          Effect.sync(() => isTimed),
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
