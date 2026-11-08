import { Array, Option } from 'effect'
import { AsyncData } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { modifyFields } from 'foldkit/struct'

import { activityUnreadCount } from './activity'
import { activityView } from './activityView'
import { attentionView } from './attentionView'
import { ownerWorkCounts } from './channel'
import { channelRevealAttributes } from './channelReveal'
import {
  answerHistoryView,
  sourceQuestionHref,
  updatesView,
} from './channelView'
import {
  FORMAT_VERSION,
  GRILL_FLOW_TARGET,
  OWN,
  type PlanIssue,
  type Question,
  type Snapshot,
  type Step,
  agentMessagesOf,
  answerRoundLabel,
  planPhaseOf,
  questionAgent,
  questionSession,
  roundLabel,
  roundOf,
  statusOf,
  urgencyDetail,
} from './domain'
import { drawingButton, drawingPanel } from './drawingView'
import type { QuestionDrawing } from './drawings'
import {
  FillBox,
  Message,
  type Model,
  RestoreDiscussionScroll,
  type SidebarEdge,
  threadDraftKey,
} from './main'
import { rosterView } from './rosterView'
import {
  ANSWER_HISTORY,
  CHANGES,
  CONVERSATIONS,
  GRILLS,
  NEEDS,
  QUESTION_PAGE,
  type QuestionNode,
  REPLIES,
  REVIEW,
  RUN_TARGET,
  SQUAD,
  UPDATES,
  adjacentQuestion,
  answerLabel,
  draftAnswerIds,
  draftQuestions,
  questionGroups,
  questionOnPage,
  questionState,
  questionUrgencyFilterFrom,
  quickViews,
  selectedRound,
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
  thread: (target: string, h: H) => ReadonlyArray<Html>
  overview: (h: H) => Html
  decided: (h: H) => Html
  resize: (edge: SidebarEdge, h: H) => Html
  notices: (h: H) => Html
}>

const link = (label: string, message: Message, h: H): Html =>
  h.button(
    [h.Type('button'), h.Class('text-button'), h.OnClick(message)],
    [label],
  )

const pageLink = (label: string, page: string, h: H): Html =>
  link(label, Message.ClickedWorkspacePage({ page }), h)

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

const questionNodeView = (
  model: Model,
  snapshot: Snapshot,
  node: QuestionNode,
  h: H,
): Html => {
  const step = node.step
  const state = questionState(
    snapshot,
    step,
    model.answers,
    model.notes,
    model.own,
  )
  const hasChildren = Array.isReadonlyArrayNonEmpty(node.children)
  const collapsed =
    model.workspace.search.trim() === '' &&
    model.workspace.foldedQuestions.includes(step.question.id)
  const urgency = Option.getOrElse(urgencyDetail(step.question), () => '')
  return h.keyed('li')(
    step.id,
    [h.Class('f-question-node'), h.Id(`question-node-${step.question.id}`)],
    [
      h.div(
        [h.Class('f-question-row')],
        [
          h.button(
            [
              h.Class(
                `f-question-item${model.currentPart === `${QUESTION_PAGE}${step.question.id}` ? ' is-current' : ''}`,
              ),
              h.OnClick(
                Message.ClickedWorkspacePage({
                  page: `${QUESTION_PAGE}${step.question.id}`,
                }),
              ),
              h.AriaCurrent(
                model.currentPart === `${QUESTION_PAGE}${step.question.id}`
                  ? 'page'
                  : 'false',
              ),
              h.Title(
                `${step.question.id} · ${state} · ${step.question.title} · Asked by ${questionAgent(snapshot.grill, step.question)} · ${roundLabel(snapshot.grill, roundOf(snapshot.grill, step.question))}${urgency === '' ? '' : ` · ${urgency}`}`,
              ),
            ],
            [
              stateMark(state, step.question, h),
              h.span([h.Class('f-question-number')], [step.question.id]),
              h.span([], [step.question.title]),
              h.span(
                [h.Class('sr-only')],
                [
                  `${state}${state === 'Open' && urgency !== '' ? ` · ${urgency}` : ''}`,
                ],
              ),
            ],
          ),
          hasChildren
            ? h.button(
                [
                  h.Class('f-question-branch'),
                  h.AriaExpanded(!collapsed),
                  h.AriaControls(`question-children-${step.question.id}`),
                  h.AriaLabel(
                    `${collapsed ? 'Expand' : 'Collapse'} dependents of ${step.question.id}`,
                  ),
                  h.Title(`Questions waiting on ${step.question.id}`),
                  h.OnClick(
                    Message.ClickedQuestionBranch({
                      question: step.question.id,
                    }),
                  ),
                ],
                [
                  h.svg(
                    [
                      h.ViewBox('0 0 16 16'),
                      h.Class(collapsed ? '' : 'is-open'),
                      h.AriaHidden(true),
                    ],
                    [
                      h.path([
                        h.D('m6 4 4 4-4 4'),
                        h.Fill('none'),
                        h.Stroke('currentColor'),
                        h.StrokeWidth('1.5'),
                      ]),
                    ],
                  ),
                ],
              )
            : h.empty,
        ],
      ),
      hasChildren && !collapsed
        ? h.ul(
            [
              h.Class('f-question-children'),
              h.Id(`question-children-${step.question.id}`),
            ],
            node.children.map(child =>
              questionNodeView(model, snapshot, child, h),
            ),
          )
        : h.empty,
    ],
  )
}

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
          'Alerts for new or newly urgent Blocking/Soon questions and owner actions while a grill-flow page is open. Enabling starts with future changes. Alerts open the item in a new tab.',
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
    id => !model.workspace.excluded.includes(id),
  )
  const reviewLabel = `Review & send${drafts.length > 0 ? ` · ${drafts.length}` : ''}`
  const sendLabel =
    model.send === 'Sending'
      ? 'Sending…'
      : model.quickSend !== 'Idle'
        ? 'Saving…'
        : model.isCommandHeld
          ? `Send${selectedDrafts.length > 0 ? ` · ${selectedDrafts.length}` : ''}`
          : reviewLabel
  const question = questionOnPage(snapshot, model.currentPart)
  const isDiscussion =
    model.side === 'Talk' || model.currentPart === CONVERSATIONS
  const expanded =
    model.workspace.isDiscussionExpanded || model.currentPart === CONVERSATIONS
  const styles = {
    '--nav-w': `${Option.getOrElse(model.maybeNavWidth, () => 438)}px`,
    '--side-set': `${Option.getOrElse(model.maybeSideWidth, () => 400)}px`,
  }
  const content =
    model.currentPart === CHANGES
      ? activityView(model, snapshot, h)
      : model.currentPart === UPDATES
        ? updatesView(model, snapshot, reading.prose, h)
        : model.currentPart === ANSWER_HISTORY
          ? answerHistoryView(model, snapshot, h)
          : model.currentPart === SQUAD
            ? squadView(model, snapshot, reading, h)
            : model.currentPart === GRILLS
              ? grillsView(model, snapshot, h)
              : model.currentPart === REVIEW
                ? reviewView(model, snapshot, reading, h)
                : model.currentPart === REPLIES
                  ? repliesView(model, snapshot, reading, h)
                  : model.currentPart === NEEDS
                    ? needsView(model, snapshot, reading, h)
                    : model.currentPart === 'plan' ||
                        model.currentPart === 'status'
                      ? runView(model, snapshot, reading, h)
                      : model.currentPart === 'decided'
                        ? reading.decided(h)
                        : model.currentPart === CONVERSATIONS
                          ? conversationPage(model, snapshot, reading, h)
                          : Option.match(question, {
                              onSome: step =>
                                questionView(model, snapshot, step, reading, h),
                              onNone: () => reading.overview(h),
                            })
  return h.div(
    [
      h.Class(
        `app f-workspace${model.workspace.highlightTerms ? '' : ' f-no-highlights'}${Option.isSome(model.maybeResizing) ? ' is-resizing' : ''}`,
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
      h.header(
        [h.Class('f-topbar')],
        [
          h.a(
            [h.Href('/'), h.Class('f-run-name'), h.Title('All grills')],
            [grill.title],
          ),
          h.div(
            [h.Class('f-page-location')],
            [
              h.span(
                [h.Class('f-current-round')],
                [
                  grill.squad?.id === grill.id && Option.isNone(question)
                    ? 'Squad'
                    : roundLabel(
                        grill,
                        Option.match(question, {
                          onSome: step => roundOf(grill, step.question),
                          onNone: () => grill.round,
                        }),
                      ),
                ],
              ),
              h.span(
                [h.Class('f-current-question')],
                [
                  Option.match(question, {
                    onSome: step => step.question.id,
                    onNone: () => workspacePageName(model.currentPart),
                  }),
                ],
              ),
            ],
          ),
          h.nav(
            [h.AriaLabel('Run actions')],
            [
              h.button(
                [
                  h.Class(
                    `text-button${model.currentPart === CONVERSATIONS ? ' is-active' : ''}`,
                  ),
                  h.AriaCurrent(
                    model.currentPart === CONVERSATIONS ? 'page' : 'false',
                  ),
                  h.OnClick(
                    Message.ClickedWorkspacePage({ page: CONVERSATIONS }),
                  ),
                ],
                ['Conversations'],
              ),
              pageLink(
                `Replies${agentMessagesOf(snapshot).filter(message => !model.readIds.includes(message.id) && message.at > Option.getOrElse(model.readSince, () => Infinity)).length > 0 ? ' · new' : ''}`,
                REPLIES,
                h,
              ),
              h.button(
                [
                  h.Id('workspace-review-send'),
                  h.Class('send-button f-header-send'),
                  h.AriaLabel(sendLabel),
                  h.Disabled(
                    model.send === 'Sending' || model.quickSend !== 'Idle',
                  ),
                  h.OnClick(Message.ClickedWorkspacePage({ page: REVIEW })),
                ],
                [
                  h.span(
                    [h.Class('f-header-send-reserve'), h.AriaHidden(true)],
                    [reviewLabel],
                  ),
                  h.span([h.Class('f-header-send-label')], [sendLabel]),
                ],
              ),
              h.button(
                [
                  h.Id('workspace-settings-trigger'),
                  h.Class('quiet-button'),
                  h.OnClick(Message.ClickedSettings()),
                ],
                ['Settings'],
              ),
            ],
          ),
        ],
      ),
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
        [
          h.Class(
            `f-frame${isDiscussion && model.currentPart !== CONVERSATIONS ? ' f-with-discussion' : ''}${expanded && isDiscussion ? ' f-expanded' : ''}`,
          ),
          h.Style(styles),
        ],
        [
          navigationView(model, snapshot, reading.notices, h),
          reading.resize('Nav', h),
          h.main(
            [
              h.Id('workspace-main'),
              h.Class(
                `f-main${Option.isSome(question) ? ' f-question-main' : ''}`,
              ),
            ],
            [
              model.currentPart !== CONVERSATIONS && !isDiscussion
                ? h.div(
                    [h.Class('f-discuss-action')],
                    [
                      link(
                        discussLabel(model),
                        Message.ClickedDiscussion({
                          target: Option.match(question, {
                            onSome: step => step.id,
                            onNone: () => RUN_TARGET,
                          }),
                        }),
                        h,
                      ),
                    ],
                  )
                : h.empty,
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
                              'This grill uses a newer format. Update grill-flow if some content is missing.',
                            ],
                          )
                        : h.empty,
                      content,
                    ],
                  ),
            ],
          ),
          isDiscussion && model.currentPart !== CONVERSATIONS
            ? discussionView(model, snapshot, reading, expanded, h)
            : h.empty,
          isDiscussion && model.currentPart !== CONVERSATIONS
            ? reading.resize('Side', h)
            : h.empty,
        ],
      ),
      settingView(model, h),
    ],
  )
}

const navigationView = (
  model: Model,
  snapshot: Snapshot,
  notices: Reading['notices'],
  h: H,
): Html => {
  const grill = snapshot.grill
  const priority =
    grill.squad?.id === grill.id
      ? grill.steps.find(step => step.id === grill.squad?.openForYou)
      : undefined
  const open = grill.steps.filter(step => {
    const status = statusOf(grill, model.answers, step.question.id)
    return status._tag === 'Open' || status._tag === 'Waiting'
  })
  const ownerWork = ownerWorkCounts(snapshot)
  const visible = visibleQuestions(
    model.workspace,
    snapshot,
    model.answers,
    model.notes,
    model.own,
  )
  const groups = questionGroups(
    model.workspace,
    snapshot,
    model.answers,
    model.notes,
    model.own,
  )
  const drafts = draftAnswerIds(
    snapshot,
    model.answers,
    model.notes,
    model.own,
  ).length
  const count = (
    filter: typeof model.workspace.filter,
    urgencyFilter: typeof model.workspace.urgencyFilter,
  ) =>
    visibleQuestions(
      modifyFields(model.workspace, {
        filter: () => filter,
        urgencyFilter: () => urgencyFilter,
      }),
      snapshot,
      model.answers,
      model.notes,
      model.own,
    ).length
  const scope = selectedRound(model.workspace, snapshot)
  const rounds = Array.dedupe(
    grill.steps.map(step => roundOf(grill, step.question)),
  ).sort((a, b) => {
    const sections = Array.dedupe(
      grill.steps.map(
        step => grill.roundSections?.[String(roundOf(grill, step.question))],
      ),
    )
    return (
      sections.indexOf(grill.roundSections?.[String(a)]) -
        sections.indexOf(grill.roundSections?.[String(b)]) ||
      (grill.roundNumbers?.[String(a)] ?? a) -
        (grill.roundNumbers?.[String(b)] ?? b)
    )
  })
  const roundMatches = visibleQuestions(
    modifyFields(model.workspace, {
      roundScopes: () => ({}),
    }),
    snapshot,
    model.answers,
    model.notes,
    model.own,
  )
  const urgencyNames = {
    All: 'All urgencies',
    urgent: 'Blocking or Soon',
    blocking: 'Blocking',
    soon: 'Soon',
    wait: 'Can wait',
    fyi: 'FYI',
    unspecified: 'Unspecified',
  }
  const icon = (page: string) =>
    h.svg(
      [h.ViewBox('0 0 24 24'), h.AriaHidden(true)],
      [
        h.path([
          h.D(
            page === NEEDS
              ? 'M12 4v9m0 4v1M4 21h16L12 3Z'
              : page.startsWith(QUESTION_PAGE)
                ? 'M5 4h14v16H5ZM8 8h8m-8 4h8m-8 4h5'
                : page === UPDATES
                  ? 'M4 5h16v14H4Zm4 4h8m-8 4h8m-8 3h5'
                  : page === CHANGES
                    ? 'M4 6h16M4 12h10M4 18h6m8-4v8m-4-4h8'
                    : page === ANSWER_HISTORY
                      ? 'M4 12a8 8 0 1 0 2-5M4 3v5h5m3-1v5l3 2'
                      : 'M4 4h6v6H4Zm10 0h6v6h-6ZM4 14h6v6H4Zm10 0h6v6h-6Z',
          ),
          h.Fill('none'),
          h.Stroke('currentColor'),
          h.StrokeWidth('1.5'),
        ]),
      ],
    )
  const item = (label: string, hint: string, page: string) =>
    h.button(
      [
        h.Class(`f-nav-item${model.currentPart === page ? ' is-current' : ''}`),
        h.OnClick(Message.ClickedWorkspacePage({ page })),
        h.AriaCurrent(model.currentPart === page ? 'page' : 'false'),
        h.Title(`${label} · ${hint}`),
      ],
      [icon(page), h.span([], [label]), h.span([h.Class('hint')], [hint])],
    )
  return h.aside(
    [h.Class('f-navigation f-navigation-g'), h.AriaLabel('Grill navigation')],
    [
      h.div(
        [h.Class('f-app-rail')],
        [
          h.a([h.Href('/'), h.Class('f-brand')], ['gf']),
          priority === undefined
            ? h.empty
            : item(
                'Open for you',
                priority.question.id,
                `${QUESTION_PAGE}${priority.question.id}`,
              ),
          item(
            'Needs you',
            `${open.length} open${drafts > 0 ? ` · ${drafts} drafts` : ''}${ownerWork.actions > 0 ? ` · ${ownerWork.actions} action${ownerWork.actions === 1 ? '' : 's'}` : ''}${ownerWork.provisional > 0 ? ` · ${ownerWork.provisional} provisional` : ''}`,
            NEEDS,
          ),
          item(
            'What changed',
            `${activityUnreadCount(snapshot.activity, model.workspace.activityRead)} unread`,
            CHANGES,
          ),
          item(
            'Updates',
            String(
              (snapshot.updates ?? []).filter(
                update => update.supersededBy === undefined,
              ).length,
            ),
            UPDATES,
          ),
          item(
            'Answer history',
            String((snapshot.answerHistory ?? []).length),
            ANSWER_HISTORY,
          ),
          grill.kind === 'squad'
            ? item(
                'Squad overview',
                AsyncData.hasData(model.workspace.catalog)
                  ? `${squadRuns(model, snapshot).length} runs`
                  : 'Runs and work',
                SQUAD,
              )
            : item(
                'Overview',
                grill.session === ''
                  ? 'Independent grill'
                  : `Session ${grill.session}`,
                'overview',
              ),
          ...(grill.plan === undefined
            ? []
            : [
                item(
                  'Run overview',
                  `${grill.plan.issues.filter(issue => issue.phase === 'merged').length} merged · ${grill.plan.issues.filter(issue => issue.phase !== 'merged' && issue.phase !== 'outside').length} remaining`,
                  'plan',
                ),
              ]),
          item(
            'Your grills',
            AsyncData.hasData(model.workspace.catalog)
              ? `${catalogSnapshots(model, snapshot).length} grills`
              : 'All machines',
            GRILLS,
          ),
        ],
      ),
      h.div(
        [h.Class('f-question-pane')],
        [
          h.div(
            [h.Class('f-question-tools')],
            [
              h.div(
                [],
                [
                  h.strong([], ['Questions']),
                  h.span([h.Class('hint')], [String(grill.steps.length)]),
                ],
              ),
              h.input([
                h.Type('search'),
                h.Placeholder('Find question or issue…'),
                h.AriaLabel('Find question or issue'),
                h.Value(model.workspace.search),
                h.OnInput(value => Message.UpdatedQuestionSearch({ value })),
              ]),
              h.div(
                [
                  h.Class('f-quick-views'),
                  h.Role('group'),
                  h.AriaLabel('Quick views'),
                ],
                quickViews.map(preset =>
                  h.button(
                    [
                      h.Class(
                        model.workspace.filter === preset.filter &&
                          model.workspace.urgencyFilter === preset.urgencyFilter
                          ? 'is-active'
                          : '',
                      ),
                      h.AriaPressed(
                        String(
                          model.workspace.filter === preset.filter &&
                            model.workspace.urgencyFilter ===
                              preset.urgencyFilter,
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
                      h.span([], [preset.label]),
                      h.small(
                        [],
                        [String(count(preset.filter, preset.urgencyFilter))],
                      ),
                    ],
                  ),
                ),
              ),
              h.button(
                [
                  h.Class('text-button f-custom-filter-toggle'),
                  h.AriaExpanded(model.workspace.customFilters === 'Expanded'),
                  h.OnClick(Message.ClickedCustomFilters()),
                ],
                [
                  model.workspace.customFilters === 'Expanded'
                    ? 'Close custom filters'
                    : 'Custom filters',
                ],
              ),
              model.workspace.customFilters === 'Expanded'
                ? h.div(
                    [h.Class('f-custom-filters')],
                    [
                      h.div(
                        [
                          h.Class('f-filters'),
                          h.Role('group'),
                          h.AriaLabel('Question state'),
                        ],
                        (
                          [
                            'All',
                            'Open',
                            'Draft',
                            'Sent',
                          ] satisfies ReadonlyArray<
                            typeof model.workspace.filter
                          >
                        ).map(filter =>
                          h.button(
                            [
                              h.Class(
                                model.workspace.filter === filter
                                  ? 'is-active'
                                  : '',
                              ),
                              h.AriaPressed(
                                String(model.workspace.filter === filter),
                              ),
                              h.OnClick(
                                Message.ChangedQuestionFilter({ filter }),
                              ),
                            ],
                            [
                              filter === 'All'
                                ? h.empty
                                : stateMark(filter, undefined, h),
                              filter,
                            ],
                          ),
                        ),
                      ),
                      h.label(
                        [h.Class('f-urgency-filter')],
                        [
                          h.span([], ['Urgency']),
                          h.select(
                            [
                              h.AriaLabel('Urgency filter'),
                              h.Value(model.workspace.urgencyFilter),
                              h.OnChange(value =>
                                Message.ChangedQuestionUrgencyFilter({
                                  urgencyFilter:
                                    questionUrgencyFilterFrom(value),
                                }),
                              ),
                            ],
                            [
                              { value: 'All', label: 'All urgencies' },
                              { value: 'urgent', label: 'Blocking or Soon' },
                              { value: 'blocking', label: 'Blocking' },
                              { value: 'soon', label: 'Soon' },
                              { value: 'wait', label: 'Can wait' },
                              { value: 'fyi', label: 'FYI' },
                              { value: 'unspecified', label: 'Unspecified' },
                            ].map(({ value, label }) =>
                              h.option([h.Value(value)], [label]),
                            ),
                          ),
                        ],
                      ),
                    ],
                  )
                : h.empty,
              h.p(
                [h.Class('f-filter-readout')],
                [
                  h.strong([], [String(visible.length)]),
                  ` match · ${model.workspace.filter === 'All' ? 'All states' : model.workspace.filter} · ${urgencyNames[model.workspace.urgencyFilter]}`,
                ],
              ),
            ],
          ),
          h.div(
            [h.Class('f-round-browser')],
            [
              h.nav(
                [h.Class('f-round-rail'), h.AriaLabel('Choose a round')],
                [
                  h.button(
                    [
                      h.Class(scope === undefined ? 'is-current' : ''),
                      h.AriaPressed(String(scope === undefined)),
                      h.OnClick(
                        Message.SelectedRoundScope({
                          maybeRound: Option.none(),
                        }),
                      ),
                    ],
                    [
                      h.span([], ['All rounds']),
                      h.small([], [`${roundMatches.length} match`]),
                    ],
                  ),
                  ...rounds.map((round, index) => {
                    const section = grill.roundSections?.[String(round)]
                    const previousSection =
                      grill.roundSections?.[String(rounds[index - 1])]
                    return h.keyed('div')(
                      String(round),
                      [],
                      [
                        section !== undefined && section !== previousSection
                          ? h.h3([h.Class('f-round-section')], [section])
                          : h.empty,
                        h.button(
                          [
                            h.Class(scope === round ? 'is-current' : ''),
                            h.AriaPressed(String(scope === round)),
                            h.Title(
                              `${section === undefined ? '' : `${section} · `}${sidebarRoundName(snapshot, round)}`,
                            ),
                            h.OnClick(
                              Message.SelectedRoundScope({
                                maybeRound: Option.some(round),
                              }),
                            ),
                          ],
                          [
                            h.span([], [sidebarRoundName(snapshot, round)]),
                            h.small(
                              [],
                              [
                                `${roundMatches.filter(step => roundOf(grill, step.question) === round).length} match`,
                              ],
                            ),
                          ],
                        ),
                      ],
                    )
                  }),
                ],
              ),
              h.nav(
                [
                  h.Class('f-question-list'),
                  h.AriaLabel(
                    `Questions by ${model.workspace.grouping.toLowerCase()}`,
                  ),
                ],
                [
                  ...(Array.isReadonlyArrayEmpty(visible)
                    ? [
                        h.p(
                          [h.Class('hint f-empty-nav')],
                          [
                            'No questions match. Clear the search or adjust the filters.',
                          ],
                        ),
                      ]
                    : []),
                  ...groups.map((group, index) => {
                    const steps = group.steps
                    const sent = steps.filter(
                      step =>
                        questionState(
                          snapshot,
                          step,
                          model.answers,
                          model.notes,
                          model.own,
                        ) === 'Sent',
                    ).length
                    const collapsed = group.collapsed
                    return h.keyed('section')(
                      `${model.workspace.grouping}-${group.key}`,
                      [h.Class('f-round')],
                      [
                        group.section !== undefined &&
                        group.section !== groups[index - 1]?.section
                          ? h.h3([h.Class('f-agent-section')], [group.section])
                          : h.empty,
                        h.div(
                          [h.Class('f-round-heading')],
                          [
                            h.button(
                              [
                                h.Class('f-round-toggle'),
                                h.AriaLabel(
                                  `${sidebarRoundName(snapshot, Number(group.key))} · ${sent} of ${steps.length} sent`,
                                ),
                                h.AriaExpanded(!collapsed),
                                h.OnClick(
                                  model.workspace.grouping === 'Agent'
                                    ? Message.ClickedAgentGroup({
                                        session: group.key,
                                      })
                                    : Message.ClickedRound({
                                        round: Number(group.key),
                                      }),
                                ),
                              ],
                              [
                                h.svg(
                                  [
                                    h.ViewBox('0 0 16 16'),
                                    h.Class(collapsed ? '' : 'is-open'),
                                    h.AriaHidden(true),
                                  ],
                                  [
                                    h.path([
                                      h.D('m6 4 4 4-4 4'),
                                      h.Fill('none'),
                                      h.Stroke('currentColor'),
                                      h.StrokeWidth('1.5'),
                                    ]),
                                  ],
                                ),
                                h.span(
                                  [h.Class('f-round-name')],
                                  [
                                    sidebarRoundName(
                                      snapshot,
                                      Number(group.key),
                                    ),
                                  ],
                                ),
                                h.span(
                                  [
                                    h.Class(
                                      `hint${sent === steps.length ? ' is-complete' : ''}`,
                                    ),
                                  ],
                                  [`${sent}/${steps.length} sent`],
                                ),
                              ],
                            ),
                            model.workspace.grouping === 'Round'
                              ? link(
                                  'Rename',
                                  Message.ClickedRenameRound({
                                    round: Number(group.key),
                                  }),
                                  h,
                                )
                              : h.empty,
                          ],
                        ),
                        model.workspace.grouping === 'Round' &&
                        Option.contains(
                          model.workspace.maybeEditingRound,
                          Number(group.key),
                        )
                          ? h.form(
                              [
                                h.Class('f-round-editor'),
                                h.OnSubmit(
                                  Message.SubmittedRoundName({
                                    round: Number(group.key),
                                  }),
                                ),
                              ],
                              [
                                h.label(
                                  [h.For(`round-name-${group.key}`)],
                                  [`Name for round ${group.key}`],
                                ),
                                h.input([
                                  h.Id(`round-name-${group.key}`),
                                  h.Value(model.workspace.roundNameDraft),
                                  h.Maxlength(80),
                                  h.Placeholder(
                                    'What are these questions about?',
                                  ),
                                  h.OnInput(name =>
                                    Message.UpdatedRoundName({ name }),
                                  ),
                                ]),
                                h.div(
                                  [],
                                  [
                                    h.button(
                                      [
                                        h.Type('submit'),
                                        h.Class('text-button'),
                                      ],
                                      ['Save'],
                                    ),
                                    h.button(
                                      [
                                        h.Type('button'),
                                        h.Class('text-button'),
                                        h.OnClick(Message.CancelledRoundName()),
                                      ],
                                      ['Cancel'],
                                    ),
                                  ],
                                ),
                              ],
                            )
                          : h.empty,
                        collapsed
                          ? h.empty
                          : h.ul(
                              [h.Class('f-question-tree')],
                              group.roots.map(node =>
                                questionNodeView(model, snapshot, node, h),
                              ),
                            ),
                      ],
                    )
                  }),
                ],
              ),
            ],
          ),
          notices(h),
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
  h: H,
): Html => {
  const q = step.question
  const state = questionState(
    snapshot,
    step,
    model.answers,
    model.notes,
    model.own,
  )
  const previous = adjacentQuestion(
    model.workspace,
    snapshot,
    model.answers,
    model.notes,
    model.own,
    model.currentPart,
    'Previous',
  )
  const next = adjacentQuestion(
    model.workspace,
    snapshot,
    model.answers,
    model.notes,
    model.own,
    model.currentPart,
    'Next',
  )
  const arrow = (direction: 'Previous' | 'Next', disabled: boolean): Html =>
    h.button(
      [
        h.Class(`f-arrow f-arrow-${direction.toLowerCase()}`),
        h.Disabled(disabled),
        h.AriaLabel(`${direction} question`),
        h.AriaKeyshortcuts(
          direction === 'Previous' ? 'ArrowLeft' : 'ArrowRight',
        ),
        h.Title(
          `${direction} question (${direction === 'Previous' ? 'Left' : 'Right'} arrow)`,
        ),
        h.OnClick(Message.ClickedQuestionArrow({ direction })),
      ],
      [
        h.svg(
          [h.ViewBox('0 0 32 64'), h.AriaHidden(true)],
          [
            h.path([
              h.D(
                direction === 'Previous'
                  ? 'M24 8 8 32 24 56'
                  : 'M8 8 24 32 8 56',
              ),
              h.Stroke('currentColor'),
              h.StrokeWidth('1.5'),
              h.Fill('none'),
            ]),
          ],
        ),
      ],
    )
  return h.div(
    [h.Class('f-question-layout')],
    [
      h.article(
        [h.Class('f-reading-scroller')],
        [
          h.div([h.Id('workspace-top'), h.Tabindex(-1)]),
          h.div(
            [h.Class('f-reading'), h.Id(`q-${q.id}`)],
            [
              h.header(
                [h.Class('f-question-reference')],
                [
                  h.h1(
                    [h.Class('f-question-title'), h.Id(`ask-text-${q.id}`)],
                    reading.heading(q.ask, h),
                  ),
                  h.div(
                    [h.Class('f-question-meta')],
                    [
                      h.span([], [q.id]),
                      issueLink(snapshot, q.issue, h),
                      h.span([], [questionAgent(snapshot.grill, q)]),
                      h.span(
                        [],
                        [
                          q.round === undefined
                            ? 'No round'
                            : roundLabel(snapshot.grill, q.round),
                        ],
                      ),
                      h.span(
                        [h.Class('f-state-label')],
                        [
                          stateMark(state, q, h),
                          state === 'Draft' ? 'Draft · not sent' : state,
                        ],
                      ),
                    ],
                  ),
                ],
              ),
              h.div(
                [h.Class('f-question-body')],
                [
                  reading.status(step, h),
                  answersView(model, snapshot, step, reading, h),
                  reading.comparison(step, h),
                  drawingPanel(model, snapshot, step, reading.drawing, h),
                  h.section(
                    [h.Class('f-reasoning'), h.Id('workspace-reasoning')],
                    [
                      h.h2([], ['Why this question']),
                      reading.reasoning(step, h),
                      h.div(
                        [h.Class('f-starters')],
                        [
                          'Contextualize this for me',
                          'Give me an example',
                          'Compare the choices',
                          'Ask for a clearer rewrite',
                        ].map(text =>
                          link(
                            text,
                            Message.ClickedConversationStarter({
                              target: step.id,
                              text:
                                text === 'Ask for a clearer rewrite'
                                  ? 'Please rewrite this question and its reasoning more clearly.'
                                  : `${text}.`,
                            }),
                            h,
                          ),
                        ),
                      ),
                    ],
                  ),
                  reading.related(step, h),
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
                ],
              ),
            ],
          ),
          h.div(
            [h.Class('f-arrows')],
            [
              arrow('Previous', Option.isNone(previous)),
              arrow('Next', Option.isNone(next)),
            ],
          ),
        ],
      ),
    ],
  )
}

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

const workspacePageName = (page: string): string =>
  ({
    [REVIEW]: 'Review & send',
    [NEEDS]: 'Needs you',
    [SQUAD]: 'Squad overview',
    [GRILLS]: 'Your grills',
    [CONVERSATIONS]: 'Conversations',
    [REPLIES]: 'Replies & decisions',
    [UPDATES]: 'Updates',
    [ANSWER_HISTORY]: 'Answer history',
    [CHANGES]: 'What changed',
    plan: 'Run overview',
    status: 'Run overview',
    overview: 'Overview',
  })[page] ?? ''
const discussLabel = (model: Model): string =>
  model.currentPart.startsWith(QUESTION_PAGE) ||
  [REVIEW, REPLIES].includes(model.currentPart)
    ? 'Discuss'
    : 'Ask about run'

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
  const pick = (
    key: string,
    label: string,
    effect: string,
    recommended: boolean,
  ) =>
    h.button(
      [
        h.Type('button'),
        h.Class(`f-option${selected === key ? ' is-selected' : ''}`),
        h.Role('radio'),
        h.AriaChecked(selected === key),
        h.Disabled(blocked),
        h.OnClick(
          key === OWN
            ? Message.SelectedOwnAnswer({ question: q.id })
            : Message.SelectedOption({ question: q.id, key }),
        ),
      ],
      [
        h.span([h.Class('f-option-key')], [key === OWN ? '?' : key]),
        h.div(
          [],
          [
            h.div(
              [h.Class('f-option-label')],
              [
                h.b([], reading.answer(label, h)),
                recommended
                  ? h.span([h.Class('f-recommended')], ['Recommended'])
                  : h.empty,
              ],
            ),
            h.p([h.Class('f-option-effect')], reading.answer(effect, h)),
          ],
        ),
      ],
    )
  const saved =
    model.pendingEvents > 0
      ? 'Saving…'
      : questionState(snapshot, step, model.answers, model.notes, model.own) ===
          'Sent'
        ? 'Sent'
        : selected === undefined
          ? 'Nothing sent yet'
          : 'Draft saved · not sent'
  return h.section(
    [h.Class('f-answer-section')],
    [
      h.div(
        [
          h.Class('f-options'),
          h.Role('radiogroup'),
          h.AriaLabelledBy(`ask-text-${q.id}`),
        ],
        [
          ...q.options.map(option =>
            pick(option.key, option.label, option.effect, option.recommended),
          ),
          pick(
            OWN,
            'My own answer',
            'A different choice, in your words.',
            false,
          ),
        ],
      ),
      selected === OWN
        ? h.textarea([
            h.Id(`own-${q.id}`),
            h.Rows(3),
            h.AriaLabel('Your own answer'),
            h.OnMount(FillBox({ text: model.own[q.id] ?? '' })),
            h.OnInput(value =>
              Message.UpdatedOwnAnswer({ question: q.id, value }),
            ),
            h.OnBlur(Message.BlurredOwnAnswer({ question: q.id })),
          ])
        : h.empty,
      h.div(
        [h.Class('f-answer-actions')],
        [
          link(
            'Add a note',
            Message.ClickedQuestionNote({ question: q.id }),
            h,
          ),
          link('Discuss', Message.ClickedDiscussion({ target: step.id }), h),
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
      model.workspace.noteOpen.includes(q.id) ||
      (model.notes[q.id] ?? '') !== ''
        ? h.textarea([
            h.Class('f-note'),
            h.Id(`note-${q.id}`),
            h.Rows(2),
            h.AriaLabel('Note with this answer'),
            h.Placeholder(
              'Conditions, reservations or details to keep with your answer…',
            ),
            h.OnMount(FillBox({ text: model.notes[q.id] ?? '' })),
            h.OnInput(value => Message.UpdatedNote({ question: q.id, value })),
            h.OnBlur(Message.BlurredNote({ question: q.id })),
          ])
        : h.empty,
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
  const selected = drafts.filter(id => !model.workspace.excluded.includes(id))
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
                        [
                          h.Class(
                            model.workspace.excluded.includes(id)
                              ? 'is-excluded'
                              : '',
                          ),
                        ],
                        [
                          h.td(
                            [],
                            [
                              h.input([
                                h.Type('checkbox'),
                                h.Checked(
                                  !model.workspace.excluded.includes(id),
                                ),
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
                                  `To ${questionAgent(snapshot.grill, step.question)}`,
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
            h.Value(model.sendMessage),
            h.Rows(2),
            h.OnMount(FillBox({ text: model.sendMessage })),
            h.Placeholder('Anything else the agent should know…'),
            h.OnInput(value => Message.UpdatedSendMessage({ value })),
          ]),
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
): Html => {
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
              [isMaintainer ? 'Improving grill-flow' : snapshot.grill.title],
            ),
            ...(isMaintainer
              ? [
                  h.p(
                    [],
                    [
                      'Ask about the interface, report a problem, or discuss an improvement. This conversation goes directly to the session building grill-flow.',
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
      h.Class(`f-discussion${expanded ? ' is-expanded' : ''}`),
      h.AriaLabel('Discussion'),
    ],
    [
      h.header(
        [h.Class('f-discussion-head')],
        [
          h.h2([], ['Discussion']),
          h.span(
            [h.Class('hint')],
            [
              isMaintainer
                ? `Grill-flow · ${snapshot.maintainerSession ?? 'Unavailable'}`
                : questionAgent(snapshot.grill, step?.question),
            ],
          ),
          h.div(
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
      h.div(
        [
          h.Class('f-discussion-scope'),
          h.Role('group'),
          h.AriaLabel('Conversation scope'),
        ],
        [
          h.button(
            [
              h.Class(`quiet-button${step !== undefined ? ' is-active' : ''}`),
              h.Disabled(step === undefined && Option.isNone(onQuestion)),
              h.AriaPressed(String(step !== undefined)),
              h.OnClick(
                Message.SelectedDiscussionTarget({
                  target:
                    step?.id ??
                    Option.match(onQuestion, {
                      onSome: question => question.id,
                      onNone: () => RUN_TARGET,
                    }),
                }),
              ),
            ],
            [
              `This question${step === undefined ? Option.match(onQuestion, { onSome: question => ` · ${question.question.id}`, onNone: () => '' }) : ` · ${step.question.id}`}`,
            ],
          ),
          h.button(
            [
              h.Class(
                `quiet-button${target === RUN_TARGET ? ' is-active' : ''}`,
              ),
              h.AriaPressed(String(target === RUN_TARGET)),
              h.OnClick(
                Message.SelectedDiscussionTarget({ target: RUN_TARGET }),
              ),
            ],
            ['Whole run'],
          ),
          snapshot.maintainerSession === undefined
            ? h.empty
            : h.button(
                [
                  h.Class(`quiet-button${isMaintainer ? ' is-active' : ''}`),
                  h.AriaPressed(String(isMaintainer)),
                  h.OnClick(
                    Message.SelectedDiscussionTarget({
                      target: GRILL_FLOW_TARGET,
                    }),
                  ),
                ],
                ['Grill-flow'],
              ),
        ],
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
      h.form(
        [
          h.Class('f-discussion-compose'),
          h.OnSubmit(Message.SubmittedWorkspaceDiscussion({ target })),
        ],
        [
          h.label(
            [h.For('talk-box')],
            [
              isMaintainer
                ? 'Ask about grill-flow'
                : step === undefined
                  ? 'Ask about the run'
                  : `Ask about ${step.question.id}`,
            ],
          ),
          h.keyed('textarea')(`discussion-${target}-${model.talkGeneration}`, [
            h.Id('talk-box'),
            h.Rows(4),
            h.OnMount(FillBox({ text: draft })),
            h.Placeholder('Ask, push back, or ask for a clearer explanation…'),
            h.OnInput(value =>
              Message.UpdatedTalkDraft({
                partId: threadDraftKey(target),
                value,
              }),
            ),
            h.OnKeyDownPreventDefault((key, { shiftKey }) =>
              key === 'Enter' && !shiftKey
                ? Option.some(Message.SubmittedWorkspaceDiscussion({ target }))
                : Option.none(),
            ),
          ]),
          h.div(
            [h.Class('f-send-foot')],
            [
              h.span(
                [h.Class('hint')],
                ['Enter to send · Shift + Enter for a new line'],
              ),
              h.button([h.Type('submit'), h.Class('send-button')], ['Ask']),
            ],
          ),
        ],
      ),
    ],
  )
}

const conversationPage = (
  model: Model,
  snapshot: Snapshot,
  reading: Reading,
  h: H,
): Html => {
  const current = Option.getOrElse(
    model.workspace.maybeDiscussionTarget,
    () => RUN_TARGET,
  )
  const targets = Array.dedupe([
    current,
    ...snapshot.asks.map(ask => ask.stepId),
  ]).filter(target => target !== RUN_TARGET && target !== GRILL_FLOW_TARGET)
  return h.div(
    [h.Class('f-conversation-layout')],
    [
      h.nav(
        [h.Class('f-conversation-list'), h.AriaLabel('Conversations')],
        [
          h.h2([], ['Conversations']),
          ...targets.map(target => {
            const step = snapshot.grill.steps.find(item => item.id === target)
            return h.keyed('button')(
              target,
              [
                h.Class(
                  `f-conversation-item${current === target ? ' is-active' : ''}`,
                ),
                h.OnClick(Message.SelectedDiscussionTarget({ target })),
              ],
              [
                step === undefined
                  ? target.startsWith('part:')
                    ? (snapshot.grill.parts.find(
                        part => `part:${part.id}` === target,
                      )?.title ?? target)
                    : target
                  : `About ${step.question.id}`,
                step === undefined
                  ? h.empty
                  : h.small([], [step.question.title]),
              ],
            )
          }),
          h.button(
            [
              h.Class(
                `f-conversation-item${current === RUN_TARGET ? ' is-active' : ''}`,
              ),
              h.OnClick(
                Message.SelectedDiscussionTarget({ target: RUN_TARGET }),
              ),
            ],
            [
              `Run coordination${snapshot.grill.session === '' ? '' : ` · ${snapshot.grill.session}`}`,
            ],
          ),
          snapshot.maintainerSession === undefined
            ? h.empty
            : h.button(
                [
                  h.Class(
                    `f-conversation-item${current === GRILL_FLOW_TARGET ? ' is-active' : ''}`,
                  ),
                  h.OnClick(
                    Message.SelectedDiscussionTarget({
                      target: GRILL_FLOW_TARGET,
                    }),
                  ),
                ],
                [
                  'Grill-flow',
                  h.small(
                    [],
                    [
                      `Interface & improvements · ${snapshot.maintainerSession}`,
                    ],
                  ),
                ],
              ),
          h.p(
            [h.Class('hint')],
            [
              'A conversation is the same thread here and beside its question. Moving between views keeps its draft and replies.',
            ],
          ),
        ],
      ),
      discussionView(model, snapshot, reading, true, h),
    ],
  )
}

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

const needsView = (
  model: Model,
  snapshot: Snapshot,
  reading: Reading,
  h: H,
): Html => {
  const drafts = draftAnswerIds(snapshot, model.answers, model.notes, model.own)
  const steps = snapshot.grill.steps.filter(step =>
    ['Open', 'Waiting'].includes(
      statusOf(snapshot.grill, model.answers, step.question.id, model.skipped)
        ._tag,
    ),
  )
  const ready = steps.filter(
    step =>
      statusOf(snapshot.grill, model.answers, step.question.id, model.skipped)
        ._tag === 'Open',
  )
  const waiting = steps.filter(step => !ready.includes(step))
  const rows = (items: ReadonlyArray<Step>) =>
    items.map(step =>
      h.keyed('button')(
        step.id,
        [
          h.Class('f-decision-row'),
          h.OnClick(
            Message.ClickedWorkspacePage({
              page: `${QUESTION_PAGE}${step.question.id}`,
            }),
          ),
        ],
        [
          h.span([h.Class('f-decision-id')], [step.question.id]),
          h.div(
            [],
            [
              h.b([], [step.question.title]),
              h.p([], reading.answer(step.question.ask, h)),
            ],
          ),
          h.small([], [step.question.issue ?? '']),
        ],
      ),
    )
  return h.section(
    [h.Class('f-page f-attention')],
    [
      h.h1([], ['Needs you']),
      h.p(
        [h.Class('f-lead')],
        ['Decisions, owner actions and answers ready to return to the agent.'],
      ),
      h.section(
        [h.Class('f-attention-summary')],
        [
          h.div(
            [],
            [
              h.h2(
                [],
                [
                  `${drafts.length} draft${drafts.length === 1 ? '' : 's'} ready to send`,
                ],
              ),
              h.p(
                [h.Class('hint')],
                ['Review the selected answers and include a message.'],
              ),
            ],
          ),
          h.button(
            [
              h.Class('send-button'),
              h.OnClick(Message.ClickedWorkspacePage({ page: REVIEW })),
            ],
            ['Review & send'],
          ),
        ],
      ),
      h.div(
        [h.Class('f-section-heading')],
        [
          h.h2(
            [],
            [`${ready.length} open decision${ready.length === 1 ? '' : 's'}`],
          ),
          pageLink(
            'See all in questions',
            snapshot.grill.steps[0] === undefined
              ? 'overview'
              : `${QUESTION_PAGE}${ready[0]?.question.id ?? snapshot.grill.steps[0].question.id}`,
            h,
          ),
        ],
      ),
      ...(ready.length === 0
        ? [h.p([h.Class('hint')], ['No decisions are ready for an answer.'])]
        : rows(ready)),
      ...(waiting.length === 0
        ? []
        : [h.h2([], ['Waiting on another answer']), ...rows(waiting)]),
      attentionView(model, snapshot, h),
    ],
  )
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
          pageLink('Replies and decisions', REPLIES, h),
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

const squadView = (
  model: Model,
  snapshot: Snapshot,
  reading: Reading,
  h: H,
): Html => {
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
                        h.a(
                          [
                            h.Href(
                              `/g/${encodeURIComponent(state.grill.id)}/needs-you`,
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
    [h.Class('f-page f-squad-overview')],
    [
      h.h1([], ['Squad overview']),
      h.p(
        [h.Class('f-lead')],
        [
          'The portfolio view: active runs, their state, and where your attention is needed.',
        ],
      ),
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
            ['No active squad runs in the loaded grills.'],
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
      rosterView(snapshot.roster, runs, h),
      h.section(
        [h.Class('f-portfolio-next')],
        [
          h.h2([], ['Where to go next']),
          h.p(
            [],
            [
              'Needs you collects decisions and drafts ready to send. Run overview holds the work, future plans, sessions and dependencies.',
            ],
          ),
          h.div(
            [h.Class('f-actions')],
            [
              h.button(
                [
                  h.Class('quiet-button'),
                  h.OnClick(Message.ClickedWorkspacePage({ page: NEEDS })),
                ],
                ['Needs you'],
              ),
              h.button(
                [
                  h.Class('quiet-button'),
                  h.OnClick(Message.ClickedWorkspacePage({ page: 'plan' })),
                ],
                ['Run overview'],
              ),
            ],
          ),
        ],
      ),
    ],
  )
}

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

const repliesView = (
  model: Model,
  snapshot: Snapshot,
  reading: Reading,
  h: H,
): Html => {
  const messages = Array.reverse(agentMessagesOf(snapshot))
  return h.section(
    [h.Class('f-page f-replies-page')],
    [
      h.h1([], ['Replies & decisions']),
      ...messages.map(message =>
        h.keyed('article')(
          message.id,
          [
            h.Class('f-reply'),
            ...channelRevealAttributes(model, `agent-${message.id}`, h),
          ],
          [
            h.h2(
              [],
              [
                message.kind === 'reply'
                  ? 'Reply to your answers'
                  : message.stepId === RUN_TARGET
                    ? 'About the whole run'
                    : (snapshot.grill.steps.find(
                        step => step.id === message.stepId,
                      )?.question.title ?? message.stepId),
              ],
            ),
            reading.prose(message.text, h),
            message.kind === 'answer'
              ? link(
                  'Open discussion',
                  Message.ClickedAgentMessage({
                    id: message.id,
                    inReplies: false,
                  }),
                  h,
                )
              : h.empty,
          ],
        ),
      ),
      ...(snapshot.grill.decided ?? []).map(decision =>
        h.keyed('article')(
          decision.id,
          [h.Class('f-reply')],
          [reading.prose(decision.text, h)],
        ),
      ),
      messages.length + (snapshot.grill.decided?.length ?? 0) === 0
        ? h.p([h.Class('f-empty')], ['No replies or earlier decisions yet.'])
        : h.empty,
    ],
  )
}
