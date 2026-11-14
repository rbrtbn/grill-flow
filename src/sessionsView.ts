import { Array, Option, Order } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { sessionAvatar } from './avatar'
import {
  AGENT_TARGET_PREFIX,
  GRILL_FLOW_TARGET,
  type Snapshot,
  questionSession,
} from './domain'
import {
  type InboxData,
  NAMES,
  SESSION_TYPES,
  type SessionInfo,
  type SessionOrder,
} from './inbox'
import { SESSION_PROFILES } from './inboxFixture'
import { Message, type Model, unreadMessagesOf } from './main'
import { refView } from './refCard'
import { linkCard } from './refCards'
import { replySession } from './replies'
import { QUESTION_PAGE, RUN_TARGET } from './workspace'

type H = HtmlBuilder<Message>

// The sessions panel (variant I): pinned lead and Board, recent conversations, then every
// session grouped and ordered as Rob picks. A session whose issue is done or whose terminal
// closed stays, dimmed, for a day; after that its conversations live on the Conversations page.

const DAY = 24 * 60 * 60 * 1000

type Work = Readonly<{
  issue?: Readonly<{ id: string; isDone: boolean }>
  work?: string
  pr?: Readonly<{ number: number; state: 'open' | 'merged' }>
  newOn?: Readonly<{ key: string; question: string; count: number }>
  closedAt?: number
  doneAt?: number
}>

export type SessionRow = Readonly<{
  address: string
  name: string
  role: string
  squad: string
  isLive: boolean
  isClosed: boolean
  isDone: boolean
  lastAt: number
  work: Work
  // Closed or finished more than a day ago: off the sidebar, under Finished on Conversations.
  hasLeft: boolean
  // New messages from this session: its unread answers and replies, plus the fixture's.
  fresh: number
}>

// Where the panel shows: the right sidebar, or docked left on the Conversations page.
export type Placement = 'Sidebar' | 'Page'

// Preview-only work state until sessions publish it (t2j6's business-logic phase).
const FIXTURE_WORK: Readonly<Record<string, Work>> = {
  t2hq: {
    issue: { id: 'LAB-1449', isDone: false },
    work: 'stage1-t2cr orchestrator',
    pr: { number: 157, state: 'open' },
  },
  t2cr: { issue: { id: 'LAB-1400', isDone: false }, work: 'Squad lead' },
  t2j6: {
    work: 'Discussion threads',
    newOn: { key: 'session-finder', question: 'Q901', count: 1 },
  },
  t2j8: {
    issue: { id: 'LAB-1446', isDone: true },
    work: 'Send shortcuts',
    pr: { number: 22, state: 'merged' },
    doneAt: Date.parse('2026-11-14T03:30:00Z'),
  },
  t2j5: { work: 'Owner actions prototypes' },
}
const FIXTURE_CLOSED: SessionRow = {
  address: 't2j0',
  name: 'Test speed',
  role: 'Helper',
  squad: 'Squad',
  isLive: false,
  isClosed: true,
  isDone: false,
  lastAt: Date.parse('2026-11-14T02:10:00Z'),
  work: {
    issue: { id: 'LAB-1438', isDone: false },
    work: 'Reshape tests/run.sh',
    closedAt: Date.parse('2026-11-14T02:10:00Z'),
  },
  hasLeft: false,
  fresh: 0,
}
const FIXTURE_FINISHED: SessionRow = {
  address: 't2gx',
  name: 'Plugin cache fix',
  role: 'Orchestrated run',
  squad: 'Squad',
  isLive: false,
  isClosed: false,
  isDone: true,
  lastAt: Date.parse('2026-11-12T18:20:00Z'),
  work: {
    issue: { id: 'LAB-1431', isDone: true },
    work: 'Plugin cache fix',
    pr: { number: 151, state: 'merged' },
    doneAt: Date.parse('2026-11-12T18:20:00Z'),
  },
  hasLeft: false,
  fresh: 0,
}

const realWork = (snapshot: Snapshot, address: string): Work => {
  const issue = (snapshot.grill.plan?.issues ?? []).find(
    item => item.agent === address,
  )
  return issue === undefined
    ? {}
    : {
        issue: { id: issue.id, isDone: issue.phase === 'merged' },
        work: issue.title,
      }
}

/** Every session the page knows, the ones that left the sidebar flagged. */
const everySessionRow = (
  model: Model,
  snapshot: Snapshot,
  inbox: InboxData,
): ReadonlyArray<SessionRow> => {
  const squad = snapshot.grill.squad?.section ?? 'This page'
  const fromSessions = inbox.sessions.map(session =>
    rowOf(model, snapshot, squad, session),
  )
  const agentsOnly = (snapshot.agents ?? [])
    .filter(
      agent =>
        !inbox.sessions.some(session => session.address === agent.address),
    )
    .map((agent): SessionRow => ({
      address: agent.address,
      name: agent.name === '' ? agent.program : agent.name,
      role: agent.lead ? SESSION_TYPES.Lead.label : 'Running agent',
      squad,
      isLive: true,
      isClosed: false,
      isDone: false,
      lastAt: 0,
      work: {},
      hasLeft: false,
      fresh: 0,
    }))
  const rows = [
    ...fromSessions,
    ...agentsOnly,
    ...(model.inbox.isFixture ? [FIXTURE_CLOSED, FIXTURE_FINISHED] : []),
  ]
  const now = model.now === 0 ? (snapshot.channelNow ?? 0) : model.now
  const unread = unreadMessagesOf(model)
  const askerOf = (stepId: string): string =>
    stepId.startsWith(AGENT_TARGET_PREFIX)
      ? stepId.slice(AGENT_TARGET_PREFIX.length)
      : questionSession(
          snapshot.grill,
          snapshot.grill.steps.find(step => step.id === stepId)?.question,
        )
  const replyAuthor = (id: string): string => {
    const reply = (snapshot.replies ?? []).find(
      item => `reply-${item.id}` === id,
    )
    return reply === undefined
      ? snapshot.grill.session
      : replySession(snapshot, reply)
  }
  return rows.map(row => {
    const fresh =
      (row.work.newOn?.count ?? 0) +
      unread.filter(message =>
        message.kind === 'reply'
          ? replyAuthor(message.id) === row.address
          : askerOf(message.stepId) === row.address,
      ).length
    const gone =
      row.work.closedAt ??
      row.work.doneAt ??
      (row.isClosed ? row.lastAt : undefined)
    return {
      ...row,
      hasLeft: gone !== undefined && now !== 0 && now - gone >= DAY,
      fresh,
    }
  })
}

/** One session as the panel knows it, for its reference card. */
export const sessionRowOf = (
  model: Model,
  snapshot: Snapshot,
  inbox: InboxData,
  address: string,
): SessionRow | undefined =>
  everySessionRow(model, snapshot, inbox).find(row => row.address === address)

/** The sessions the sidebar lists. */
export const sessionRows = (
  model: Model,
  snapshot: Snapshot,
  inbox: InboxData,
): ReadonlyArray<SessionRow> =>
  everySessionRow(model, snapshot, inbox).filter(row => !row.hasLeft)

const rowOf = (
  model: Model,
  snapshot: Snapshot,
  squad: string,
  session: SessionInfo,
): SessionRow => {
  const agent = snapshot.agents?.find(item => item.address === session.address)
  const work = model.inbox.isFixture
    ? {
        ...realWork(snapshot, session.address),
        ...FIXTURE_WORK[session.address],
      }
    : realWork(snapshot, session.address)
  const discussion =
    snapshot.discussions?.[`${AGENT_TARGET_PREFIX}${session.address}`]
  return {
    address: session.address,
    name:
      session.type === 'Lead'
        ? SESSION_TYPES.Lead.label
        : agent === undefined || agent.name === ''
          ? session.label
          : agent.name,
    role: SESSION_TYPES[session.type].label,
    squad,
    isLive: session.type !== 'Ended',
    isClosed: session.type === 'Ended' || work.closedAt !== undefined,
    isDone: work.issue?.isDone === true,
    lastAt: Math.max(
      discussion?.lastAt ?? 0,
      Option.match(session.maybeLastActive, {
        onNone: () => 0,
        onSome: last => last.at,
      }),
    ),
    work,
    hasLeft: false,
    fresh: 0,
  }
}

const targetOf = (snapshot: Snapshot, row: SessionRow): string =>
  row.address === snapshot.grill.session
    ? RUN_TARGET
    : `${AGENT_TARGET_PREFIX}${row.address}`

const matches = (row: SessionRow, search: string): boolean => {
  const needle = search.trim().toLowerCase()
  return (
    needle === '' ||
    [
      row.name,
      row.address,
      row.role,
      row.squad,
      row.work.issue?.id ?? '',
      row.work.work ?? '',
    ].some(value => value.toLowerCase().includes(needle))
  )
}

const ORDERS: Readonly<Record<SessionOrder, Order.Order<SessionRow>>> = {
  Recent: Order.flip(
    Order.mapInput(Order.Number, (row: SessionRow) => row.lastAt),
  ),
  Waiting: Order.flip(
    Order.mapInput(Order.Number, (row: SessionRow) => row.fresh),
  ),
  Name: Order.mapInput(Order.String, (row: SessionRow) =>
    row.name.toLowerCase(),
  ),
}

/** Recency as a chat list shows it: now, 5m, 2h, 3d. */
const shortAgo = (now: number, at: number): string => {
  const minutes = Math.max(0, Math.round((now - at) / 60000))
  return minutes < 1
    ? 'now'
    : minutes < 60
      ? `${minutes}m`
      : minutes < 1440
        ? `${Math.round(minutes / 60)}h`
        : `${Math.round(minutes / 1440)}d`
}

const rowView = (
  model: Model,
  snapshot: Snapshot,
  row: SessionRow,
  h: H,
  isPinnedRow = false,
): Html => {
  const isPinned = model.inbox.pinned.includes(row.address)
  const isCurrent =
    Option.getOrElse(
      model.workspace.maybeDiscussionTarget,
      () => RUN_TARGET,
    ) === targetOf(snapshot, row)
  const now = model.now === 0 ? (snapshot.channelNow ?? 0) : model.now
  return h.keyed('div')(
    `${isPinnedRow ? 'pin:' : ''}${row.address}`,
    [
      h.Class(
        `f-session-row${row.isClosed ? ' is-closed' : ''}${row.isDone ? ' is-done' : ''}${isCurrent ? ' is-current' : ''}${row.fresh > 0 ? ' has-new' : ''}`,
      ),
    ],
    [
      h.button(
        [
          h.Type('button'),
          h.Class('f-session-main'),
          h.OnClick(
            Message.ClickedOpenSession({ target: targetOf(snapshot, row) }),
          ),
        ],
        [
          sessionAvatar(row.address, row.name, h),
          h.span(
            [h.Class('f-session-top')],
            [
              h.b([], [row.name]),
              h.span([
                h.Class(
                  `f-state-dot${row.isClosed ? ' is-closed' : row.isLive ? ' is-live' : ''}`,
                ),
                h.Title(
                  row.isClosed ? 'Closed' : row.isLive ? 'Running' : 'Idle',
                ),
              ]),
              row.isClosed
                ? h.span([h.Class('f-session-flag')], ['closed'])
                : row.isDone
                  ? h.span([h.Class('f-session-flag')], ['done'])
                  : h.empty,
            ],
          ),
          h.span(
            [h.Class('f-session-meta')],
            [
              row.fresh > 0
                ? h.span([h.Class('f-session-new')], [`${row.fresh} new`])
                : h.empty,
              h.small(
                [h.Class('f-session-when')],
                [row.lastAt === 0 ? '' : shortAgo(now, row.lastAt)],
              ),
            ],
          ),
          h.small(
            [h.Class('f-session-sub')],
            [
              [row.address, row.role, row.work.issue?.id, row.work.work]
                .filter(Boolean)
                .join(' · '),
            ],
          ),
        ],
      ),
      h.div(
        [h.Class('f-session-chips')],
        [
          row.work.issue === undefined
            ? h.empty
            : refView(
                linkCard(snapshot, row.work.issue.id),
                `panel-${row.address}`,
                h.span(
                  [
                    h.Class(
                      `f-session-chip${row.work.issue.isDone ? ' is-struck' : ''}`,
                    ),
                  ],
                  [row.work.issue.id],
                ),
                h,
              ),
          row.work.pr === undefined
            ? h.empty
            : refView(
                {
                  kind: 'PR',
                  id: String(row.work.pr.number),
                  title: `PR #${row.work.pr.number}`,
                  subtitle: row.work.work ?? row.name,
                  rows: [['State', row.work.pr.state]],
                },
                `panel-${row.address}`,
                h.span(
                  [h.Class(`f-session-chip is-${row.work.pr.state}`)],
                  [`PR #${row.work.pr.number} · ${row.work.pr.state}`],
                ),
                h,
              ),
          row.work.newOn === undefined
            ? h.empty
            : h.button(
                [
                  h.Type('button'),
                  h.Class('f-session-chip is-new'),
                  h.OnClick(
                    Message.ClickedWorkspacePage({
                      page: `${QUESTION_PAGE}${row.work.newOn.question}`,
                    }),
                  ),
                ],
                [`on ${row.work.newOn.key} ›`],
              ),
          isPinnedRow && row.address === snapshot.grill.session
            ? h.empty
            : h.button(
                [
                  h.Type('button'),
                  h.Class(`f-pin${isPinned ? ' is-pinned' : ''}`),
                  h.AriaPressed(String(isPinned)),
                  h.AriaLabel(`${isPinned ? 'Unpin' : 'Pin'} ${row.name}`),
                  h.OnClick(
                    Message.ClickedPinSession({ address: row.address }),
                  ),
                ],
                [isPinned ? 'Unpin' : 'Pin'],
              ),
        ],
      ),
    ],
  )
}

const pinnedGrillFlow = (snapshot: Snapshot, h: H): Html =>
  h.div(
    [h.Class('f-session-row')],
    [
      h.button(
        [
          h.Type('button'),
          h.Class('f-session-main'),
          h.Disabled(snapshot.maintainerSession === undefined),
          h.OnClick(Message.ClickedOpenSession({ target: GRILL_FLOW_TARGET })),
        ],
        [
          sessionAvatar(snapshot.maintainerSession ?? 'board', NAMES.brand, h),
          h.span(
            [h.Class('f-session-top')],
            [
              h.b([], [NAMES.brand]),
              h.span([
                h.Class(
                  `f-state-dot${snapshot.maintainerState === 'live' ? ' is-live' : ''}`,
                ),
              ]),
              h.small(
                [h.Class('f-session-address')],
                [snapshot.maintainerSession ?? 'not set'],
              ),
            ],
          ),
          h.small(
            [h.Class('f-session-sub')],
            [
              snapshot.maintainerSession === undefined
                ? 'Set GF_MAINTAINER_SESSION to talk to the session building the board'
                : 'Maintainer · builds the board',
            ],
          ),
        ],
      ),
    ],
  )

const directoryView = (
  model: Model,
  snapshot: Snapshot,
  everyRow: ReadonlyArray<SessionRow>,
  placement: Placement,
  h: H,
): ReadonlyArray<Html> => {
  const rows = everyRow.filter(row => !row.hasLeft)
  const finished = Array.sort(
    everyRow.filter(
      row => row.hasLeft && matches(row, model.inbox.sessionSearch),
    ),
    ORDERS.Recent,
  )
  const lead = rows.find(row => row.address === snapshot.grill.session)
  const pinned = rows.filter(
    row => model.inbox.pinned.includes(row.address) && row !== lead,
  )
  const shown = Array.sort(
    rows.filter(
      row =>
        row !== lead &&
        !pinned.includes(row) &&
        matches(row, model.inbox.sessionSearch),
    ),
    ORDERS[model.inbox.sessionOrder],
  )
  return [
    h.div(
      [h.Class('f-sessions-top')],
      [
        h.div(
          [h.Class('f-sessions-pinned'), h.AriaLabel('Pinned sessions')],
          [
            ...(lead === undefined
              ? []
              : [rowView(model, snapshot, lead, h, true)]),
            pinnedGrillFlow(snapshot, h),
            ...pinned.map(row => rowView(model, snapshot, row, h, true)),
          ],
        ),
        h.div(
          [h.Class('f-sessions-controls')],
          [
            h.input([
              h.Type('search'),
              h.Class('f-sessions-search'),
              h.Placeholder('Search name, LAB-…, work, t2…'),
              h.AriaLabel('Search sessions'),
              h.Value(model.inbox.sessionSearch),
              h.OnInput(value => Message.UpdatedSessionSearch({ value })),
            ]),
            h.div(
              [h.Class('f-segmented'), h.Role('group'), h.AriaLabel('Order')],
              (
                [
                  'Recent',
                  'Waiting',
                  'Name',
                ] satisfies ReadonlyArray<SessionOrder>
              ).map(order =>
                h.button(
                  [
                    h.Type('button'),
                    h.Class(model.inbox.sessionOrder === order ? 'is-on' : ''),
                    h.AriaPressed(String(model.inbox.sessionOrder === order)),
                    h.OnClick(Message.SelectedSessionOrder({ order })),
                  ],
                  [order],
                ),
              ),
            ),
          ],
        ),
      ],
    ),
    h.div(
      [h.Class('f-sessions-list'), h.Role('list'), h.AriaLabel('Sessions')],
      shown.map(row => rowView(model, snapshot, row, h)),
    ),
    Array.isReadonlyArrayEmpty(shown)
      ? h.p([h.Class('hint')], ['No session matches.'])
      : h.empty,
    ...(placement === 'Sidebar' || Array.isReadonlyArrayEmpty(finished)
      ? []
      : [
          h.h3(
            [h.Class('f-sessions-heading')],
            [
              'Finished ',
              h.span([h.Class('f-count')], [String(finished.length)]),
            ],
          ),
          ...finished.map(row => rowView(model, snapshot, row, h)),
        ]),
    placement === 'Page'
      ? h.empty
      : h.p(
          [h.Class('hint f-sessions-foot')],
          [
            'Closed and finished sessions leave this list a day after; their conversations stay on ',
            h.button(
              [
                h.Type('button'),
                h.Class('text-button'),
                h.OnClick(
                  Message.ClickedWorkspacePage({ page: 'conversations' }),
                ),
              ],
              ['Conversations'],
            ),
            '.',
          ],
        ),
  ]
}

export const maintainerLabel = (snapshot: Snapshot): string =>
  snapshot.maintainerSession === undefined
    ? 'Unavailable'
    : snapshot.maintainerState === 'missing'
      ? `${snapshot.maintainerSession} · not in Herdr`
      : snapshot.maintainerState === 'stopped'
        ? `${snapshot.maintainerSession} · stopped`
        : snapshot.maintainerSession

/** Who a thread is with, the same wherever a session's thread opens. */
export const sessionIdentityView = (
  model: Model,
  snapshot: Snapshot,
  inbox: InboxData,
  target: string,
  h: H,
): Html => {
  if (target === GRILL_FLOW_TARGET) {
    return h.header(
      [h.Class('f-identity')],
      [
        sessionAvatar(
          snapshot.maintainerSession ?? 'board',
          NAMES.brand,
          h,
          'Large',
        ),
        h.div(
          [h.Class('f-identity-text')],
          [
            h.b([], [NAMES.brand]),
            h.span(
              [h.Class('f-identity-sub')],
              [`${maintainerLabel(snapshot)} · Maintainer`],
            ),
          ],
        ),
      ],
    )
  }
  const address =
    target === RUN_TARGET
      ? snapshot.grill.session
      : target.startsWith(AGENT_TARGET_PREFIX)
        ? target.slice(AGENT_TARGET_PREFIX.length)
        : undefined
  const row =
    address === undefined
      ? undefined
      : everySessionRow(model, snapshot, inbox).find(
          item => item.address === address,
        )
  if (row === undefined) {
    return h.empty
  }
  const profile = model.inbox.isFixture
    ? SESSION_PROFILES[row.address]
    : undefined
  const now = model.now === 0 ? (snapshot.channelNow ?? 0) : model.now
  const state = row.isClosed
    ? 'Closed'
    : row.isDone
      ? 'Done'
      : row.isLive
        ? 'Running'
        : 'Idle'
  return h.header(
    [h.Class('f-identity')],
    [
      sessionAvatar(row.address, row.name, h, 'Large'),
      h.div(
        [h.Class('f-identity-text')],
        [
          h.b([], [row.name]),
          h.span(
            [h.Class('f-identity-sub')],
            [
              h.span([h.Class('f-session-address')], [row.address]),
              ` · ${row.role}`,
            ],
          ),
          h.span(
            [h.Class('f-identity-facts')],
            [
              h.span(
                [h.Class(`f-identity-state is-${state.toLowerCase()}`)],
                [
                  h.span([
                    h.Class(
                      `f-state-dot${row.isClosed ? ' is-closed' : row.isLive ? ' is-live' : ''}`,
                    ),
                  ]),
                  state,
                  row.lastAt === 0
                    ? ''
                    : ` · active ${shortAgo(now, row.lastAt)} ago`,
                ],
              ),
              row.work.issue === undefined
                ? h.empty
                : refView(
                    linkCard(snapshot, row.work.issue.id),
                    `identity-${row.address}`,
                    h.span([h.Class('f-session-chip')], [row.work.issue.id]),
                    h,
                  ),
              row.work.pr === undefined
                ? h.empty
                : h.span(
                    [h.Class(`f-session-chip is-${row.work.pr.state}`)],
                    [`PR #${row.work.pr.number} · ${row.work.pr.state}`],
                  ),
              row.work.work === undefined
                ? h.empty
                : h.span([h.Class('f-identity-work')], [row.work.work]),
            ],
          ),
          profile === undefined
            ? h.empty
            : h.span(
                [h.Class('f-identity-profile'), h.Title('Preview sample')],
                [
                  `${profile.model} · ${profile.effort} effort · ${profile.subagents ? 'uses subagents' : 'no subagents'}`,
                ],
              ),
        ],
      ),
    ],
  )
}

/**
 * The sessions panel. As the right sidebar it shows the directory or the conversation a row
 * opened; on the Conversations page it docks left and the conversation fills the middle.
 */
export const sessionsPanelView = (
  model: Model,
  snapshot: Snapshot,
  inbox: InboxData,
  conversation: (closedNote: Option.Option<string>) => Html,
  placement: Placement,
  h: H,
): Html => {
  const rows = everySessionRow(model, snapshot, inbox)
  const target = Option.getOrElse(
    model.workspace.maybeDiscussionTarget,
    () => RUN_TARGET,
  )
  const address = target.startsWith(AGENT_TARGET_PREFIX)
    ? target.slice(AGENT_TARGET_PREFIX.length)
    : undefined
  const closed = rows.find(row => row.address === address && row.isClosed)
  const opened = conversation(
    closed === undefined
      ? Option.none()
      : Option.some(
          `${closed.address} is closed, so it can't receive messages. Message the lead, ${snapshot.grill.session}, instead.`,
        ),
  )
  const identity = sessionIdentityView(model, snapshot, inbox, target, h)
  const directory = h.div(
    [h.Class('f-sessions-body')],
    directoryView(model, snapshot, rows, placement, h),
  )
  return placement === 'Page'
    ? h.div(
        [h.Class('f-conversations-page')],
        [
          h.aside(
            [h.Class('f-sessions is-docked'), h.AriaLabel('Sessions')],
            [
              h.header(
                [h.Class('f-sessions-head')],
                [
                  h.div(
                    [],
                    [
                      h.h1([], ['Conversations']),
                      h.p(
                        [h.Class('hint')],
                        ['Every session thread; finished ones last'],
                      ),
                    ],
                  ),
                ],
              ),
              directory,
            ],
          ),
          h.section(
            [h.Class('f-conversation-pane'), h.AriaLabel('Conversation')],
            [identity, opened],
          ),
        ],
      )
    : h.aside(
        [h.Class('f-sessions'), h.AriaLabel('Sessions')],
        [
          h.header(
            [h.Class('f-sessions-head')],
            [
              model.inbox.isSessionDirectory
                ? h.div(
                    [],
                    [
                      h.h2([], ['Sessions']),
                      h.p(
                        [h.Class('hint')],
                        ['Your pins on top, then the rest'],
                      ),
                    ],
                  )
                : h.button(
                    [
                      h.Type('button'),
                      h.Class('text-button'),
                      h.OnClick(Message.ClickedSessionsBack()),
                    ],
                    ['‹ Sessions'],
                  ),
              h.button(
                [
                  h.Type('button'),
                  h.Class('text-button'),
                  h.AriaKeyshortcuts('Escape'),
                  h.OnClick(Message.ClickedCloseDiscussion()),
                ],
                ['Close'],
              ),
            ],
          ),
          ...(model.inbox.isSessionDirectory
            ? [directory]
            : [identity, opened]),
        ],
      )
}

export const sessionsBadge = (
  model: Model,
  snapshot: Snapshot,
  inbox: InboxData,
): number =>
  sessionRows(model, snapshot, inbox).reduce(
    (sum, row) => sum + (row.work.newOn?.count ?? 0),
    0,
  )
