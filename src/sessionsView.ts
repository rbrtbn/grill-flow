import { Array, Option, Order } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { AGENT_TARGET_PREFIX, GRILL_FLOW_TARGET, type Snapshot } from './domain'
import {
  type InboxData,
  NAMES,
  SESSION_TYPES,
  type SessionGroup,
  type SessionInfo,
  type SessionOrder,
} from './inbox'
import { ago } from './inboxView'
import { Message, type Model } from './main'
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
    }))
  const rows = [
    ...fromSessions,
    ...agentsOnly,
    ...(model.inbox.isFixture ? [FIXTURE_CLOSED, FIXTURE_FINISHED] : []),
  ]
  const now = model.now === 0 ? (snapshot.channelNow ?? 0) : model.now
  return rows.map(row => {
    const gone =
      row.work.closedAt ??
      row.work.doneAt ??
      (row.isClosed ? row.lastAt : undefined)
    return {
      ...row,
      hasLeft: gone !== undefined && now !== 0 && now - gone >= DAY,
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
    Order.mapInput(
      Order.Number,
      (row: SessionRow) => row.work.newOn?.count ?? 0,
    ),
  ),
  Name: Order.mapInput(Order.String, (row: SessionRow) =>
    row.name.toLowerCase(),
  ),
}

const groupKey = (row: SessionRow, group: SessionGroup): string =>
  group === 'Squad'
    ? row.squad
    : group === 'Issue'
      ? (row.work.issue?.id ?? 'No issue')
      : group === 'Status'
        ? row.isClosed
          ? 'Closed'
          : row.isDone
            ? 'Work done'
            : row.work.newOn !== undefined
              ? 'Waiting on you'
              : 'Working'
        : 'All sessions'

const avatar = (name: string, h: H): Html =>
  h.span(
    [h.Class('f-avatar'), h.AriaHidden(true)],
    [name.slice(0, 1).toUpperCase()],
  )

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
  return h.keyed('div')(
    `${isPinnedRow ? 'pin:' : ''}${row.address}`,
    [
      h.Class(
        `f-session-row${row.isClosed ? ' is-closed' : ''}${row.isDone ? ' is-done' : ''}${isCurrent ? ' is-current' : ''}`,
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
          h.span(
            [h.Class('f-session-top')],
            [
              avatar(row.name, h),
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
              h.small([h.Class('f-session-address')], [row.address]),
            ],
          ),
          h.small(
            [h.Class('f-session-sub')],
            [
              [row.role, row.work.issue?.id, row.work.work]
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
            : h.span(
                [
                  h.Class(
                    `f-session-chip${row.work.issue.isDone ? ' is-struck' : ''}`,
                  ),
                ],
                [row.work.issue.id],
              ),
          row.work.pr === undefined
            ? h.empty
            : h.span(
                [h.Class(`f-session-chip is-${row.work.pr.state}`)],
                [`PR #${row.work.pr.number} · ${row.work.pr.state}`],
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
                [`${row.work.newOn.count} new on ${row.work.newOn.key} ›`],
              ),
          isPinnedRow
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
                [isPinned ? 'Pinned' : 'Pin'],
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
          h.span(
            [h.Class('f-session-top')],
            [
              avatar(NAMES.brand, h),
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
  const recent = Array.take(
    Array.sort(
      rows.filter(row => row.lastAt > 0 && row !== lead),
      ORDERS.Recent,
    ),
    3,
  )
  const shown = Array.sort(
    rows.filter(row => row !== lead && matches(row, model.inbox.sessionSearch)),
    ORDERS[model.inbox.sessionOrder],
  )
  const groups = Array.dedupe(
    shown.map(row => groupKey(row, model.inbox.sessionGroup)),
  )
  const now = model.now === 0 ? (snapshot.channelNow ?? 0) : model.now
  return [
    h.input([
      h.Type('search'),
      h.Class('f-sessions-search'),
      h.Placeholder('Search name, LAB-…, work, t2…'),
      h.AriaLabel('Search sessions'),
      h.Value(model.inbox.sessionSearch),
      h.OnInput(value => Message.UpdatedSessionSearch({ value })),
    ]),
    h.h3([h.Class('f-sessions-heading')], ['Pinned']),
    ...(lead === undefined ? [] : [rowView(model, snapshot, lead, h, true)]),
    pinnedGrillFlow(snapshot, h),
    ...pinned.map(row => rowView(model, snapshot, row, h, true)),
    ...(Array.isReadonlyArrayEmpty(recent)
      ? []
      : [
          h.h3(
            [h.Class('f-sessions-heading')],
            [
              'Recent conversations ',
              h.span([h.Class('f-count')], [String(recent.length)]),
            ],
          ),
          ...recent.map(row =>
            h.keyed('div')(
              `recent:${row.address}`,
              [h.Class('f-session-recent')],
              [
                h.button(
                  [
                    h.Type('button'),
                    h.Class('f-session-main'),
                    h.OnClick(
                      Message.ClickedOpenSession({
                        target: targetOf(snapshot, row),
                      }),
                    ),
                  ],
                  [
                    h.span(
                      [h.Class('f-session-top')],
                      [
                        avatar(row.name, h),
                        h.b([], [row.name]),
                        h.small(
                          [h.Class('f-session-address')],
                          [ago(now, row.lastAt)],
                        ),
                      ],
                    ),
                  ],
                ),
              ],
            ),
          ),
        ]),
    h.div(
      [h.Class('f-sessions-controls')],
      [
        h.label(
          [],
          [
            'Group ',
            h.select(
              [
                h.OnChange(value =>
                  Message.SelectedSessionGroup({ group: groupOf(value) }),
                ),
              ],
              (
                [
                  'Squad',
                  'Issue',
                  'Status',
                  'None',
                ] satisfies ReadonlyArray<SessionGroup>
              ).map(group =>
                h.option(
                  [
                    h.Value(group),
                    h.Selected(model.inbox.sessionGroup === group),
                  ],
                  [
                    group === 'None'
                      ? 'No grouping'
                      : `By ${group.toLowerCase()}`,
                  ],
                ),
              ),
            ),
          ],
        ),
        h.label(
          [],
          [
            'Order ',
            h.select(
              [
                h.OnChange(value =>
                  Message.SelectedSessionOrder({ order: orderOf(value) }),
                ),
              ],
              (
                [
                  'Recent',
                  'Waiting',
                  'Name',
                ] satisfies ReadonlyArray<SessionOrder>
              ).map(order =>
                h.option(
                  [
                    h.Value(order),
                    h.Selected(model.inbox.sessionOrder === order),
                  ],
                  [order === 'Waiting' ? 'Waiting first' : order],
                ),
              ),
            ),
          ],
        ),
      ],
    ),
    ...groups.flatMap(group => {
      const inGroup = shown.filter(
        row => groupKey(row, model.inbox.sessionGroup) === group,
      )
      return [
        h.h3(
          [h.Class('f-sessions-heading')],
          [group, ' ', h.span([h.Class('f-count')], [String(inGroup.length)])],
        ),
        ...inGroup.map(row => rowView(model, snapshot, row, h)),
      ]
    }),
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

const groupOf = (value: string): SessionGroup =>
  value === 'Issue' || value === 'Status' || value === 'None' ? value : 'Squad'
const orderOf = (value: string): SessionOrder =>
  value === 'Waiting' || value === 'Name' ? value : 'Recent'

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
            [opened],
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
                      h.p([h.Class('hint')], ['Pinned, then grouped your way']),
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
          model.inbox.isSessionDirectory ? directory : opened,
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
