import { Array, Option, pipe } from 'effect'

import {
  type Grill,
  type Snapshot,
  type Step,
  questionAgent,
  roundLabel,
  roundOf,
} from './domain'
import { draftQuestions } from './workspace'

type Answers = Readonly<Record<string, string>>
type Notes = Readonly<Record<string, string>>

// How long a one-click send waits in the browser before the page freezes and delivers it.
// Undo is honest only inside this window: nothing has left the page yet (docs/adr/0035).
export const HOLD_SECONDS = 5

// A quiet spell after the last answer edit, after which ready drafts nudge from the header.
export const IDLE_NUDGE_SECONDS = 60

// Drafts a one-click send can carry, in page order: answered, with any own answer written.
export const unsentSteps = (
  snapshot: Snapshot,
  answers: Answers,
  notes: Notes,
  own: Notes,
): ReadonlyArray<Step> => draftQuestions(snapshot, answers, notes, own)

// Unsent drafts minus the ones the reader keeps back; these count, nudge and send by default.
export const readySteps = (
  snapshot: Snapshot,
  answers: Answers,
  notes: Notes,
  own: Notes,
  keptBack: ReadonlyArray<string>,
): ReadonlyArray<Step> =>
  unsentSteps(snapshot, answers, notes, own).filter(
    step => !keptBack.includes(step.question.id),
  )

export type RoundDrafts = Readonly<{
  round: number
  label: string
  steps: ReadonlyArray<Step>
}>

// Newest round first, the order the reader is most likely working in.
export const byRound = (
  grill: Grill,
  steps: ReadonlyArray<Step>,
): ReadonlyArray<RoundDrafts> =>
  pipe(
    Array.dedupe(steps.map(step => roundOf(grill, step.question))),
    rounds => [...rounds].sort((a, b) => b - a),
    Array.map(round => ({
      round,
      label: roundLabel(grill, round),
      steps: steps.filter(step => roundOf(grill, step.question) === round),
    })),
  )

export const roundSteps = (
  grill: Grill,
  steps: ReadonlyArray<Step>,
  round: number,
): ReadonlyArray<Step> =>
  steps.filter(step => roundOf(grill, step.question) === round)

const plural = (count: number, word: string): string =>
  `${count} ${word}${count === 1 ? '' : 's'}`

// "2 answers to Grant checks · t2k4 · 1 answer to Homelab lanes · t2m1": one entry per
// recipient, since each asking session gets its own message (docs/adr/0005).
export const recipientSummary = (
  grill: Grill,
  steps: ReadonlyArray<Step>,
): string =>
  pipe(
    Array.dedupe(steps.map(step => questionAgent(grill, step.question))),
    Array.map(
      agent =>
        `${plural(
          steps.filter(step => questionAgent(grill, step.question) === agent)
            .length,
          'answer',
        )} to ${agent}`,
    ),
    Array.join(' · '),
  )

export const answerCount = (count: number): string => plural(count, 'answer')

export const stepsOf = (
  grill: Grill,
  ids: ReadonlyArray<string>,
): ReadonlyArray<Step> =>
  grill.steps.filter(step => ids.includes(step.question.id))

export const stepOf = (grill: Grill, id: string): Option.Option<Step> =>
  Array.findFirst(grill.steps, step => step.question.id === id)

// The tray's row order, which its keyboard cursor indexes.
export const trayOrder = (
  grill: Grill,
  steps: ReadonlyArray<Step>,
): ReadonlyArray<Step> => byRound(grill, steps).flatMap(group => group.steps)
