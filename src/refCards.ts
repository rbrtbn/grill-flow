import { Array } from 'effect'

import {
  type Snapshot,
  questionSession,
  roundLabel,
  roundOf,
  statusOf,
} from './domain'
import { ITEM_PAGE, type InboxData, NAMES, RUN_PAGE } from './inbox'
import { SESSION_PROFILES } from './inboxFixture'
import { ago } from './inboxView'
import type { Model } from './main'
import type { RefCard } from './refCard'
import { sessionRowOf } from './sessionsView'
import { QUESTION_PAGE, sidebarRoundName } from './workspace'

const entry = (label: string, value: string): readonly [string, string] => [
  label,
  value,
]

const TASK_STATES: Readonly<Record<string, string>> = {
  Open: 'On you',
  Promised: NAMES.promised,
  Reported: NAMES.confirming,
  Completed: 'Done',
  Withdrawn: 'Withdrawn',
}

export const sessionCard = (
  model: Model,
  snapshot: Snapshot,
  inbox: InboxData,
  address: string,
): RefCard => {
  const row = sessionRowOf(model, snapshot, inbox, address)
  const profile = model.inbox.isFixture ? SESSION_PROFILES[address] : undefined
  const now = model.now === 0 ? (snapshot.channelNow ?? 0) : model.now
  if (row === undefined) {
    return { kind: 'Session', id: address, title: address, rows: [] }
  }
  return {
    kind: 'Session',
    id: address,
    title: row.name,
    subtitle: `${row.address} · ${row.role}`,
    rows: [
      ...(row.work.issue === undefined && row.work.work === undefined
        ? []
        : [
            entry(
              'Work',
              [row.work.issue?.id, row.work.work].filter(Boolean).join(' · '),
            ),
          ]),
      ...(row.work.pr === undefined
        ? []
        : [entry('PR', `#${row.work.pr.number} · ${row.work.pr.state}`)]),
      entry(
        'State',
        row.isClosed
          ? 'Closed'
          : row.isDone
            ? 'Done'
            : row.isLive
              ? 'Running'
              : 'Idle',
      ),
      ...(row.lastAt === 0 ? [] : [entry('Last active', ago(now, row.lastAt))]),
      ...(profile === undefined
        ? []
        : [
            entry('Model', profile.model),
            entry('Effort', profile.effort),
            entry('Subagents', profile.subagents ? 'Yes' : 'No'),
          ]),
    ],
    ...(profile === undefined
      ? {}
      : { sampleNote: 'Model, effort and subagents are preview samples.' }),
    page: { label: `${NAMES.runs} ›`, page: `${RUN_PAGE}${row.address}` },
  }
}

export const roundCard = (
  model: Model,
  snapshot: Snapshot,
  round: number,
): RefCard => {
  const grill = snapshot.grill
  const steps = grill.steps.filter(
    step => roundOf(grill, step.question) === round,
  )
  const answered = steps.filter(
    step =>
      statusOf(grill, model.answers, step.question.id, model.skipped)._tag ===
      'Answered',
  ).length
  const section = grill.roundSections?.[String(round)]
  const askers = Array.dedupe(
    steps.map(step => questionSession(grill, step.question)),
  )
  return {
    kind: 'Round',
    id: String(round),
    title: `${section === undefined ? '' : `${section} · `}${sidebarRoundName(snapshot, round)}`,
    subtitle: roundLabel(grill, round),
    rows: [
      ['Open', String(steps.length - answered)],
      ['Answered', String(answered)],
      ['Asked by', askers.join(', ')],
    ],
  }
}

/** A Linear issue or pull request named on the page, as its refs record it. */
export const linkCard = (snapshot: Snapshot, key: string): RefCard => {
  const ref = snapshot.grill.refs?.[key]
  return {
    kind: ref?.type === 'pr' || key.includes('#') ? 'PR' : 'Issue',
    id: key,
    title: ref?.text ?? key,
    subtitle: key,
    rows: ref?.state === undefined ? [] : [['State', ref.state]],
    ...(ref?.url === undefined ? {} : { href: ref.url }),
  }
}

export const keyCard = (
  model: Model,
  snapshot: Snapshot,
  key: string,
): RefCard => {
  const step = snapshot.grill.steps.find(item => item.question.key === key)
  if (step === undefined) {
    return { kind: 'Key', id: key, title: key, rows: [] }
  }
  const state = statusOf(
    snapshot.grill,
    model.answers,
    step.question.id,
    model.skipped,
  )
  return {
    kind: 'Key',
    id: key,
    title: step.question.title,
    subtitle: `${key} · ${step.question.id}`,
    rows: [['State', state._tag]],
    page: {
      label: 'Open question ›',
      page: `${QUESTION_PAGE}${step.question.id}`,
    },
  }
}

export const taskCard = (inbox: InboxData, id: string): RefCard => {
  const task = inbox.tasks.find(item => item.id === id)
  return task === undefined
    ? { kind: 'Task', id, title: id, rows: [] }
    : {
        kind: 'Task',
        id,
        title: task.title,
        subtitle: `${task.session} · ${task.host}`,
        rows: [['State', TASK_STATES[task.state._tag] ?? task.state._tag]],
        page: { label: 'Open task ›', page: `${ITEM_PAGE}${id}` },
        ...(task.destination._tag === 'Link'
          ? { href: task.destination.url }
          : {}),
      }
}
