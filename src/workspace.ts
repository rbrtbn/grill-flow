import { Array, Option, Schema } from 'effect'
import { AsyncData } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

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

export const QUESTION_PAGE = 'question:'
export const REVIEW = 'review'
export const CONVERSATIONS = 'conversations'
export const REPLIES = 'replies'
export const NEEDS = 'needs-you'
export const SQUAD = 'squad'
export const GRILLS = 'grills'
export const RUN_TARGET = 'run'

export const QuestionFilter = Schema.Literals(['All', 'Open', 'Draft', 'Sent'])
export type QuestionFilter = typeof QuestionFilter.Type
export const QuestionUrgencyFilter = Schema.Literals([
  'All',
  'blocking',
  'soon',
  'wait',
  'fyi',
  'unspecified',
])
export type QuestionUrgencyFilter = typeof QuestionUrgencyFilter.Type

export const questionFilterFrom = (value: unknown): QuestionFilter => {
  const result = Schema.decodeUnknownResult(QuestionFilter)(value)
  return result._tag === 'Success' ? result.success : 'All'
}

export const questionUrgencyFilterFrom = (
  value: unknown,
): QuestionUrgencyFilter => {
  const result = Schema.decodeUnknownResult(QuestionUrgencyFilter)(value)
  return result._tag === 'Success' ? result.success : 'All'
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
  catalog: CatalogData.schema,
  workSection: WorkSection,
  noteOpen: Schema.Array(Schema.String),
  reviewQuery: Schema.String,
  reviewExpanded: Schema.Array(Schema.String),
  filter: QuestionFilter,
  urgencyFilter: QuestionUrgencyFilter,
  grouping: QuestionGrouping,
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
})
export type Workspace = typeof Workspace.Type

export const initialWorkspace: Workspace = {
  catalog: CatalogData.Idle(),
  workSection: 'Now',
  noteOpen: [],
  reviewQuery: '',
  reviewExpanded: [],
  filter: 'All',
  urgencyFilter: 'All',
  grouping: 'Round',
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
}

export const isWorkspacePage = (page: string): boolean =>
  page.startsWith(QUESTION_PAGE) ||
  [
    REVIEW,
    CONVERSATIONS,
    REPLIES,
    NEEDS,
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

export const visibleQuestions = (
  workspace: Workspace,
  snapshot: Snapshot,
  answers: Answers,
  notes: Notes,
  own: Notes,
): ReadonlyArray<Step> => {
  const search = workspace.search.trim().toLocaleLowerCase()
  return snapshot.grill.steps.filter(
    step =>
      (workspace.filter !== 'Open' ||
        statusOf(snapshot.grill, answers, step.question.id)._tag !==
          'NotNeeded') &&
      (workspace.filter === 'All' ||
        questionState(snapshot, step, answers, notes, own) ===
          workspace.filter) &&
      (workspace.urgencyFilter === 'All' ||
        (workspace.urgencyFilter === 'unspecified'
          ? step.question.urgency === undefined
          : step.question.urgency === workspace.urgencyFilter)) &&
      (search === '' ||
        [
          step.question.id,
          step.question.title,
          step.question.ask,
          step.question.issue ?? '',
          questionAgent(snapshot.grill, step.question),
          roundLabel(snapshot.grill, roundOf(snapshot.grill, step.question)),
          step.heading,
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
    }),
    snapshot,
    answers,
    notes,
    own,
  ).find(item => item.steps.some(step => step.question.id === id))
  return modifyFields(workspace, {
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
