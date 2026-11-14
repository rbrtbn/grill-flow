import { Array, Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { decisionArticle } from './attentionView'
import { sessionAvatar } from './avatar'
import { channelItemKey } from './channel'
import type { Snapshot } from './domain'
import {
  ALL_SCOPES,
  BUCKETS,
  type Bucket,
  DECISION_PAGE,
  type Entry,
  type Filters,
  GROUP_BYS,
  type GroupBy,
  INBOX,
  ITEM_PAGE,
  type InboxData,
  type InboxQuestion,
  KINDS,
  NAMES,
  PRESET_VIEWS,
  RUNS,
  RUN_PAGE,
  SCOPE_LABELS,
  SESSION_TYPES,
  SESSION_TYPE_ORDER,
  type SessionInfo,
  type Task,
  type TaskStep,
  bucketLabel,
  bucketOf,
  decisionKey,
  dueCount,
  entriesOf,
  filtersFrom,
  hasFilters,
  isCurrentView,
  isLive,
  isQuestionQueryEmpty,
  kindOf,
  passes,
  placeLabel,
  placeOf,
  provisionalDecisions,
  questionPasses,
  questionQueryFrom,
  questionQueryString,
  requestMessage,
  sessionOf,
  taskEntry,
  threadTarget,
} from './inbox'
import { Message, type Model, PAGE_LINK_COPY } from './main'
import { refView } from './refCard'
import { roundCard, sessionCard } from './refCards'
import { QUESTION_PAGE } from './workspace'

type H = HtmlBuilder<Message>
type Prose = (text: string, h: H) => Html

// SHARED

const go = (page: string) => Message.ClickedWorkspacePage({ page })

const navLink = (label: string, page: string, h: H, className = '') =>
  h.button(
    [
      h.Type('button'),
      h.Class(
        `text-button f-inbox-link${className === '' ? '' : ` ${className}`}`,
      ),
      h.OnClick(go(page)),
    ],
    [label],
  )

const withQuery = (page: string, query: string) =>
  query === '' ? page : `${page}?${query}`

export const ago = (now: number, at: number): string => {
  if (now === 0) {
    return ''
  }
  const minutes = Math.round((now - at) / 60000)
  if (minutes < 1) {
    return 'just now'
  }
  if (minutes < 60) {
    return `${minutes} min ago`
  }
  const hours = Math.round(minutes / 60)
  return hours < 36 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`
}

const urgencyChip = (bucket: Bucket, h: H) =>
  h.span([h.Class(`f-inbox-urgency is-${bucket}`)], [bucketLabel(bucket)])

const STATE_CHIPS: Readonly<
  Record<Task['state']['_tag'], Readonly<{ label: string; tone: string }>>
> = {
  Open: { label: 'On you', tone: 'open' },
  Promised: { label: NAMES.promised, tone: 'promised' },
  Reported: { label: NAMES.confirming, tone: 'reported' },
  Completed: { label: 'Done', tone: 'done' },
  Withdrawn: { label: 'Withdrawn', tone: 'skip' },
}

const stateChip = (task: Task, h: H): Html =>
  h.span(
    [h.Class(`f-inbox-state is-${STATE_CHIPS[task.state._tag].tone}`)],
    [STATE_CHIPS[task.state._tag].label],
  )

export const sessionTag = (data: InboxData, address: string, h: H): Html =>
  Option.match(sessionOf(data, address), {
    onNone: () =>
      h.span(
        [h.Class('f-session-tag')],
        [sessionAvatar(address, address, h, 'Small'), address],
      ),
    onSome: session =>
      h.button(
        [
          h.Type('button'),
          h.Class(`f-session-tag is-${session.type.toLowerCase()}`),
          h.Title(
            `${SESSION_TYPES[session.type].label}: ${SESSION_TYPES[session.type].note}`,
          ),
          h.OnClick(go(`${RUN_PAGE}${address}`)),
        ],
        [
          sessionAvatar(address, session.label, h, 'Small'),
          address,
          session.type === 'Interactive'
            ? ` · ${NAMES.interactive.toLowerCase()}`
            : session.type === 'Ended'
              ? ' · ended'
              : '',
        ],
      ),
  })

const typeBadge = (session: SessionInfo, h: H) =>
  h.span(
    [
      h.Class(`f-type-badge is-${session.type.toLowerCase()}`),
      h.Title(SESSION_TYPES[session.type].note),
    ],
    [SESSION_TYPES[session.type].label],
  )

const heldBy = (data: InboxData, task: Task) =>
  data.freezes.filter(freeze => (task.heldBy ?? []).includes(freeze.id))

const copyLabel = (model: Model, key: string, label: string) =>
  model.ownerCopies[key] === 'Copied'
    ? 'Copied'
    : model.ownerCopies[key] === 'Failed'
      ? 'Copy failed'
      : label

const copyBox = (
  model: Model,
  key: string,
  text: string,
  label: string,
  h: H,
): Html =>
  h.div(
    [h.Class('f-copy-box')],
    [
      h.code([], [text]),
      h.button(
        [
          h.Type('button'),
          h.Class('quiet-button'),
          h.OnClick(Message.ClickedCopyInboxLine({ key, text })),
        ],
        [copyLabel(model, key, label)],
      ),
    ],
  )

const stepsList = (model: Model, data: InboxData, task: Task, h: H): Html =>
  task.steps === undefined
    ? task.copy !== undefined && task.state._tag !== 'Promised'
      ? copyBox(model, `inbox:${task.id}`, task.copy, 'Copy line', h)
      : h.empty
    : h.ol(
        [h.Class('f-task-steps')],
        task.steps.map((step: TaskStep, index) => {
          const freeze = data.freezes.find(entry => entry.id === step.heldBy)
          return h.li(
            [h.Class(freeze === undefined ? '' : 'is-held')],
            [
              h.span([], [step.text]),
              step.copy === undefined
                ? h.empty
                : copyBox(
                    model,
                    `inbox:${task.id}#${index}`,
                    step.copy,
                    'Copy',
                    h,
                  ),
              step.link === undefined
                ? h.empty
                : h.a(
                    [
                      h.Href(step.link),
                      h.Target('_blank'),
                      h.Rel('noreferrer'),
                    ],
                    [` ${step.link.replace('https://github.com/', '')} ↗`],
                  ),
              freeze === undefined
                ? h.empty
                : h.p(
                    [h.Class('f-held-note')],
                    [
                      `⏸ ${NAMES.freeze}: ${freeze.title} until ${freeze.clearsWhen}.`,
                    ],
                  ),
            ],
          )
        }),
      )

const originLine = (task: Task, h: H): Html => {
  const origin = task.origin
  if (origin === undefined) {
    return h.empty
  }
  return h.div(
    [h.Class('f-task-origin')],
    origin._tag === 'Answer'
      ? [
          h.span([h.Class('f-origin-k')], ['From your answer']),
          h.button(
            [
              h.Type('button'),
              h.Class('text-button'),
              h.OnClick(go(`${QUESTION_PAGE}${origin.question}`)),
            ],
            [origin.question],
          ),
          ` ${origin.title} · `,
          h.b([], [origin.answer]),
          h.blockquote([], [origin.note]),
        ]
      : origin._tag === 'Pick'
        ? [
            h.span([h.Class('f-origin-k')], ['Your page pick']),
            ` card ${origin.card}: `,
            h.b([], [origin.pick]),
          ]
        : [
            h.span([h.Class('f-origin-k')], ['Your page picks']),
            ` ${origin.label}: `,
            ...origin.questions.map(question =>
              h.button(
                [
                  h.Type('button'),
                  h.Class('text-button f-origin-q'),
                  h.OnClick(go(`${QUESTION_PAGE}${question}`)),
                ],
                [question],
              ),
            ),
          ],
  )
}

const doneLine = (model: Model, task: Task, h: H): Html =>
  h.p(
    [h.Class('f-done-line hint')],
    [
      task.state._tag === 'Completed'
        ? `✓ ${task.state.proof} · ${ago(model.now, task.state.at)}`
        : task.state._tag === 'Reported'
          ? `You said done (${task.state.via}). Waiting for ${task.session}'s proof.`
          : task.state._tag === 'Withdrawn'
            ? `Withdrawn: ${task.state.reason}`
            : task.state._tag === 'Promised'
              ? `${task.session} fills this in when ${task.state.until}.`
              : `Done when ${task.session} posts proof.`,
    ],
  )

/** The one move a task leads with: a page answer when its agent accepts one, else typing it. */
const leadAction = (
  model: Model,
  task: Task,
  isCompact: boolean,
  h: H,
): Html => {
  const source = Option.getOrUndefined(task.maybeSource)
  const destination = task.destination
  if (task.pageAnswer !== undefined) {
    return h.button(
      [
        h.Type('button'),
        h.Class('send-button'),
        h.Disabled(true),
        h.Title(
          `Sends ${task.pageAnswer.question} = ${task.pageAnswer.option} as a page answer ${task.session} reads with gf grant; wired with the business logic`,
        ),
      ],
      ['Answer on page'],
    )
  }
  if (destination._tag !== 'Terminal') {
    return h.empty
  }
  const copyKey =
    source === undefined
      ? `inbox:${task.id}`
      : channelItemKey(source.source, task.id, source.revision)
  return h.span(
    [h.Class('f-type-route')],
    [
      isCompact ? h.empty : h.b([], [`Type it in ${destination.address}.`]),
      h.button(
        [
          h.Type('button'),
          h.Class('quiet-button'),
          h.Title(
            source === undefined
              ? 'Sample task: copies the line; focusing needs a published step'
              : `Copies the line and focuses ${destination.address} in Herdr`,
          ),
          h.OnClick(
            source === undefined
              ? Message.ClickedCopyInboxLine({
                  key: copyKey,
                  text: task.copy ?? task.action,
                })
              : Message.ClickedCopyAndFocus({
                  source: source.source,
                  item: task.id,
                  revision: source.revision,
                }),
          ),
        ],
        [
          copyLabel(
            model,
            copyKey,
            isCompact ? 'Copy & focus' : `Copy & focus ${destination.address}`,
          ),
        ],
      ),
    ],
  )
}

const taskButtons = (model: Model, task: Task, h: H): Html => {
  if (task.state._tag !== 'Open') {
    return h.empty
  }
  const source = Option.getOrUndefined(task.maybeSource)
  const destination = task.destination
  return h.div(
    [h.Class('f-actions f-task-buttons')],
    [
      leadAction(model, task, false, h),
      destination._tag === 'Link'
        ? h.a(
            [
              h.Class('quiet-button'),
              h.Href(destination.url),
              h.Target('_blank'),
              h.Rel('noreferrer'),
            ],
            [`Open ${OPEN_LABELS[placeOf(task)] ?? 'link'} ↗`],
          )
        : h.empty,
      source === undefined || destination._tag === 'Terminal'
        ? h.empty
        : h.button(
            [
              h.Type('button'),
              h.Class('quiet-button'),
              h.OnClick(
                Message.ClickedCopyOwnerStep({
                  source: source.source,
                  item: task.id,
                  revision: source.revision,
                }),
              ),
            ],
            [
              copyLabel(
                model,
                channelItemKey(source.source, task.id, source.revision),
                'Copy action',
              ),
            ],
          ),
      h.button(
        [
          h.Type('button'),
          h.Class('quiet-button'),
          h.Disabled(true),
          h.Title(
            'Reporting it done to the agent comes with the business logic',
          ),
        ],
        ['I did it'],
      ),
    ],
  )
}

const OPEN_LABELS: Readonly<Record<string, string>> = {
  github: 'on GitHub',
  linear: 'in Linear',
  here: 'here',
}

const freezeBanner = (
  model: Model,
  data: InboxData,
  h: H,
): ReadonlyArray<Html> =>
  data.freezes.map(freeze =>
    h.keyed('div')(
      freeze.id,
      [h.Class('f-freeze'), h.Role('note')],
      [
        h.b([], [`⏸ ${NAMES.freeze}: ${freeze.title}`]),
        ` until ${freeze.clearsWhen}. `,
        freeze.isUnknown === true
          ? h.span([h.Class('f-freeze-unknown')], ['evidence unknown '])
          : h.empty,
        h.span(
          [h.Class('hint')],
          [`${freeze.session} · ${ago(model.now, freeze.at)}`],
        ),
        h.p([], [freeze.body]),
      ],
    ),
  )

// HEADER

export const inboxNavView = (model: Model, data: InboxData, h: H): Html => {
  const due = dueCount(data)
  const dueQuestions = entriesOf(data).filter(
    entry => entry._tag === 'Question' && entry.bucket !== 'later',
  ).length
  const isActive = model.currentPart === INBOX
  return h.span(
    [h.Class(`f-inbox-split${isActive ? ' is-active' : ''}`)],
    [
      h.button(
        [
          h.Type('button'),
          h.Class(`text-button${isActive ? ' is-active' : ''}`),
          h.AriaCurrent(isActive ? 'page' : 'false'),
          h.Title(
            `${due - dueQuestions} tasks and ${dueQuestions} questions in ${NAMES.now} and ${NAMES.next}`,
          ),
          h.OnClick(go(INBOX)),
        ],
        [
          NAMES.inbox,
          due > 0
            ? h.span([h.Class('f-nav-count is-hot')], [String(due)])
            : h.empty,
        ],
      ),
      h.button(
        [
          h.Type('button'),
          h.Class('text-button f-quick-look-caret'),
          h.AriaExpanded(model.inbox.isQuickLookOpen),
          h.AriaLabel(NAMES.quickLook),
          h.AriaKeyshortcuts('.'),
          h.Title(`${NAMES.quickLook} (.)`),
          h.OnClick(Message.ClickedQuickLook()),
        ],
        ['▾'],
      ),
    ],
  )
}

export const freezePillView = (data: InboxData, h: H): Html =>
  Array.isReadonlyArrayNonEmpty(data.freezes)
    ? h.button(
        [
          h.Type('button'),
          h.Class('f-freeze-pill'),
          h.Title(data.freezes.map(freeze => freeze.title).join(' · ')),
          h.OnClick(go(INBOX)),
        ],
        [`⏸ ${data.freezes.length} ${NAMES.freeze.toLowerCase()}`],
      )
    : h.empty

export const quickLookView = (model: Model, data: InboxData, h: H): Html => {
  if (!model.inbox.isQuickLookOpen) {
    return h.empty
  }
  const entries = entriesOf(data)
  return h.div(
    [h.Class('f-quick-look'), h.Role('dialog'), h.AriaLabel(NAMES.quickLook)],
    [
      h.div(
        [h.Class('f-quick-look-head')],
        [
          h.b([], [NAMES.quickLook]),
          h.span([h.Class('hint')], ['press . to toggle']),
        ],
      ),
      ...data.freezes.map(freeze =>
        h.p(
          [h.Class('f-quick-look-freeze')],
          [`⏸ ${NAMES.freeze}: ${freeze.title}`],
        ),
      ),
      ...BUCKETS.flatMap(bucket => {
        const tasks = entries.filter(
          entry => entry.bucket === bucket && entry._tag === 'Task',
        )
        const questions = entries.filter(
          entry => entry.bucket === bucket && entry._tag === 'Question',
        )
        if (tasks.length + questions.length === 0) {
          return []
        }
        return [
          h.h3(
            [],
            [`${bucketLabel(bucket)} · ${tasks.length + questions.length}`],
          ),
          ...tasks.map(entry =>
            entry._tag === 'Task'
              ? h.button(
                  [
                    h.Type('button'),
                    h.Class('f-quick-look-row'),
                    h.OnClick(go(`${ITEM_PAGE}${entry.task.id}`)),
                  ],
                  [
                    h.span([], [entry.task.title]),
                    h.span([h.Class('hint')], [placeLabel(entry.place)]),
                  ],
                )
              : h.empty,
          ),
          Array.isReadonlyArrayNonEmpty(questions)
            ? h.button(
                [
                  h.Type('button'),
                  h.Class('f-quick-look-row'),
                  h.OnClick(
                    go(questionsPage(data, questions, `urgency=${bucket}`)),
                  ),
                ],
                [
                  h.span(
                    [],
                    [
                      `❓ ${questions.length} ${questions.length === 1 ? 'question' : 'questions'}`,
                    ],
                  ),
                  h.span(
                    [h.Class('hint')],
                    [
                      Array.dedupe(questions.map(entry => entry.session)).join(
                        ', ',
                      ),
                    ],
                  ),
                ],
              )
            : h.empty,
        ]
      }),
      h.div(
        [h.Class('f-quick-look-foot')],
        [
          navLink(`Open ${NAMES.inbox}`, INBOX, h),
          navLink(`Open ${NAMES.runs}`, RUNS, h),
        ],
      ),
    ],
  )
}

/** The Questions page for a set of entries: their first question, filtered by `query`. */
const questionsPage = (
  data: InboxData,
  entries: ReadonlyArray<Entry>,
  query: string,
): string => {
  const first = entries.find(entry => entry._tag === 'Question')
  const id =
    first?._tag === 'Question' ? first.question.id : data.questions[0]?.id
  return withQuery(id === undefined ? INBOX : `${QUESTION_PAGE}${id}`, query)
}

// REQUEST UPDATE

const pageActions = (
  model: Model,
  data: InboxData,
  snapshot: Snapshot,
  inView: ReadonlyArray<string>,
  label: string,
  h: H,
): Html => {
  const state = model.inbox.requestUpdate
  return h.div(
    [h.Class('f-page-actions')],
    [
      h.button(
        [
          h.Type('button'),
          h.Class('quiet-button'),
          h.AriaExpanded(state._tag === 'Open'),
          h.OnClick(Message.ClickedRequestUpdate({ sessions: inView })),
        ],
        [`⟳ ${NAMES.requestUpdate} ▾`],
      ),
      state._tag === 'Open'
        ? h.div(
            [
              h.Class('f-request-menu'),
              h.Role('dialog'),
              h.AriaLabel(NAMES.requestUpdate),
            ],
            [
              h.h3([], ['What to bring up to date']),
              ...ALL_SCOPES.map(scope =>
                h.label(
                  [h.Class('f-check')],
                  [
                    h.input([
                      h.Type('checkbox'),
                      h.Checked(state.scope.includes(scope)),
                      h.OnChange(() => Message.ClickedUpdateScope({ scope })),
                    ]),
                    ` ${SCOPE_LABELS[scope]}`,
                  ],
                ),
              ),
              h.h3(
                [],
                ['Which sessions ', h.span([h.Class('hint')], [`(${label})`])],
              ),
              h.div(
                [h.Class('f-check-grid')],
                data.sessions.map(session =>
                  h.label(
                    [h.Class(`f-check${isLive(session) ? '' : ' is-dim'}`)],
                    [
                      h.input([
                        h.Type('checkbox'),
                        h.Checked(state.sessions.includes(session.address)),
                        h.OnChange(() =>
                          Message.ClickedUpdateSession({
                            session: session.address,
                          }),
                        ),
                      ]),
                      ` ${session.address} `,
                      h.span(
                        [h.Class('hint')],
                        [SESSION_TYPES[session.type].label],
                      ),
                    ],
                  ),
                ),
              ),
              h.h3([], ['Message']),
              h.p(
                [h.Class('f-message-preview')],
                [requestMessage(snapshot.grill.id, state.scope)],
              ),
              h.p(
                [h.Class('hint')],
                [
                  'Preview: this records the request here and shows replies as pending. Delivery like a page ask comes with the business logic. It asks for an update; it grants nothing.',
                ],
              ),
              h.div(
                [h.Class('f-actions')],
                [
                  h.button(
                    [
                      h.Type('button'),
                      h.Class('send-button'),
                      h.Disabled(
                        !Array.isReadonlyArrayNonEmpty(state.sessions) ||
                          !Array.isReadonlyArrayNonEmpty(state.scope),
                      ),
                      h.OnClick(
                        Message.ClickedSendUpdateRequest({
                          ended: data.sessions
                            .filter(session => !isLive(session))
                            .map(session => session.address),
                        }),
                      ),
                    ],
                    [`Send to ${state.sessions.length}`],
                  ),
                  h.button(
                    [
                      h.Type('button'),
                      h.Class('text-button'),
                      h.OnClick(Message.ClickedRequestUpdate({ sessions: [] })),
                    ],
                    ['Cancel'],
                  ),
                ],
              ),
            ],
          )
        : h.empty,
    ],
  )
}

const requestStrip = (model: Model, h: H): Html =>
  Array.match(model.inbox.requests, {
    onEmpty: () => h.empty,
    onNonEmpty: requests =>
      h.div(
        [h.Class('f-request-strip'), h.AriaLive('polite')],
        [
          h.b([], [NAMES.requestUpdate]),
          ` ${ago(model.now, requests[0].at)}: `,
          ...Array.take(requests, 10).map(request =>
            h.span(
              [
                h.Class(`f-request-chip is-${request.delivery.toLowerCase()}`),
                h.Title(
                  request.delivery === 'Pending'
                    ? 'Recorded here; waiting for a reply'
                    : 'Not delivered: session ended. Hand its tasks to another session or retire them.',
                ),
              ],
              [
                `${request.session} ${request.delivery === 'Pending' ? '…' : '✕'}`,
              ],
            ),
          ),
        ],
      ),
  })

// INBOX

const taskRow = (model: Model, data: InboxData, task: Task, h: H): Html => {
  const isOpen = model.inbox.expanded.includes(task.id)
  const held = heldBy(data, task)
  const quick =
    !isOpen &&
    task.copy !== undefined &&
    task.steps === undefined &&
    task.state._tag === 'Open'
  return h.keyed('article')(
    task.id,
    [h.Class(`f-task${isOpen ? ' is-open' : ''}`)],
    [
      h.div(
        [h.Class('f-task-head')],
        [
          h.button(
            [
              h.Type('button'),
              h.Class('f-caret'),
              h.AriaExpanded(isOpen),
              h.AriaLabel(isOpen ? 'Collapse' : 'Expand'),
              h.OnClick(Message.ClickedToggleInboxTask({ id: task.id })),
            ],
            [isOpen ? '▾' : '▸'],
          ),
          task.state._tag === 'Open'
            ? urgencyChip(taskEntry(task).bucket, h)
            : stateChip(task, h),
          h.button(
            [
              h.Type('button'),
              h.Class('f-task-title'),
              h.OnClick(go(`${ITEM_PAGE}${task.id}`)),
            ],
            [task.title],
          ),
          Array.isReadonlyArrayNonEmpty(held)
            ? h.span(
                [
                  h.Class('f-inbox-state is-held'),
                  h.Title(held.map(freeze => freeze.title).join(' · ')),
                ],
                ['⏸ part held'],
              )
            : h.empty,
          sessionTag(data, task.session, h),
          h.span([h.Class('f-task-place')], [placeLabel(placeOf(task))]),
        ],
      ),
      quick && task.copy !== undefined
        ? h.div(
            [h.Class('f-task-quick')],
            [
              copyBox(model, `inbox:${task.id}`, task.copy, 'Copy', h),
              leadAction(model, task, true, h),
            ],
          )
        : h.empty,
      isOpen
        ? h.div(
            [h.Class('f-task-body')],
            [
              originLine(task, h),
              h.p([h.Class('f-task-prose')], [task.body]),
              stepsList(model, data, task, h),
              task.routeWhy === undefined
                ? h.empty
                : h.p([h.Class('f-task-route')], [task.routeWhy]),
              taskButtons(model, task, h),
              doneLine(model, task, h),
              navLink(
                `Details & ${NAMES.thread.toLowerCase()} ›`,
                `${ITEM_PAGE}${task.id}`,
                h,
              ),
            ],
          )
        : h.empty,
    ],
  )
}

const questionLine = (
  model: Model,
  data: InboxData,
  entries: ReadonlyArray<Entry>,
  group: string,
  query: string,
  h: H,
): Html => {
  const questions = entries.flatMap(entry =>
    entry._tag === 'Question' ? [entry.question] : [],
  )
  if (!Array.isReadonlyArrayNonEmpty(questions)) {
    return h.empty
  }
  const isOpen = model.inbox.openQuestionLines.includes(group)
  const sessions = Array.dedupe(questions.map(question => question.session))
  return h.keyed('article')(
    `questions:${group}`,
    [h.Class('f-task f-question-line')],
    [
      h.div(
        [h.Class('f-task-head')],
        [
          h.button(
            [
              h.Type('button'),
              h.Class('f-caret'),
              h.AriaExpanded(isOpen),
              h.AriaLabel('Show questions'),
              h.OnClick(Message.ClickedToggleQuestionLine({ group })),
            ],
            [isOpen ? '▾' : '▸'],
          ),
          h.span([h.Class('f-question-badge')], [`❓ ${questions.length}`]),
          h.button(
            [
              h.Type('button'),
              h.Class('f-task-title'),
              h.OnClick(Message.ClickedToggleQuestionLine({ group })),
            ],
            [`${questions.length === 1 ? 'question' : 'questions'} to answer`],
          ),
          h.span(
            [h.Class('hint')],
            [
              sessions
                .map(address =>
                  Option.match(sessionOf(data, address), {
                    onNone: () => address,
                    onSome: session =>
                      session.type === 'Interactive'
                        ? `${address} (${NAMES.interactive.toLowerCase()})`
                        : address,
                  }),
                )
                .join(', '),
            ],
          ),
          navLink(
            'Answer ›',
            questionsPage(data, entries, query),
            h,
            'f-answer-link',
          ),
        ],
      ),
      isOpen
        ? h.ul(
            [h.Class('f-question-inline')],
            questions.map(question =>
              h.keyed('li')(
                question.id,
                [],
                [
                  h.button(
                    [
                      h.Type('button'),
                      h.Class('f-question-inline-title'),
                      h.OnClick(go(`${QUESTION_PAGE}${question.id}`)),
                    ],
                    [
                      urgencyChip(bucketOf(question.urgency), h),
                      h.span([h.Class('f-qref')], [question.id]),
                      h.b([], [question.title]),
                    ],
                  ),
                  h.span(
                    [h.Class('hint')],
                    [
                      `${question.key} · ${question.session} · ${question.roundName}`,
                    ],
                  ),
                  question.context === ''
                    ? h.empty
                    : h.p([], [question.context]),
                ],
              ),
            ),
          )
        : h.empty,
    ],
  )
}

type Group = Readonly<{
  key: string
  title: ReadonlyArray<Html | string>
  entries: ReadonlyArray<Entry>
  query: Readonly<Record<string, string>>
  note?: string
  action?: Html
}>

const groupView = (
  model: Model,
  data: InboxData,
  filters: Filters,
  group: Group,
  h: H,
): Html => {
  const tasks = group.entries.flatMap(entry =>
    entry._tag === 'Task' ? [entry.task] : [],
  )
  if (!Array.isReadonlyArrayNonEmpty(group.entries)) {
    return h.empty
  }
  const params = new URLSearchParams(group.query)
  if (Array.isReadonlyArrayNonEmpty(filters.session) && !params.has('run')) {
    params.set('run', filters.session.join(','))
  }
  if (
    Array.isReadonlyArrayNonEmpty(filters.urgency) &&
    !params.has('urgency')
  ) {
    params.set('urgency', filters.urgency.join(','))
  }
  return h.keyed('section')(
    group.key,
    [h.Class('f-inbox-group')],
    [
      h.div(
        [h.Class('f-inbox-group-head')],
        [
          h.h2(
            [],
            [
              ...group.title,
              ' ',
              h.span([h.Class('f-count')], [String(group.entries.length)]),
            ],
          ),
          group.action ?? h.empty,
        ],
      ),
      group.note === undefined ? h.empty : h.p([h.Class('hint')], [group.note]),
      ...tasks.map(task => taskRow(model, data, task, h)),
      questionLine(model, data, group.entries, group.key, params.toString(), h),
    ],
  )
}

const groupsOf = (
  data: InboxData,
  filters: Filters,
  entries: ReadonlyArray<Entry>,
  h: H,
): ReadonlyArray<Group> => {
  const byGroup: Readonly<Record<GroupBy, () => ReadonlyArray<Group>>> = {
    urgency: () =>
      BUCKETS.map(bucket => ({
        key: bucket,
        title: [bucketLabel(bucket)],
        entries: entries.filter(entry => entry.bucket === bucket),
        query: { urgency: bucket },
      })),
    place: () =>
      Array.dedupe(entries.map(entry => entry.place)).map(place => ({
        key: place,
        title: [placeLabel(place)],
        entries: entries.filter(entry => entry.place === place),
        query: {},
        ...(place.startsWith('terminal:')
          ? {
              note: 'Type each line as its own message: one line answers one card.',
            }
          : {}),
      })),
    kind: () =>
      KINDS.map(([kind, label]) => ({
        key: kind,
        title: [label],
        entries: entries.filter(entry => entry.kind === kind),
        query: {},
      })),
    session: () =>
      data.sessions.map(session => ({
        key: session.address,
        title: [
          session.address,
          ' ',
          h.span(
            [h.Class('f-group-sub')],
            [`${session.label} · ${SESSION_TYPES[session.type].label}`],
          ),
        ],
        entries: entries.filter(entry => entry.session === session.address),
        query: { run: session.address },
        action: navLink(`${NAMES.runs} ›`, `${RUN_PAGE}${session.address}`, h),
        ...(session.type === 'Interactive'
          ? { note: SESSION_TYPES.Interactive.note }
          : {}),
      })),
  }
  return byGroup[filters.groupBy]()
}

const filterBar = (
  model: Model,
  snapshot: Snapshot,
  data: InboxData,
  filters: Filters,
  h: H,
): Html => {
  const entries = entriesOf(data)
  const facet = (
    name: 'kind' | 'urgency' | 'session',
    label: string,
    options: ReadonlyArray<readonly [string, string]>,
  ) =>
    h.div(
      [h.Class(`f-facet is-${name}`)],
      [
        h.span([h.Class('f-facet-label')], [label]),
        h.div(
          [h.Class('f-pills')],
          options.map(([value, text]) => {
            const on = filters[name].includes(value)
            const count = entries.filter(entry =>
              name === 'urgency'
                ? entry.bucket === value
                : name === 'kind'
                  ? entry.kind === value
                  : entry.session === value,
            ).length
            const chip = h.button(
              [
                h.Type('button'),
                h.Class(`f-pill${on ? ' is-on' : ''}`),
                h.AriaPressed(String(on)),
                h.OnClick(Message.ClickedInboxFacet({ facet: name, value })),
              ],
              [
                name === 'urgency'
                  ? h.span([
                      h.Class(`f-urgency-dot is-${value}`),
                      h.AriaHidden(true),
                    ])
                  : name === 'session'
                    ? sessionAvatar(
                        value,
                        Option.match(sessionOf(data, value), {
                          onNone: () => value,
                          onSome: session => session.label,
                        }),
                        h,
                        'Small',
                      )
                    : h.empty,
                `${text} `,
                h.span([h.Class('f-count')], [String(count)]),
              ],
            )
            return name === 'session'
              ? refView(
                  sessionCard(model, snapshot, data, value),
                  'inbox-facet',
                  chip,
                  h,
                  false,
                )
              : chip
          }),
        ),
      ],
    )
  const views = [...PRESET_VIEWS(data), ...model.inbox.savedViews]
  return h.section(
    [h.Class('f-inbox-filters'), h.AriaLabel(NAMES.filter)],
    [
      h.div(
        [h.Class('f-views-row')],
        [
          h.div(
            [
              h.Class('f-segmented f-views'),
              h.Role('group'),
              h.AriaLabel(NAMES.views),
            ],
            views.map(view =>
              h.button(
                [
                  h.Type('button'),
                  h.Class(isCurrentView(view, filters) ? 'is-on' : ''),
                  h.AriaPressed(String(isCurrentView(view, filters))),
                  h.OnClick(Message.ClickedInboxView({ query: view.query })),
                ],
                [view.name],
              ),
            ),
          ),
          h.button(
            [
              h.Type('button'),
              h.Class('text-button f-save-view'),
              h.Disabled(views.some(view => isCurrentView(view, filters))),
              h.Title('Save the current filters as a view (kept until reload)'),
              h.OnClick(
                Message.ClickedSaveInboxView({
                  name: viewName(data, filters),
                }),
              ),
            ],
            ['+ Save view'],
          ),
          h.div(
            [h.Class('f-filter-actions')],
            [
              h.button(
                [
                  h.Type('button'),
                  h.Class('text-button'),
                  h.Disabled(!hasFilters(filters)),
                  h.OnClick(Message.ClickedClearInboxFilters()),
                ],
                ['Clear filters'],
              ),
              h.button(
                [
                  h.Type('button'),
                  h.Class('text-button'),
                  h.Title('Copy a link to this exact view'),
                  h.OnClick(Message.ClickedCopyPageLink()),
                ],
                [copyLabel(model, PAGE_LINK_COPY, 'Copy link')],
              ),
            ],
          ),
        ],
      ),
      facet('kind', 'Kind', KINDS),
      facet(
        'urgency',
        'Urgency',
        BUCKETS.map(bucket => option(bucket, bucketLabel(bucket))),
      ),
      h.div(
        [h.Class('f-facet')],
        [
          h.span([h.Class('f-facet-label')], ['Group by']),
          h.div(
            [h.Class('f-segmented'), h.Role('group'), h.AriaLabel('Group by')],
            GROUP_BYS.map(([value, label]) =>
              h.button(
                [
                  h.Type('button'),
                  h.Class(filters.groupBy === value ? 'is-on' : ''),
                  h.AriaPressed(String(filters.groupBy === value)),
                  h.OnClick(Message.SelectedInboxGroupBy({ groupBy: value })),
                ],
                [label],
              ),
            ),
          ),
        ],
      ),
      facet(
        'session',
        'Session',
        data.sessions
          .filter(isLive)
          .map(session => option(session.address, session.address)),
      ),
    ],
  )
}

const option = (value: string, label: string): readonly [string, string] => [
  value,
  label,
]

const viewName = (data: InboxData, filters: Filters): string => {
  const parts = [
    ...filters.kind.map(
      kind => KINDS.find(([value]) => value === kind)?.[1] ?? kind,
    ),
    ...filters.urgency.flatMap(bucket =>
      BUCKETS.filter(value => value === bucket).map(bucketLabel),
    ),
    ...filters.session,
  ]
  return parts.length === 0 ? `By ${filters.groupBy}` : parts.join(' · ')
}

const statusSection = (
  model: Model,
  data: InboxData,
  filters: Filters,
  h: H,
): Html =>
  h.section(
    [h.Class('f-inbox-group')],
    [
      h.div(
        [h.Class('f-inbox-group-head')],
        [h.h2([], [NAMES.status]), navLink(`Open ${NAMES.runs} ›`, RUNS, h)],
      ),
      ...data.sessions
        .filter(
          session =>
            !Array.isReadonlyArrayNonEmpty(filters.session) ||
            filters.session.includes(session.address),
        )
        .map(session => {
          const status = data.statuses.find(
            line => line.session === session.address,
          )
          return h.keyed('button')(
            session.address,
            [
              h.Type('button'),
              h.Class(`f-status-line${isLive(session) ? '' : ' is-stale'}`),
              h.OnClick(go(`${RUN_PAGE}${session.address}`)),
            ],
            [
              h.b([], [session.address]),
              typeBadge(session, h),
              h.span([h.Class('f-status-label')], [session.label]),
              h.span(
                [h.Class('hint')],
                [
                  status === undefined
                    ? lastActiveLine(model, session)
                    : `${status.title} · ${ago(model.now, status.at)}`,
                ],
              ),
            ],
          )
        }),
    ],
  )

const lastActiveLine = (model: Model, session: SessionInfo): string =>
  Option.match(session.maybeLastActive, {
    onNone: () => 'No status published',
    onSome: last =>
      `No status published · last active ${ago(model.now, last.at)} (${last.what})`,
  })

const deadlineLabel = (now: number, deadline: number): string => {
  const hours = Math.round((deadline - now) / 3_600_000)
  return now === 0
    ? new Date(deadline).toLocaleString('en-GB', {
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : hours <= 0
      ? 'window closed'
      : hours < 24
        ? `veto within ${hours} h`
        : `veto within ${Math.round(hours / 24)} d`
}

const decisionRow = (
  model: Model,
  entry: ReturnType<typeof provisionalDecisions>[number],
  h: H,
): Html =>
  h.keyed('li')(
    decisionKey(entry),
    [],
    [
      h.button(
        [
          h.Type('button'),
          h.Class('f-decision-row'),
          h.OnClick(go(`${DECISION_PAGE}${decisionKey(entry)}`)),
        ],
        [
          sessionAvatar(entry.item.session, entry.item.session, h, 'Small'),
          h.span(
            [h.Class('f-decision-title')],
            [entry.item.title?.trim() || entry.item.id],
          ),
          h.small(
            [],
            [
              `${entry.item.session} · ${deadlineLabel(model.now, entry.item.deadline)}`,
            ],
          ),
        ],
      ),
    ],
  )

// Shown before the rest fold behind "Show all N".
const DECISIONS_SHOWN = 3

/** Provisional decisions: a quiet list below the urgency groups, handled one by one. */
const decisionsSection = (model: Model, snapshot: Snapshot, h: H): Html => {
  const decisions = provisionalDecisions(snapshot)
  return Array.isReadonlyArrayEmpty(decisions)
    ? h.empty
    : h.section(
        [h.Class('f-decisions'), h.AriaLabel('Provisional decisions')],
        [
          h.h2(
            [],
            [
              'Provisional decisions ',
              h.span([h.Class('f-count')], [String(decisions.length)]),
            ],
          ),
          h.p(
            [h.Class('hint')],
            [
              'Agents act on these unless you veto before the deadline. Open one to read it and veto.',
            ],
          ),
          h.ul(
            [],
            Array.take(decisions, DECISIONS_SHOWN).map(entry =>
              decisionRow(model, entry, h),
            ),
          ),
          decisions.length > DECISIONS_SHOWN
            ? h.details(
                [],
                [
                  h.summary([], [`Show all ${decisions.length}`]),
                  h.ul(
                    [],
                    Array.drop(decisions, DECISIONS_SHOWN).map(entry =>
                      decisionRow(model, entry, h),
                    ),
                  ),
                ],
              )
            : h.empty,
        ],
      )
}

/** One decision on its own page: the words, the deadline, Veto and its receipts. */
export const decisionPage = (
  model: Model,
  snapshot: Snapshot,
  key: string,
  h: H,
): Html => {
  const entry = (snapshot.decisions ?? []).find(
    item => decisionKey(item) === key,
  )
  return h.section(
    [h.Class('f-page f-decision-page')],
    [
      h.nav(
        [h.Class('f-crumbs'), h.AriaLabel('Breadcrumb')],
        [navLink(NAMES.inbox, INBOX, h), ' › Decision'],
      ),
      entry === undefined
        ? h.p([], ['No decision with this address on this page.'])
        : decisionArticle(model, snapshot, entry, h),
    ],
  )
}

export const inboxPage = (
  model: Model,
  snapshot: Snapshot,
  data: InboxData,
  h: H,
): Html => {
  const filters = filtersFrom(model.pageQuery)
  const entries = entriesOf(data).filter(entry => passes(filters, entry))
  const groups = groupsOf(data, filters, entries, h).filter(group =>
    Array.isReadonlyArrayNonEmpty(group.entries),
  )
  const inView = Array.dedupe(entries.map(entry => entry.session)).filter(
    address =>
      Option.match(sessionOf(data, address), {
        onNone: () => false,
        onSome: isLive,
      }),
  )
  const shown = (task: Task) => passes(filters, taskEntry(task))
  const promised = data.tasks.filter(
    task => task.state._tag === 'Promised' && shown(task),
  )
  const confirming = data.tasks.filter(
    task => task.state._tag === 'Reported' && shown(task),
  )
  const done = data.tasks.filter(
    task => task.state._tag === 'Completed' || task.state._tag === 'Withdrawn',
  )
  return h.section(
    [h.Class('f-page f-inbox')],
    [
      h.div(
        [h.Class('f-inbox-title')],
        [
          h.h1([], [NAMES.inbox]),
          pageActions(
            model,
            data,
            snapshot,
            inView,
            hasFilters(filters)
              ? 'sessions in this view'
              : 'every session on the page',
            h,
          ),
        ],
      ),
      h.p(
        [h.Class('f-lead')],
        [
          `Everything the squad needs from you, ${filters.groupBy === 'urgency' ? 'most urgent first' : `grouped by ${GROUP_BYS.find(([value]) => value === filters.groupBy)?.[1].toLowerCase()}`}. Questions sit with the tasks they belong with.`,
        ],
      ),
      model.inbox.isFixture
        ? h.p(
            [h.Class('f-fixture-note')],
            [
              'Preview fixture: sample freezes, promises and done tasks are merged in.',
            ],
          )
        : h.empty,
      requestStrip(model, h),
      ...freezeBanner(model, data, h),
      filterBar(model, snapshot, data, filters, h),
      ...Array.match(groups, {
        onEmpty: () => [
          h.p([h.Class('hint')], ['Nothing matches these filters.']),
        ],
        onNonEmpty: nonEmpty =>
          nonEmpty.map(group => groupView(model, data, filters, group, h)),
      }),
      decisionsSection(model, snapshot, h),
      Array.isReadonlyArrayNonEmpty(promised)
        ? h.section(
            [h.Class('f-inbox-group')],
            [
              h.div(
                [h.Class('f-inbox-group-head')],
                [
                  h.h2(
                    [],
                    [
                      NAMES.promised,
                      ' ',
                      h.span([h.Class('f-count')], [String(promised.length)]),
                    ],
                  ),
                ],
              ),
              h.p(
                [h.Class('hint')],
                [
                  'An agent owes you these and fills them in when its condition is met.',
                ],
              ),
              ...promised.map(task => taskRow(model, data, task, h)),
            ],
          )
        : h.empty,
      Array.isReadonlyArrayNonEmpty(confirming)
        ? h.section(
            [h.Class('f-inbox-group')],
            [
              h.div(
                [h.Class('f-inbox-group-head')],
                [
                  h.h2(
                    [],
                    [
                      NAMES.confirming,
                      ' ',
                      h.span([h.Class('f-count')], [String(confirming.length)]),
                    ],
                  ),
                ],
              ),
              h.p(
                [h.Class('hint')],
                [
                  'You reported these done; the agent checks before closing them.',
                ],
              ),
              ...confirming.map(task => taskRow(model, data, task, h)),
            ],
          )
        : h.empty,
      statusSection(model, data, filters, h),
      h.section(
        [h.Class('f-done-zone')],
        [
          h.div(
            [h.Class('f-inbox-group-head')],
            [
              h.h2(
                [],
                [
                  NAMES.done,
                  ' ',
                  h.span([h.Class('f-count')], [String(done.length)]),
                ],
              ),
              h.button(
                [
                  h.Type('button'),
                  h.Class('quiet-button'),
                  h.AriaExpanded(model.inbox.isDoneShown),
                  h.OnClick(Message.ClickedToggleRecentlyDone()),
                ],
                [model.inbox.isDoneShown ? 'Hide' : 'Show'],
              ),
            ],
          ),
          model.inbox.isDoneShown
            ? h.div(
                [h.Class('f-done-cards')],
                done.map(task =>
                  h.keyed('button')(
                    task.id,
                    [
                      h.Type('button'),
                      h.Class('f-done-card'),
                      h.OnClick(go(`${ITEM_PAGE}${task.id}`)),
                    ],
                    [
                      h.span(
                        [h.Class('hint')],
                        [
                          `${task.session} · ${STATE_CHIPS[task.state._tag].label}`,
                        ],
                      ),
                      h.b([], [task.title]),
                      h.span(
                        [h.Class('hint')],
                        [
                          task.state._tag === 'Completed'
                            ? task.state.proof
                            : task.state._tag === 'Withdrawn'
                              ? task.state.reason
                              : '',
                        ],
                      ),
                    ],
                  ),
                ),
              )
            : h.p(
                [h.Class('hint')],
                ['Not actionable; kept here for reference.'],
              ),
        ],
      ),
    ],
  )
}

// RUNS

const laneView = (
  model: Model,
  data: InboxData,
  session: SessionInfo,
  isFocus: boolean,
  h: H,
): Html => {
  const status = data.statuses.find(line => line.session === session.address)
  const tasks = data.tasks.filter(
    task =>
      task.session === session.address &&
      ['Open', 'Reported', 'Promised'].includes(task.state._tag),
  )
  const questions = data.questions.filter(
    question => question.session === session.address,
  )
  const rounds = Array.dedupe(questions.map(question => question.round))
  const onYou =
    tasks.filter(task => task.state._tag === 'Open').length + questions.length
  return h.keyed('section')(
    session.address,
    [
      h.Class(
        `f-lane is-${session.type.toLowerCase()}${isFocus ? ' is-focus' : ''}`,
      ),
    ],
    [
      h.header(
        [h.Class('f-lane-head')],
        [
          h.div(
            [],
            [
              h.h2(
                [],
                [
                  sessionAvatar(session.address, session.label, h),
                  ' ',
                  h.button(
                    [
                      h.Type('button'),
                      h.Class('text-button'),
                      h.OnClick(go(`${RUN_PAGE}${session.address}`)),
                    ],
                    [session.address],
                  ),
                  ' ',
                  h.span([h.Class('f-group-sub')], [session.label]),
                ],
              ),
              h.p(
                [h.Class('f-lane-type')],
                [
                  typeBadge(session, h),
                  isFocus
                    ? h.span(
                        [h.Class('hint')],
                        [` ${SESSION_TYPES[session.type].note}`],
                      )
                    : h.empty,
                ],
              ),
              h.p(
                [h.Class('f-lane-waiting')],
                [
                  isLive(session)
                    ? onYou > 0
                      ? `Waiting on you (${onYou})`
                      : 'Not waiting on you'
                    : 'Session ended · stale',
                ],
              ),
            ],
          ),
          // Room for G's "find a session by its work": the issue and work this lane holds.
          h.div([h.Class('f-lane-work')]),
        ],
      ),
      status === undefined
        ? h.p(
            [h.Class('f-lane-nostatus')],
            [
              session.type === 'Interactive'
                ? Option.match(session.maybeLastActive, {
                    onNone: () => 'No run, so no status. ',
                    onSome: last =>
                      `No run, so no status. Last active ${ago(model.now, last.at)} (${last.what}). `,
                  })
                : 'No status published. ',
              h.button(
                [
                  h.Type('button'),
                  h.Class('text-button'),
                  h.OnClick(
                    Message.ClickedRequestStatus({
                      session: session.address,
                      isEnded: !isLive(session),
                    }),
                  ),
                ],
                [NAMES.requestUpdate],
              ),
            ],
          )
        : h.details(
            [
              h.Class(`f-lane-status${isLive(session) ? '' : ' is-stale'}`),
              h.Open(isFocus),
            ],
            [
              h.summary(
                [],
                [
                  `${NAMES.status} · ${status.title} · ${ago(model.now, status.at)}${isLive(session) ? '' : ' · stale'}`,
                ],
              ),
              h.p([], [status.body]),
            ],
          ),
      ...tasks.map(task =>
        h.keyed('button')(
          task.id,
          [
            h.Type('button'),
            h.Class('f-lane-node'),
            h.OnClick(go(`${ITEM_PAGE}${task.id}`)),
          ],
          [
            task.state._tag === 'Open'
              ? urgencyChip(taskEntry(task).bucket, h)
              : stateChip(task, h),
            h.b([], [task.title]),
          ],
        ),
      ),
      Array.isReadonlyArrayNonEmpty(questions)
        ? h.div(
            [h.Class('f-lane-node is-questions')],
            [
              h.b(
                [],
                [
                  `❓ ${questions.length} ${questions.length === 1 ? 'question' : 'questions'}`,
                ],
              ),
              ' · ',
              ...rounds.flatMap((round, index) => {
                const inRound = questions.filter(
                  question => question.round === round,
                )
                return [
                  index === 0 ? '' : ' · ',
                  navLink(
                    `${inRound[0]?.roundName ?? `Round ${round}`} (${inRound.length})`,
                    withQuery(
                      `${QUESTION_PAGE}${inRound[0]?.id ?? ''}`,
                      questionQueryString({
                        session: [session.address],
                        urgency: [],
                        maybeRound: Option.some(round),
                      }),
                    ),
                    h,
                  ),
                ]
              }),
            ],
          )
        : h.empty,
      tasks.length + questions.length === 0
        ? h.p([h.Class('hint')], ['Nothing on you here.'])
        : h.empty,
    ],
  )
}

export const runsPage = (
  model: Model,
  snapshot: Snapshot,
  data: InboxData,
  maybeFocus: Option.Option<string>,
  h: H,
): Html => {
  const focus = Option.flatMap(maybeFocus, address => sessionOf(data, address))
  const ordered = SESSION_TYPE_ORDER.flatMap(type =>
    data.sessions.filter(session => session.type === type),
  )
  const present = SESSION_TYPE_ORDER.filter(type =>
    data.sessions.some(session => session.type === type),
  )
  return h.section(
    [h.Class(`f-page f-runs${Option.isSome(focus) ? ' is-focus' : ''}`)],
    [
      h.div(
        [h.Class('f-inbox-title')],
        [
          h.h1(
            [],
            Option.match(focus, {
              onNone: () => [NAMES.runs],
              onSome: session => [
                navLink(NAMES.runs, RUNS, h),
                ` › ${session.address}`,
              ],
            }),
          ),
          pageActions(
            model,
            data,
            snapshot,
            Option.match(focus, {
              onNone: () =>
                data.sessions.filter(isLive).map(session => session.address),
              onSome: session => [session.address],
            }),
            Option.isSome(focus) ? 'this session' : 'every live session',
            h,
          ),
        ],
      ),
      h.p(
        [h.Class('f-lead')],
        [
          `Every session on the page: orchestrated runs follow the squad’s rules; ${NAMES.interactive.toLowerCase()} sessions only joined the page and report through questions and tasks.`,
        ],
      ),
      requestStrip(model, h),
      Option.isSome(focus)
        ? h.empty
        : h.dl(
            [h.Class('f-legend')],
            present.flatMap(type => [
              h.dt(
                [],
                [
                  h.span(
                    [h.Class(`f-type-badge is-${type.toLowerCase()}`)],
                    [SESSION_TYPES[type].label],
                  ),
                ],
              ),
              h.dd([], [SESSION_TYPES[type].note]),
            ]),
          ),
      Option.match(focus, {
        onNone: () =>
          h.div(
            [h.Class('f-board')],
            ordered.map(session => laneView(model, data, session, false, h)),
          ),
        onSome: session => laneView(model, data, session, true, h),
      }),
      Option.isSome(maybeFocus) && Option.isNone(focus)
        ? h.p([h.Class('hint')], ['No session with that address on this page.'])
        : h.empty,
    ],
  )
}

// ITEM

export const itemPage = (
  model: Model,
  data: InboxData,
  id: string,
  prose: Prose,
  h: H,
): Html =>
  Option.match(
    Array.findFirst(data.tasks, task => task.id === id),
    {
      onNone: () =>
        h.section(
          [h.Class('f-page')],
          [
            h.h1([], ['Not found']),
            h.p([], [`No ${NAMES.task.toLowerCase()} ${id} on this page.`]),
            navLink(`Back to ${NAMES.inbox}`, INBOX, h),
          ],
        ),
      onSome: task => {
        const target = threadTarget(task)
        const messages = model.inbox.threads[target] ?? []
        const draft = model.inbox.threadDrafts[target] ?? ''
        return h.section(
          [h.Class('f-item-page')],
          [
            h.nav(
              [h.Class('f-crumbs'), h.AriaLabel('Breadcrumbs')],
              [
                navLink(NAMES.inbox, INBOX, h),
                ' › ',
                navLink(task.session, `${RUN_PAGE}${task.session}`, h),
                ` › ${NAMES.task}`,
              ],
            ),
            h.div(
              [h.Class('f-item-grid')],
              [
                h.article(
                  [h.Class('f-item-sheet')],
                  [
                    h.p(
                      [h.Class('f-item-meta')],
                      [
                        stateChip(task, h),
                        urgencyChip(taskEntry(task).bucket, h),
                        ` ${KINDS.find(([kind]) => kind === kindOf(task))?.[1] ?? ''} · `,
                        sessionTag(data, task.session, h),
                        ` · ${ago(model.now, task.at)}`,
                      ],
                    ),
                    h.h1([], [task.title]),
                    h.dl(
                      [h.Class('f-item-facts')],
                      [
                        h.dt([], ['Where']),
                        h.dd(
                          [],
                          [
                            task.host,
                            task.destination._tag === 'Link'
                              ? h.span(
                                  [],
                                  [
                                    ' · ',
                                    h.a(
                                      [
                                        h.Href(task.destination.url),
                                        h.Target('_blank'),
                                        h.Rel('noreferrer'),
                                      ],
                                      [
                                        task.destination.url.replace(
                                          /^https?:\/\//,
                                          '',
                                        ),
                                      ],
                                    ),
                                  ],
                                )
                              : h.empty,
                          ],
                        ),
                        h.dt([], ['What']),
                        h.dd([], [task.action]),
                        ...(task.unblocks === undefined
                          ? []
                          : [
                              h.dt([], ['Unblocks']),
                              h.dd([], [task.unblocks.join(' · ')]),
                            ]),
                        h.dt([], ['If you wait']),
                        h.dd(
                          [],
                          [
                            {
                              now: 'The session stays blocked on this.',
                              next: 'Work after this waits; nothing is blocked yet.',
                              later: 'Nothing waits on it.',
                            }[taskEntry(task).bucket],
                          ],
                        ),
                        ...(Array.isReadonlyArrayNonEmpty(heldBy(data, task))
                          ? [
                              h.dt([], ['Related']),
                              h.dd(
                                [],
                                [
                                  heldBy(data, task)
                                    .map(freeze => `⏸ ${freeze.title}`)
                                    .join(' · '),
                                ],
                              ),
                            ]
                          : []),
                      ],
                    ),
                    originLine(task, h),
                    prose(task.body, h),
                    stepsList(model, data, task, h),
                    task.routeWhy === undefined
                      ? h.empty
                      : h.p([h.Class('f-task-route')], [task.routeWhy]),
                    taskButtons(model, task, h),
                    doneLine(model, task, h),
                    h.details(
                      [h.Class('f-item-history')],
                      [
                        h.summary([], ['History']),
                        h.ul(
                          [],
                          [
                            h.li(
                              [],
                              [
                                `Published by ${task.session} · ${ago(model.now, task.at)}`,
                              ],
                            ),
                            ...(task.state._tag === 'Completed'
                              ? [
                                  h.li(
                                    [],
                                    [
                                      `Completed with proof · ${ago(model.now, task.state.at)}`,
                                    ],
                                  ),
                                ]
                              : []),
                          ],
                        ),
                      ],
                    ),
                  ],
                ),
                h.aside(
                  [h.Class('f-item-thread'), h.AriaLabel(NAMES.thread)],
                  [
                    h.h2([], [`${NAMES.thread} with ${task.session}`]),
                    h.p(
                      [h.Class('hint')],
                      [
                        'Stub: messages stay in this browser until threads use the agent:<address> delivery.',
                      ],
                    ),
                    h.ol(
                      [h.Class('f-thread-messages')],
                      Array.match(messages, {
                        onEmpty: () => [
                          h.li([h.Class('hint')], ['No messages yet.']),
                        ],
                        onNonEmpty: nonEmpty =>
                          nonEmpty.map(message =>
                            h.li(
                              [
                                h.Class(
                                  `f-thread-message is-${message.from.toLowerCase()}`,
                                ),
                              ],
                              [
                                h.span(
                                  [h.Class('f-thread-who')],
                                  [
                                    message.from === 'You'
                                      ? 'You'
                                      : task.session,
                                  ],
                                ),
                                message.text,
                              ],
                            ),
                          ),
                      }),
                    ),
                    h.form(
                      [
                        h.Class('f-thread-composer'),
                        h.OnSubmit(
                          Message.SubmittedThreadMessage({ item: target }),
                        ),
                      ],
                      [
                        h.textarea([
                          h.Rows(3),
                          h.Value(draft),
                          h.AriaLabel(`Message ${task.session}`),
                          h.Placeholder(`Message ${task.session}…`),
                          h.OnInput(text =>
                            Message.UpdatedThreadDraft({ item: target, text }),
                          ),
                        ]),
                        h.button(
                          [
                            h.Type('submit'),
                            h.Class('send-button'),
                            h.Disabled(draft.trim() === ''),
                          ],
                          ['Send'],
                        ),
                      ],
                    ),
                  ],
                ),
              ],
            ),
          ],
        )
      },
    },
  )

// QUESTIONS PAGE FILTERS

export const questionFilterView = (
  model: Model,
  snapshot: Snapshot,
  inbox: InboxData,
  all: ReadonlyArray<InboxQuestion>,
  currentQuestion: string,
  h: H,
): Html => {
  const query = questionQueryFrom(model.pageQuery)
  const shown = all.filter(question => questionPasses(query, question))
  const page = (next: typeof query) =>
    withQuery(
      `${QUESTION_PAGE}${shown.find(question => questionPasses(next, question))?.id ?? all.find(question => questionPasses(next, question))?.id ?? currentQuestion}`,
      questionQueryString(next),
    )
  const toggle = (list: ReadonlyArray<string>, value: string) =>
    list.includes(value)
      ? list.filter(current => current !== value)
      : [...list, value]
  const pill = (
    on: boolean,
    label: Html | string,
    count: number,
    next: typeof query,
    extra = '',
  ) =>
    h.button(
      [
        h.Type('button'),
        h.Class(`f-pill${on ? ' is-on' : ''}${extra}`),
        h.AriaPressed(String(on)),
        h.OnClick(go(page(next))),
      ],
      [label, ' ', h.span([h.Class('f-count')], [String(count)])],
    )
  const chip = (
    label: string,
    next: typeof query,
  ): readonly [string, typeof query] => [label, next]
  const sessions = Array.dedupe(all.map(question => question.session))
  const rounds = Array.dedupe(all.map(question => question.round))
  const chips: ReadonlyArray<readonly [string, typeof query]> = [
    ...query.session.map(session =>
      chip(`Session ${session}`, {
        ...query,
        session: query.session.filter(value => value !== session),
      }),
    ),
    ...BUCKETS.filter(bucket => query.urgency.includes(bucket)).map(bucket =>
      chip(bucketLabel(bucket), {
        ...query,
        urgency: query.urgency.filter(value => value !== bucket),
      }),
    ),
    ...Option.match(query.maybeRound, {
      onNone: () => [],
      onSome: round => [
        chip(
          `Round “${all.find(question => question.round === round)?.roundName ?? round}”`,
          { ...query, maybeRound: Option.none() },
        ),
      ],
    }),
  ]
  return h.section(
    [
      h.Class('f-question-filters'),
      h.AriaLabel(`${NAMES.questions} ${NAMES.filter.toLowerCase()}`),
    ],
    [
      h.div(
        [h.Class('f-facet is-urgency')],
        [
          h.span([h.Class('f-facet-label')], ['Urgency']),
          h.div(
            [h.Class('f-pills')],
            BUCKETS.map(bucket =>
              pill(
                query.urgency.includes(bucket),
                h.span(
                  [],
                  [
                    h.span([
                      h.Class(`f-urgency-dot is-${bucket}`),
                      h.AriaHidden(true),
                    ]),
                    bucketLabel(bucket),
                  ],
                ),
                all.filter(question => bucketOf(question.urgency) === bucket)
                  .length,
                { ...query, urgency: toggle(query.urgency, bucket) },
              ),
            ),
          ),
        ],
      ),
      h.div(
        [h.Class('f-facet is-round')],
        [
          h.span([h.Class('f-facet-label')], ['Round']),
          h.div(
            [h.Class('f-round-chips')],
            rounds.map(round => {
              const inRound = all.filter(question => question.round === round)
              const on = Option.getOrUndefined(query.maybeRound) === round
              const number =
                snapshot.grill.roundNumbers?.[String(round)] ?? round
              return refView(
                roundCard(model, snapshot, round),
                'question-filter',
                pill(
                  on,
                  h.span(
                    [],
                    [`R${number}`, h.small([], [inRound[0]?.session ?? ''])],
                  ),
                  inRound.length,
                  {
                    ...query,
                    maybeRound: on ? Option.none() : Option.some(round),
                  },
                  ' f-round-chip',
                ),
                h,
                false,
              )
            }),
          ),
        ],
      ),
      h.div(
        [h.Class('f-facet is-session')],
        [
          h.span([h.Class('f-facet-label')], ['Session']),
          h.div(
            [h.Class('f-pills')],
            sessions.map(session =>
              refView(
                sessionCard(model, snapshot, inbox, session),
                'question-filter',
                pill(
                  query.session.includes(session),
                  h.span(
                    [],
                    [
                      sessionAvatar(
                        session,
                        Option.match(sessionOf(inbox, session), {
                          onNone: () => session,
                          onSome: info => info.label,
                        }),
                        h,
                        'Small',
                      ),
                      session,
                    ],
                  ),
                  all.filter(question => question.session === session).length,
                  { ...query, session: toggle(query.session, session) },
                ),
                h,
                false,
              ),
            ),
          ),
        ],
      ),
      isQuestionQueryEmpty(query)
        ? h.empty
        : h.p(
            [h.Class('f-active-filters')],
            [
              'Showing ',
              h.b([], [String(shown.length)]),
              ` of ${all.length}: `,
              ...chips.map(([label, next]) =>
                h.button(
                  [
                    h.Type('button'),
                    h.Class('f-filter-chip'),
                    h.AriaLabel(`Remove ${label}`),
                    h.OnClick(go(page(next))),
                  ],
                  [`${label} ✕`],
                ),
              ),
              h.button(
                [
                  h.Type('button'),
                  h.Class('text-button'),
                  h.OnClick(go(`${QUESTION_PAGE}${currentQuestion}`)),
                ],
                ['Clear all'],
              ),
            ],
          ),
    ],
  )
}
