/// <reference types="vite/client" />
import { Array, Effect, Option, Schema } from 'effect'
import { Command, Dom, Runtime, Subscription, Update } from 'foldkit'
import type { Document, Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import './styles.css'

const Variant = Schema.Literals(['A', 'B', 'C', 'D', 'E', 'F', 'G'])
const State = Schema.Literals(['All', 'Open', 'Draft', 'Sent'])
const Urgency = Schema.Literals([
  'All',
  'blocking',
  'soon',
  'wait',
  'fyi',
  'unspecified',
  'urgent',
])
const Grouping = Schema.Literals(['Round', 'Agent'])
const Page = Schema.Literals([
  'Question',
  'Needs you',
  'Squad overview',
  'Run overview',
  'Your grills',
])
const Model = Schema.Struct({
  variant: Variant,
  state: State,
  urgency: Urgency,
  grouping: Grouping,
  page: Page,
  query: Schema.String,
  selected: Schema.Number,
  count: Schema.Number,
  scope: Schema.String,
  folded: Schema.Array(Schema.String),
  drafts: Schema.Array(Schema.Number),
  filters: Schema.Boolean,
  discussion: Schema.Boolean,
})
type Model = typeof Model.Type
const Message = defineMessageUnion({
  SelectedVariant: { variant: Variant },
  PressedVariantArrow: { direction: Schema.Number },
  UpdatedQuery: { query: Schema.String },
  SelectedState: { state: State },
  SelectedUrgency: { urgency: Urgency },
  SelectedFilters: { state: State, urgency: Urgency },
  SelectedGrouping: { grouping: Grouping },
  SelectedQuestion: { id: Schema.Number },
  SelectedScope: { scope: Schema.String },
  ToggledGroup: { group: Schema.String },
  ToggledFilters: {},
  ClearedFilters: {},
  SelectedPage: { page: Page },
  SelectedSize: { count: Schema.Number },
  ToggledDiscussion: {},
  SelectedAnswer: {},
  CompletedVariantUrl: {},
})
type Message = typeof Message.Type
type H = HtmlBuilder<Message>

const baseVariants: ReadonlyArray<typeof Variant.Type> = ['A', 'B', 'C', 'D']
const hybridVariants: ReadonlyArray<typeof Variant.Type> = ['E', 'F', 'G']
const isHybrid = (variant: typeof Variant.Type) =>
  hybridVariants.includes(variant)
const variantsFor = (model: Model) =>
  isHybrid(model.variant) ? hybridVariants : baseVariants
const names = {
  A: 'Compact stack',
  B: 'Separate rail',
  C: 'Filters on demand',
  D: 'Round navigator',
  E: 'Visible filters',
  F: 'Filter grid',
  G: 'Quick views',
}
const descriptions = {
  A: 'Every control is visible. Only the question list scrolls.',
  B: 'Application navigation gets its own rail, leaving more room for questions.',
  C: 'Search stays visible. Less frequent filters open together, with active choices shown.',
  D: 'Pick a round or agent, then work through a shorter list. All groups remains available.',
  E: 'Both filter rows stay visible. Choose status and urgency directly, with counts for each.',
  F: 'Choose a status and urgency intersection in one click. The grid previews the result counts.',
  G: 'Frequent combinations are one click. Open Custom filters only for a less common view.',
}
const titles = [
  'Night grant for the runs',
  'Capacity for three runs',
  'Tag sends in grill-flow',
  'Keep the laptop awake',
  'Source labels, not only IDs',
  'Limits per source',
  'Card transition after release',
  'Show the exact answer sent',
  'Design gate for the next stage',
  'Old pages retire',
  'Read-only fallback',
  'Which ADR should retire the old rules?',
  'Keep grant provenance',
  'Hook trust and configuration',
  'Review the PR order',
]
const rounds = ['Tonight', 'Release & grants', 'Clean-up', 'Design gates']
const agents = [
  'Squad lead',
  'Token efficiency',
  'Grant checks',
  'Homelab lanes',
]
const urgencyNames = {
  All: 'All urgencies',
  blocking: 'Blocking',
  soon: 'Soon',
  wait: 'Can wait',
  fyi: 'FYI',
  unspecified: 'Unspecified',
  urgent: 'Blocking + Soon',
}
const questions = (count: number) =>
  Array.makeBy(count, index => ({
    id: index + 1,
    title: titles[index % titles.length] ?? 'Review the proposed change',
    round: Math.floor(index / Math.ceil(count / 4)),
    agent: index % agents.length,
    state:
      index < Math.floor(count / 4)
        ? 'Sent'
        : index % 7 === 2
          ? 'Draft'
          : 'Open',
    urgency:
      index % 11 === 0
        ? 'blocking'
        : index % 5 === 0
          ? 'soon'
          : index % 7 === 0
            ? 'fyi'
            : index % 3 === 0
              ? 'unspecified'
              : 'wait',
  }))
type Question = ReturnType<typeof questions>[number]
const stateOf = (model: Model, q: Question) =>
  model.drafts.includes(q.id) ? 'Draft' : q.state
const groupKey = (model: Model, q: Question) =>
  String(model.grouping === 'Round' ? q.round : q.agent)
const roundName = (key: number) => rounds[key]?.trim() || `Round ${key + 1}`
const groupName = (model: Model, key: number) =>
  model.grouping === 'Round'
    ? model.variant === 'G'
      ? roundName(key)
      : `Round ${key + 1} · ${rounds[key]}`
    : (agents[key] ?? 'Agent')
const urgencyMatches = (filter: typeof Urgency.Type, value: string) =>
  filter === 'All' ||
  (filter === 'urgent'
    ? value === 'blocking' || value === 'soon'
    : value === filter)
const visible = (model: Model) =>
  questions(model.count).filter(
    q =>
      (model.state === 'All' || stateOf(model, q) === model.state) &&
      urgencyMatches(model.urgency, q.urgency) &&
      `Q${q.id} ${q.title} ${agents[q.agent]} ${rounds[q.round]}`
        .toLowerCase()
        .includes(model.query.trim().toLowerCase()),
  )
const variantUrl = Command.define('VariantUrl', {
  args: { variant: Variant },
  messages: [Message.CompletedVariantUrl],
  execute: ({ variant }) =>
    Effect.sync(() => {
      const url = new URL(window.location.href)
      url.searchParams.set('variant', variant)
      window.history.replaceState({}, '', url)
      return Message.CompletedVariantUrl()
    }),
})
const chooseVariant = (model: Model, variant: typeof Variant.Type) => ({
  model: modifyFields(model, {
    variant: () => variant,
    grouping: current => (variant === 'G' ? 'Round' : current),
    folded: current =>
      variant === 'G' && model.grouping !== 'Round' ? [] : current,
    scope: current =>
      variant === 'G' && model.grouping !== 'Round'
        ? current === 'all'
          ? 'all'
          : String(
              Math.floor((model.selected - 1) / Math.ceil(model.count / 4)),
            )
        : isHybrid(model.variant) && isHybrid(variant)
          ? current
          : variant === 'D' || isHybrid(variant)
            ? String(
                model.grouping === 'Round'
                  ? Math.floor(
                      (model.selected - 1) / Math.ceil(model.count / 4),
                    )
                  : (model.selected - 1) % agents.length,
              )
            : 'all',
    filters: () => false,
  }),
  commands: [variantUrl({ variant })],
})
const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    SelectedVariant: ({ variant }) => chooseVariant(model, variant),
    PressedVariantArrow: ({ direction }) =>
      chooseVariant(
        model,
        variantsFor(model)[
          (variantsFor(model).indexOf(model.variant) +
            direction +
            variantsFor(model).length) %
            variantsFor(model).length
        ] ?? 'A',
      ),
    UpdatedQuery: ({ query }) => ({
      model: modifyFields(model, { query: () => query }),
    }),
    SelectedState: ({ state }) => ({
      model: modifyFields(model, { state: () => state }),
    }),
    SelectedUrgency: ({ urgency }) => ({
      model: modifyFields(model, { urgency: () => urgency }),
    }),
    SelectedFilters: ({ state, urgency }) => ({
      model: modifyFields(model, {
        state: () => state,
        urgency: () => urgency,
      }),
    }),
    SelectedGrouping: ({ grouping }) => ({
      model: modifyFields(model, {
        grouping: () => (model.variant === 'G' ? 'Round' : grouping),
        scope: () => 'all',
        folded: () => [],
      }),
    }),
    SelectedQuestion: ({ id }) => ({
      model: modifyFields(model, {
        selected: () => id,
        page: () => 'Question',
      }),
    }),
    SelectedScope: ({ scope }) => ({
      model: modifyFields(model, { scope: () => scope }),
    }),
    ToggledGroup: ({ group }) => ({
      model: modifyFields(model, {
        folded: ids =>
          ids.includes(group)
            ? ids.filter(id => id !== group)
            : [...ids, group],
      }),
    }),
    ToggledFilters: () => ({
      model: modifyFields(model, { filters: current => !current }),
    }),
    ClearedFilters: () => ({
      model: modifyFields(model, {
        state: () => 'All',
        urgency: () => 'All',
        query: () => '',
        scope: current => (isHybrid(model.variant) ? current : 'all'),
      }),
    }),
    SelectedPage: ({ page }) => ({
      model: modifyFields(model, { page: () => page }),
    }),
    SelectedSize: ({ count }) => ({
      model: modifyFields(model, {
        count: () => count,
        folded: () => [],
        selected: () => Math.min(model.selected, count),
        scope: current =>
          (model.variant === 'D' || isHybrid(model.variant)) &&
          current !== 'all' &&
          model.grouping === 'Round'
            ? String(
                Math.floor(
                  (Math.min(model.selected, count) - 1) / Math.ceil(count / 4),
                ),
              )
            : current,
      }),
    }),
    ToggledDiscussion: () => ({
      model: modifyFields(model, { discussion: current => !current }),
    }),
    SelectedAnswer: () => ({
      model: modifyFields(model, {
        drafts: ids => Array.dedupe([...ids, model.selected]),
      }),
    }),
    CompletedVariantUrl: () => ({ model }),
  })

const icon = (name: string, h: H): Html =>
  h.svg(
    [
      h.ViewBox('0 0 24 24'),
      h.Fill('none'),
      h.Stroke('currentColor'),
      h.StrokeWidth('1.6'),
      h.AriaHidden(true),
    ],
    [
      h.path([
        h.D(
          name === 'Needs you'
            ? 'M12 3 2 21h20L12 3Zm0 6v5m0 3v1'
            : name === 'Squad overview'
              ? 'M3 5h7v6H3V5Zm11 0h7v6h-7V5ZM3 15h7v6H3v-6Zm11 0h7v6h-7v-6Z'
              : 'M5 4h14v17H5V4Zm4-2v4m6-4v4M8 11h8m-8 4h8',
        ),
      ]),
    ],
  )
const mark = (model: Model, q: Question, h: H) =>
  h.span([
    h.Class(`state-mark ${stateOf(model, q).toLowerCase()} ${q.urgency}`),
    h.Title(
      `${stateOf(model, q)} · ${urgencyNames[Schema.decodeUnknownSync(Urgency)(q.urgency)]}`,
    ),
    h.AriaHidden(true),
  ])
const nav = (model: Model, rail: boolean, h: H): Html =>
  h.nav(
    [h.Class(rail ? 'app-nav rail' : 'app-nav'), h.AriaLabel('Workspace')],
    (
      [
        'Needs you',
        'Squad overview',
        'Run overview',
        'Your grills',
      ] satisfies ReadonlyArray<typeof Page.Type>
    ).map(page =>
      h.button(
        [
          h.Class(`nav-item${model.page === page ? ' current' : ''}`),
          h.OnClick(Message.SelectedPage({ page })),
        ],
        [
          rail ? icon(page, h) : h.empty,
          h.span([], [page]),
          h.small(
            [],
            [
              page === 'Needs you'
                ? `${questions(model.count).filter(q => stateOf(model, q) === 'Open').length} open`
                : page === 'Squad overview'
                  ? '4 agents'
                  : page === 'Run overview'
                    ? '7 merged'
                    : 'All hosts',
            ],
          ),
        ],
      ),
    ),
  )
const search = (model: Model, h: H) =>
  h.input([
    h.Type('search'),
    h.Placeholder('Find a question or issue…'),
    h.AriaLabel('Find a question or issue'),
    h.Value(model.query),
    h.OnInput(query => Message.UpdatedQuery({ query })),
  ])
const status = (model: Model, h: H) =>
  h.div(
    [
      h.Class('status-controls'),
      h.Role('group'),
      h.AriaLabel('Question status'),
    ],
    (
      ['All', 'Open', 'Draft', 'Sent'] satisfies ReadonlyArray<
        typeof State.Type
      >
    ).map(state =>
      h.button(
        [
          h.Class(model.state === state ? 'active' : ''),
          h.AriaPressed(String(model.state === state)),
          h.OnClick(Message.SelectedState({ state })),
        ],
        [
          state === 'All'
            ? h.empty
            : h.span([
                h.Class(`state-mark ${state.toLowerCase()}`),
                h.AriaHidden(true),
              ]),
          state,
          h.small(
            [],
            [
              String(
                questions(model.count).filter(
                  q => state === 'All' || stateOf(model, q) === state,
                ).length,
              ),
            ],
          ),
        ],
      ),
    ),
  )
const urgency = (model: Model, h: H) =>
  h.label(
    [h.Class('select-line')],
    [
      'Urgency',
      h.select(
        [
          h.AriaLabel('Urgency'),
          h.Value(model.urgency),
          h.OnChange(value =>
            Message.SelectedUrgency({
              urgency: Schema.decodeUnknownSync(Urgency)(value),
            }),
          ),
        ],
        Object.entries(urgencyNames)
          .filter(([value]) => value !== 'urgent')
          .map(([value, label]) => h.option([h.Value(value)], [label])),
      ),
    ],
  )
const grouping = (model: Model, h: H) =>
  h.select(
    [
      h.AriaLabel('Group questions by'),
      h.Value(model.grouping),
      h.OnChange(value =>
        Message.SelectedGrouping({
          grouping: value === 'Agent' ? 'Agent' : 'Round',
        }),
      ),
    ],
    ['Round', 'Agent'].map(value =>
      h.option([h.Value(value)], [`By ${value.toLowerCase()}`]),
    ),
  )
const questionRow = (model: Model, q: Question, h: H) =>
  h.keyed('li')(
    String(q.id),
    [],
    [
      h.button(
        [
          h.Class(
            `question-row${model.selected === q.id && model.page === 'Question' ? ' selected' : ''}`,
          ),
          h.OnClick(Message.SelectedQuestion({ id: q.id })),
          h.Title(`Q${q.id} · ${q.title} · ${stateOf(model, q)}`),
        ],
        [
          mark(model, q, h),
          h.span([h.Class('qid')], [`Q${q.id}`]),
          h.span([h.Class('question-name')], [q.title]),
        ],
      ),
    ],
  )
const questionList = (model: Model, scoped: boolean, h: H): Html => {
  const list = visible(model).filter(
    q => !scoped || model.scope === 'all' || groupKey(model, q) === model.scope,
  )
  return h.div(
    [h.Class('question-scroll'), h.AriaLabel('Question list')],
    Array.isArrayEmpty(list)
      ? [
          h.p([h.Class('empty')], ['No questions match these filters.']),
          h.button(
            [h.Class('text-button'), h.OnClick(Message.ClearedFilters())],
            ['Clear filters'],
          ),
        ]
      : [
          ...Array.makeBy(4, key => {
            const rows = list.filter(q => groupKey(model, q) === String(key))
            return Array.isArrayEmpty(rows)
              ? h.empty
              : h.section(
                  [h.Class('question-group')],
                  [
                    scoped && model.scope !== 'all'
                      ? h.empty
                      : h.button(
                          [
                            h.Class('group-heading'),
                            h.AriaExpanded(!model.folded.includes(String(key))),
                            h.OnClick(
                              Message.ToggledGroup({ group: String(key) }),
                            ),
                          ],
                          [
                            h.span([
                              h.Class(
                                `chevron${model.folded.includes(String(key)) ? '' : ' down'}`,
                              ),
                            ]),
                            h.span([], [groupName(model, key)]),
                            h.small(
                              [],
                              [
                                `${rows.filter(q => stateOf(model, q) === 'Sent').length}/${rows.length}`,
                              ],
                            ),
                          ],
                        ),
                    model.folded.includes(String(key)) &&
                    (!scoped || model.scope === 'all')
                      ? h.empty
                      : h.ul(
                          [],
                          rows.map(q => questionRow(model, q, h)),
                        ),
                  ],
                )
          }),
        ],
  )
}
const controls = (model: Model, h: H) =>
  h.div(
    [h.Class('question-controls')],
    [
      h.div(
        [h.Class('question-heading')],
        [
          h.strong([], ['Questions']),
          h.small([], [String(model.count)]),
          grouping(model, h),
        ],
      ),
      search(model, h),
      status(model, h),
      urgency(model, h),
    ],
  )
const variantA = (model: Model, h: H) =>
  h.aside(
    [h.Class('sidebar variant-a')],
    [
      h.div(
        [h.Class('workspace-name')],
        ['grill-flow', h.small([], ['Squad'])],
      ),
      nav(model, false, h),
      controls(model, h),
      questionList(model, false, h),
    ],
  )
const variantB = (model: Model, h: H) =>
  h.aside(
    [h.Class('sidebar variant-b')],
    [
      h.div(
        [h.Class('rail-wrapper')],
        [h.div([h.Class('rail-brand')], ['gf']), nav(model, true, h)],
      ),
      h.div(
        [h.Class('question-pane')],
        [
          h.div(
            [h.Class('workspace-name')],
            ['Squad', h.small([], ['All agents · all runs'])],
          ),
          controls(model, h),
          questionList(model, false, h),
        ],
      ),
    ],
  )
const variantC = (model: Model, h: H) =>
  h.aside(
    [h.Class('sidebar variant-c')],
    [
      h.div(
        [h.Class('workspace-name')],
        ['grill-flow', h.small([], ['Squad'])],
      ),
      h.button(
        [
          h.Class('attention-link'),
          h.OnClick(Message.SelectedPage({ page: 'Needs you' })),
        ],
        [
          'Needs you',
          h.small(
            [],
            [
              `${questions(model.count).filter(q => stateOf(model, q) === 'Open').length} open questions`,
            ],
          ),
        ],
      ),
      h.div(
        [h.Class('question-controls')],
        [
          h.div(
            [h.Class('question-heading')],
            [h.strong([], ['Questions']), grouping(model, h)],
          ),
          search(model, h),
          h.div(
            [h.Class('filter-summary')],
            [
              h.button(
                [
                  h.Class(`filter-button${model.filters ? ' active' : ''}`),
                  h.AriaExpanded(model.filters),
                  h.OnClick(Message.ToggledFilters()),
                ],
                [
                  'Filters',
                  h.small(
                    [],
                    [
                      String(
                        Number(model.state !== 'All') +
                          Number(model.urgency !== 'All'),
                      ),
                    ],
                  ),
                ],
              ),
              h.span([], [`${visible(model).length} of ${model.count}`]),
              model.state === 'All' && model.urgency === 'All'
                ? h.empty
                : h.button(
                    [
                      h.Class('text-button'),
                      h.OnClick(Message.ClearedFilters()),
                    ],
                    ['Reset'],
                  ),
            ],
          ),
          model.state === 'All' && model.urgency === 'All'
            ? h.empty
            : h.p(
                [h.Class('active-filters')],
                [
                  [
                    model.state === 'All' ? '' : model.state,
                    model.urgency === 'All' ? '' : urgencyNames[model.urgency],
                  ]
                    .filter(Boolean)
                    .join(' · '),
                ],
              ),
          model.filters
            ? h.div(
                [h.Class('filter-popover')],
                [
                  h.strong([], ['Show questions']),
                  status(model, h),
                  urgency(model, h),
                  h.button(
                    [
                      h.Class('text-button'),
                      h.OnClick(Message.ToggledFilters()),
                    ],
                    ['Done'],
                  ),
                ],
              )
            : h.empty,
        ],
      ),
      questionList(model, false, h),
      h.div([h.Class('bottom-navigation')], [nav(model, false, h)]),
    ],
  )
const variantD = (model: Model, h: H) =>
  h.aside(
    [h.Class('sidebar variant-d')],
    [
      h.div(
        [h.Class('workspace-name')],
        ['grill-flow', h.small([], ['Squad'])],
      ),
      nav(model, false, h),
      h.div(
        [h.Class('question-controls')],
        [
          h.div(
            [h.Class('question-heading')],
            [h.strong([], ['Questions']), grouping(model, h)],
          ),
          search(model, h),
          status(model, h),
          urgency(model, h),
        ],
      ),
      h.div(
        [h.Class('round-browser')],
        [
          h.nav(
            [h.Class('round-rail'), h.AriaLabel('Choose a group')],
            [
              h.button(
                [
                  h.Class(model.scope === 'all' ? 'active' : ''),
                  h.OnClick(Message.SelectedScope({ scope: 'all' })),
                ],
                ['All', h.small([], [String(visible(model).length)])],
              ),
              ...Array.makeBy(4, key =>
                h.button(
                  [
                    h.Class(model.scope === String(key) ? 'active' : ''),
                    h.OnClick(Message.SelectedScope({ scope: String(key) })),
                  ],
                  [
                    h.span(
                      [],
                      [
                        model.grouping === 'Round'
                          ? `Round ${key + 1}`
                          : (agents[key] ?? 'Agent'),
                      ],
                    ),
                    h.small(
                      [],
                      [
                        model.grouping === 'Round'
                          ? (rounds[key] ?? '')
                          : `${questions(model.count).filter(q => q.agent === key).length} questions`,
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
          questionList(model, true, h),
        ],
      ),
    ],
  )

const inScope = (model: Model, q: Question) =>
  model.scope === 'all' || groupKey(model, q) === model.scope
const pairCount = (
  model: Model,
  state: typeof State.Type,
  urgency: typeof Urgency.Type,
) =>
  visible(
    modifyFields(model, { state: () => state, urgency: () => urgency }),
  ).filter(q => inScope(model, q)).length
const stateValues: ReadonlyArray<typeof State.Type> = [
  'All',
  'Open',
  'Draft',
  'Sent',
]
const urgencyValues: ReadonlyArray<typeof Urgency.Type> = [
  'All',
  'blocking',
  'soon',
  'wait',
  'fyi',
  'unspecified',
]
const shortUrgency = {
  All: 'Any',
  blocking: 'Blocking',
  soon: 'Soon',
  wait: 'Wait',
  fyi: 'FYI',
  unspecified: 'Unset',
  urgent: 'Soon / now',
}
const hybridStatus = (model: Model, h: H) =>
  h.div(
    [
      h.Class('status-controls'),
      h.Role('group'),
      h.AriaLabel('Question status'),
    ],
    stateValues.map(state =>
      h.button(
        [
          h.Class(model.state === state ? 'active' : ''),
          h.AriaPressed(String(model.state === state)),
          h.OnClick(Message.SelectedState({ state })),
        ],
        [
          state === 'All'
            ? h.empty
            : h.span([
                h.Class(`state-mark ${state.toLowerCase()}`),
                h.AriaHidden(true),
              ]),
          state,
          h.small([], [String(pairCount(model, state, model.urgency))]),
        ],
      ),
    ),
  )
const selectedUrgency = (model: Model, urgency: typeof Urgency.Type) =>
  model.urgency === urgency ||
  (model.urgency === 'urgent' && (urgency === 'blocking' || urgency === 'soon'))
const hybridUrgency = (model: Model, h: H) =>
  h.div(
    [
      h.Class('urgency-buttons'),
      h.Role('group'),
      h.AriaLabel('Question urgency'),
    ],
    urgencyValues.map(urgency =>
      h.button(
        [
          h.Class(selectedUrgency(model, urgency) ? 'active' : ''),
          h.AriaLabel(urgencyNames[urgency]),
          h.AriaPressed(String(selectedUrgency(model, urgency))),
          h.OnClick(Message.SelectedUrgency({ urgency })),
        ],
        [
          h.span([], [shortUrgency[urgency]]),
          h.small([], [String(pairCount(model, model.state, urgency))]),
        ],
      ),
    ),
  )
const filterGrid = (model: Model, h: H) =>
  h.table(
    [h.Class('filter-grid'), h.AriaLabel('Choose status and urgency together')],
    [
      h.thead(
        [],
        [
          h.tr(
            [],
            [
              h.th([], ['Status']),
              ...urgencyValues.map(urgency =>
                h.th([h.Title(urgencyNames[urgency])], [shortUrgency[urgency]]),
              ),
            ],
          ),
        ],
      ),
      h.tbody(
        [],
        stateValues.map(state =>
          h.tr(
            [],
            [
              h.th([], [state]),
              ...urgencyValues.map(urgency =>
                h.td(
                  [],
                  [
                    h.button(
                      [
                        h.Class(
                          model.state === state &&
                            selectedUrgency(model, urgency)
                            ? 'active'
                            : '',
                        ),
                        h.AriaPressed(
                          String(
                            model.state === state &&
                              selectedUrgency(model, urgency),
                          ),
                        ),
                        h.AriaLabel(
                          `${state} · ${urgencyNames[urgency]} · ${pairCount(model, state, urgency)} questions`,
                        ),
                        h.OnClick(Message.SelectedFilters({ state, urgency })),
                      ],
                      [String(pairCount(model, state, urgency))],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    ],
  )
const quickViews = [
  { label: 'All', state: 'All', urgency: 'All' },
  { label: 'Needs attention', state: 'Open', urgency: 'urgent' },
  { label: 'Open', state: 'Open', urgency: 'All' },
  { label: 'Drafts', state: 'Draft', urgency: 'All' },
  { label: 'Sent', state: 'Sent', urgency: 'All' },
] satisfies ReadonlyArray<{
  label: string
  state: typeof State.Type
  urgency: typeof Urgency.Type
}>
const presetFilters = (model: Model, h: H) =>
  h.div(
    [h.Class('preset-filters')],
    [
      h.div(
        [h.Class('quick-views'), h.Role('group'), h.AriaLabel('Quick views')],
        quickViews.map(item =>
          h.button(
            [
              h.Class(
                model.state === item.state && model.urgency === item.urgency
                  ? 'active'
                  : '',
              ),
              h.AriaPressed(
                String(
                  model.state === item.state && model.urgency === item.urgency,
                ),
              ),
              h.OnClick(
                Message.SelectedFilters({
                  state: item.state,
                  urgency: item.urgency,
                }),
              ),
            ],
            [
              h.span([], [item.label]),
              h.small([], [String(pairCount(model, item.state, item.urgency))]),
            ],
          ),
        ),
      ),
      h.button(
        [
          h.Class('custom-filter-toggle'),
          h.AriaExpanded(model.filters),
          h.OnClick(Message.ToggledFilters()),
        ],
        [model.filters ? 'Close custom filters' : 'Custom filters'],
      ),
      model.filters
        ? h.div(
            [h.Class('custom-filter-controls')],
            [hybridStatus(model, h), hybridUrgency(model, h)],
          )
        : h.empty,
    ],
  )
const hybridSidebar = (model: Model, h: H) =>
  h.aside(
    [h.Class('sidebar variant-hybrid')],
    [
      h.div(
        [h.Class('rail-wrapper')],
        [h.div([h.Class('rail-brand')], ['gf']), nav(model, true, h)],
      ),
      h.div(
        [h.Class('hybrid-question-pane')],
        [
          h.div(
            [h.Class('hybrid-workspace')],
            [
              h.strong([], ['Squad questions']),
              h.a([h.Href('./?variant=B')], ['Earlier studies']),
            ],
          ),
          h.div(
            [h.Class('question-controls hybrid-controls')],
            [
              h.div(
                [h.Class('question-heading')],
                [
                  h.strong([], ['Questions']),
                  h.small([], [String(model.count)]),
                  model.variant === 'G' ? h.empty : grouping(model, h),
                ],
              ),
              search(model, h),
              model.variant === 'E'
                ? h.div(
                    [h.Class('direct-filters')],
                    [hybridStatus(model, h), hybridUrgency(model, h)],
                  )
                : model.variant === 'F'
                  ? filterGrid(model, h)
                  : presetFilters(model, h),
              h.p(
                [h.Class('filter-readout')],
                [
                  h.strong(
                    [],
                    [`${visible(model).filter(q => inScope(model, q)).length}`],
                  ),
                  ` match · ${model.state === 'All' ? 'All states' : model.state} · ${urgencyNames[model.urgency]}`,
                ],
              ),
            ],
          ),
          h.div(
            [h.Class('round-browser hybrid-browser')],
            [
              h.nav(
                [
                  h.Class('round-rail'),
                  h.AriaLabel(
                    model.variant === 'G' ? 'Choose a round' : 'Choose a group',
                  ),
                ],
                [
                  h.button(
                    [
                      h.Class(model.scope === 'all' ? 'active' : ''),
                      h.OnClick(Message.SelectedScope({ scope: 'all' })),
                    ],
                    [
                      model.variant === 'G' ? 'All rounds' : 'All groups',
                      h.small([], [`${visible(model).length} match`]),
                    ],
                  ),
                  ...Array.makeBy(4, key =>
                    h.button(
                      [
                        h.Class(model.scope === String(key) ? 'active' : ''),
                        h.OnClick(
                          Message.SelectedScope({ scope: String(key) }),
                        ),
                      ],
                      [
                        h.span(
                          [h.Class('round-label')],
                          [
                            model.variant === 'G'
                              ? roundName(key)
                              : model.grouping === 'Round'
                                ? `Round ${key + 1}`
                                : (agents[key] ?? 'Agent'),
                            h.small(
                              [],
                              [
                                String(
                                  visible(model).filter(
                                    q => groupKey(model, q) === String(key),
                                  ).length,
                                ),
                              ],
                            ),
                          ],
                        ),
                        model.variant === 'G'
                          ? h.empty
                          : h.small(
                              [],
                              [
                                model.grouping === 'Round'
                                  ? (rounds[key] ?? '')
                                  : 'Agent questions',
                              ],
                            ),
                      ],
                    ),
                  ),
                ],
              ),
              questionList(model, true, h),
            ],
          ),
        ],
      ),
    ],
  )

const questionContent = (model: Model, h: H) => {
  const q =
    questions(model.count).find(item => item.id === model.selected) ??
    questions(model.count)[0]!
  return h.article(
    [h.Class('question-content')],
    [
      h.div(
        [h.Class('question-meta')],
        [
          `Q${q.id}`,
          h.a(
            [
              h.Href('https://linear.app/rbrtbn/issue/LAB-1310'),
              h.Target('_blank'),
            ],
            ['LAB-1310'],
          ),
          `${agents[q.agent]} · Round ${q.round + 1}`,
          h.span(
            [h.Class('question-state')],
            [mark(model, q, h), stateOf(model, q)],
          ),
        ],
      ),
      h.h1(
        [],
        [
          q.title === 'Night grant for the runs'
            ? 'Which work can the squad continue without you tonight?'
            : q.title,
        ],
      ),
      h.p(
        [h.Class('question-intro')],
        [
          'Choose the scope for the next run. Safety decisions and merges still come back to you.',
        ],
      ),
      h.div(
        [h.Class('answers')],
        [
          h.button(
            [
              h.OnClick(Message.SelectedAnswer()),
              h.Class(model.drafts.includes(q.id) ? 'chosen' : ''),
            ],
            [
              h.span([h.Class('option-letter')], ['a']),
              h.div(
                [],
                [
                  h.strong([], ['Continue with the agreed scope']),
                  h.small([], ['Recommended']),
                  h.p(
                    [],
                    [
                      'The run can move ahead within the existing boundaries. New safety questions still wait for you.',
                    ],
                  ),
                ],
              ),
            ],
          ),
          h.button(
            [h.OnClick(Message.SelectedAnswer())],
            [
              h.span([h.Class('option-letter')], ['b']),
              h.div(
                [],
                [
                  h.strong([], ['Review each change first']),
                  h.p(
                    [],
                    [
                      'The run stops at each decision and asks you before moving on.',
                    ],
                  ),
                ],
              ),
            ],
          ),
          h.button(
            [h.OnClick(Message.SelectedAnswer())],
            [
              h.span([h.Class('option-letter')], ['?']),
              h.div(
                [],
                [
                  h.strong([], ['My own answer']),
                  h.p([], ['A different choice, in your words.']),
                ],
              ),
            ],
          ),
        ],
      ),
      h.div(
        [h.Class('answer-actions')],
        [
          h.button([h.OnClick(Message.ToggledDiscussion())], ['Discuss']),
          h.span([], ['Example answers stay in this prototype']),
        ],
      ),
      h.section(
        [h.Class('reasoning')],
        [
          h.h2([], ['Why this question']),
          h.p(
            [],
            [
              'The squad can keep working while you are away, but it needs a clear boundary. The first choice keeps routine work moving; the second gives you a checkpoint before every change.',
            ],
          ),
          h.p(
            [],
            [
              'Use the sidebar to find what is blocking now, return to a draft, or review a completed round. The question and discussion layouts stay the same across these sidebar studies.',
            ],
          ),
        ],
      ),
    ],
  )
}
const overviewContent = (model: Model, h: H) =>
  h.article(
    [h.Class('question-content')],
    [
      h.h1([], [model.page]),
      h.p(
        [h.Class('question-intro')],
        [
          'Illustrative workspace content. Navigation remains available in every sidebar study.',
        ],
      ),
      ...['Waiting on your decision', 'Working now', 'Completed today'].map(
        (title, index) =>
          h.section(
            [h.Class('overview-section')],
            [
              h.h2([], [title]),
              h.p(
                [],
                [
                  index === 0
                    ? 'Design gates, grant wording, and the next release scope.'
                    : index === 1
                      ? 'Token efficiency, grant checks, and homelab lanes.'
                      : 'Seven merged changes; the next round is ready to review.',
                ],
              ),
            ],
          ),
      ),
    ],
  )
const view = (model: Model, h: H): Document => ({
  title: `${model.variant} · ${names[model.variant]} · Sidebar studies`,
  body: h.div(
    [
      h.Class(
        `prototype mode-${model.variant}${model.discussion ? ' discussion-open' : ''}`,
      ),
    ],
    [
      h.div(
        [h.Class('study-strip')],
        [
          h.strong(
            [],
            [
              isHybrid(model.variant)
                ? 'Hybrid sidebar studies'
                : 'Sidebar studies',
            ],
          ),
          h.span([], ['Illustrative data · simulated actions']),
          h.div(
            [],
            [30, 60, 135].map(count =>
              h.button(
                [
                  h.Class(model.count === count ? 'active' : ''),
                  h.OnClick(Message.SelectedSize({ count })),
                ],
                [`${count} questions`],
              ),
            ),
          ),
        ],
      ),
      h.header(
        [h.Class('topbar')],
        [
          h.strong([], ['Squad']),
          h.span(
            [],
            [
              model.page === 'Question'
                ? `Round ${questions(model.count).find(q => q.id === model.selected)?.round! + 1} · Q${model.selected}`
                : model.page,
            ],
          ),
          h.div(
            [],
            [
              h.button(
                [h.OnClick(Message.ToggledDiscussion())],
                ['Conversations'],
              ),
              h.button(
                [h.OnClick(Message.SelectedPage({ page: 'Needs you' }))],
                ['Replies'],
              ),
              h.button(
                [
                  h.Class('primary'),
                  h.OnClick(Message.SelectedState({ state: 'Draft' })),
                ],
                [
                  `Review & send · ${questions(model.count).filter(q => stateOf(model, q) === 'Draft').length}`,
                ],
              ),
            ],
          ),
        ],
      ),
      h.div(
        [h.Class('application')],
        [
          model.variant === 'A'
            ? variantA(model, h)
            : model.variant === 'B'
              ? variantB(model, h)
              : model.variant === 'C'
                ? variantC(model, h)
                : model.variant === 'D'
                  ? variantD(model, h)
                  : hybridSidebar(model, h),
          h.main(
            [h.Class('main-content')],
            [
              h.div(
                [h.Class('main-actions')],
                [
                  h.button(
                    [h.OnClick(Message.ToggledDiscussion())],
                    [model.discussion ? 'Close discussion' : 'Discuss'],
                  ),
                ],
              ),
              model.page === 'Question'
                ? questionContent(model, h)
                : overviewContent(model, h),
            ],
          ),
          model.discussion
            ? h.aside(
                [h.Class('discussion')],
                [
                  h.header(
                    [],
                    [
                      h.h2([], ['Discussion']),
                      h.button(
                        [h.OnClick(Message.ToggledDiscussion())],
                        ['Close'],
                      ),
                    ],
                  ),
                  h.p([h.Class('muted')], ['This question · Asking agent']),
                  h.div(
                    [h.Class('discussion-thread')],
                    [
                      h.small([], ['Agent']),
                      h.p([], ['What would help you decide?']),
                      h.p(
                        [],
                        [
                          'Opening this panel lets you judge how much reading space each sidebar leaves. This is a layout study; messages are not sent.',
                        ],
                      ),
                    ],
                  ),
                  h.label(
                    [],
                    [
                      'Ask about this question',
                      h.textarea([
                        h.Rows(4),
                        h.Placeholder('Simulated discussion…'),
                      ]),
                    ],
                  ),
                ],
              )
            : h.empty,
        ],
      ),
      h.footer(
        [
          h.Class(
            `prototype-switcher${isHybrid(model.variant) ? ' hybrid-switcher' : ''}`,
          ),
          h.AriaLabel('Choose sidebar prototype'),
        ],
        [
          h.button(
            [
              h.AriaLabel('Previous variant'),
              h.OnClick(Message.PressedVariantArrow({ direction: -1 })),
            ],
            ['←'],
          ),
          ...variantsFor(model).map(variant =>
            h.button(
              [
                h.Class(model.variant === variant ? 'active' : ''),
                h.AriaPressed(String(model.variant === variant)),
                h.OnClick(Message.SelectedVariant({ variant })),
              ],
              [`${variant} · ${names[variant]}`],
            ),
          ),
          h.button(
            [
              h.AriaLabel('Next variant'),
              h.OnClick(Message.PressedVariantArrow({ direction: 1 })),
            ],
            ['→'],
          ),
          h.p(
            [],
            [
              descriptions[model.variant],
              ` ${visible(model).filter(q => (model.variant !== 'D' && !isHybrid(model.variant)) || model.scope === 'all' || groupKey(model, q) === model.scope).length}/${model.count} match; ${model.state}; ${urgencyNames[model.urgency]}; by ${model.grouping.toLowerCase()}${(model.variant === 'D' || isHybrid(model.variant)) && model.scope !== 'all' ? `; ${groupName(model, Number(model.scope))}` : ''}.`,
            ],
          ),
        ],
      ),
    ],
  ),
})
const subscriptions = Subscription.make<Model, Message>()(entry => ({
  arrows: entry(
    {},
    {
      modelToDependencies: () => ({}),
      dependenciesToStream: () =>
        Dom.streamFromEventFilterMapPreventDefault({
          target: document,
          type: 'keydown',
          filterMapEvent: event =>
            !['ArrowLeft', 'ArrowRight'].includes(event.key) ||
            (event.target instanceof Element &&
              event.target.closest('input,textarea,select,[contenteditable]'))
              ? Option.none()
              : Option.some(
                  Message.PressedVariantArrow({
                    direction: event.key === 'ArrowLeft' ? -1 : 1,
                  }),
                ),
        }),
    },
  ),
}))
const hybridEntry = window.location.pathname.endsWith('hybrid.html')
const initialVariant = Schema.decodeUnknownOption(Variant)(
  new URLSearchParams(window.location.search).get('variant'),
)
Runtime.run(
  Runtime.makeApplication({
    Model,
    init: (): Update.Return<Model, Message> => ({
      model: {
        variant: Option.getOrElse(initialVariant, () =>
          hybridEntry ? 'E' : 'A',
        ),
        state: 'All',
        urgency: 'All',
        grouping: 'Round',
        page: 'Question',
        query: '',
        selected: 16,
        count: 60,
        scope:
          hybridEntry ||
          Option.exists(
            initialVariant,
            value => value === 'D' || isHybrid(value),
          )
            ? '1'
            : 'all',
        folded: ['0'],
        drafts: [],
        filters: false,
        discussion: false,
      },
    }),
    update,
    view,
    subscriptions,
    container: document.getElementById('root'),
    devTools: false,
  }),
)
