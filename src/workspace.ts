import { Array, Option, Schema } from 'effect'
import { AsyncData } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { ActivityCursors, ActivityFilter } from './activity'
import {
  type Answers,
  type Notes,
  OWN,
  Snapshot,
  type Step,
  isSent,
  questionAgent,
  questionSession,
  roundLabel,
  roundOf,
  sendableLines,
  statusOf,
} from './domain'
import { DECISION_PAGE, INBOX, ITEM_PAGE, RUNS, RUN_PAGE } from './inbox'
import { QuoteSelection } from './quote'
import { decidedLine } from './replies'

export const QUESTION_PAGE = 'question:'
export const REVIEW = 'review'
export const CONVERSATIONS = 'conversations'
export const REPLIES = 'replies'
export const UPDATES = 'updates'
export const ANSWER_HISTORY = 'answer-history'
export const CHANGES = 'changes'
export const NEEDS = 'needs-you'

// Retired pages and where their parts went; old links in messages land there.
export const RETIRED_PAGES: Readonly<Record<string, string>> = {
  [NEEDS]: 'inbox',
  [UPDATES]: 'runs',
  [CHANGES]: 'inbox',
  [REPLIES]: 'conversations',
}
export const SQUAD = 'squad'
export const GRILLS = 'grills'
export const RUN_TARGET = 'run'

export const QuestionFilter = Schema.Literals([
  'All',
  'Open',
  'Waiting',
  'Draft',
  'Sent',
])
export type QuestionFilter = typeof QuestionFilter.Type
export const QuestionUrgencyFilter = Schema.Literals([
  'All',
  'blocking',
  'soon',
  'wait',
  'fyi',
  'unspecified',
  'urgent',
])
export type QuestionUrgencyFilter = typeof QuestionUrgencyFilter.Type

export const questionFilterFrom = (value: unknown): QuestionFilter => {
  if (value === undefined) {
    return 'Open'
  }
  const result = Schema.decodeUnknownResult(QuestionFilter)(value)
  return result._tag === 'Success' ? result.success : 'All'
}

export const questionUrgencyFilterFrom = (
  value: unknown,
): QuestionUrgencyFilter => {
  const result = Schema.decodeUnknownResult(QuestionUrgencyFilter)(value)
  return result._tag === 'Success' ? result.success : 'All'
}
export const QuestionSort = Schema.Literals(['Urgency', 'Round', 'Recency'])
export type QuestionSort = typeof QuestionSort.Type
export const questionSortFrom = (value: unknown): QuestionSort => {
  const result = Schema.decodeUnknownResult(QuestionSort)(value)
  return result._tag === 'Success' ? result.success : 'Round'
}

export const QuestionGrouping = Schema.Literals(['Round', 'Agent'])

export const CatalogData = AsyncData.Schema(
  Schema.Array(Snapshot),
  Schema.String,
)
export const WorkSection = Schema.Literals([
  'Now',
  'Completed',
  'Later',
  'Sessions',
  'Dependencies',
])

export const Workspace = Schema.Struct({
  activityFilter: ActivityFilter,
  activityRead: ActivityCursors,
  catalog: CatalogData.schema,
  workSection: WorkSection,
  noteOpen: Schema.Array(Schema.String),
  reviewQuery: Schema.String,
  reviewExpanded: Schema.Array(Schema.String),
  filter: QuestionFilter,
  urgencyFilter: QuestionUrgencyFilter,
  grouping: QuestionGrouping,
  sort: QuestionSort,
  roundScopes: Schema.Record(Schema.String, Schema.Array(Schema.Number)),
  customFilters: Schema.Literals(['Collapsed', 'Expanded']),
  scopeRestoration: Schema.Literals(['Preserve', 'Reveal']),
  foldedAgents: Schema.Array(Schema.String),
  maybeEditingRound: Schema.Option(Schema.Number),
  roundNameDraft: Schema.String,
  foldedQuestions: Schema.Array(Schema.String),
  search: Schema.String,
  foldedRounds: Schema.Array(Schema.Number),
  expandedRounds: Schema.Array(Schema.Number),
  isSettingsOpen: Schema.Boolean,
  highlightTerms: Schema.Boolean,
  collapseSentRounds: Schema.Boolean,
  isDiscussionExpanded: Schema.Boolean,
  discussionRestored: Schema.Boolean,
  discussionScroll: Schema.Record(Schema.String, Schema.Number),
  maybeDiscussionTarget: Schema.Option(Schema.String),
  excluded: Schema.Array(Schema.String),
  quote: QuoteSelection,
})
export type Workspace = typeof Workspace.Type

export const initialWorkspace: Workspace = {
  activityFilter: 'Unread',
  activityRead: {},
  catalog: CatalogData.Idle(),
  workSection: 'Now',
  noteOpen: [],
  reviewQuery: '',
  reviewExpanded: [],
  filter: 'Open',
  urgencyFilter: 'All',
  grouping: 'Round',
  sort: 'Round',
  roundScopes: {},
  customFilters: 'Collapsed',
  scopeRestoration: 'Reveal',
  foldedAgents: [],
  maybeEditingRound: Option.none(),
  roundNameDraft: '',
  foldedQuestions: [],
  search: '',
  foldedRounds: [],
  expandedRounds: [],
  isSettingsOpen: false,
  highlightTerms: false,
  collapseSentRounds: true,
  isDiscussionExpanded: false,
  discussionRestored: false,
  discussionScroll: {},
  maybeDiscussionTarget: Option.none(),
  excluded: [],
  quote: QuoteSelection.Idle(),
}

export const isWorkspacePage = (page: string): boolean =>
  page.startsWith(QUESTION_PAGE) ||
  page.startsWith(RUN_PAGE) ||
  page.startsWith(ITEM_PAGE) ||
  page.startsWith(DECISION_PAGE) ||
  [
    INBOX,
    RUNS,
    REVIEW,
    CONVERSATIONS,
    ANSWER_HISTORY,
    SQUAD,
    GRILLS,
    'overview',
    'plan',
    'status',
    'decided',
  ].includes(page)

export const questionOnPage = (
  snapshot: Snapshot,
  page: string,
): Option.Option<Step> =>
  Array.findFirst(
    snapshot.grill.steps,
    step => `${QUESTION_PAGE}${step.question.id}` === page,
  )

const answerLineCache = new WeakMap<
  Snapshot,
  Readonly<{
    answers: Answers
    notes: Notes
    own: Notes
    lines: Readonly<Record<string, string>>
  }>
>()

// Sidebar rows share answer lines; immutable inputs avoid quadratic rendering work.
export const workspaceLines = (
  snapshot: Snapshot,
  answers: Answers,
  notes: Notes,
  own: Notes,
): Readonly<Record<string, string>> => {
  const cached = answerLineCache.get(snapshot)
  if (
    cached?.answers === answers &&
    cached.notes === notes &&
    cached.own === own
  ) {
    return cached.lines
  }
  const lines = sendableLines(snapshot.grill, answers, notes, own)
  answerLineCache.set(snapshot, { answers, notes, own, lines })
  return lines
}

export const questionState = (
  snapshot: Snapshot,
  step: Step,
  answers: Answers,
  notes: Notes,
  own: Notes,
): 'Open' | 'Draft' | 'Sent' => {
  const lines = workspaceLines(snapshot, answers, notes, own)
  const status = statusOf(snapshot.grill, answers, step.question.id)
  const key = answers[step.question.id]
  const valid =
    key === OWN || step.question.options.some(option => option.key === key)
  return status._tag !== 'Answered' || !valid
    ? 'Open'
    : isSent(snapshot.sent ?? {}, lines, step.question.id)
      ? 'Sent'
      : 'Draft'
}

export const roundScopesFrom = (
  value: unknown,
): Readonly<Record<string, ReadonlyArray<number>>> => {
  const result = Schema.decodeUnknownResult(
    Schema.Record(
      Schema.String,
      Schema.Union([Schema.Number, Schema.Array(Schema.Number)]),
    ),
  )(value)
  return result._tag === 'Success'
    ? Object.fromEntries(
        Object.entries(result.success).flatMap(([id, value]) => {
          const rounds = Array.dedupe(
            (typeof value === 'number' ? [value] : value).filter(
              round => Number.isSafeInteger(round) && round > 0,
            ),
          )
          return Array.isReadonlyArrayEmpty(rounds) ? [] : [[id, rounds]]
        }),
      )
    : {}
}

export const selectedRounds = (
  workspace: Workspace,
  snapshot: Snapshot,
): ReadonlyArray<number> =>
  (workspace.roundScopes[snapshot.grill.id] ?? []).filter(round =>
    snapshot.grill.steps.some(
      step => roundOf(snapshot.grill, step.question) === round,
    ),
  )

export const activeQuestionFilters = (
  workspace: Workspace,
  snapshot: Snapshot,
): number =>
  Number(Array.isReadonlyArrayNonEmpty(selectedRounds(workspace, snapshot))) +
  Number(workspace.urgencyFilter !== 'All') +
  Number(workspace.filter === 'Sent')

export const sidebarRoundName = (snapshot: Snapshot, round: number): string =>
  snapshot.grill.roundNames?.[String(round)]?.trim() ||
  `Round ${snapshot.grill.roundNumbers?.[String(round)] ?? round}`

export const quickViews: ReadonlyArray<{
  label: string
  filter: QuestionFilter
  urgencyFilter: QuestionUrgencyFilter
}> = [
  { label: 'Open', filter: 'Open', urgencyFilter: 'All' },
  { label: 'Waiting', filter: 'Waiting', urgencyFilter: 'All' },
  { label: 'Drafts', filter: 'Draft', urgencyFilter: 'All' },
  { label: 'All', filter: 'All', urgencyFilter: 'All' },
]

export const visibleQuestions = (
  workspace: Workspace,
  snapshot: Snapshot,
  answers: Answers,
  notes: Notes,
  own: Notes,
): ReadonlyArray<Step> => {
  const search = workspace.search.trim().toLocaleLowerCase()
  const rounds = selectedRounds(workspace, snapshot)
  return snapshot.grill.steps.filter(
    step =>
      (Array.isReadonlyArrayEmpty(rounds) ||
        rounds.includes(roundOf(snapshot.grill, step.question))) &&
      // Waiting narrows Open to the questions held behind another answer.
      (workspace.filter === 'Waiting'
        ? statusOf(snapshot.grill, answers, step.question.id)._tag === 'Waiting'
        : workspace.filter === 'All' ||
          (questionState(snapshot, step, answers, notes, own) ===
            workspace.filter &&
            (workspace.filter !== 'Open' ||
              statusOf(snapshot.grill, answers, step.question.id)._tag !==
                'NotNeeded'))) &&
      (workspace.urgencyFilter === 'All' ||
        (workspace.urgencyFilter === 'urgent'
          ? step.question.urgency === 'blocking' ||
            step.question.urgency === 'soon'
          : workspace.urgencyFilter === 'unspecified'
            ? step.question.urgency === undefined
            : step.question.urgency === workspace.urgencyFilter)) &&
      (search === '' ||
        [
          step.question.id,
          step.question.key ?? '',
          step.question.title,
          step.question.ask,
          step.question.issue ?? '',
          questionAgent(snapshot.grill, step.question),
          roundLabel(snapshot.grill, roundOf(snapshot.grill, step.question)),
          step.heading,
          decidedLine(snapshot, step) ?? '',
        ]
          .join(' ')
          .toLocaleLowerCase()
          .includes(search)),
  )
}

export const draftAnswerIds = (
  snapshot: Snapshot,
  answers: Answers,
  notes: Notes,
  own: Notes,
): ReadonlyArray<string> => {
  const lines = workspaceLines(snapshot, answers, notes, own)
  return Object.keys(lines).filter(
    id => !isSent(snapshot.sent ?? {}, lines, id),
  )
}

export const draftQuestions = (
  snapshot: Snapshot,
  answers: Answers,
  notes: Notes,
  own: Notes,
): ReadonlyArray<Step> =>
  snapshot.grill.steps.filter(
    step =>
      questionState(snapshot, step, answers, notes, own) === 'Draft' &&
      (answers[step.question.id] !== OWN ||
        (own[step.question.id] ?? '').trim() !== ''),
  )

export const answerLabel = (
  step: Step,
  answers: Answers,
  own: Notes,
): string =>
  answers[step.question.id] === OWN
    ? (own[step.question.id] ?? '')
    : (step.question.options.find(
        option => option.key === answers[step.question.id],
      )?.label ?? 'No answer yet')

export const roundIsCollapsed = (
  workspace: Workspace,
  snapshot: Snapshot,
  round: number,
  answers: Answers,
  notes: Notes,
  own: Notes,
): boolean =>
  workspace.foldedRounds.includes(round) ||
  (workspace.collapseSentRounds &&
    !workspace.expandedRounds.includes(round) &&
    snapshot.grill.steps
      .filter(step => roundOf(snapshot.grill, step.question) === round)
      .every(
        step =>
          statusOf(snapshot.grill, answers, step.question.id)._tag ===
            'NotNeeded' ||
          questionState(snapshot, step, answers, notes, own) === 'Sent',
      ))

export type QuestionNode = Readonly<{
  step: Step
  children: ReadonlyArray<QuestionNode>
}>

export const questionParents = (
  snapshot: Snapshot,
  answers: Answers,
): ReadonlyMap<string, string> =>
  snapshot.grill.steps.reduce((parents, step) => {
    const question = step.question
    if (statusOf(snapshot.grill, answers, question.id)._tag === 'NotNeeded') {
      return parents
    }
    const closesCycle = (id: string): boolean => {
      if (id === question.id) {
        return true
      }
      const parent = parents.get(id)
      return parent === undefined ? false : closesCycle(parent)
    }
    const parent = Array.dedupe([
      ...question.dependsOn,
      ...question.when.map(condition => condition.question),
    ]).find(id => {
      const exists = snapshot.grill.steps.some(item => item.question.id === id)
      const status = statusOf(snapshot.grill, answers, id)._tag
      return (
        exists &&
        (status === 'Open' || status === 'Waiting') &&
        !closesCycle(id)
      )
    })
    return parent === undefined
      ? parents
      : new Map([...parents, [question.id, parent]])
  }, new Map<string, string>())

export const questionForest = (
  workspace: Workspace,
  snapshot: Snapshot,
  answers: Answers,
  notes: Notes,
  own: Notes,
): ReadonlyArray<QuestionNode> => {
  const visible = visibleQuestions(workspace, snapshot, answers, notes, own)
  const ids = new Set(visible.map(step => step.question.id))
  const parents = questionParents(snapshot, answers)
  const build = (step: Step): QuestionNode => ({
    step,
    children: visible
      .filter(child => parents.get(child.question.id) === step.question.id)
      .map(build),
  })
  return visible
    .filter(step => !ids.has(parents.get(step.question.id) ?? ''))
    .map(build)
}

export const flattenQuestions = (
  nodes: ReadonlyArray<QuestionNode>,
): ReadonlyArray<Step> =>
  nodes.flatMap(node => [node.step, ...flattenQuestions(node.children)])

export const questionGroups = (
  workspace: Workspace,
  snapshot: Snapshot,
  answers: Answers,
  notes: Notes,
  own: Notes,
) => {
  const roots = questionForest(workspace, snapshot, answers, notes, own)
  if (workspace.sort !== 'Round') {
    const numbered = snapshot.grill.steps.every(step =>
      /^Q\d+$/.test(step.question.id),
    )
    const position = (step: Step) => {
      const id = /^Q(\d+)$/.exec(step.question.id)
      return !numbered || id === null
        ? snapshot.grill.steps.indexOf(step)
        : Number(id[1])
    }
    const urgency = (step: Step) =>
      ({ blocking: 0, soon: 2, wait: 3, fyi: 4 })[
        step.question.urgency ?? 'blocking'
      ] + (step.question.urgency === undefined ? 1 : 0)
    const score = (node: QuestionNode): number => {
      const values = flattenQuestions([node]).map(
        workspace.sort === 'Urgency' ? urgency : position,
      )
      return workspace.sort === 'Urgency'
        ? Math.min(...values)
        : -Math.max(...values)
    }
    const sorted = (
      nodes: ReadonlyArray<QuestionNode>,
    ): ReadonlyArray<QuestionNode> =>
      [...nodes]
        .sort((a, b) => score(a) - score(b))
        .map(node => ({ step: node.step, children: sorted(node.children) }))
    const nodes = sorted(roots)
    return [
      {
        key: 'sorted',
        section: undefined,
        label: workspace.sort,
        steps: flattenQuestions(nodes),
        roots: nodes,
        collapsed: false,
      },
    ]
  }
  const keyOf = (step: Step) =>
    workspace.grouping === 'Agent'
      ? questionSession(snapshot.grill, step.question)
      : String(roundOf(snapshot.grill, step.question))
  const keys = Array.dedupe(snapshot.grill.steps.map(keyOf)).filter(key =>
    roots.some(node => keyOf(node.step) === key),
  )
  const sections = Array.dedupe(
    snapshot.grill.steps.map(
      step =>
        snapshot.grill.roundSections?.[
          String(roundOf(snapshot.grill, step.question))
        ],
    ),
  )
  const ordered =
    workspace.grouping === 'Round' && snapshot.grill.roundSections !== undefined
      ? keys.sort(
          (a, b) =>
            sections.indexOf(snapshot.grill.roundSections?.[a]) -
              sections.indexOf(snapshot.grill.roundSections?.[b]) ||
            (snapshot.grill.roundNumbers?.[a] ?? Number(a)) -
              (snapshot.grill.roundNumbers?.[b] ?? Number(b)),
        )
      : workspace.grouping === 'Round'
        ? keys.sort((a, b) => Number(a) - Number(b))
        : keys
  return ordered.map(key => {
    const nodes = roots.filter(node => keyOf(node.step) === key)
    const steps = flattenQuestions(nodes)
    const first = nodes[0]?.step
    return {
      key,
      section:
        workspace.grouping === 'Round'
          ? snapshot.grill.roundSections?.[key]
          : undefined,
      label:
        workspace.grouping === 'Agent'
          ? questionAgent(snapshot.grill, first?.question)
          : roundLabel(snapshot.grill, Number(key), false),
      steps,
      roots: nodes,
      collapsed:
        workspace.grouping === 'Agent'
          ? workspace.foldedAgents.includes(key)
          : roundIsCollapsed(
              workspace,
              snapshot,
              Number(key),
              answers,
              notes,
              own,
            ),
    }
  })
}

export const revealQuestion = (
  workspace: Workspace,
  snapshot: Snapshot,
  answers: Answers,
  notes: Notes,
  own: Notes,
  id: string,
): Workspace => {
  const parents = questionParents(snapshot, answers)
  const ancestry = (child: string): ReadonlyArray<string> => {
    const parent = parents.get(child)
    return parent === undefined ? [] : [parent, ...ancestry(parent)]
  }
  const ancestors = new Set(ancestry(id))
  const group = questionGroups(
    modifyFields(workspace, {
      filter: () => 'All',
      urgencyFilter: () => 'All',
      search: () => '',
      sort: () => 'Round',
      roundScopes: () => ({}),
    }),
    snapshot,
    answers,
    notes,
    own,
  ).find(item => item.steps.some(step => step.question.id === id))
  const target = snapshot.grill.steps.find(step => step.question.id === id)
  return modifyFields(workspace, {
    roundScopes: scopes => {
      const selected = selectedRounds(workspace, snapshot)
      return Array.isReadonlyArrayNonEmpty(selected) && target !== undefined
        ? {
            ...scopes,
            [snapshot.grill.id]: Array.dedupe([
              ...selected,
              roundOf(snapshot.grill, target.question),
            ]),
          }
        : scopes
    },
    foldedQuestions: ids => ids.filter(item => !ancestors.has(item)),
    foldedAgents: ids =>
      workspace.grouping === 'Agent'
        ? ids.filter(item => item !== group?.key)
        : ids,
    foldedRounds: rounds =>
      workspace.grouping === 'Round'
        ? rounds.filter(round => round !== Number(group?.key))
        : rounds,
    expandedRounds: rounds =>
      workspace.grouping === 'Round' && group !== undefined
        ? Array.dedupe([...rounds, Number(group.key)])
        : rounds,
  })
}

export const adjacentQuestion = (
  workspace: Workspace,
  snapshot: Snapshot,
  answers: Answers,
  notes: Notes,
  own: Notes,
  page: string,
  direction: 'Previous' | 'Next',
): Option.Option<Step> => {
  const displayed = questionGroups(
    workspace,
    snapshot,
    answers,
    notes,
    own,
  ).flatMap(group => group.steps)
  const ordered = displayed.some(
    step => `${QUESTION_PAGE}${step.question.id}` === page,
  )
    ? displayed
    : questionGroups(
        modifyFields(workspace, {
          filter: () => 'All',
          urgencyFilter: () => 'All',
          search: () => '',
          roundScopes: () => ({}),
        }),
        snapshot,
        answers,
        notes,
        own,
      ).flatMap(group => group.steps)
  const index = ordered.findIndex(
    step => `${QUESTION_PAGE}${step.question.id}` === page,
  )
  if (index < 0) {
    return Option.none()
  }
  const visible = new Set(
    visibleQuestions(workspace, snapshot, answers, notes, own).map(
      step => step.id,
    ),
  )
  const candidates =
    direction === 'Next'
      ? ordered.slice(index + 1)
      : Array.reverse(ordered.slice(0, index))
  return Array.findFirst(candidates, step => visible.has(step.id))
}
