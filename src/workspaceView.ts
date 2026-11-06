import { Array, Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import {
  FORMAT_VERSION,
  type Snapshot,
  type Step,
  agentMessagesOf,
  planPhaseOf,
  statusOf,
} from './domain'
import {
  FillBox,
  Message,
  type Model,
  type SidebarEdge,
  threadDraftKey,
} from './main'
import {
  CONVERSATIONS,
  NEEDS,
  QUESTION_PAGE,
  REPLIES,
  REVIEW,
  RUN_TARGET,
  adjacentQuestion,
  answerLabel,
  draftQuestions,
  questionOnPage,
  questionState,
  roundIsCollapsed,
  visibleQuestions,
} from './workspace'

type H = HtmlBuilder<Message>

type Reading = Readonly<{
  source: (step: Step, h: H) => Html
  heading: (text: string, h: H) => ReadonlyArray<Html | string>
  inline: (text: string, h: H) => ReadonlyArray<Html | string>
  prose: (text: string, h: H) => Html
  question: (step: Step, h: H) => Html
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

const stateMark = (state: 'Open' | 'Draft' | 'Sent', h: H): Html =>
  h.span(
    [h.Class(`f-state f-state-${state.toLowerCase()}`), h.AriaHidden(true)],
    state === 'Sent'
      ? [
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
        ]
      : [],
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
        ],
      ),
    ],
  )

export const workspaceView = (
  model: Model,
  snapshot: Snapshot,
  reading: Reading,
  h: H,
): Html => {
  const grill = snapshot.grill
  const drafts = draftQuestions(snapshot, model.answers, model.notes, model.own)
  const question = questionOnPage(snapshot, model.currentPart)
  const isDiscussion =
    model.side === 'Talk' || model.currentPart === CONVERSATIONS
  const expanded =
    model.workspace.isDiscussionExpanded || model.currentPart === CONVERSATIONS
  const styles = {
    '--nav-w': `${Option.getOrElse(model.maybeNavWidth, () => 284)}px`,
    '--side-set': `${Option.getOrElse(model.maybeSideWidth, () => 430)}px`,
  }
  const content =
    model.currentPart === REVIEW
      ? reviewView(model, snapshot, reading, h)
      : model.currentPart === REPLIES
        ? repliesView(model, snapshot, reading, h)
        : model.currentPart === NEEDS
          ? needsView(model, snapshot, reading, h)
          : model.currentPart === 'plan' || model.currentPart === 'status'
            ? runView(model, snapshot, reading, h)
            : model.currentPart === 'decided'
              ? reading.decided(h)
              : model.currentPart === CONVERSATIONS
                ? discussionView(model, snapshot, reading, true, h)
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
      reading.notices(h),
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
      h.header(
        [h.Class('f-topbar')],
        [
          h.a(
            [h.Href('/'), h.Class('f-run-name'), h.Title('All grills')],
            [grill.title],
          ),
          h.span(
            [h.Class('f-current-question')],
            [
              Option.match(question, {
                onSome: step => step.question.id,
                onNone: () => '',
              }),
            ],
          ),
          h.nav(
            [h.AriaLabel('Run actions')],
            [
              pageLink('Conversations', CONVERSATIONS, h),
              pageLink(
                `Replies${agentMessagesOf(snapshot).filter(message => !model.readIds.includes(message.id) && message.at > Option.getOrElse(model.readSince, () => Infinity)).length > 0 ? ' · new' : ''}`,
                REPLIES,
                h,
              ),
              h.button(
                [
                  h.Class('send-button'),
                  h.OnClick(Message.ClickedWorkspacePage({ page: REVIEW })),
                ],
                [
                  `Review & send${drafts.length > 0 ? ` · ${drafts.length}` : ''}`,
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
      h.div(
        [
          h.Class(
            `f-frame${isDiscussion && model.currentPart !== CONVERSATIONS ? ' f-with-discussion' : ''}${expanded && isDiscussion ? ' f-expanded' : ''}`,
          ),
          h.Style(styles),
        ],
        [
          navigationView(model, snapshot, h),
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
                        'Discuss',
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

const navigationView = (model: Model, snapshot: Snapshot, h: H): Html => {
  const grill = snapshot.grill
  const open = grill.steps.filter(step => {
    const status = statusOf(grill, model.answers, step.question.id)
    return status._tag === 'Open' || status._tag === 'Waiting'
  })
  const visible = visibleQuestions(
    model.workspace,
    snapshot,
    model.answers,
    model.notes,
    model.own,
  )
  const rounds = Array.dedupe(
    visible.map(step => step.question.round ?? 1),
  ).sort((a, b) => a - b)
  const item = (label: string, hint: string, page: string) =>
    h.button(
      [
        h.Class(`f-nav-item${model.currentPart === page ? ' is-current' : ''}`),
        h.OnClick(Message.ClickedWorkspacePage({ page })),
        h.AriaCurrent(model.currentPart === page ? 'page' : 'false'),
      ],
      [h.span([], [label]), h.span([h.Class('hint')], [hint])],
    )
  return h.aside(
    [h.Class('f-navigation'), h.AriaLabel('Grill navigation')],
    [
      h.div(
        [h.Class('f-nav-top')],
        [
          h.a([h.Href('/'), h.Class('f-brand')], ['grill-flow']),
          item('Needs you', `${open.length} open`, NEEDS),
          item(
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
          h.a(
            [h.Href('/'), h.Class('f-nav-item')],
            [
              h.span([], ['Your grills']),
              h.span([h.Class('hint')], ['All machines']),
            ],
          ),
        ],
      ),
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
              h.Class('f-filters'),
              h.Role('group'),
              h.AriaLabel('Question state'),
            ],
            (
              ['All', 'Open', 'Draft', 'Sent'] satisfies ReadonlyArray<
                typeof model.workspace.filter
              >
            ).map(filter =>
              h.button(
                [
                  h.Class(model.workspace.filter === filter ? 'is-active' : ''),
                  h.AriaPressed(String(model.workspace.filter === filter)),
                  h.OnClick(Message.ChangedQuestionFilter({ filter })),
                ],
                [filter === 'All' ? h.empty : stateMark(filter, h), filter],
              ),
            ),
          ),
        ],
      ),
      h.nav(
        [h.Class('f-question-list'), h.AriaLabel('Questions by round')],
        [
          ...(Array.isReadonlyArrayEmpty(visible)
            ? [
                h.p(
                  [h.Class('hint f-empty-nav')],
                  ['No questions match. Clear the search or choose All.'],
                ),
              ]
            : []),
          ...rounds.map(round => {
            const steps = visible.filter(
              step => (step.question.round ?? 1) === round,
            )
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
            const collapsed = roundIsCollapsed(
              model.workspace,
              snapshot,
              round,
              model.answers,
              model.notes,
              model.own,
            )
            return h.keyed('section')(
              `round-${round}`,
              [h.Class('f-round')],
              [
                h.button(
                  [
                    h.Class('f-round-toggle'),
                    h.AriaExpanded(!collapsed),
                    h.OnClick(Message.ClickedRound({ round })),
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
                    `Round ${round}`,
                    h.span([h.Class('hint')], [`${sent}/${steps.length} sent`]),
                  ],
                ),
                ...(collapsed
                  ? []
                  : steps.map(step => {
                      const state = questionState(
                        snapshot,
                        step,
                        model.answers,
                        model.notes,
                        model.own,
                      )
                      return h.keyed('button')(
                        step.id,
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
                            model.currentPart ===
                              `${QUESTION_PAGE}${step.question.id}`
                              ? 'page'
                              : 'false',
                          ),
                          h.Title(
                            `${step.question.id} · ${state} · ${step.question.title}`,
                          ),
                        ],
                        [
                          stateMark(state, h),
                          h.span(
                            [h.Class('f-question-number')],
                            [step.question.id],
                          ),
                          h.span([], [step.question.title]),
                          h.span([h.Class('sr-only')], [state]),
                        ],
                      )
                    })),
              ],
            )
          }),
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
  const question = step.question
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
        h.Title(`${direction} question`),
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
            [h.Class('f-reading'), h.Id(`q-${question.id}`)],
            [
              h.h1(
                [h.Class('f-question-title'), h.Id(`ask-text-${question.id}`)],
                reading.heading(question.ask, h),
              ),
              h.div(
                [h.Class('f-question-meta')],
                [
                  h.span([], [question.id]),
                  question.issue === undefined
                    ? h.empty
                    : h.span([], reading.inline(question.issue, h)),
                  reading.source(step, h),
                  h.span([], [`Round ${question.round ?? 1}`]),
                  h.span(
                    [h.Class('f-state-label')],
                    [stateMark(state, h), state],
                  ),
                ],
              ),
              question.scope === ''
                ? h.empty
                : h.p([h.Class('f-scope hint')], [question.scope]),
              reading.question(step, h),
              h.p(
                [h.Class('f-saved hint'), h.AriaLive('polite')],
                [
                  Option.match(model.maybeSaveError, {
                    onSome: error =>
                      `Could not save: ${error}. Your answer is still in this tab.`,
                    onNone: () =>
                      model.pendingEvents > 0
                        ? 'Saving…'
                        : state === 'Draft'
                          ? 'Draft saved · not sent'
                          : state === 'Sent'
                            ? 'Sent to the agent'
                            : 'Choose an answer to save a draft',
                  }),
                ],
              ),
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

const reviewView = (
  model: Model,
  snapshot: Snapshot,
  reading: Reading,
  h: H,
): Html => {
  const drafts = draftQuestions(snapshot, model.answers, model.notes, model.own)
  const selected = drafts.filter(
    step => !model.workspace.excluded.includes(step.question.id),
  )
  return h.section(
    [h.Class('f-page f-review')],
    [
      h.h1([], ['Review & send']),
      h.p(
        [h.Class('hint')],
        [
          'Select the answers you want to send. Unselected answers stay as drafts.',
        ],
      ),
      h.div(
        [h.Class('f-review-summary')],
        [
          h.strong(
            [],
            [`${selected.length} of ${drafts.length} drafts selected`],
          ),
          link(
            'Select all',
            Message.ClickedSelectReview({ selected: true }),
            h,
          ),
          link(
            'Clear selection',
            Message.ClickedSelectReview({ selected: false }),
            h,
          ),
        ],
      ),
      h.div(
        [h.Class('f-table-scroll')],
        [
          h.table(
            [h.Class('f-table')],
            [
              h.thead(
                [],
                [
                  h.tr(
                    [],
                    [
                      h.th([h.Scope('col')], ['Send']),
                      h.th([h.Scope('col')], ['Question']),
                      h.th([h.Scope('col')], ['Your answer']),
                      h.th([h.Scope('col')], ['']),
                    ],
                  ),
                ],
              ),
              h.tbody(
                [],
                drafts.map(step =>
                  h.keyed('tr')(
                    step.id,
                    [],
                    [
                      h.td(
                        [],
                        [
                          h.input([
                            h.Type('checkbox'),
                            h.Checked(
                              !model.workspace.excluded.includes(
                                step.question.id,
                              ),
                            ),
                            h.AriaLabel(`Send ${step.question.id}`),
                            h.OnClick(
                              Message.ToggledReviewAnswer({
                                question: step.question.id,
                              }),
                            ),
                          ]),
                        ],
                      ),
                      h.td(
                        [],
                        [
                          h.strong([], [step.question.id]),
                          h.span([], [step.question.title]),
                        ],
                      ),
                      h.td(
                        [],
                        [
                          h.span(
                            [],
                            reading.inline(
                              answerLabel(step, model.answers, model.own),
                              h,
                            ),
                          ),
                          (model.notes[step.question.id] ?? '').trim() === ''
                            ? h.empty
                            : h.p(
                                [h.Class('hint')],
                                [model.notes[step.question.id] ?? ''],
                              ),
                        ],
                      ),
                      h.td(
                        [],
                        [
                          pageLink(
                            'Edit',
                            `${QUESTION_PAGE}${step.question.id}`,
                            h,
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
      Array.isReadonlyArrayEmpty(drafts)
        ? h.p(
            [h.Class('f-empty')],
            [
              'No drafts to send. Choose an answer on a question page; it will appear here.',
            ],
          )
        : h.empty,
      h.div(
        [h.Class('f-review-compose')],
        [
          h.label(
            [h.For('send-message')],
            ['A message with your answers (optional)'],
          ),
          h.textarea([
            h.Id('send-message'),
            h.Rows(3),
            h.OnMount(FillBox({ text: model.sendMessage })),
            h.Placeholder('Anything the agent should know'),
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
                    : model.send === 'Sent'
                      ? model.sendDetail
                      : '⌘ / Ctrl + Enter sends the selection',
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

const discussionView = (
  model: Model,
  snapshot: Snapshot,
  reading: Reading,
  expanded: boolean,
  h: H,
): Html => {
  const onQuestion = questionOnPage(snapshot, model.currentPart)
  const target = Option.getOrElse(model.workspace.maybeDiscussionTarget, () =>
    Option.match(onQuestion, {
      onSome: step => step.id,
      onNone: () => RUN_TARGET,
    }),
  )
  const step = snapshot.grill.steps.find(item => item.id === target)
  const draft = model.talkDrafts[threadDraftKey(target)] ?? ''
  const thread = reading.thread(target, h)
  const context =
    step === undefined
      ? h.div(
          [h.Class('f-context')],
          [
            h.h3([], [snapshot.grill.title]),
            ...snapshot.grill.intro.map(text => reading.prose(text, h)),
          ],
        )
      : h.div(
          [h.Class('f-context')],
          [
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
              snapshot.grill.session === ''
                ? 'Agent'
                : `Run orchestrator · ${snapshot.grill.session}`,
            ],
          ),
          h.div(
            [h.Class('f-discussion-actions')],
            [
              model.currentPart === CONVERSATIONS
                ? h.empty
                : link(
                    expanded ? 'Reduce' : 'Expand',
                    Message.ClickedExpandDiscussion(),
                    h,
                  ),
              model.currentPart === CONVERSATIONS
                ? pageLink(
                    'Close',
                    Option.getOrElse(
                      Option.filter(
                        model.maybePrevious,
                        page => page !== CONVERSATIONS,
                      ),
                      () => 'overview',
                    ),
                    h,
                  )
                : link('Close', Message.ClickedCloseDiscussion(), h),
            ],
          ),
        ],
      ),
      model.currentPart === CONVERSATIONS
        ? h.label(
            [h.Class('f-conversation-picker')],
            [
              h.span([], ['Conversation']),
              h.select(
                [
                  h.AriaLabel('Choose a conversation'),
                  h.Value(target),
                  h.OnInput(target =>
                    Message.SelectedDiscussionTarget({ target }),
                  ),
                ],
                [
                  h.option([h.Value(RUN_TARGET)], ['Whole run']),
                  ...snapshot.grill.steps.map(item =>
                    h.option(
                      [h.Value(item.id)],
                      [`${item.question.id} · ${item.question.title}`],
                    ),
                  ),
                  ...snapshot.grill.parts
                    .filter(part =>
                      snapshot.asks.some(
                        ask => ask.stepId === `part:${part.id}`,
                      ),
                    )
                    .map(part =>
                      h.option([h.Value(`part:${part.id}`)], [part.title]),
                    ),
                ],
              ),
            ],
          )
        : h.empty,
      h.div(
        [
          h.Class('f-discussion-scope'),
          h.Role('group'),
          h.AriaLabel('Conversation scope'),
        ],
        [
          h.button(
            [
              h.Class(
                target === RUN_TARGET
                  ? 'quiet-button is-active'
                  : 'quiet-button',
              ),
              h.AriaPressed(String(target === RUN_TARGET)),
              h.OnClick(
                Message.SelectedDiscussionTarget({ target: RUN_TARGET }),
              ),
            ],
            ['Whole run'],
          ),
          ...(step === undefined && Option.isNone(onQuestion)
            ? []
            : [
                h.button(
                  [
                    h.Class(
                      target !== RUN_TARGET
                        ? 'quiet-button is-active'
                        : 'quiet-button',
                    ),
                    h.AriaPressed(String(target !== RUN_TARGET)),
                    h.OnClick(
                      Message.SelectedDiscussionTarget({
                        target: step?.id ?? Option.getOrThrow(onQuestion).id,
                      }),
                    ),
                  ],
                  [
                    step?.question.id ??
                      Option.getOrThrow(onQuestion).question.id,
                  ],
                ),
              ]),
        ],
      ),
      h.div(
        [h.Class('f-discussion-messages')],
        [
          expanded ? context : h.empty,
          ...(Array.isReadonlyArrayEmpty(thread)
            ? [
                h.p(
                  [h.Class('hint f-empty')],
                  [
                    step === undefined
                      ? 'Ask about this run. The agent’s reply will appear here.'
                      : 'Ask about this question, compare its choices, or request a clearer rewrite.',
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
            [h.For('talk-box'), h.Class('sr-only')],
            ['Message to the agent'],
          ),
          h.keyed('textarea')(`discussion-${target}-${model.talkGeneration}`, [
            h.Id('talk-box'),
            h.Rows(4),
            h.OnMount(FillBox({ text: draft })),
            h.Placeholder(
              step === undefined
                ? 'Ask about the run…'
                : `Ask about ${step.question.id}…`,
            ),
            h.OnInput(value =>
              Message.UpdatedTalkDraft({
                partId: threadDraftKey(target),
                value,
              }),
            ),
            h.OnKeyDownPreventDefault((key, { metaKey, ctrlKey }) =>
              key === 'Enter' && (metaKey || ctrlKey)
                ? Option.some(Message.SubmittedWorkspaceDiscussion({ target }))
                : Option.none(),
            ),
          ]),
          h.div(
            [h.Class('f-send-foot')],
            [
              h.span([h.Class('hint')], ['⌘ / Ctrl + Enter to send']),
              h.button([h.Type('submit'), h.Class('send-button')], ['Send']),
            ],
          ),
        ],
      ),
    ],
  )
}

const needsView = (
  model: Model,
  snapshot: Snapshot,
  reading: Reading,
  h: H,
): Html => {
  const steps = snapshot.grill.steps.filter(step => {
    const status = statusOf(
      snapshot.grill,
      model.answers,
      step.question.id,
      model.skipped,
    )
    return status._tag === 'Open' || status._tag === 'Waiting'
  })
  const ready = steps.filter(
    step =>
      statusOf(snapshot.grill, model.answers, step.question.id, model.skipped)
        ._tag === 'Open',
  )
  const waiting = steps.filter(step => !ready.includes(step))
  const rows = (items: ReadonlyArray<Step>) =>
    items.map(step =>
      h.keyed('div')(
        step.id,
        [h.Class('f-needs-row')],
        [
          h.div(
            [],
            [
              h.strong([], [`${step.question.id} · ${step.question.title}`]),
              h.p([h.Class('hint')], [step.question.scope]),
            ],
          ),
          pageLink('Open question', `${QUESTION_PAGE}${step.question.id}`, h),
        ],
      ),
    )
  return h.section(
    [h.Class('f-page')],
    [
      h.h1([], ['Needs you']),
      h.p(
        [h.Class('hint')],
        [
          `${ready.length} questions ready to answer${waiting.length === 0 ? '' : ` · ${waiting.length} waiting on another answer`}`,
        ],
      ),
      h.h2([], ['Ready to answer']),
      ...(ready.length === 0
        ? [h.p([], ['Nothing is waiting for an answer.'])]
        : rows(ready)),
      ...(waiting.length === 0
        ? []
        : [h.h2([], ['Waiting on another answer']), ...rows(waiting)]),
    ],
  )
}

const runView = (
  model: Model,
  snapshot: Snapshot,
  reading: Reading,
  h: H,
): Html => {
  const grill = snapshot.grill
  const issues = grill.plan?.issues ?? []
  return h.section(
    [h.Class('f-page f-run-overview')],
    [
      h.h1([], ['Run overview']),
      ...grill.intro.map(text => reading.prose(text, h)),
      h.div(
        [h.Class('f-run-summary')],
        [
          h.span(
            [],
            [
              `${issues.filter(issue => issue.phase === 'merged').length} merged`,
            ],
          ),
          h.span(
            [],
            [
              `${issues.filter(issue => ['building', 'review'].includes(issue.phase)).length} active`,
            ],
          ),
          h.span(
            [],
            [
              `${issues.filter(issue => !['merged', 'building', 'review', 'outside'].includes(issue.phase)).length} remaining`,
            ],
          ),
          h.span(
            [],
            [
              grill.plan?.slots === undefined
                ? ''
                : `${grill.plan.slots} session slots`,
            ],
          ),
        ],
      ),
      h.h2([], ['Work and sessions']),
      h.div(
        [h.Class('f-table-scroll')],
        [
          h.table(
            [h.Class('f-table')],
            [
              h.thead(
                [],
                [
                  h.tr(
                    [],
                    ['Issue', 'State', 'Session', 'What happens next'].map(
                      label => h.th([h.Scope('col')], [label]),
                    ),
                  ),
                ],
              ),
              h.tbody(
                [],
                issues.map(issue =>
                  h.keyed('tr')(
                    issue.id,
                    [],
                    [
                      h.td(
                        [],
                        [
                          h.span([], reading.inline(issue.id, h)),
                          h.span([], [issue.title]),
                        ],
                      ),
                      h.td([], [planPhaseOf(grill, issue, model.answers)]),
                      h.td([], [issue.agent ?? '—']),
                      h.td(
                        [],
                        [
                          issue.note ?? '',
                          ...(issue.start ?? []).map(id =>
                            pageLink(id, `${QUESTION_PAGE}${id}`, h),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
      issues.length === 0
        ? h.p(
            [h.Class('f-empty')],
            ['The agent has not supplied a run plan for this grill.'],
          )
        : h.empty,
      h.h2([], ['Decisions']),
      pageLink('Replies and decisions', REPLIES, h),
      h.h2([], ['After this round']),
      ...grill.next.map(text => reading.prose(text, h)),
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
          [h.Class('f-reply'), h.Id(`agent-${message.id}`)],
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
