import type { Html, HtmlBuilder } from 'foldkit/html'

import { agentAvatar, hueOf } from './avatar'
import { NAMES } from './inbox'
import { Message, type Model } from './main'
import { type RefCard, refView } from './refCard'
import { WORK_FIXTURE } from './workFixture'
import {
  STATE_LABELS,
  type TimelineScale,
  type WorkFold,
  type WorkIssue,
  type WorkModel,
  agoText,
  cycleTime,
  duration,
  isFoldShown,
  isLaterState,
  leftLine,
  median,
  openIssues,
  timelineScale,
  timelineX,
  trackStages,
  workModel,
} from './workFlow'

type H = HtmlBuilder<Message>

// Every timeline row and fold head has a fixed height (workflow.css --work-row, --work-fold),
// so a dependency arrow can reach the row it starts from without measuring the page.
const ROW = 48
const FOLD = 40

const LINEAR = 'https://linear.app/rbrtbn/issue/'
const PULLS = 'https://github.com/rbrtbn/squad/pull/'

const entry = (label: string, value: string): readonly [string, string] => [
  label,
  value,
]

const issueCard = (issue: WorkIssue): RefCard => ({
  kind: 'Issue',
  id: issue.id,
  title: issue.title,
  subtitle: `${issue.id} · Linear: ${issue.linearStatus}`,
  rows: [
    entry('State', stateText(issue)),
    ...(issue.pr === null
      ? []
      : [
          entry(
            'PR',
            `#${issue.pr}${issue.prState === null ? '' : ` · ${issue.prState}`}`,
          ),
        ]),
    entry('Spent', duration(issue.spent)),
    entry('Left', leftLine(issue)),
  ],
  href: `${LINEAR}${issue.id}`,
})

const stateText = (issue: WorkIssue): string =>
  issue.isBlocked
    ? `Blocked · ${STATE_LABELS[issue.at]}`
    : STATE_LABELS[issue.state]

const stateChip = (issue: WorkIssue, h: H): Html =>
  h.span(
    [h.Class(`f-work-state is-${issue.isBlocked ? 'blocked' : issue.state}`)],
    [stateText(issue)],
  )

const issueRef = (issue: WorkIssue, place: string, h: H): Html =>
  refView(
    issueCard(issue),
    place,
    h.span([h.Class('f-work-id')], [issue.id]),
    h,
  )

// STATS

const statsView = (work: WorkModel, h: H): Html => {
  const stat = (value: string, label: string, isHot = false): Html =>
    h.div(
      [h.Class(`f-work-stat${isHot ? ' is-hot' : ''}`)],
      [h.b([], [value]), h.span([], [label])],
    )
  const { stats } = work
  return h.section(
    [h.Class('f-work-stats'), h.AriaLabel('The squad at a glance')],
    [
      stat(String(stats.inProgress), 'in progress'),
      stat(String(stats.blocked), 'blocked', stats.blocked > 0),
      stat(String(stats.done), 'done'),
      stat(String(stats.planned), 'planned'),
      stat(duration(stats.medianCycle), 'median start → merge'),
      stat(duration(stats.spentOpen), 'spent on open work'),
      stat(String(stats.handovers), 'handovers between agents'),
      stat(stats.reviewRounds.toFixed(1), 'review rounds per issue'),
    ],
  )
}

// TIMELINE

type Line =
  | Readonly<{ _tag: 'Fold'; fold: WorkFold; issues: ReadonlyArray<WorkIssue> }>
  | Readonly<{ _tag: 'Issue'; issue: WorkIssue }>

const lineHeight = (line: Line): number => (line._tag === 'Fold' ? FOLD : ROW)

const dayLabel = (day: number): string =>
  new Date(day).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })

const at = (scale: TimelineScale, ms: number): string =>
  `${timelineX(scale, ms).toFixed(3)}%`

const gridView = (work: WorkModel, scale: TimelineScale, h: H): Html =>
  h.div(
    [h.Class('f-work-grid'), h.AriaHidden(true)],
    [
      ...scale.days.map(day =>
        h.span([h.Class('f-work-tick'), h.Style({ left: at(scale, day) })], []),
      ),
      h.span(
        [h.Class('f-work-now'), h.Style({ left: at(scale, work.now) })],
        [],
      ),
    ],
  )

const axisView = (work: WorkModel, scale: TimelineScale, h: H): Html =>
  h.div(
    [h.Class('f-work-axis')],
    [
      h.span([h.Class('f-work-label-head')], ['Issue']),
      h.div(
        [h.Class('f-work-plot'), h.AriaHidden(true)],
        [
          ...scale.days.map(day =>
            h.span(
              [h.Class('f-work-day'), h.Style({ left: at(scale, day) })],
              [dayLabel(day)],
            ),
          ),
          h.span(
            [
              h.Class('f-work-day is-now'),
              h.Style({ left: at(scale, work.now) }),
            ],
            ['now'],
          ),
        ],
      ),
    ],
  )

// A curve from the end of the work this issue waits on to where this issue starts. Drawn in the
// waiting row, `rise` px above or below it; x is a percentage of the plot.
const arrowView = (fromX: number, toX: number, rise: number, h: H): Html => {
  const y = ROW / 2
  const bend = Math.max(1.5, Math.abs(toX - fromX) / 3)
  return h.svg(
    [
      h.Class('f-work-arrow'),
      h.ViewBox(`0 0 100 ${ROW}`),
      h.Attribute('preserveAspectRatio', 'none'),
      h.AriaHidden(true),
    ],
    [
      h.path([
        h.D(
          `M${fromX},${y + rise} C${fromX + bend},${y + rise} ${toX - bend},${y} ${toX},${y}`,
        ),
      ]),
    ],
  )
}

const barsView = (
  work: WorkModel,
  scale: TimelineScale,
  issue: WorkIssue,
  arrows: ReadonlyArray<Html>,
  h: H,
): Html => {
  const shown = issue.segments.filter(segment => !isLaterState(segment.state))
  const pickups = shown.filter(
    (segment, index) =>
      segment.agent !== '' &&
      (index === 0 || shown[index - 1]?.agent !== segment.agent),
  )
  const start = issue.first ?? work.now
  return h.div(
    [h.Class('f-work-plot')],
    [
      ...arrows,
      ...(arrows.length === 0
        ? []
        : [
            h.span(
              [
                h.Class('f-work-arrowhead'),
                h.Style({ left: at(scale, start) }),
                h.AriaHidden(true),
              ],
              [],
            ),
          ]),
      ...shown.map(segment =>
        h.span(
          [
            h.Class(
              `f-work-seg is-${segment.state}${segment.isInferred ? ' is-inferred' : ''}`,
            ),
            h.Style({
              left: at(scale, segment.from),
              width: `${Math.max(0, timelineX(scale, segment.to) - timelineX(scale, segment.from)).toFixed(3)}%`,
            }),
            h.Title(
              [
                STATE_LABELS[segment.state],
                duration(segment.to - segment.from),
                segment.agent,
                segment.note,
              ]
                .filter(part => part !== '')
                .join(' · '),
            ),
          ],
          [],
        ),
      ),
      issue.group === 'Active'
        ? h.span(
            [
              h.Class('f-work-left'),
              h.Style({
                left: at(scale, work.now),
                width: `${Math.max(8, issue.stepsLeft * 22)}px`,
              }),
              h.Title(leftLine(issue)),
            ],
            [],
          )
        : h.empty,
      ...pickups.map(segment =>
        h.span(
          [
            h.Class('f-work-pickup'),
            h.Style({ left: at(scale, segment.from) }),
          ],
          [agentAvatar(segment.agent, h, 'Small')],
        ),
      ),
      issue.group === 'Later'
        ? h.span(
            [h.Class('f-work-planned'), h.Style({ left: at(scale, work.now) })],
            [
              `planned${issue.dependsOn.length === 0 ? '' : ` · after ${issue.dependsOn.join(', ')}`}`,
            ],
          )
        : h.empty,
      issue.isBlocked
        ? h.span(
            [
              h.Class('f-work-blocker'),
              h.Style({
                right: `${(100 - timelineX(scale, work.now)).toFixed(3)}%`,
              }),
            ],
            [`⛔ ${issue.blockedBy ?? 'Blocked'}`],
          )
        : h.empty,
    ],
  )
}

const foldView = (
  query: string,
  fold: WorkFold,
  issues: ReadonlyArray<WorkIssue>,
  h: H,
): Html => {
  const isShown = isFoldShown(query, fold)
  const hint =
    fold === 'Done'
      ? `${issues
          .map(issue => issue.id)
          .slice(-6)
          .join(
            ', ',
          )}${issues.length > 6 ? ', …' : ''} · median ${duration(median(issues.map(cycleTime)))} start → merge`
      : `${issues.filter(issue => issue.dependsOn.length > 0).length} wait on other work`
  return h.button(
    [
      h.Type('button'),
      h.Class(`f-work-fold${isShown ? ' is-open' : ''}`),
      h.AriaExpanded(isShown),
      h.OnClick(Message.ClickedWorkFold({ fold })),
    ],
    [
      h.span(
        [h.Class('f-work-caret'), h.AriaHidden(true)],
        [isShown ? '▾' : '▸'],
      ),
      h.b(
        [],
        [
          `${fold === 'Done' ? 'Done earlier' : 'Planned next'} · ${issues.length}`,
        ],
      ),
      h.span([h.Class('hint')], [hint]),
    ],
  )
}

const trackId = (issue: WorkIssue): string => `work-track-${issue.id}`

const rowView = (
  work: WorkModel,
  scale: TimelineScale,
  issue: WorkIssue,
  isOpen: boolean,
  arrows: ReadonlyArray<Html>,
  h: H,
): Html => {
  const holder = issue.agents[issue.agents.length - 1]
  return h.keyed('div')(
    issue.id,
    [
      h.Class(
        `f-work-row is-${issue.group.toLowerCase()}${issue.isBlocked ? ' is-blocked' : ''}${isOpen ? ' is-open' : ''}`,
      ),
    ],
    [
      h.div(
        [h.Class('f-work-line')],
        [
          h.div(
            [h.Class('f-work-label')],
            [
              issueRef(issue, 'work-row', h),
              h.button(
                [
                  h.Type('button'),
                  h.Class('f-work-toggle'),
                  h.AriaExpanded(isOpen),
                  h.AriaControls(trackId(issue)),
                  h.OnClick(Message.ClickedWorkRow({ id: issue.id })),
                ],
                [
                  h.span([h.Class('f-work-title')], [issue.title]),
                  stateChip(issue, h),
                  holder === undefined
                    ? h.empty
                    : agentAvatar(holder, h, 'Small'),
                  h.span(
                    [h.Class('f-work-caret'), h.AriaHidden(true)],
                    [isOpen ? '▾' : '▸'],
                  ),
                ],
              ),
            ],
          ),
          barsView(work, scale, issue, arrows, h),
        ],
      ),
      isOpen ? trackView(work, issue, h) : h.empty,
    ],
  )
}

/** The timeline's lines in page order: done fold, active work, planned fold. */
const linesOf = (work: WorkModel, query: string): ReadonlyArray<Line> => [
  { _tag: 'Fold', fold: 'Done', issues: work.done },
  ...(isFoldShown(query, 'Done') ? work.done : []).map((issue): Line => ({
    _tag: 'Issue',
    issue,
  })),
  ...work.active.map((issue): Line => ({ _tag: 'Issue', issue })),
  { _tag: 'Fold', fold: 'Later', issues: work.later },
  ...(isFoldShown(query, 'Later') ? work.later : []).map((issue): Line => ({
    _tag: 'Issue',
    issue,
  })),
]

const timelineView = (work: WorkModel, query: string, h: H): Html => {
  const scale = timelineScale(work)
  const open = openIssues(query)
  const lines = linesOf(work, query)
  const tops = lines.reduce<ReadonlyArray<number>>(
    (sums, line, index) => [
      ...sums,
      index === 0
        ? 0
        : (sums[index - 1] ?? 0) + lineHeight(lines[index - 1] ?? line),
    ],
    [],
  )
  const indexOf = (id: string): number =>
    lines.findIndex(line => line._tag === 'Issue' && line.issue.id === id)
  // An opened track between two rows moves one of them by an unknown height; the track lists
  // the dependency instead.
  const isClear = (from: number, to: number): boolean =>
    lines
      .slice(Math.min(from, to), Math.max(from, to))
      .every(line => line._tag === 'Fold' || !open.includes(line.issue.id))
  // Planned work has not started, so its label names what it waits on instead of an arrow.
  const arrowsOf = (issue: WorkIssue, index: number): ReadonlyArray<Html> =>
    (issue.group === 'Later' ? [] : issue.dependsOn).flatMap(id => {
      const from = indexOf(id)
      const source = lines[from]
      return from === -1 || source?._tag !== 'Issue' || !isClear(from, index)
        ? []
        : [
            arrowView(
              timelineX(scale, source.issue.last ?? work.now),
              timelineX(scale, issue.first ?? work.now),
              (tops[from] ?? 0) - (tops[index] ?? 0),
              h,
            ),
          ]
    })
  return h.section(
    [h.Class('f-work-timeline'), h.AriaLabel('Timeline')],
    [
      h.div(
        [h.Class('f-work-scroll')],
        [
          h.div(
            [h.Class('f-work-board')],
            [
              axisView(work, scale, h),
              h.div(
                [h.Class('f-work-rows')],
                [
                  h.div(
                    [h.Class('f-work-gridbox'), h.AriaHidden(true)],
                    [h.span([], []), gridView(work, scale, h)],
                  ),
                  ...lines.map((line, index) =>
                    line._tag === 'Fold'
                      ? foldView(query, line.fold, line.issues, h)
                      : rowView(
                          work,
                          scale,
                          line.issue,
                          open.includes(line.issue.id),
                          arrowsOf(line.issue, index),
                          h,
                        ),
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
      h.div(
        [h.Class('f-work-legend')],
        [
          ...(
            [
              'design-gate',
              'building',
              'review',
              'fixing',
              'merge-ready',
              'merged',
              'blocked',
            ] satisfies ReadonlyArray<keyof typeof STATE_LABELS>
          ).map(state =>
            h.span(
              [],
              [
                h.i(
                  [h.Class(`f-work-swatch is-${state}`), h.AriaHidden(true)],
                  [],
                ),
                STATE_LABELS[state],
              ],
            ),
          ),
          h.span(
            [],
            [
              h.i([h.Class('f-work-swatch is-left'), h.AriaHidden(true)], []),
              'Left to merge',
            ],
          ),
          h.span([], ['● an agent picks it up']),
          h.span([], ['→ waits on']),
        ],
      ),
    ],
  )
}

// TRACK

const moveTime = (ms: number): string =>
  new Date(ms).toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

const issueOf = (work: WorkModel, id: string): WorkIssue | undefined =>
  work.issues.find(issue => issue.id === id)

const trackView = (work: WorkModel, issue: WorkIssue, h: H): Html => {
  const stages = trackStages(issue)
  const handovers = Math.max(0, issue.agents.length - 1)
  return h.div(
    [h.Id(trackId(issue)), h.Class('f-work-track')],
    [
      h.div(
        [h.Class('f-track-main')],
        [
          h.ol(
            [h.Class('f-track-stages'), h.AriaLabel(`${issue.id} stages`)],
            stages.map(stage =>
              h.li(
                [
                  h.Class(
                    `f-track-stage is-${stage.mark.toLowerCase()}${stage.mark === 'Here' && issue.isBlocked ? ' is-blocked' : ''}`,
                  ),
                  ...(stage.agent === undefined
                    ? []
                    : [
                        h.Style({
                          '--stage-agent': `var(--av-${hueOf(stage.agent)})`,
                        }),
                      ]),
                ],
                [
                  h.span(
                    [h.Class('f-track-name')],
                    [STATE_LABELS[stage.stage]],
                  ),
                  h.span(
                    [h.Class('f-track-node')],
                    [
                      stage.mark === 'Here' && stage.agent !== undefined
                        ? agentAvatar(stage.agent, h)
                        : h.empty,
                    ],
                  ),
                  h.span(
                    [h.Class('f-track-time')],
                    [
                      stage.spent === undefined ? '' : duration(stage.spent),
                      stage.loops > 1
                        ? h.span(
                            [h.Class('f-track-loops')],
                            [`×${stage.loops}`],
                          )
                        : h.empty,
                      stage.agent === undefined || stage.mark === 'Here'
                        ? h.empty
                        : h.span([h.Class('f-track-who')], [stage.agent]),
                    ],
                  ),
                ],
              ),
            ),
          ),
          h.div(
            [h.Class('f-track-nums')],
            [
              h.b([], [duration(issue.spent)]),
              h.span(
                [],
                [
                  `${leftLine(issue)}${issue.estimateLeft === null || issue.group === 'Done' ? '' : ` · ${issue.estimateLeft}`}`,
                ],
              ),
              issue.group === 'Active'
                ? h.span(
                    [h.Class('hint')],
                    [`last move ${agoText(issue.sinceLast)}`],
                  )
                : h.empty,
            ],
          ),
        ],
      ),
      h.div(
        [h.Class('f-track-facts')],
        [
          issue.doing === ''
            ? h.empty
            : h.p([], [h.b([], ['Doing ']), issue.doing]),
          issue.blockedBy === null
            ? h.empty
            : h.p([h.Class('f-track-blocker')], [`⛔ ${issue.blockedBy}`]),
          h.p(
            [h.Class('f-track-meta')],
            [
              issue.dependsOn.length === 0
                ? h.empty
                : h.span(
                    [],
                    [
                      'After ',
                      ...issue.dependsOn.flatMap((id, index) => {
                        const target = issueOf(work, id)
                        return [
                          index === 0 ? '' : ', ',
                          target === undefined
                            ? h.span([h.Class('f-work-id')], [id])
                            : h.button(
                                [
                                  h.Type('button'),
                                  h.Class('text-button f-work-id'),
                                  h.OnClick(
                                    Message.ClickedWorkDependency({
                                      id,
                                      group: target.group,
                                    }),
                                  ),
                                ],
                                [id],
                              ),
                        ]
                      }),
                    ],
                  ),
              issue.pr === null
                ? h.empty
                : h.a(
                    [
                      h.Class('text-link'),
                      h.Href(`${PULLS}${issue.pr}`),
                      h.Target('_blank'),
                      h.Rel('noreferrer'),
                    ],
                    [
                      `#${issue.pr}${issue.prState === 'merged' ? ' · merged' : ''}`,
                    ],
                  ),
              h.span([h.Class('hint')], [`Linear: ${issue.linearStatus}`]),
              h.span(
                [h.Class('hint')],
                [
                  `Review rounds ${issue.rounds.review}, fix rounds ${issue.rounds.fix}${handovers === 0 ? '' : ` · ${handovers} handover${handovers === 1 ? '' : 's'}`}`,
                ],
              ),
            ],
          ),
        ],
      ),
      h.details(
        [h.Class('f-track-moves')],
        [
          h.summary([], [`Moves · ${issue.segments.length}`]),
          h.ol(
            [],
            issue.segments.map(segment =>
              h.li(
                [],
                [
                  h.time([], [moveTime(segment.from)]),
                  segment.agent === ''
                    ? h.empty
                    : agentAvatar(segment.agent, h, 'Small'),
                  h.b([], [STATE_LABELS[segment.state]]),
                  h.span([h.Class('hint')], [segment.note]),
                ],
              ),
            ),
          ),
        ],
      ),
    ],
  )
}

// PAGE

/** The Work page: every issue over time, each row opening into its Track. */
export const workPage = (model: Model, h: H): Html => {
  const header = h.div([h.Class('f-inbox-title')], [h.h1([], [NAMES.work])])
  if (!model.inbox.isFixture) {
    return h.section(
      [h.Class('f-page f-work')],
      [
        header,
        h.p(
          [h.Class('f-lead')],
          [
            'Where each Linear issue the squad works on stands, over time. Agents don’t log their moves yet, so there is nothing to show here. Open the page with the preview fixture to see it with a past run’s issues.',
          ],
        ),
      ],
    )
  }
  const work = workModel(WORK_FIXTURE)
  return h.section(
    [h.Class('f-page f-work')],
    [
      header,
      h.p(
        [h.Class('f-lead')],
        [
          'Every Linear issue the squad is working on, over time. Open a row for its track: who held each stage, how long it took and what is left. Done work folds above, planned work below.',
        ],
      ),
      h.p(
        [h.Class('f-fixture-note')],
        [
          `Preview data: ${WORK_FIXTURE.issues.length} issues from run ${WORK_FIXTURE.run.id}. Times marked (mtime) come from file times.`,
        ],
      ),
      statsView(work, h),
      timelineView(work, model.pageQuery, h),
    ],
  )
}
