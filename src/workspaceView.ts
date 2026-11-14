import { Array, Option, Order } from 'effect'
import { AsyncData } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { modifyFields } from 'foldkit/struct'

import { ownerWorkCounts } from './channel'
import {
  answerHistoryView,
  sentOnQuestionView,
  sourceQuestionHref,
} from './channelView'
import {
  type DiscussionRef,
  FORMAT_VERSION,
  GRILL_FLOW_TARGET,
  OWN,
  type PlanIssue,
  type Question,
  type QuestionTimes,
  type Snapshot,
  type Step,
  agentAddressOf,
  agentMessagesOf,
  agentTarget,
  answerRoundLabel,
  isOverTextLimit,
  planPhaseOf,
  questionAgent,
  questionSession,
  roundOf,
  statusOf,
  unreadOf,
  urgencyDetail,
} from './domain'
import { drawingButton, drawingPanel } from './drawingView'
import type { QuestionDrawing } from './drawings'
import {
  DECISION_PAGE,
  INBOX,
  ITEM_PAGE,
  type InboxData,
  NAMES,
  RUNS,
  RUN_PAGE,
  boardName,
  inboxData,
  narrowedSnapshot,
  questionOf,
  sessionOf,
} from './inbox'
import {
  decisionPage,
  freezePillView,
  inboxNavView,
  inboxPage,
  itemPage,
  questionFilterView,
  quickLookView,
  runsPage,
} from './inboxView'
import {
  DRAFT_ATTRIBUTE,
  FillBox,
  Message,
  type Model,
  RestoreDiscussionScroll,
  type SidebarEdge,
  readyOf,
  threadDraftKey,
} from './main'
import {
  QUOTE_BOX,
  QUOTE_DRAFT,
  QUOTE_POPOVER_CLASS,
  quoteDestination,
  quotedAsk,
} from './quote'
import { refView } from './refCard'
import { linkCard, roundCard, sessionCard } from './refCards'
import { decidedLine, replyOnQuestion, replySession } from './replies'
import { decisionPanelView, openDecisions } from './retirementView'
import {
  heldSendBarView,
  leaveDialogView,
  nudgeView,
  sendStripView,
  unsentLabel,
  unsentTrayView,
} from './sendShortcutsView'
import {
  maintainerLabel,
  sessionsBadge,
  sessionsPanelView,
} from './sessionsView'
import { textLimitCount } from './textLimitView'
import {
  type NestedThread,
  STARTERS,
  type ThreadLine,
  fixtureThreads,
  threadTarget,
} from './threads'
import {
  ANSWER_HISTORY,
  CONVERSATIONS,
  GRILLS,
  QUESTION_PAGE,
  REVIEW,
  RUN_TARGET,
  SQUAD,
  answerLabel,
  draftAnswerIds,
  draftQuestions,
  questionOnPage,
  questionState,
  quickViews,
  sidebarRoundName,
  visibleQuestions,
  workspaceLines,
} from './workspace'

type H = HtmlBuilder<Message>

type Reading = Readonly<{
  source: (step: Step, h: H) => Html
  heading: (text: string, h: H) => ReadonlyArray<Html | string>
  inline: (text: string, h: H) => ReadonlyArray<Html | string>
  prose: (text: string, h: H) => Html
  answer: (text: string, h: H) => ReadonlyArray<Html | string>
  status: (step: Step, h: H) => Html
  comparison: (step: Step, h: H) => Html
  drawing: (drawing: QuestionDrawing, h: H) => Html
  related: (step: Step, h: H) => Html
  reasoning: (step: Step, h: H) => Html
  summary: (step: Step, h: H) => Html
  details: (step: Step, h: H) => Html
  thread: (target: string, h: H) => ReadonlyArray<Html>
  overview: (h: H) => Html
  decided: (h: H) => Html
  resize: (edge: SidebarEdge, h: H) => Html
  notices: (h: H) => Html
  noticeBell: (h: H) => Html
}>

const link = (label: string, message: Message, h: H): Html =>
  h.button(
    [h.Type('button'), h.Class('text-button'), h.OnClick(message)],
    [label],
  )

const pageLink = (label: string, page: string, h: H): Html =>
  link(label, Message.ClickedWorkspacePage({ page }), h)

/** The question's key, copied on click so the reader can name the question in chat. */
const keyButton = (model: Model, key: string, h: H): Html => {
  const copied = model.keyCopies[key]
  const label =
    copied === 'Copied'
      ? `Copied ${key}`
      : copied === 'Failed'
        ? `Could not copy ${key}`
        : `Copy key ${key}`
  return h.button(
    [
      h.Type('button'),
      h.Class(
        `f-question-key${copied === undefined ? '' : ` is-${copied.toLowerCase()}`}`,
      ),
      h.Title(label),
      h.AriaLabel(label),
      h.OnClick(Message.ClickedQuestionKey({ key })),
    ],
    [key],
  )
}

const stateMark = (
  state: 'Open' | 'Draft' | 'Sent',
  question: Question | undefined,
  h: H,
): Html =>
  h.span(
    [
      h.Class(
        `f-state f-state-${state.toLowerCase()}${state === 'Open' && question?.urgency !== undefined ? ` urgency-${question.urgency}` : ''}`,
      ),
      h.AriaHidden(true),
      ...(state === 'Open' && question !== undefined
        ? Option.toArray(
            Option.map(urgencyDetail(question), detail => h.Title(detail)),
          )
        : []),
    ],
    state === 'Open'
      ? []
      : [
          h.svg(
            [h.ViewBox('0 0 16 16')],
            [
              h.path([
                h.D('m4 8 3 3 5-6'),
                h.Fill('none'),
                h.Stroke('currentColor'),
                h.StrokeWidth('1.5'),
              ]),
            ],
          ),
        ],
  )

const settingView = (model: Model, h: H): Html =>
  h.dialog(
    [
      h.Id('workspace-settings'),
      h.Class('f-settings'),
      h.AriaLabelledBy('workspace-settings-title'),
      h.OnCancel(Message.ClosedSettings()),
    ],
    [
      h.div([
        h.Class('f-settings-backdrop'),
        h.OnClick(Message.ClosedSettings()),
      ]),
      h.section(
        [h.Class('f-settings-panel')],
        [
          h.header(
            [],
            [
              h.h2([h.Id('workspace-settings-title')], ['Settings']),
              h.button(
                [
                  h.Id('workspace-settings-close'),
                  h.Class('text-button'),
                  h.OnClick(Message.ClosedSettings()),
                ],
                ['Close'],
              ),
            ],
          ),
          h.label(
            [],
            [
              h.input([
                h.Type('checkbox'),
                h.Checked(model.workspace.highlightTerms),
                h.OnClick(Message.ChangedHighlights()),
              ]),
              'Highlight terms and people',
            ],
          ),
          h.p(
            [h.Class('hint')],
            ['Definitions stay available when highlighting is off.'],
          ),
          h.label(
            [],
            [
              h.input([
                h.Type('checkbox'),
                h.Checked(model.workspace.collapseSentRounds),
                h.OnClick(Message.ChangedCollapseSentRounds()),
              ]),
              'Collapse completed rounds',
            ],
          ),
          h.p(
            [h.Class('hint')],
            ['You can expand any round from the question list.'],
          ),
          browserNoticeSettings(model, h),
        ],
      ),
    ],
  )

const browserNoticeSettings = (model: Model, h: H): Html => {
  const state = model.browserNotices
  const status = state.asking
    ? 'Waiting for browser permission…'
    : state.enabled
      ? 'On in this browser.'
      : {
          Unknown: 'Checking this browser…',
          Unsupported:
            'This browser cannot provide running-page notifications.',
          Default: 'Off in this browser.',
          Granted: 'Off in this browser.',
          Denied:
            'Blocked in browser settings. Allow notifications there, then check permission here.',
          Failed:
            'Browser notifications paused. Check browser and site settings, then enable again.',
        }[state.status]
  return h.section(
    [h.Class('f-browser-notifications'), h.AriaLabel('Browser notifications')],
    [
      h.h3([], ['Browser notifications']),
      h.p(
        [h.Class('hint')],
        [
          'Alerts for new or newly urgent Blocking/Soon questions and owner actions while a Squad Board page is open. Enabling starts with future changes. Alerts open the item in a new tab.',
        ],
      ),
      h.p([h.Class('f-notification-status'), h.Role('status')], [status]),
      h.button(
        [
          h.Class('quiet-button'),
          h.Disabled(
            !state.ready || state.asking || state.status === 'Unsupported',
          ),
          h.OnClick(
            state.enabled
              ? Message.ClickedDisableBrowserNotices()
              : Message.ClickedEnableBrowserNotices(),
          ),
        ],
        [
          state.asking
            ? 'Waiting for permission…'
            : state.enabled
              ? 'Turn off browser notifications'
              : state.status === 'Denied'
                ? 'Check notification permission'
                : 'Enable browser notifications',
        ],
      ),
    ],
  )
}

export const workspaceView = (
  model: Model,
  snapshot: Snapshot,
  reading: Reading,
  h: H,
): Html => {
  const grill = snapshot.grill
  const drafts = draftAnswerIds(snapshot, model.answers, model.notes, model.own)
  const selectedDrafts = drafts.filter(
    id =>
      !model.workspace.excluded.includes(id) && !model.keptBack.includes(id),
  )
  const reviewLabel = unsentLabel(model, snapshot)
  const sendLabel =
    model.send === 'Sending'
      ? 'Sending…'
      : model.quickSend !== 'Idle'
        ? 'Saving…'
        : model.isCommandHeld
          ? `Send${selectedDrafts.length > 0 ? ` · ${selectedDrafts.length}` : ''}`
          : reviewLabel
  const question = questionOnPage(snapshot, model.currentPart)
  const hasSessions =
    model.side === 'Talk' && model.currentPart !== CONVERSATIONS
  const styles = {
    '--nav-w': `${Option.getOrElse(model.maybeNavWidth, () => 320)}px`,
    '--side-set': `${Option.getOrElse(model.maybeSideWidth, () => 400)}px`,
  }
  const inbox = inboxData(
    snapshot,
    model.answers,
    model.now === 0 ? (snapshot.channelNow ?? 0) : model.now,
    model.inbox.isFixture,
  )
  const panelConversation = (closedNote: Option.Option<string>) =>
    discussionView(model, snapshot, reading, false, h, Option.some(closedNote))
  const content =
    model.currentPart === INBOX
      ? inboxPage(model, snapshot, inbox, h)
      : model.currentPart === RUNS || model.currentPart.startsWith(RUN_PAGE)
        ? runsPage(
            model,
            snapshot,
            inbox,
            model.currentPart.startsWith(RUN_PAGE)
              ? Option.some(model.currentPart.slice(RUN_PAGE.length))
              : Option.none(),
            h,
            model.currentPart.startsWith(RUN_PAGE)
              ? runDetailView(
                  model,
                  snapshot,
                  reading,
                  model.currentPart.slice(RUN_PAGE.length),
                  h,
                )
              : runsTableSection(model, snapshot, h),
          )
        : model.currentPart.startsWith(DECISION_PAGE)
          ? decisionPage(
              model,
              snapshot,
              model.currentPart.slice(DECISION_PAGE.length),
              h,
            )
          : model.currentPart.startsWith(ITEM_PAGE)
            ? itemPage(
                model,
                inbox,
                model.currentPart.slice(ITEM_PAGE.length),
                reading.prose,
                h,
              )
            : model.currentPart === ANSWER_HISTORY
              ? answerHistoryView(model, snapshot, h)
              : model.currentPart === SQUAD
                ? squadView(snapshot, h)
                : model.currentPart === GRILLS
                  ? grillsView(model, snapshot, h)
                  : model.currentPart === REVIEW
                    ? reviewView(model, snapshot, reading, h)
                    : model.currentPart === 'plan' ||
                        model.currentPart === 'status'
                      ? runView(model, snapshot, reading, h)
                      : model.currentPart === 'decided'
                        ? reading.decided(h)
                        : model.currentPart === CONVERSATIONS
                          ? sessionsPanelView(
                              model,
                              snapshot,
                              inbox,
                              panelConversation,
                              'Page',
                              h,
                            )
                          : Option.match(question, {
                              onSome: step =>
                                questionView(
                                  model,
                                  snapshot,
                                  step,
                                  reading,
                                  inbox,
                                  h,
                                ),
                              onNone: () => reading.overview(h),
                            })
  return h.div(
    [
      h.Class(
        `app f-workspace${hasSessions ? ' has-sessions' : ''}${model.workspace.highlightTerms ? '' : ' f-no-highlights'}${Option.isSome(model.maybeResizing) ? ' is-resizing' : ''}`,
      ),
    ],
    [
      Option.isSome(model.maybeSaveError)
        ? h.div(
            [h.Class('f-save-error'), h.Role('alert')],
            [
              Option.getOrThrow(model.maybeSaveError),
              model.failedWrites.length > 0
                ? link('Retry saving', Message.ClickedRetrySaves(), h)
                : h.empty,
            ],
          )
        : h.empty,
      model.send === 'Failed' && model.currentPart !== REVIEW
        ? h.div(
            [h.Class('f-save-error'), h.Role('alert')],
            [
              `Not sent: ${model.sendDetail} `,
              link(
                'Review drafts',
                Message.ClickedWorkspacePage({ page: REVIEW }),
                h,
              ),
            ],
          )
        : h.empty,
      workspaceHeaderView(
        model,
        snapshot,
        inbox,
        reviewLabel,
        sendLabel,
        reading.noticeBell(h),
        h,
      ),
      quickLookView(model, inbox, h),
      unsentTrayView(model, snapshot, h),
      heldSendBarView(model, snapshot, question, h),
      leaveDialogView(model, snapshot, h),
      Array.isReadonlyArrayNonEmpty(snapshot.unconfirmedSends ?? [])
        ? h.div(
            [h.Class('f-unconfirmed-sends'), h.Role('alert')],
            [
              `Delivery is unconfirmed for saved sends: ${(snapshot.unconfirmedSends ?? []).map(item => `${item.source} #${item.send}`).join(', ')}. `,
              link(
                'Review drafts before sending again',
                Message.ClickedWorkspacePage({ page: REVIEW }),
                h,
              ),
            ],
          )
        : h.empty,
      h.div(
        [h.Class('f-frame f-no-nav'), h.Style(styles)],
        [
          h.main(
            [
              h.Id('workspace-main'),
              h.Class(
                `f-main${Option.isSome(question) ? ' f-question-main' : ''}`,
              ),
            ],
            [
              Option.isSome(question)
                ? content
                : h.div(
                    [
                      h.Class(
                        `f-page-scroller${model.currentPart === REVIEW ? ' is-review' : ''}${model.currentPart === CONVERSATIONS ? ' is-conversation' : ''}`,
                      ),
                    ],
                    [
                      h.div([h.Id('workspace-top'), h.Tabindex(-1)]),
                      (grill.version ?? 1) > FORMAT_VERSION
                        ? h.p(
                            [h.Class('f-version hint')],
                            [
                              'This grill uses a newer format. Update Squad Board if some content is missing.',
                            ],
                          )
                        : h.empty,
                      content,
                    ],
                  ),
            ],
          ),
        ],
      ),
      hasSessions
        ? sessionsPanelView(
            model,
            snapshot,
            inbox,
            panelConversation,
            'Sidebar',
            h,
          )
        : h.empty,
      settingView(model, h),
    ],
  )
}

const questionQueuePage = (model: Model, snapshot: Snapshot): string => {
  const current = questionOnPage(snapshot, model.currentPart)
  const previous = Option.flatMap(model.maybePrevious, page =>
    questionOnPage(snapshot, page),
  )
  const first =
    visibleQuestions(
      model.workspace,
      snapshot,
      model.answers,
      model.notes,
      model.own,
    )[0] ?? snapshot.grill.steps[0]
  return Option.match(
    Option.orElse(current, () => previous),
    {
      onSome: step => `${QUESTION_PAGE}${step.question.id}`,
      onNone: () =>
        first === undefined ? INBOX : `${QUESTION_PAGE}${first.question.id}`,
    },
  )
}

// Pages reached from More ▾; the toggle shows as active on any of them.
const MORE_PAGES: ReadonlyArray<string> = [
  CONVERSATIONS,
  SQUAD,
  'overview',
  ANSWER_HISTORY,
  'plan',
  GRILLS,
]

const workspaceHeaderView = (
  model: Model,
  snapshot: Snapshot,
  inbox: InboxData,
  reviewLabel: string,
  sendLabel: string,
  bell: Html,
  h: H,
): Html => {
  const grill = snapshot.grill
  const destination = (label: string, page: string, inMenu = false) =>
    h.button(
      [
        h.Type('button'),
        h.Class(`text-button${model.currentPart === page ? ' is-active' : ''}`),
        h.AriaCurrent(model.currentPart === page ? 'page' : 'false'),
        h.OnClick(Message.ClickedWorkspacePage({ page })),
        ...(inMenu
          ? [h.Popovertarget('workspace-more'), h.Popovertargetaction('hide')]
          : []),
      ],
      [label],
    )
  return h.header(
    [h.Class('f-topbar f-topbar-a')],
    [
      h.nav(
        [h.Class('f-header-start'), h.AriaLabel('Workspace destinations')],
        [
          h.button(
            [
              h.Type('button'),
              h.Class('f-wordmark'),
              h.AriaLabel(`${boardName(grill)} overview`),
              h.OnClick(
                Message.ClickedWorkspacePage({
                  page: grill.kind === 'squad' ? SQUAD : 'overview',
                }),
              ),
            ],
            [NAMES.brand],
          ),
          h.div(
            [h.Class('f-primary-nav')],
            [
              inboxNavView(model, inbox, h),
              h.button(
                [
                  h.Type('button'),
                  h.Class(
                    `text-button${model.currentPart.startsWith(QUESTION_PAGE) ? ' is-active' : ''}`,
                  ),
                  h.AriaCurrent(
                    model.currentPart.startsWith(QUESTION_PAGE)
                      ? 'page'
                      : 'false',
                  ),
                  h.OnClick(
                    Message.ClickedWorkspacePage({
                      page: questionQueuePage(model, snapshot),
                    }),
                  ),
                ],
                [
                  NAMES.questions,
                  inbox.questions.length > 0
                    ? h.span(
                        [h.Class('f-nav-count')],
                        [String(inbox.questions.length)],
                      )
                    : h.empty,
                ],
              ),
              h.button(
                [
                  h.Type('button'),
                  h.Class(
                    `text-button${model.currentPart === RUNS || model.currentPart.startsWith(RUN_PAGE) ? ' is-active' : ''}`,
                  ),
                  h.AriaCurrent(
                    model.currentPart === RUNS ||
                      model.currentPart.startsWith(RUN_PAGE)
                      ? 'page'
                      : 'false',
                  ),
                  h.OnClick(Message.ClickedWorkspacePage({ page: RUNS })),
                ],
                [NAMES.runs],
              ),
              h.button(
                [
                  h.Type('button'),
                  h.Class(
                    `text-button f-more-toggle${MORE_PAGES.includes(model.currentPart) ? ' is-active' : ''}`,
                  ),
                  h.Popovertarget('workspace-more'),
                  h.AriaLabel('More destinations'),
                ],
                ['More ▾'],
              ),
            ],
          ),
          h.div(
            [
              h.Id('workspace-more'),
              h.Popover('auto'),
              h.Class('f-app-popdown f-more-menu'),
              h.Role('group'),
              h.AriaLabel('More destinations'),
            ],
            [
              destination(NAMES.conversations, CONVERSATIONS, true),
              destination(
                grill.kind === 'squad'
                  ? `Squad overview · ${openDecisions()} open decisions`
                  : 'Overview',
                grill.kind === 'squad' ? SQUAD : 'overview',
                true,
              ),
              destination('Log', ANSWER_HISTORY, true),
              ...(grill.plan === undefined
                ? []
                : [destination('Run overview', 'plan', true)]),
              destination('Your grills', GRILLS, true),
              h.button(
                [
                  h.Type('button'),
                  h.Id('workspace-settings-trigger'),
                  h.Class('text-button'),
                  h.Popovertarget('workspace-more'),
                  h.Popovertargetaction('hide'),
                  h.OnClick(Message.ClickedSettings()),
                ],
                ['Settings'],
              ),
            ],
          ),
        ],
      ),
      h.span(
        [h.Class('f-run-name'), h.Title(grill.title)],
        [grill.title.replace(/\s+[·—–-]\s+Open for you$/i, '')],
      ),
      h.nav(
        [h.Class('f-header-actions'), h.AriaLabel('Run actions')],
        [
          nudgeView(model, snapshot, h),
          bell,
          h.button(
            [
              h.Type('button'),
              h.Class(
                `text-button f-sessions-toggle${model.side === 'Talk' ? ' is-active' : ''}`,
              ),
              h.AriaExpanded(model.side === 'Talk'),
              h.OnClick(Message.ClickedSessions()),
            ],
            [
              'Sessions',
              sessionsBadge(model, snapshot, inbox) > 0
                ? h.span(
                    [h.Class('f-nav-count')],
                    [String(sessionsBadge(model, snapshot, inbox))],
                  )
                : h.empty,
            ],
          ),
          h.button(
            [
              h.Type('button'),
              h.Id('workspace-review-send'),
              h.Class(
                `send-button f-header-send${readyOf(model, snapshot).length > 0 ? ' has-unsent' : ''}`,
              ),
              h.AriaLabel(sendLabel),
              h.AriaExpanded(model.isTrayOpen),
              h.AriaKeyshortcuts('U'),
              h.Title(
                'Unsent answers (u) · ⌘-click sends your Review selection',
              ),
              h.Disabled(
                model.send === 'Sending' || model.quickSend !== 'Idle',
              ),
              h.OnClick(Message.ClickedUnsentTray()),
            ],
            [
              h.span(
                [h.Class('f-header-send-reserve'), h.AriaHidden(true)],
                [reviewLabel],
              ),
              h.span([h.Class('f-header-send-label')], [sendLabel]),
            ],
          ),
          freezePillView(inbox, h),
          h.button(
            [
              h.Type('button'),
              h.Class('text-button f-decisions-link'),
              h.Title('The redesign’s open decisions, on Squad overview'),
              h.OnClick(Message.ClickedWorkspacePage({ page: SQUAD })),
            ],
            [`Decisions · ${openDecisions()} open`],
          ),
        ],
      ),
    ],
  )
}

const questionView = (
  model: Model,
  snapshot: Snapshot,
  step: Step,
  reading: Reading,
  inbox: InboxData,
  h: H,
): Html => {
  const q = step.question
  const grill = snapshot.grill
  const askerAddress = questionSession(grill, q)
  const askerName =
    (q.from === undefined ? undefined : grill.sources?.[q.from]?.text) ??
    askerAddress
  return h.div(
    [h.Class('f-question-layout')],
    [
      h.article(
        [h.Class('f-reading-scroller')],
        [
          h.div([h.Id('workspace-top'), h.Tabindex(-1)]),
          questionsBar(model, snapshot, step, inbox, h),
          h.div(
            [h.Class('f-question-grid')],
            [
              questionSideList(model, snapshot, step, h),
              h.div(
                [
                  h.Class('f-reading'),
                  h.Id(`q-${q.id}`),
                  h.DataAttribute('quote-step', step.id),
                ],
                [
                  quotePopover(model, snapshot, step, h),
                  h.header(
                    [h.Class('f-question-reference')],
                    [
                      h.h1([h.Class('f-question-title')], [q.title]),
                      h.p(
                        [h.Class('f-question-ask'), h.Id(`ask-text-${q.id}`)],
                        reading.heading(q.ask, h),
                      ),
                      q.context === undefined || q.context.trim() === ''
                        ? h.empty
                        : h.p(
                            [h.Class('f-question-lead')],
                            reading.inline(q.context, h),
                          ),
                    ],
                  ),
                  h.div(
                    [h.Class('f-question-body')],
                    [
                      reading.status(step, h),
                      answersView(model, snapshot, step, reading, h),
                      questionMetaView(model, snapshot, step, inbox, h),
                      sentOnQuestionView(snapshot, q.id, h),
                      answerFollowUpView(snapshot, step, h),
                      backgroundView(model, snapshot, step, reading, inbox, h),
                      questionConversationView(
                        model,
                        snapshot,
                        step,
                        reading,
                        inbox,
                        askerName,
                        askerAddress,
                        h,
                      ),
                    ],
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
    ],
  )
}

/** Filter the queue, then step through it: F's facets above I's one-question page. */
const questionsBar = (
  model: Model,
  snapshot: Snapshot,
  step: Step,
  inbox: InboxData,
  h: H,
): Html => {
  const visibleAll = visibleQuestions(
    model.workspace,
    snapshot,
    model.answers,
    model.notes,
    model.own,
  )
  const narrowed = narrowedSnapshot(snapshot, model.pageQuery)
  const list = visibleQuestions(
    model.workspace,
    narrowed,
    model.answers,
    model.notes,
    model.own,
  )
  const index = list.findIndex(item => item.id === step.id)
  const query = model.pageQuery
  const pageOf = (item: Step) =>
    `${QUESTION_PAGE}${item.question.id}${query === '' ? '' : `?${query}`}`
  const previous = index > 0 ? list[index - 1] : undefined
  const next = index >= 0 ? list[index + 1] : list[0]
  const arrow = (direction: 'Previous' | 'Next', target: Step | undefined) =>
    h.button(
      [
        h.Type('button'),
        h.Class('f-question-arrow'),
        h.Disabled(target === undefined),
        h.AriaLabel(`${direction} question`),
        h.AriaKeyshortcuts(
          direction === 'Previous' ? 'ArrowLeft' : 'ArrowRight',
        ),
        h.Title(
          `${direction} in this list (${direction === 'Previous' ? 'Left' : 'Right'} arrow)`,
        ),
        ...(target === undefined
          ? []
          : [
              h.OnClick(Message.ClickedWorkspacePage({ page: pageOf(target) })),
            ]),
      ],
      [
        h.svg(
          [h.ViewBox('0 0 20 20'), h.AriaHidden(true)],
          [
            h.path([
              h.D(
                direction === 'Previous'
                  ? 'M16 10H4m5-5-5 5 5 5'
                  : 'M4 10h12m-5-5 5 5-5 5',
              ),
              h.Stroke('currentColor'),
              h.StrokeWidth('1.5'),
              h.Fill('none'),
            ]),
          ],
        ),
      ],
    )
  const count = (filter: typeof model.workspace.filter) =>
    visibleQuestions(
      modifyFields(model.workspace, {
        filter: () => filter,
        urgencyFilter: () => 'All',
      }),
      narrowed,
      model.answers,
      model.notes,
      model.own,
    ).length
  return h.section(
    [h.Class('f-questions-bar'), h.AriaLabel('Questions to work through')],
    [
      h.div(
        [h.Class('f-questions-bar-top')],
        [
          h.div(
            [h.Class('f-segmented'), h.Role('group'), h.AriaLabel('Show')],
            quickViews.map(preset =>
              h.button(
                [
                  h.Type('button'),
                  h.Class(
                    model.workspace.filter === preset.filter &&
                      model.workspace.urgencyFilter === preset.urgencyFilter
                      ? 'is-on'
                      : '',
                  ),
                  h.AriaPressed(
                    String(
                      model.workspace.filter === preset.filter &&
                        model.workspace.urgencyFilter === preset.urgencyFilter,
                    ),
                  ),
                  h.OnClick(
                    Message.SelectedQuestionView({
                      filter: preset.filter,
                      urgencyFilter: preset.urgencyFilter,
                    }),
                  ),
                ],
                [
                  `${preset.label} `,
                  h.span([h.Class('f-count')], [String(count(preset.filter))]),
                ],
              ),
            ),
          ),
          h.input([
            h.Type('search'),
            h.Class('f-questions-search'),
            h.Placeholder('Find a question or issue…'),
            h.AriaLabel('Find a question or issue'),
            h.Value(model.workspace.search),
            h.OnInput(value => Message.UpdatedQuestionSearch({ value })),
          ]),
          h.div(
            [h.Class('f-question-position')],
            [
              arrow('Previous', previous),
              h.span(
                [h.Class('f-question-count'), h.AriaLive('polite')],
                [
                  index >= 0
                    ? `${index + 1} of ${list.length}`
                    : `${list.length} in this list`,
                ],
              ),
              arrow('Next', next),
            ],
          ),
        ],
      ),
      questionFilterView(
        model,
        snapshot,
        inbox,
        visibleAll.map(item => questionOf(snapshot, item)),
        step.question.id,
        h,
      ),
    ],
  )
}

/** The question's facts in one line under its answers, each reference with its card. */
const questionMetaView = (
  model: Model,
  snapshot: Snapshot,
  step: Step,
  inbox: InboxData,
  h: H,
): Html => {
  const q = step.question
  const grill = snapshot.grill
  const askerAddress = questionSession(grill, q)
  const state = questionState(
    snapshot,
    step,
    model.answers,
    model.notes,
    model.own,
  )
  return h.div(
    [h.Class('f-question-meta')],
    [
      h.span([h.Class('f-question-id')], [q.id]),
      q.key === undefined ? h.empty : keyButton(model, q.key, h),
      q.issue === undefined
        ? h.empty
        : refView(
            linkCard(snapshot, q.issue),
            'question-meta',
            issueLink(snapshot, q.issue, h),
            h,
            false,
          ),
      q.round === undefined
        ? h.span([], ['No round'])
        : refView(
            roundCard(model, snapshot, q.round),
            'question-meta',
            `Round ${grill.roundNumbers?.[String(q.round)] ?? q.round}`,
            h,
          ),
      refView(
        sessionCard(model, snapshot, inbox, askerAddress),
        'question-meta',
        `asked by ${askerAddress}`,
        h,
      ),
      ...Option.toArray(
        Option.map(urgencyDetail(q), detail =>
          h.span([h.Class('f-question-urgency')], [detail]),
        ),
      ),
      h.span(
        [h.Class('f-state-label')],
        [
          stateMark(state, q, h),
          state === 'Draft' ? 'Draft · not sent' : state,
        ],
      ),
      ...Option.toArray(
        Option.map(answeredLabel(model, step), label =>
          h.span([h.Class('f-answered-label')], [label]),
        ),
      ),
      unreadBadge(questionUnread(model, snapshot, step), h),
      questionTimesView(snapshot, q.id, h),
    ],
  )
}

/** What came back on an answered question: the agent's reply naming it, and the decided line. */
const answerFollowUpView = (snapshot: Snapshot, step: Step, h: H): Html => {
  const decided = decidedLine(snapshot, step)
  const reply = replyOnQuestion(snapshot, step)
  return decided === undefined && reply === undefined
    ? h.empty
    : h.div(
        [h.Class('f-answer-follow-up')],
        [
          reply === undefined
            ? h.empty
            : h.p(
                [h.Class('f-reply-line')],
                [
                  h.b([], [`Reply · ${replySession(snapshot, reply)}`]),
                  ` ${reply.text
                    .split('\n')
                    .filter(line => line.trim() !== '')
                    .slice(1, 2)
                    .join(' ')
                    .replace(/[*_`]/g, '')
                    .slice(0, 220)}… `,
                  h.button(
                    [
                      h.Type('button'),
                      h.Class('text-button'),
                      h.OnClick(
                        Message.ClickedAgentMessage({
                          id: `reply-${reply.id}`,
                          inReplies: false,
                        }),
                      ),
                    ],
                    ['Open in thread ›'],
                  ),
                ],
              ),
          decided === undefined
            ? h.empty
            : h.p(
                [h.Class('f-decided-line')],
                [h.b([], ['Decided ']), decided],
              ),
        ],
      )
}

/** F's side list: every question the filters keep, beside the one in view. */
const questionSideList = (
  model: Model,
  snapshot: Snapshot,
  step: Step,
  h: H,
): Html => {
  const list = visibleQuestions(
    model.workspace,
    narrowedSnapshot(snapshot, model.pageQuery),
    model.answers,
    model.notes,
    model.own,
  )
  const query = model.pageQuery
  const pageOf = (item: Step) =>
    `${QUESTION_PAGE}${item.question.id}${query === '' ? '' : `?${query}`}`
  return h.nav(
    [h.Class('f-question-side'), h.AriaLabel('Matching questions')],
    [
      Array.isReadonlyArrayEmpty(list)
        ? h.p([h.Class('hint')], ['No question matches these filters.'])
        : h.ol(
            [h.Class('f-question-list')],
            list.map(item => {
              const itemState = questionState(
                snapshot,
                item,
                model.answers,
                model.notes,
                model.own,
              )
              return h.keyed('li')(
                item.id,
                [],
                [
                  h.button(
                    [
                      h.Type('button'),
                      h.Class(
                        `f-question-list-row${item.id === step.id ? ' is-current' : ''}`,
                      ),
                      h.AriaCurrent(item.id === step.id ? 'page' : 'false'),
                      h.OnClick(
                        Message.ClickedWorkspacePage({ page: pageOf(item) }),
                      ),
                    ],
                    [
                      stateMark(itemState, item.question, h),
                      h.span([h.Class('f-question-id')], [item.question.id]),
                      h.span(
                        [h.Class('f-question-list-title')],
                        [item.question.title],
                      ),
                      h.small(
                        [],
                        [
                          [
                            questionSession(snapshot.grill, item.question),
                            sidebarRoundName(
                              snapshot,
                              roundOf(snapshot.grill, item.question),
                            ),
                            ...Option.toArray(answeredLabel(model, item)),
                          ].join(' · '),
                        ],
                      ),
                      decidedLine(snapshot, item) === undefined
                        ? h.empty
                        : h.small(
                            [h.Class('f-question-decided')],
                            [`Decided: ${decidedLine(snapshot, item)}`],
                          ),
                      unreadBadge(questionUnread(model, snapshot, item), h),
                      messagesCount(snapshot, item, h),
                    ],
                  ),
                ],
              )
            }),
          ),
    ],
  )
}

// New messages about one question: agent answers to its asks, and in the preview fixture the
// new lines of its passage and side threads.
const questionUnread = (model: Model, snapshot: Snapshot, step: Step): number =>
  unreadOf(
    agentMessagesOf(snapshot).filter(message => message.stepId === step.id),
    Option.getOrElse(model.readSince, () => Infinity),
    model.readIds,
  ).length +
  (model.inbox.isFixture
    ? fixtureThreads(snapshot, step, '')
        .flatMap(thread => thread.lines)
        .filter(line => line.isNew === true).length
    : 0)

const unreadBadge = (count: number, h: H): Html =>
  count === 0
    ? h.empty
    : h.span(
        [h.Class('f-nav-count is-hot f-question-unread')],
        [`${count} new`],
      )

const answeredLabel = (model: Model, step: Step): Option.Option<string> =>
  Option.map(
    Option.fromNullishOr(model.answers[step.question.id]),
    answer => `Answered ${answer === OWN ? 'own' : answer}`,
  )

const messagesCount = (snapshot: Snapshot, step: Step, h: H): Html => {
  const ref = snapshot.discussions?.[step.question.id]
  return ref === undefined || ref.asks + ref.replies === 0
    ? h.empty
    : h.span(
        [h.Class('f-message-count'), h.Title(messageCount(ref))],
        [String(ref.asks + ref.replies)],
      )
}

const backgroundView = (
  model: Model,
  snapshot: Snapshot,
  step: Step,
  reading: Reading,
  inbox: InboxData,
  h: H,
): Html => {
  const q = step.question
  const isOpen = model.whyOpen[step.id] === true
  const passages = model.inbox.isFixture
    ? fixtureThreads(snapshot, step, '').filter(
        thread => thread.kind === 'Passage',
      ).length
    : 0
  const parts = [
    'Trade-offs and details',
    ...(q.compare === undefined ? [] : ['comparison table']),
    ...(passages > 0 ? [`${passages} quoted passages`] : []),
  ]
  return h.section(
    [h.Class('f-background'), h.Id('workspace-reasoning')],
    [
      h.h2([], ['Summary']),
      reading.summary(step, h),
      ...(isOpen
        ? [
            q.compare === undefined
              ? h.empty
              : h.h3([], ['How the answers compare']),
            reading.comparison(step, h),
            drawingPanel(model, snapshot, step, reading.drawing, h),
            h.h3([], ['Details']),
            reading.details(step, h),
            reading.related(step, h),
            h.p(
              [h.Class('hint')],
              ['Select a sentence to quote it into a new thread below.'],
            ),
            h.details(
              [h.Class('f-question-source')],
              [
                h.summary([], ['Scope and source details']),
                h.p([], [q.scope]),
                reading.source(step, h),
                snapshot.questionOrigins?.[q.id] === undefined
                  ? h.empty
                  : h.p(
                      [],
                      [
                        h.a(
                          [
                            h.Href(
                              sourceQuestionHref(
                                snapshot.grill.id,
                                snapshot.questionOrigins[q.id]!.grill,
                                snapshot.questionOrigins[q.id]!.question,
                              ),
                            ),
                          ],
                          ['Source question link'],
                        ),
                      ],
                    ),
              ],
            ),
          ]
        : []),
      h.button(
        [
          h.Type('button'),
          h.Class('text-button f-background-toggle'),
          h.AriaExpanded(isOpen),
          h.OnClick(
            Message.ClickedToggleWhy({ stepId: step.id, open: !isOpen }),
          ),
        ],
        [isOpen ? 'Hide trade-offs and details' : parts.join(' · ')],
      ),
    ],
  )
}

const nestedThreadView = (model: Model, thread: NestedThread, h: H): Html => {
  const isOpen = Option.contains(model.inbox.maybeOpenThread, thread.key)
  const local = model.inbox.threads[thread.key] ?? []
  const lines: ReadonlyArray<ThreadLine> = [
    ...thread.lines,
    ...local.map(message => ({
      isYou: message.from === 'You',
      name: message.from === 'You' ? 'You' : thread.name,
      text: message.text,
      time: '',
    })),
  ]
  const shown = isOpen ? lines : lines.slice(-1)
  const draft = model.inbox.threadDrafts[thread.key] ?? ''
  const fresh = lines.filter(line => line.isNew === true).length
  return h.keyed('div')(
    thread.key,
    [
      h.Class(
        `f-nested is-${thread.kind.toLowerCase()}${isOpen ? ' is-open' : ''}`,
      ),
    ],
    [
      h.div(
        [h.Class('f-nested-title')],
        thread.kind === 'Passage'
          ? [
              h.span([h.Class('f-quote-mark'), h.AriaHidden(true)], ['“']),
              h.em(
                [h.Class(thread.orphanedIn === undefined ? '' : 'is-orphan')],
                [thread.quote ?? ''],
              ),
              thread.orphanedIn === undefined
                ? h.empty
                : h.small(
                    [h.Class('hint')],
                    [
                      ` · this passage changed in revision ${thread.orphanedIn}; the thread stays here`,
                    ],
                  ),
              fresh > 0
                ? h.span([h.Class('f-new-badge')], [`${fresh} new`])
                : h.empty,
            ]
          : [
              h.span([h.Class('f-thread-dot'), h.AriaHidden(true)]),
              `Side thread with ${thread.name} · ${thread.address}`,
            ],
      ),
      ...shown.map(line => threadLineView(line, h)),
      isOpen
        ? h.form(
            [
              h.Class('f-inline-reply'),
              h.OnSubmit(Message.SubmittedThreadMessage({ item: thread.key })),
            ],
            [
              h.textarea([
                h.Rows(2),
                h.Value(draft),
                h.AriaLabel(`Reply to ${thread.name} in this thread`),
                h.Placeholder(`Reply to ${thread.name} in this thread…`),
                h.OnInput(text =>
                  Message.UpdatedThreadDraft({ item: thread.key, text }),
                ),
              ]),
              h.div(
                [h.Class('f-send-foot')],
                [
                  h.span(
                    [h.Class('hint')],
                    [`Preview: stays here until ${thread.key} delivery lands`],
                  ),
                  h.button(
                    [
                      h.Type('button'),
                      h.Class('text-button'),
                      h.OnClick(
                        Message.ClickedNestedThread({ key: thread.key }),
                      ),
                    ],
                    ['Collapse'],
                  ),
                  h.button(
                    [
                      h.Type('submit'),
                      h.Class('send-button'),
                      h.Disabled(draft.trim() === ''),
                    ],
                    ['Reply in thread'],
                  ),
                ],
              ),
            ],
          )
        : h.button(
            [
              h.Type('button'),
              h.Class('text-button'),
              h.OnClick(Message.ClickedNestedThread({ key: thread.key })),
            ],
            [
              lines.length > 1
                ? `Show all ${lines.length} · reply in thread`
                : 'Reply in thread',
            ],
          ),
    ],
  )
}

const threadLineView = (line: ThreadLine, h: H): Html =>
  h.div(
    [h.Class(`f-thread-line${line.isYou ? ' is-you' : ''}`)],
    [
      h.div(
        [h.Class('f-thread-line-head')],
        [
          h.b([], [line.name]),
          line.time === '' ? h.empty : h.span([h.Class('hint')], [line.time]),
          line.isNew === true
            ? h.span([h.Class('f-new-badge')], ['New'])
            : h.empty,
        ],
      ),
      h.p([], [line.text]),
    ],
  )

/** One-click asks by the composer; each sends at once, its full wording in the title. */
const startersView = (step: Step, h: H): Html =>
  h.div(
    [h.Class('f-starters'), h.Role('group'), h.AriaLabel('Quick asks')],
    STARTERS.map(([label, text]) =>
      h.button(
        [
          h.Type('button'),
          h.Class('f-starter'),
          h.Title(`Sends: ${text}`),
          h.OnClick(
            Message.ClickedConversationStarter({ target: step.id, text }),
          ),
        ],
        [label],
      ),
    ),
  )

const questionConversationView = (
  model: Model,
  snapshot: Snapshot,
  step: Step,
  reading: Reading,
  inbox: InboxData,
  askerName: string,
  askerAddress: string,
  h: H,
): Html => {
  const thread = reading.thread(step.id, h)
  const draftKey = threadDraftKey(step.id)
  const draft = model.talkDrafts[draftKey] ?? ''
  const isClosed = Option.exists(
    sessionOf(inbox, askerAddress),
    session => session.type === 'Ended',
  )
  const lead = snapshot.grill.session
  const routedTo = isClosed && lead !== '' ? lead : askerAddress
  const nested = [
    ...(model.inbox.isFixture ? fixtureThreads(snapshot, step, askerName) : []),
    ...model.inbox.sideThreads
      .filter(key => key.startsWith(`${step.id}@`))
      .map((key): NestedThread => ({
        key,
        kind: 'Side',
        address: key.slice(step.id.length + 1),
        name: key.slice(step.id.length + 1),
        lines: [],
      })),
  ]
  return h.section(
    [h.Class('f-question-conversation'), h.AriaLabel('Conversation')],
    [
      h.h2([], ['Conversation']),
      h.div(
        [h.Class('f-timeline')],
        [
          ...thread,
          ...nested.map(item => nestedThreadView(model, item, h)),
          Array.isReadonlyArrayEmpty(thread) &&
          Array.isReadonlyArrayEmpty(nested)
            ? h.p(
                [h.Class('hint')],
                [
                  'No conversation yet. Ask about an option, challenge the reasoning, or select a passage to quote it.',
                ],
              )
            : h.empty,
        ],
      ),
      h.button(
        [
          h.Type('button'),
          h.Class('text-button f-side-start'),
          h.AriaExpanded(model.inbox.isSidePickerOpen),
          h.OnClick(Message.ClickedStartSideThread()),
        ],
        ['+ Start a side thread with someone else about this question'],
      ),
      model.inbox.isSidePickerOpen
        ? h.div(
            [h.Class('f-side-picker')],
            inbox.sessions
              .filter(
                session =>
                  session.address !== askerAddress && session.type !== 'Ended',
              )
              .map(session =>
                h.button(
                  [
                    h.Type('button'),
                    h.Class('f-side-picker-row'),
                    h.OnClick(
                      Message.ClickedSideThreadWith({
                        key: threadTarget(step.id, session.address),
                      }),
                    ),
                  ],
                  [h.b([], [session.label]), h.small([], [session.address])],
                ),
              ),
          )
        : h.empty,
      h.form(
        [
          h.Class('f-question-compose'),
          h.OnSubmit(Message.SubmittedWorkspaceDiscussion({ target: step.id })),
        ],
        [
          h.label(
            [h.For(`compose-${step.id}`), h.Class('f-compose-to')],
            [
              'Reply to ',
              h.b([], [`${askerName} · ${routedTo}`]),
              h.small(
                [h.Class('hint')],
                [
                  isClosed
                    ? ` ${askerAddress} is closed; messages go to the lead, ${lead}`
                    : ' asked this question',
                ],
              ),
            ],
          ),
          h.keyed('textarea')(`compose-${step.id}-${model.talkGeneration}`, [
            h.Id(`compose-${step.id}`),
            h.DataAttribute(DRAFT_ATTRIBUTE, draftKey),
            h.Rows(3),
            h.OnMount(FillBox({ text: draft })),
            h.Placeholder(`Reply to ${askerName}…`),
            h.OnInput(value =>
              Message.UpdatedTalkDraft({ partId: draftKey, value }),
            ),
            h.OnKeyDownPreventDefault((key, { shiftKey }) =>
              key === 'Enter' && !shiftKey
                ? Option.some(
                    Message.SubmittedWorkspaceDiscussion({ target: step.id }),
                  )
                : Option.none(),
            ),
          ]),
          textLimitCount(draft, h),
          Array.isReadonlyArrayEmpty(thread) &&
          Array.isReadonlyArrayEmpty(nested)
            ? startersView(step, h)
            : h.details(
                [h.Class('f-suggestions')],
                [h.summary([], ['Suggestions']), startersView(step, h)],
              ),
          h.div(
            [h.Class('f-send-foot')],
            [
              h.span(
                [h.Class('hint')],
                ['Enter to send · thread replies go in their thread above'],
              ),
              h.button(
                [
                  h.Type('submit'),
                  h.Class('send-button'),
                  h.Disabled(isOverTextLimit(draft.trim())),
                ],
                [`Send to ${askerName}`],
              ),
            ],
          ),
        ],
      ),
    ],
  )
}

const quoteDestinationLabel = (snapshot: Snapshot, target: string): string =>
  target === GRILL_FLOW_TARGET
    ? NAMES.brand
    : target === RUN_TARGET
      ? 'the run'
      : (snapshot.grill.steps.find(item => item.id === target)?.question.id ??
        snapshot.grill.parts.find(part => `part:${part.id}` === target)
          ?.title ??
        target)

const quotePopover = (
  model: Model,
  snapshot: Snapshot,
  step: Step,
  h: H,
): Html => {
  if (
    model.workspace.quote._tag === 'Idle' ||
    model.workspace.quote.quoted.stepId !== step.id
  ) {
    return h.empty
  }
  const quote = model.workspace.quote
  const quoted = quote.quoted
  const destination = quoteDestinationLabel(
    snapshot,
    quoteDestination(
      model.side === 'Talk',
      model.workspace.maybeDiscussionTarget,
      step.id,
    ),
  )
  const position = h.Style({
    top: `${quoted.placement === 'Above' ? quoted.top : quoted.bottom}px`,
    left: `${quoted.left}px`,
  })
  const placement = `is-${quoted.placement.toLowerCase()}`
  const quoteReply = quotedAsk(quoted.text, model.talkDrafts[QUOTE_DRAFT] ?? '')
  return quote._tag === 'Offered'
    ? h.div(
        [
          h.Class(`${QUOTE_POPOVER_CLASS} ${placement}`),
          h.Role('toolbar'),
          h.AriaLabel('Selected text'),
          position,
        ],
        [
          h.button(
            [
              h.Type('button'),
              h.Title(`Add it as a quote to the ${destination} discussion`),
              h.OnClick(Message.ClickedQuoteInDiscussion()),
            ],
            ['Quote'],
          ),
          h.button(
            [h.Type('button'), h.OnClick(Message.ClickedQuoteReply())],
            ['Reply'],
          ),
        ],
      )
    : h.form(
        [
          h.Class(`${QUOTE_POPOVER_CLASS} ${placement} is-composing`),
          h.AriaLabel('Reply to the selected text'),
          position,
          h.OnSubmit(Message.SubmittedQuoteReply()),
        ],
        [
          h.blockquote([h.Class('f-quote-excerpt')], [quoted.text]),
          h.label([h.For(QUOTE_BOX)], [`Reply · to ${destination}`]),
          h.keyed('textarea')(`${QUOTE_BOX}-${model.talkGeneration}`, [
            h.Id(QUOTE_BOX),
            h.DataAttribute(DRAFT_ATTRIBUTE, QUOTE_DRAFT),
            h.Rows(3),
            h.OnMount(FillBox({ text: model.talkDrafts[QUOTE_DRAFT] ?? '' })),
            h.Placeholder('Ask about this, or push back on it…'),
            h.OnInput(value =>
              Message.UpdatedTalkDraft({ partId: QUOTE_DRAFT, value }),
            ),
            h.OnKeyDownPreventDefault((key, { shiftKey }) =>
              key === 'Enter' && !shiftKey
                ? Option.some(Message.SubmittedQuoteReply())
                : Option.none(),
            ),
          ]),
          textLimitCount(quoteReply, h),
          h.div(
            [h.Class('f-quote-foot')],
            [
              h.button(
                [
                  h.Type('button'),
                  h.Class('text-button'),
                  h.OnClick(Message.DismissedQuote()),
                ],
                ['Cancel'],
              ),
              h.button(
                [
                  h.Type('submit'),
                  h.Class('send-button'),
                  h.Disabled(isOverTextLimit(quoteReply)),
                ],
                ['Send'],
              ),
            ],
          ),
        ],
      )
}

const dayOf = (at: number): string =>
  new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
const clockOf = (at: number): string =>
  new Date(at).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  })

export const questionTimesLabel = (times: QuestionTimes): string => {
  const posted = `Posted ${dayOf(times.posted)} ${clockOf(times.posted)}`
  if (times.edited === undefined) {
    return posted
  }
  const editedDay =
    dayOf(times.edited) === dayOf(times.posted) ? '' : `${dayOf(times.edited)} `
  return `${posted} · edited ${editedDay}${clockOf(times.edited)}`
}

const questionTimesView = (snapshot: Snapshot, id: string, h: H): Html =>
  Option.match(Option.fromUndefinedOr(snapshot.questionTimes?.[id]), {
    onNone: () => h.empty,
    onSome: times =>
      h.span([h.Class('f-question-times')], [questionTimesLabel(times)]),
  })

const issueLink = (
  snapshot: Snapshot,
  issue: string | undefined,
  h: H,
): Html => {
  if (issue === undefined) return h.empty
  const ref = snapshot.grill.refs?.[issue]
  return ref?.url === undefined
    ? h.span([], [issue])
    : h.a(
        [
          h.Href(ref.url),
          h.Target('_blank'),
          h.Rel('noreferrer'),
          h.Title([issue, ref.state, ref.text].filter(Boolean).join(' · ')),
        ],
        [issue],
      )
}

const messageCount = (ref: DiscussionRef): string => {
  const count = ref.asks + ref.replies
  return `${count} ${count === 1 ? 'message' : 'messages'}`
}

const answersView = (
  model: Model,
  snapshot: Snapshot,
  step: Step,
  reading: Reading,
  h: H,
): Html => {
  const q = step.question
  const selected = model.answers[q.id]
  const state = statusOf(snapshot.grill, model.answers, q.id, model.skipped)
  const blocked = state._tag === 'Waiting' || state._tag === 'NotNeeded'
  const sentState = questionState(
    snapshot,
    step,
    model.answers,
    model.notes,
    model.own,
  )
  const pick = (
    key: string,
    label: string,
    effect: string,
    recommended: boolean,
  ) =>
    h.button(
      [
        h.Type('button'),
        h.Class(
          `f-answer-pill${selected === key ? ' is-selected' : ''}${key === OWN ? ' is-own' : ''}`,
        ),
        h.Role('radio'),
        h.AriaChecked(selected === key),
        h.Disabled(blocked),
        h.Title(effect),
        h.OnClick(
          key === OWN
            ? Message.SelectedOwnAnswer({ question: q.id })
            : Message.SelectedOption({ question: q.id, key }),
        ),
      ],
      [
        h.span([h.Class('f-answer-radio'), h.AriaHidden(true)]),
        key === OWN ? h.empty : h.b([], [key]),
        h.span([], reading.answer(label, h)),
        recommended
          ? h.span(
              [h.Class('f-recommended-dot'), h.Title('Recommended')],
              [h.span([h.Class('sr-only')], ['Recommended'])],
            )
          : h.empty,
      ],
    )
  const pickedOption = q.options.find(option => option.key === selected)
  const saved =
    model.pendingEvents > 0
      ? 'Saving…'
      : sentState === 'Sent'
        ? 'Sent'
        : selected === undefined
          ? 'Nothing sent yet'
          : 'Draft saved · not sent'
  return h.section(
    [h.Class('f-answer-section')],
    [
      h.div(
        [
          h.Class('f-answer-row'),
          h.Role('radiogroup'),
          h.AriaLabelledBy(`ask-text-${q.id}`),
        ],
        [
          ...q.options.map(option =>
            pick(option.key, option.label, option.effect, option.recommended),
          ),
          pick(
            OWN,
            'Write my own…',
            'A different choice, in your words.',
            false,
          ),
        ],
      ),
      sentState === 'Sent' && selected !== undefined
        ? h.p(
            [h.Class('f-sent-line')],
            [
              h.b(
                [],
                [
                  selected === OWN
                    ? 'Sent your own answer'
                    : `Sent ${selected} · ${pickedOption?.label ?? ''}`,
                ],
              ),
              (model.notes[q.id] ?? '') === ''
                ? ''
                : ` with note: “${model.notes[q.id]}”`,
              ' · pick another answer to change it.',
            ],
          )
        : h.empty,
      selected === OWN
        ? h.textarea([
            h.Id(`own-${q.id}`),
            h.Class('f-own-box'),
            h.Rows(3),
            h.AriaLabel('Your own answer'),
            h.Placeholder('Write your answer…'),
            h.OnMount(FillBox({ text: model.own[q.id] ?? '' })),
            h.OnInput(value =>
              Message.UpdatedOwnAnswer({ question: q.id, value }),
            ),
            h.OnBlur(Message.BlurredOwnAnswer({ question: q.id })),
          ])
        : h.empty,
      selected === OWN ? textLimitCount(model.own[q.id] ?? '', h) : h.empty,
      selected !== undefined && selected !== OWN
        ? h.textarea([
            h.Class('f-note'),
            h.Id(`note-${q.id}`),
            h.Rows(2),
            h.AriaLabel('Note with this answer'),
            h.Placeholder(
              `Add a note to ${selected} · ${pickedOption?.label ?? ''} (optional)…`,
            ),
            h.OnMount(FillBox({ text: model.notes[q.id] ?? '' })),
            h.OnInput(value => Message.UpdatedNote({ question: q.id, value })),
            h.OnBlur(Message.BlurredNote({ question: q.id })),
          ])
        : h.empty,
      textLimitCount(model.notes[q.id] ?? '', h),
      sendStripView(model, snapshot, step, h),
      h.div(
        [h.Class('f-answer-actions')],
        [
          drawingButton(model, snapshot, step, h),
          link('Skip for now', Message.ClickedSkip({ question: q.id }), h),
          selected === undefined
            ? h.empty
            : link(
                'Clear answer',
                Message.ClickedClearAnswer({ question: q.id }),
                h,
              ),
          h.span([h.Class('f-saved'), h.Role('status')], [saved]),
        ],
      ),
    ],
  )
}

const reviewView = (
  model: Model,
  snapshot: Snapshot,
  reading: Reading,
  h: H,
): Html => {
  const drafts = draftAnswerIds(snapshot, model.answers, model.notes, model.own)
  const isLeftOut = (id: string) =>
    model.workspace.excluded.includes(id) || model.keptBack.includes(id)
  const selected = drafts.filter(id => !isLeftOut(id))
  const recipients = Array.dedupe(
    selected.map(id =>
      questionSession(
        snapshot.grill,
        snapshot.grill.steps.find(step => step.question.id === id)?.question,
      ),
    ),
  )
  const query = model.workspace.reviewQuery.trim().toLocaleLowerCase()
  const lines = workspaceLines(snapshot, model.answers, model.notes, model.own)
  const unlisted = drafts.filter(
    id =>
      !snapshot.grill.steps.some(step => step.question.id === id) &&
      `${id} ${lines[id]}`.toLocaleLowerCase().includes(query),
  )
  const visible = draftQuestions(
    snapshot,
    model.answers,
    model.notes,
    model.own,
  ).filter(step =>
    [
      step.question.id,
      step.question.title,
      step.question.ask,
      step.question.issue ?? '',
      answerLabel(step, model.answers, model.own),
    ]
      .join(' ')
      .toLocaleLowerCase()
      .includes(query),
  )
  return h.section(
    [h.Class('f-page f-review')],
    [
      h.h1([], ['Review & send']),
      h.p(
        [h.Class('f-review-summary')],
        [
          `${drafts.length} drafts · ${selected.length} selected · ${recipients.length} recipient${recipients.length === 1 ? '' : 's'}`,
        ],
      ),
      h.div(
        [h.Class('f-review-tools')],
        [
          h.label(
            [],
            [
              h.input([
                h.Type('checkbox'),
                h.Checked(
                  selected.length === drafts.length && drafts.length > 0,
                ),
                h.AriaLabel('Select all drafts'),
                h.OnClick(
                  Message.ClickedSelectReview({
                    selected: selected.length !== drafts.length,
                  }),
                ),
              ]),
              `Select all ${drafts.length}`,
            ],
          ),
          h.input([
            h.Type('search'),
            h.Placeholder('Find a question or answer…'),
            h.AriaLabel('Find a question or answer'),
            h.Value(model.workspace.reviewQuery),
            h.OnInput(value => Message.UpdatedReviewQuery({ value })),
          ]),
        ],
      ),
      h.div(
        [h.Class('f-table-scroll f-review-table-scroll')],
        [
          h.table(
            [h.Class('f-table f-review-table')],
            [
              h.thead(
                [],
                [
                  h.tr(
                    [],
                    ['Send', 'Question', 'Your answer', ''].map(label =>
                      h.th([h.Scope('col')], [label]),
                    ),
                  ),
                ],
              ),
              h.tbody(
                [],
                visible
                  .flatMap(step => {
                    const id = step.question.id
                    const expanded = model.workspace.reviewExpanded.includes(id)
                    return [
                      h.keyed('tr')(
                        step.id,
                        [h.Class(isLeftOut(id) ? 'is-excluded' : '')],
                        [
                          h.td(
                            [],
                            [
                              h.input([
                                h.Type('checkbox'),
                                h.Checked(!isLeftOut(id)),
                                h.AriaLabel(`Send ${id}`),
                                h.OnClick(
                                  Message.ToggledReviewAnswer({ question: id }),
                                ),
                              ]),
                            ],
                          ),
                          h.td(
                            [],
                            [
                              h.b(
                                [h.Title(step.question.ask)],
                                [step.question.title],
                              ),
                              h.small(
                                [],
                                [
                                  `${id}${step.question.issue === undefined ? '' : ` · ${step.question.issue}`} · ${answerRoundLabel(snapshot.grill, step)}`,
                                  h.br([]),
                                  `To ${questionAgent(snapshot.grill, step.question)}${model.keptBack.includes(id) ? ' · Kept back' : ''}`,
                                ],
                              ),
                            ],
                          ),
                          h.td(
                            [],
                            [
                              h.p(
                                [
                                  h.Title(
                                    answerLabel(step, model.answers, model.own),
                                  ),
                                ],
                                reading.answer(
                                  answerLabel(step, model.answers, model.own),
                                  h,
                                ),
                              ),
                              (model.notes[id] ?? '') === ''
                                ? h.empty
                                : h.small([], ['Has a note']),
                            ],
                          ),
                          h.td(
                            [],
                            [
                              h.button(
                                [
                                  h.Class('text-button'),
                                  h.AriaLabel(
                                    `${expanded ? 'Hide' : 'Show'} details for ${id}`,
                                  ),
                                  h.AriaExpanded(expanded),
                                  h.OnClick(
                                    Message.ClickedReviewDetail({
                                      question: id,
                                    }),
                                  ),
                                ],
                                [expanded ? 'Less' : 'Details'],
                              ),
                            ],
                          ),
                        ],
                      ),
                      ...(expanded
                        ? [
                            h.keyed('tr')(
                              `detail-${step.id}`,
                              [],
                              [
                                h.td(
                                  [h.Colspan(4)],
                                  [
                                    h.div(
                                      [h.Class('f-review-detail')],
                                      [
                                        h.h3(
                                          [],
                                          reading.heading(step.question.ask, h),
                                        ),
                                        h.p(
                                          [],
                                          reading.answer(
                                            answerLabel(
                                              step,
                                              model.answers,
                                              model.own,
                                            ),
                                            h,
                                          ),
                                        ),
                                        (model.notes[id] ?? '') === ''
                                          ? h.empty
                                          : h.p([], [model.notes[id] ?? '']),
                                        h.div(
                                          [h.Class('f-actions')],
                                          [
                                            pageLink(
                                              'Edit answer',
                                              `${QUESTION_PAGE}${id}`,
                                              h,
                                            ),
                                            link(
                                              'Discuss',
                                              Message.ClickedDiscussion({
                                                target: step.id,
                                              }),
                                              h,
                                            ),
                                          ],
                                        ),
                                      ],
                                    ),
                                  ],
                                ),
                              ],
                            ),
                          ]
                        : []),
                    ]
                  })
                  .concat(
                    unlisted.map(id =>
                      unlistedReviewRow(model, id, lines[id] ?? '', h),
                    ),
                  ),
              ),
            ],
          ),
          visible.length === 0 && unlisted.length === 0
            ? h.p(
                [h.Class('f-empty')],
                [
                  drafts.length === 0
                    ? 'No drafts to send. Choose an answer on a question page; it will appear here.'
                    : 'No drafts match this search.',
                ],
              )
            : h.empty,
        ],
      ),
      h.div(
        [h.Class('f-review-compose')],
        [
          h.label(
            [h.For('send-message')],
            ['Message to the selected recipients'],
          ),
          h.small(
            [h.Class('hint')],
            [
              recipients
                .map(session => session || 'Agent collects replies here')
                .join(' · '),
            ],
          ),
          h.textarea([
            h.Id('send-message'),
            h.Rows(2),
            h.OnMount(FillBox({ text: model.sendMessage })),
            h.Placeholder('Anything else the agent should know…'),
            h.OnInput(value => Message.UpdatedSendMessage({ value })),
          ]),
          textLimitCount(model.sendMessage, h),
          h.div(
            [h.Class('f-send-foot')],
            [
              h.span(
                [h.Class('hint'), h.AriaLive('polite')],
                [
                  model.send === 'Failed'
                    ? `Not sent: ${model.sendDetail}`
                    : model.send === 'Sent' && drafts.length === 0
                      ? model.sendDetail
                      : `${selected.length} selected · ${drafts.length - selected.length} drafts stay here · ⌘ / Ctrl + Enter to send`,
                ],
              ),
              h.button(
                [
                  h.Class('send-button'),
                  h.Disabled(
                    model.send === 'Sending' ||
                      model.pendingEvents > 0 ||
                      Option.isSome(model.maybeSaveError) ||
                      isOverTextLimit(model.sendMessage) ||
                      selected.length === 0,
                  ),
                  h.OnClick(Message.ClickedConfirmSend()),
                ],
                [
                  model.send === 'Sending'
                    ? 'Sending…'
                    : `Send ${selected.length} answer${selected.length === 1 ? '' : 's'}`,
                ],
              ),
            ],
          ),
        ],
      ),
    ],
  )
}

const unlistedReviewRow = (
  model: Model,
  id: string,
  line: string,
  h: H,
): Html =>
  h.keyed('tr')(
    `unlisted-${id}`,
    [h.Class(model.workspace.excluded.includes(id) ? 'is-excluded' : '')],
    [
      h.td(
        [],
        [
          h.input([
            h.Type('checkbox'),
            h.Checked(!model.workspace.excluded.includes(id)),
            h.AriaLabel(`Send ${id}`),
            h.OnClick(Message.ToggledReviewAnswer({ question: id })),
          ]),
        ],
      ),
      h.td(
        [],
        [
          h.b([], [id]),
          h.small([], ['Question no longer listed · round unavailable']),
          h.small([], ['To the grill session']),
        ],
      ),
      h.td([], [h.p([], [line])]),
      h.td([], ['Not sent']),
    ],
  )

const discussionView = (
  model: Model,
  snapshot: Snapshot,
  reading: Reading,
  expanded: boolean,
  h: H,
  // In the sessions panel: some note when the session closed and can't receive messages.
  maybePanel: Option.Option<Option.Option<string>> = Option.none(),
): Html => {
  const isInPanel = Option.isSome(maybePanel)
  const maybeClosed = Option.flatten(maybePanel)
  const onQuestion = Option.orElse(
    questionOnPage(snapshot, model.currentPart),
    () =>
      Option.flatMap(model.maybePrevious, page =>
        questionOnPage(snapshot, page),
      ),
  )
  const target = Option.getOrElse(model.workspace.maybeDiscussionTarget, () =>
    Option.match(onQuestion, {
      onSome: step => step.id,
      onNone: () => RUN_TARGET,
    }),
  )
  const step = snapshot.grill.steps.find(item => item.id === target)
  const draft = model.talkDrafts[threadDraftKey(target)] ?? ''
  const thread = reading.thread(target, h)
  const isMaintainer = target === GRILL_FLOW_TARGET
  const context =
    step === undefined
      ? h.div(
          [h.Class('f-context')],
          [
            h.h3(
              [],
              [
                isMaintainer
                  ? 'Improving the board'
                  : agentAddressOf(target) !== undefined
                    ? `Direct message · ${agentLabel(snapshot, agentAddressOf(target)!)}`
                    : snapshot.grill.title,
              ],
            ),
            ...(agentAddressOf(target) !== undefined
              ? [
                  h.p(
                    [],
                    [
                      'This conversation goes straight to this agent in Herdr, outside any question. Replies appear here.',
                    ],
                  ),
                ]
              : isMaintainer
                ? [
                    h.p(
                      [],
                      [
                        'Ask about the interface, report a problem, or discuss an improvement. This conversation goes directly to the session building Squad Board.',
                      ],
                    ),
                  ]
                : snapshot.grill.intro.map(text => reading.prose(text, h))),
          ],
        )
      : h.div(
          [h.Class('f-context')],
          [
            expanded ? h.h2([], ['Context for this conversation']) : h.empty,
            h.h3([], [`${step.question.id} · ${step.question.title}`]),
            h.p([], reading.heading(step.question.ask, h)),
            h.details(
              [],
              [
                h.summary([], ['What were the answers?']),
                h.dl(
                  [],
                  step.question.options.flatMap(option => [
                    h.dt([], [`${option.key} · ${option.label}`]),
                    h.dd([], [option.effect]),
                  ]),
                ),
              ],
            ),
            expanded ? reading.reasoning(step, h) : h.empty,
          ],
        )
  return h.aside(
    [
      h.Class(
        `f-discussion${expanded ? ' is-expanded' : ''}${isInPanel ? ' is-in-panel' : ''}`,
      ),
      h.AriaLabel('Discussion'),
    ],
    [
      isInPanel
        ? h.empty
        : h.header(
            [h.Class('f-discussion-head')],
            [
              h.h2([], ['Discussion']),
              h.span(
                [h.Class('hint')],
                [
                  isMaintainer
                    ? `${NAMES.brand} · ${maintainerLabel(snapshot)}`
                    : agentAddressOf(target) !== undefined
                      ? agentLabel(snapshot, agentAddressOf(target)!)
                      : questionAgent(snapshot.grill, step?.question),
                ],
              ),
              isInPanel
                ? h.empty
                : h.div(
                    [h.Class('f-discussion-actions')],
                    [
                      model.currentPart === CONVERSATIONS
                        ? h.empty
                        : link(
                            expanded ? 'Back' : 'Expand',
                            Message.ClickedExpandDiscussion(),
                            h,
                          ),
                      model.currentPart === CONVERSATIONS
                        ? link(
                            'Back',
                            Message.ClickedReturnConversation({ open: true }),
                            h,
                          )
                        : h.empty,
                      model.currentPart === CONVERSATIONS
                        ? link(
                            'Close',
                            Message.ClickedReturnConversation({ open: false }),
                            h,
                          )
                        : link('Close', Message.ClickedCloseDiscussion(), h),
                    ],
                  ),
            ],
          ),
      isInPanel
        ? h.empty
        : recipientPicker(
            snapshot,
            target,
            step === undefined ? onQuestion : Option.some(step),
            h,
          ),
      h.div(
        [
          h.Class('f-discussion-messages'),
          h.DataAttribute('discussion-target', target),
          h.OnScroll(top => Message.ScrolledDiscussion({ target, top })),
          h.OnMount(
            RestoreDiscussionScroll({
              top: model.workspace.discussionScroll[target] ?? 0,
            }),
          ),
        ],
        [
          expanded || step !== undefined ? context : h.empty,
          isMaintainer ? maintainerWarning(snapshot, h) : h.empty,
          ...(Array.isReadonlyArrayEmpty(thread)
            ? [
                h.div(
                  [h.Class('f-empty-chat')],
                  [
                    h.h3(
                      [],
                      [
                        isMaintainer
                          ? 'What should work better?'
                          : step === undefined
                            ? 'A question beyond one card?'
                            : 'What would help you decide?',
                      ],
                    ),
                    h.p(
                      [],
                      [
                        isMaintainer
                          ? 'Describe what you are trying to do and what gets in your way. Replies appear here.'
                          : step === undefined
                            ? 'Ask about priorities, progress or what the run is waiting on. Replies stay in this conversation.'
                            : 'Ask about an option, challenge the reasoning, or request a rewrite. This thread will stay attached to the question.',
                      ],
                    ),
                  ],
                ),
              ]
            : thread),
        ],
      ),
      Option.isSome(maybeClosed)
        ? h.div(
            [h.Class('f-discussion-closed'), h.Role('note')],
            [
              h.p([], [maybeClosed.value]),
              h.button(
                [
                  h.Type('button'),
                  h.Class('quiet-button'),
                  h.OnClick(Message.ClickedOpenSession({ target: RUN_TARGET })),
                ],
                ['Message the lead instead'],
              ),
            ],
          )
        : h.form(
            [
              h.Class('f-discussion-compose'),
              h.OnSubmit(Message.SubmittedWorkspaceDiscussion({ target })),
            ],
            [
              h.label(
                [h.For('talk-box')],
                [
                  isMaintainer
                    ? 'Ask about the board'
                    : agentAddressOf(target) !== undefined
                      ? isInPanel
                        ? `Message ${agentAddressOf(target)}`
                        : `Message ${agentLabel(snapshot, agentAddressOf(target)!)}`
                      : step === undefined
                        ? 'Ask about the run'
                        : `Ask about ${step.question.id}`,
                ],
              ),
              h.keyed('textarea')(
                `discussion-${target}-${model.talkGeneration}`,
                [
                  h.Id('talk-box'),
                  h.DataAttribute(DRAFT_ATTRIBUTE, threadDraftKey(target)),
                  h.Rows(4),
                  h.OnMount(FillBox({ text: draft })),
                  h.Placeholder(
                    'Ask, push back, or ask for a clearer explanation…',
                  ),
                  h.OnInput(value =>
                    Message.UpdatedTalkDraft({
                      partId: threadDraftKey(target),
                      value,
                    }),
                  ),
                  h.OnKeyDownPreventDefault((key, { shiftKey }) =>
                    key === 'Enter' && !shiftKey
                      ? Option.some(
                          Message.SubmittedWorkspaceDiscussion({ target }),
                        )
                      : Option.none(),
                  ),
                ],
              ),
              textLimitCount(draft, h),
              h.div(
                [h.Class('f-send-foot')],
                [
                  h.span(
                    [h.Class('hint')],
                    ['Enter to send · Shift + Enter for a new line'],
                  ),
                  h.button(
                    [
                      h.Type('submit'),
                      h.Class('send-button'),
                      h.Disabled(isOverTextLimit(draft.trim())),
                    ],
                    ['Ask'],
                  ),
                ],
              ),
            ],
          ),
    ],
  )
}

const agentLabel = (snapshot: Snapshot, address: string): string => {
  const agent = snapshot.agents?.find(item => item.address === address)
  return agent === undefined
    ? `${address} · not running`
    : `${agent.lead ? 'Lead · ' : ''}${agent.name === '' ? agent.program : agent.name} · ${address}`
}

type Recipient = Readonly<{ target: string; label: string }>

/**
 * Who a message goes to: this page's question or run, any running agent of the squad's Herdr
 * space (lead first), or the grill-flow maintainer even while it is down.
 */
const recipientGroups = (
  snapshot: Snapshot,
  target: string,
  maybeQuestion: Option.Option<Step>,
): ReadonlyArray<
  Readonly<{ label: string; recipients: ReadonlyArray<Recipient> }>
> => {
  const session = snapshot.grill.session
  const agents = (snapshot.agents ?? []).filter(
    agent =>
      agent.address !== snapshot.maintainerSession &&
      (agent.lead || agent.address !== session),
  )
  const strayAgent = Option.filter(
    Option.fromUndefinedOr(agentAddressOf(target)),
    address => !agents.some(agent => agent.address === address),
  )
  const page: ReadonlyArray<Recipient> = [
    ...Option.match(maybeQuestion, {
      onNone: () => [],
      onSome: question => [
        {
          target: question.id,
          label: `This question · ${question.question.id} · ${questionAgent(snapshot.grill, question.question)}`,
        },
      ],
    }),
    {
      target: RUN_TARGET,
      label: `Run · ${session === '' ? 'its agent' : session}`,
    },
  ]
  const squad: ReadonlyArray<Recipient> = [
    ...agents.map(agent => ({
      target: agentTarget(agent.address),
      label: `${agent.lead ? '★ ' : ''}${agentLabel(snapshot, agent.address)}`,
    })),
    ...Option.match(strayAgent, {
      onNone: () => [],
      onSome: address => [
        { target: agentTarget(address), label: agentLabel(snapshot, address) },
      ],
    }),
  ]
  return [
    { label: 'This page', recipients: page },
    ...(Array.isReadonlyArrayEmpty(squad)
      ? []
      : [{ label: 'Squad agents in Herdr', recipients: squad }]),
    ...(snapshot.maintainerSession === undefined
      ? []
      : [
          {
            label: NAMES.brand,
            recipients: [
              {
                target: GRILL_FLOW_TARGET,
                label: `${NAMES.brand} · ${maintainerLabel(snapshot)}`,
              },
            ],
          },
        ]),
  ]
}

const recipientPicker = (
  snapshot: Snapshot,
  target: string,
  maybeQuestion: Option.Option<Step>,
  h: H,
): Html =>
  h.label(
    [h.Class('f-discussion-scope')],
    [
      h.span([], ['To']),
      h.select(
        [
          h.Id('discussion-recipient'),
          h.AriaLabel('To'),
          h.Value(target),
          h.OnChange(value =>
            Message.SelectedDiscussionTarget({ target: value }),
          ),
        ],
        recipientGroups(snapshot, target, maybeQuestion).map(group =>
          h.optgroup(
            [h.Attribute('label', group.label)],
            group.recipients.map(recipient =>
              h.option(
                [
                  h.Value(recipient.target),
                  h.Selected(recipient.target === target),
                ],
                [recipient.label],
              ),
            ),
          ),
        ),
      ),
    ],
  )

const maintainerWarning = (snapshot: Snapshot, h: H): Html =>
  snapshot.maintainerState === 'missing' ||
  snapshot.maintainerState === 'stopped'
    ? h.p(
        [h.Class('f-maintainer-warning'), h.Role('status')],
        [
          `${snapshot.maintainerSession} is ${snapshot.maintainerState === 'missing' ? 'no longer in Herdr' : 'not running'}, so messages here will not reach it.`,
          snapshot.grill.session === ''
            ? ' Restart the board’s server with GF_MAINTAINER_SESSION set to a running session.'
            : ` Each undelivered message offers to go to ${snapshot.grill.session} instead.`,
        ],
      )
    : h.empty

const catalogSnapshots = (
  model: Model,
  snapshot: Snapshot,
): ReadonlyArray<Snapshot> => {
  const catalog = Option.getOrElse(
    AsyncData.getData(model.workspace.catalog),
    () => [snapshot],
  )
  return catalog.map(state =>
    state.grill.id === snapshot.grill.id ? snapshot : state,
  )
}

const catalogStatus = (model: Model, h: H): Html =>
  AsyncData.match(model.workspace.catalog, {
    onIdle: () => h.p([h.Class('hint')], ['Loading other grills…']),
    onLoading: () => h.p([h.Class('hint')], ['Loading other grills…']),
    onFailure: error =>
      h.p(
        [h.Class('f-catalog-error'), h.Role('alert')],
        [error, ' ', link('Retry', Message.ClickedRefreshCatalog(), h)],
      ),
    onStale: () => h.empty,
    onRefreshing: () => h.p([h.Class('hint')], ['Refreshing…']),
    onSuccess: () => h.empty,
  })

const neededCount = (snapshot: Snapshot): number =>
  snapshot.grill.steps.filter(
    step =>
      statusOf(snapshot.grill, snapshot.answers, step.question.id)._tag !==
        'NotNeeded' &&
      questionState(
        snapshot,
        step,
        snapshot.answers,
        snapshot.notes,
        snapshot.own,
      ) !== 'Sent',
  ).length +
  draftAnswerIds(
    snapshot,
    snapshot.answers,
    snapshot.notes,
    snapshot.own,
  ).filter(id => !snapshot.grill.steps.some(step => step.question.id === id))
    .length +
  ownerWorkCounts(snapshot).actions +
  ownerWorkCounts(snapshot).provisional
const workOf = (snapshot: Snapshot) => {
  const issues = snapshot.grill.plan?.issues ?? []
  return {
    current: issues.filter(issue =>
      ['building', 'review', 'stuck'].includes(issue.phase),
    ),
    completed: issues.filter(issue => issue.phase === 'merged'),
    later: issues.filter(
      issue => !['building', 'review', 'stuck', 'merged'].includes(issue.phase),
    ),
  }
}

const workState = (
  snapshot: Snapshot,
  issue: PlanIssue,
  answers: typeof snapshot.answers,
): string =>
  ({
    building: 'Building',
    review: 'In review',
    merged: 'Merged',
    ready: 'Ready',
    you: 'Needs you',
    stuck: 'Stuck',
    after: 'Waiting',
    outside: 'Outside this run',
  })[planPhaseOf(snapshot.grill, issue, answers)]
const workTable = (
  model: Model,
  snapshot: Snapshot,
  issues: ReadonlyArray<PlanIssue>,
  reading: Reading,
  h: H,
): Html =>
  h.div(
    [h.Class('f-table-scroll')],
    [
      h.table(
        [h.Class('f-table f-work-table')],
        [
          h.thead(
            [],
            [
              h.tr(
                [],
                ['Work', 'State', 'Next action', 'Session'].map(label =>
                  h.th([h.Scope('col')], [label]),
                ),
              ),
            ],
          ),
          h.tbody(
            [],
            issues.map(issue => {
              const gates = Array.dedupe([
                ...(issue.start ?? []),
                ...(issue.review ?? []),
              ])
              const question = snapshot.grill.steps.find(
                step =>
                  gates.includes(step.question.id) &&
                  questionState(
                    snapshot,
                    step,
                    model.answers,
                    model.notes,
                    model.own,
                  ) !== 'Sent',
              )
              const state = workState(snapshot, issue, model.answers)
              const fromHere =
                snapshot.grill.id ===
                Option.getOrElse(AsyncData.getData(model.page), () => snapshot)
                  .grill.id
              return h.keyed('tr')(
                issue.id,
                [],
                [
                  h.td(
                    [],
                    [
                      h.b([], [issue.title]),
                      h.small(
                        [],
                        [
                          issue.id,
                          issue.note === undefined ? '' : ` · ${issue.note}`,
                        ],
                      ),
                    ],
                  ),
                  h.td(
                    [],
                    [
                      h.span(
                        [
                          h.Class(
                            `f-work-state${state === 'Merged' ? ' is-done' : state === 'Needs you' ? ' needs-you' : ''}`,
                          ),
                        ],
                        [state],
                      ),
                    ],
                  ),
                  h.td(
                    [],
                    [
                      question === undefined
                        ? h.span(
                            [],
                            [
                              state === 'Merged'
                                ? 'Completed'
                                : state === 'In review'
                                  ? 'Review continues'
                                  : (issue.follows?.length ?? 0) > 0
                                    ? `After ${issue.follows?.join(', ')}`
                                    : state,
                            ],
                          )
                        : fromHere
                          ? pageLink(
                              `${model.answers[question.question.id] === undefined ? 'Answer' : 'Review'} ${question.question.id}`,
                              `${QUESTION_PAGE}${question.question.id}`,
                              h,
                            )
                          : h.a(
                              [
                                h.Href(
                                  `/g/${encodeURIComponent(snapshot.grill.id)}/question/${encodeURIComponent(question.question.id)}`,
                                ),
                              ],
                              [`Review ${question.question.id}`],
                            ),
                    ],
                  ),
                  h.td(
                    [],
                    [
                      h.b(
                        [],
                        [
                          issue.agent ??
                            (snapshot.grill.session || 'Not supplied'),
                        ],
                      ),
                      h.small(
                        [],
                        [
                          issue.agent === undefined
                            ? 'Run orchestrator'
                            : 'Assigned session',
                        ],
                      ),
                    ],
                  ),
                ],
              )
            }),
          ),
        ],
      ),
      issues.length === 0
        ? h.p([h.Class('f-empty hint')], ['No work in this section.'])
        : h.empty,
    ],
  )

const runView = (
  model: Model,
  snapshot: Snapshot,
  reading: Reading,
  h: H,
): Html => {
  const work = workOf(snapshot)
  const section = model.workspace.workSection
  const issues =
    section === 'Completed'
      ? work.completed
      : section === 'Later'
        ? work.later
        : work.current
  const lead = snapshot.grill.intro[0]?.split(/(?<=\.)\s/)[0] ?? ''
  return h.section(
    [h.Class('f-page f-run-overview')],
    [
      h.h1([], [snapshot.grill.title]),
      h.p([h.Class('f-lead')], [lead]),
      h.p(
        [h.Class('f-run-guidance')],
        [
          `${work.completed.length} completed · ${work.current.length} current · ${work.later.length} later${snapshot.grill.plan?.slots === undefined ? '' : ` · ${snapshot.grill.plan.slots} session slots`}`,
        ],
      ),
      h.nav(
        [h.Class('f-work-tabs'), h.AriaLabel('Run sections')],
        (
          [
            'Now',
            'Completed',
            'Later',
            'Sessions',
            'Dependencies',
          ] satisfies ReadonlyArray<typeof section>
        ).map(tab =>
          h.button(
            [
              h.Class(`quiet-button${section === tab ? ' is-active' : ''}`),
              h.AriaPressed(String(section === tab)),
              h.OnClick(Message.SelectedWorkSection({ section: tab })),
            ],
            [
              `${tab === 'Now' ? 'Current work' : tab}${tab === 'Now' ? ` · ${work.current.length}` : tab === 'Completed' ? ` · ${work.completed.length}` : tab === 'Later' ? ` · ${work.later.length}` : ''}`,
            ],
          ),
        ),
      ),
      section === 'Sessions'
        ? sessionsView(snapshot, h)
        : section === 'Dependencies'
          ? dependenciesView(snapshot, h)
          : workTable(model, snapshot, issues, reading, h),
      h.details(
        [h.Class('f-run-brief')],
        [
          h.summary([], ['Run brief and what comes next']),
          ...snapshot.grill.intro.map(text => reading.prose(text, h)),
          h.h2([], ['After this round']),
          ...snapshot.grill.next.map(text => reading.prose(text, h)),
        ],
      ),
    ],
  )
}

const sessionsView = (snapshot: Snapshot, h: H): Html => {
  const sessions = Array.dedupe([
    snapshot.grill.session,
    ...(snapshot.grill.plan?.issues ?? []).flatMap(issue =>
      issue.agent === undefined ? [] : [issue.agent],
    ),
  ]).filter(session => session !== '')
  return h.div(
    [h.Class('f-table-scroll')],
    [
      h.table(
        [h.Class('f-table f-work-table')],
        [
          h.thead(
            [],
            [
              h.tr(
                [],
                ['Session', 'Role', 'Work'].map(label =>
                  h.th([h.Scope('col')], [label]),
                ),
              ),
            ],
          ),
          h.tbody(
            [],
            sessions.map(session =>
              h.keyed('tr')(
                session,
                [],
                [
                  h.td([], [h.b([], [session])]),
                  h.td(
                    [],
                    [
                      session === snapshot.grill.session
                        ? 'Run orchestrator'
                        : 'Assigned session',
                    ],
                  ),
                  h.td(
                    [],
                    [
                      (snapshot.grill.plan?.issues ?? [])
                        .filter(issue => issue.agent === session)
                        .map(issue => issue.id)
                        .join(', ') || snapshot.grill.title,
                    ],
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
      sessions.length === 0
        ? h.p(
            [h.Class('f-empty hint')],
            ['No participating sessions supplied.'],
          )
        : h.empty,
    ],
  )
}

const dependenciesView = (snapshot: Snapshot, h: H): Html =>
  h.div(
    [h.Class('f-table-scroll')],
    [
      h.table(
        [h.Class('f-table f-work-table')],
        [
          h.thead(
            [],
            [
              h.tr(
                [],
                [
                  'Work',
                  'Depends on work',
                  'Questions before starting',
                  'Questions before review',
                ].map(label => h.th([h.Scope('col')], [label])),
              ),
            ],
          ),
          h.tbody(
            [],
            (snapshot.grill.plan?.issues ?? []).map(issue =>
              h.keyed('tr')(
                issue.id,
                [],
                [
                  h.td([], [h.b([], [issue.title]), h.small([], [issue.id])]),
                  h.td([], [issue.follows?.join(', ') || 'None']),
                  h.td(
                    [],
                    (issue.start ?? []).map(id =>
                      pageLink(id, `${QUESTION_PAGE}${id}`, h),
                    ),
                  ),
                  h.td(
                    [],
                    (issue.review ?? []).map(id =>
                      pageLink(id, `${QUESTION_PAGE}${id}`, h),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    ],
  )

const squadRuns = (
  model: Model,
  snapshot: Snapshot,
): ReadonlyArray<Snapshot> => {
  const squad = snapshot.grill.squad?.id ?? snapshot.grill.id
  return catalogSnapshots(model, snapshot).filter(
    state => state.grill.id !== squad && state.grill.squad?.id === squad,
  )
}

// Which session published from a channel source, read off what that source published.
const sessionOfSource = (
  snapshot: Snapshot,
): Readonly<Record<string, string>> =>
  Object.fromEntries(
    [
      ...(snapshot.updates ?? []),
      ...(snapshot.ownerSteps ?? []),
      ...(snapshot.decisions ?? []),
      ...(snapshot.blockers ?? []),
    ].map(entry => [entry.source, entry.item.session]),
  )

const when = (at: number): string =>
  new Date(at).toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })

/** Runs › one session: what used to live on Updates, What changed and Run overview. */
const runDetailView = (
  model: Model,
  snapshot: Snapshot,
  reading: Reading,
  address: string,
  h: H,
): Html => {
  const earlier = Array.sort(
    (snapshot.updates ?? []).filter(
      entry =>
        entry.item.session === address && entry.supersededBy !== undefined,
    ),
    Order.flip(
      Order.mapInput(
        Order.Number,
        (entry: NonNullable<Snapshot['updates']>[number]) => entry.at,
      ),
    ),
  )
  const sources = sessionOfSource(snapshot)
  const activity = (snapshot.activity?.entries ?? []).filter(
    entry => sources[entry.source] === address,
  )
  const run = squadRuns(model, snapshot).find(
    state => state.grill.session === address,
  )
  const planned =
    run ?? (snapshot.grill.session === address ? snapshot : undefined)
  const issues =
    planned?.grill.plan?.issues.filter(
      issue =>
        planned !== snapshot ||
        issue.agent === address ||
        (issue.agent === undefined && snapshot.grill.session === address),
    ) ?? []
  const fold = (title: string, count: number, body: ReadonlyArray<Html>) =>
    h.details(
      [h.Class('f-run-fold')],
      [
        h.summary(
          [],
          [title, ' ', h.span([h.Class('f-count')], [String(count)])],
        ),
        ...body,
      ],
    )
  return h.div(
    [h.Class('f-run-detail')],
    [
      fold(
        'Earlier status',
        earlier.length,
        Array.isReadonlyArrayEmpty(earlier)
          ? [h.p([h.Class('hint')], ['No earlier status from this session.'])]
          : earlier.map(entry =>
              h.keyed('article')(
                `${entry.source}:${entry.event}`,
                [h.Class('f-earlier-status')],
                [
                  h.p(
                    [h.Class('f-channel-meta')],
                    [`${entry.item.title ?? 'Status'} · ${when(entry.at)}`],
                  ),
                  reading.prose(entry.displayBody ?? entry.item.body, h),
                ],
              ),
            ),
      ),
      fold(
        'Activity',
        activity.length,
        Array.isReadonlyArrayEmpty(activity)
          ? [
              h.p(
                [h.Class('hint')],
                ['No activity from this session in the loaded feed.'],
              ),
            ]
          : [
              h.ol(
                [h.Class('f-run-activity')],
                activity.map(entry =>
                  h.keyed('li')(
                    `${entry.source}:${entry.event}`,
                    [],
                    [
                      h.span([h.Class('hint')], [when(entry.at)]),
                      h.b([], [entry.label]),
                      h.span([], [entry.summary.replace(/[*#]+/g, '')]),
                    ],
                  ),
                ),
              ),
            ],
      ),
      planned === undefined || Array.isReadonlyArrayEmpty(issues)
        ? h.empty
        : fold('Work', issues.length, [
            workTable(model, planned, issues, reading, h),
          ]),
      planned?.grill.plan === undefined
        ? h.empty
        : fold(
            'Dependencies',
            planned.grill.plan.issues.filter(
              issue => (issue.follows ?? []).length > 0,
            ).length,
            [dependenciesView(planned, h)],
          ),
      planned === undefined || planned.grill.plan === undefined
        ? h.empty
        : fold('Brief', planned.grill.intro.length, [
            ...planned.grill.intro.map(text => reading.prose(text, h)),
            h.h3([], ['After this round']),
            ...planned.grill.next.map(text => reading.prose(text, h)),
          ]),
    ],
  )
}

/** The squad's runs from the loaded boards: active first, the completed ones folded. */
const runsTableSection = (model: Model, snapshot: Snapshot, h: H): Html => {
  const runs = squadRuns(model, snapshot)
  const active = runs.filter(
    state => workOf(state).current.length > 0 || neededCount(state) > 0,
  )
  const completed = runs.filter(state => !active.includes(state))
  const table = (states: ReadonlyArray<Snapshot>) =>
    h.div(
      [h.Class('f-table-scroll')],
      [
        h.table(
          [h.Class('f-table f-work-table f-runs-table')],
          [
            h.thead(
              [],
              [
                h.tr(
                  [],
                  [
                    'Run',
                    'State',
                    'Completed',
                    'Remaining',
                    'Attention',
                    'Orchestrator',
                  ].map(label => h.th([h.Scope('col')], [label])),
                ),
              ],
            ),
            h.tbody(
              [],
              states.map(state => {
                const work = workOf(state)
                return h.keyed('tr')(
                  state.grill.id,
                  [],
                  [
                    h.td(
                      [],
                      [
                        h.a(
                          [
                            h.Href(
                              `/g/${encodeURIComponent(state.grill.id)}/plan`,
                            ),
                          ],
                          [state.grill.title],
                        ),
                        h.small([], [state.grill.id]),
                      ],
                    ),
                    h.td(
                      [],
                      [
                        work.current.length > 0
                          ? 'Running'
                          : neededCount(state) > 0
                            ? 'Needs you'
                            : 'Complete',
                      ],
                    ),
                    h.td([], [String(work.completed.length)]),
                    h.td(
                      [],
                      [
                        String(
                          work.current.length +
                            work.later.filter(
                              issue => issue.phase !== 'outside',
                            ).length,
                        ),
                      ],
                    ),
                    h.td(
                      [],
                      [
                        h.button(
                          [
                            h.Type('button'),
                            h.Class('text-button'),
                            h.Title(
                              `Open the Inbox filtered to ${state.grill.session || state.grill.id}`,
                            ),
                            h.OnClick(
                              Message.ClickedWorkspacePage({
                                page:
                                  state.grill.session === ''
                                    ? INBOX
                                    : `${INBOX}?run=${encodeURIComponent(state.grill.session)}`,
                              }),
                            ),
                          ],
                          [
                            `${neededCount(state)} ${ownerWorkCounts(state).actions + ownerWorkCounts(state).provisional > 0 ? (neededCount(state) === 1 ? 'item' : 'items') : neededCount(state) === 1 ? 'question' : 'questions'}`,
                          ],
                        ),
                      ],
                    ),
                    h.td([], [state.grill.session || 'Not supplied']),
                  ],
                )
              }),
            ),
          ],
        ),
      ],
    )
  return h.section(
    [h.Class('f-runs-table-section'), h.AriaLabel('Active runs')],
    [
      h.div(
        [h.Class('f-section-heading')],
        [
          h.h2([], ['Active runs']),
          link('Refresh', Message.ClickedRefreshCatalog(), h),
        ],
      ),
      catalogStatus(model, h),
      table(active),
      active.length === 0
        ? h.p(
            [h.Class('f-empty hint')],
            ['No active squad runs in the loaded boards.'],
          )
        : h.empty,
      completed.length > 0
        ? h.details(
            [h.Class('f-archive')],
            [
              h.summary([], [`Completed runs · ${completed.length}`]),
              table(completed),
            ],
          )
        : h.empty,
    ],
  )
}

const squadView = (snapshot: Snapshot, h: H): Html =>
  h.section(
    [h.Class('f-page f-squad-overview')],
    [
      h.h1([], [boardName(snapshot.grill)]),
      h.p(
        [h.Class('f-lead')],
        [
          'The redesign’s decision panel: every page part we retire and every piece this design leaves out, with where it goes. The runs table now lives on Runs.',
        ],
      ),
      decisionPanelView(h),
    ],
  )

const grillsView = (model: Model, snapshot: Snapshot, h: H): Html => {
  const states = catalogSnapshots(model, snapshot)
  const machine = (state: Snapshot) =>
    state.grill.session.includes('/')
      ? (state.grill.session.split('/')[0] ?? 'This machine')
      : 'This machine'
  const machines = Array.dedupe(states.map(machine))
  const row = (state: Snapshot) =>
    h.keyed('a')(
      state.grill.id,
      [
        h.Href(`/g/${encodeURIComponent(state.grill.id)}`),
        h.Class('f-grill-row'),
      ],
      [
        h.div(
          [],
          [
            h.b([], [state.grill.title]),
            h.small([], [state.grill.session || 'Agent collects replies here']),
          ],
        ),
        h.span(
          [h.Class('f-work-state')],
          [
            neededCount(state) === 0
              ? 'All sent'
              : ownerWorkCounts(state).actions +
                    ownerWorkCounts(state).provisional >
                  0
                ? `${neededCount(state)} ${neededCount(state) === 1 ? 'item needs' : 'items need'} attention`
                : `${neededCount(state)} not sent`,
          ],
        ),
      ],
    )
  return h.section(
    [h.Class('f-page')],
    [
      h.h1([], ['Your grills']),
      h.p(
        [h.Class('f-lead')],
        ['Questions and decisions from your agents, grouped by machine.'],
      ),
      h.div(
        [h.Class('f-section-heading')],
        [
          h.h2([], ['Grills']),
          link('Refresh', Message.ClickedRefreshCatalog(), h),
        ],
      ),
      catalogStatus(model, h),
      ...machines.map(name => {
        const group = states.filter(state => machine(state) === name)
        const archived = group.filter(state => neededCount(state) === 0)
        return h.section(
          [h.Class('f-machine-group')],
          [
            h.h2([], [name]),
            ...group.filter(state => neededCount(state) > 0).map(row),
            h.details(
              [h.Class('f-archive')],
              [
                h.summary([], [`Archived · ${archived.length}`]),
                ...archived.map(row),
              ],
            ),
          ],
        )
      }),
    ],
  )
}
