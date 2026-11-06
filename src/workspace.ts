import { Array, Option, Schema } from 'effect'

import {
  type Answers,
  type Notes,
  OWN,
  type Snapshot,
  type Step,
  answerLines,
  isSent,
  statusOf,
} from './domain'

export const QUESTION_PAGE = 'question:'
export const REVIEW = 'review'
export const CONVERSATIONS = 'conversations'
export const REPLIES = 'replies'
export const NEEDS = 'needs-you'
export const RUN_TARGET = 'run'

export const QuestionFilter = Schema.Literals(['All', 'Open', 'Draft', 'Sent'])
export type QuestionFilter = typeof QuestionFilter.Type

export const Workspace = Schema.Struct({
  filter: QuestionFilter,
  search: Schema.String,
  foldedRounds: Schema.Array(Schema.Number),
  expandedRounds: Schema.Array(Schema.Number),
  isSettingsOpen: Schema.Boolean,
  highlightTerms: Schema.Boolean,
  collapseSentRounds: Schema.Boolean,
  isDiscussionExpanded: Schema.Boolean,
  maybeDiscussionTarget: Schema.Option(Schema.String),
  excluded: Schema.Array(Schema.String),
})
export type Workspace = typeof Workspace.Type

export const initialWorkspace: Workspace = {
  filter: 'All',
  search: '',
  foldedRounds: [],
  expandedRounds: [],
  isSettingsOpen: false,
  highlightTerms: true,
  collapseSentRounds: true,
  isDiscussionExpanded: false,
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

export const workspaceLines = (
  snapshot: Snapshot,
  answers: Answers,
  notes: Notes,
  own: Notes,
) => answerLines(snapshot.grill, answers, notes, own, snapshot.grill.steps)

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
      (search === '' ||
        [
          step.question.id,
          step.question.title,
          step.question.ask,
          step.question.issue ?? '',
          step.heading,
        ]
          .join(' ')
          .toLocaleLowerCase()
          .includes(search)),
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
      .filter(step => (step.question.round ?? 1) === round)
      .every(
        step =>
          statusOf(snapshot.grill, answers, step.question.id)._tag ===
            'NotNeeded' ||
          questionState(snapshot, step, answers, notes, own) === 'Sent',
      ))

export const adjacentQuestion = (
  workspace: Workspace,
  snapshot: Snapshot,
  answers: Answers,
  notes: Notes,
  own: Notes,
  page: string,
  direction: 'Previous' | 'Next',
): Option.Option<Step> => {
  const index = snapshot.grill.steps.findIndex(
    step => `${QUESTION_PAGE}${step.question.id}` === page,
  )
  if (index < 0) return Option.none()
  const visible = new Set(
    visibleQuestions(workspace, snapshot, answers, notes, own).map(
      step => step.id,
    ),
  )
  const candidates =
    direction === 'Next'
      ? snapshot.grill.steps.slice(index + 1)
      : Array.reverse(snapshot.grill.steps.slice(0, index))
  return Array.findFirst(candidates, step => visible.has(step.id))
}
