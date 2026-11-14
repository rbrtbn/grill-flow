import type { Database } from 'bun:sqlite'

import { answerHistory } from './answerReceipts'
import { discussionThreads } from './discussions'
import { grillRevisions } from './history'
import { readPage } from './squad'
import {
  events,
  getGrill,
  leadHandovers,
  retirementOf,
  snapshot,
  squadRegistrations,
} from './store'

// Exports are for retros and audits, the only reader of revision history besides gf history
// (docs/adr/0031, 0033); provider reference checks are polling noise, not the record.
const recordedEvents = (db: Database, grillId: string) =>
  events(db, grillId)
    .filter(event => event.kind !== 'reference-checked')
    .map(event => ({
      id: event.id,
      at: event.at,
      kind: event.kind,
      payload: JSON.parse(event.payload) as unknown,
    }))

const grillRecord = (db: Database, grillId: string) => {
  const grill = getGrill(db, grillId)!
  const state = snapshot(db, grill)
  return {
    id: grill.id,
    grill,
    revisions: grillRevisions(db, grill.id).map(revision => ({
      rev: revision.rev,
      parentRev: revision.parentRev,
      at: revision.at,
      author: revision.author,
      reason: revision.reason,
      json: revision.grill,
    })),
    discussions: discussionThreads(state),
    outcomes: state.grill.decided ?? [],
    answers: state.answers,
    notes: state.notes,
    own: state.own,
    sent: state.sent ?? {},
    sends: state.sends,
    replies: state.replies ?? [],
    answerHistory: answerHistory(db, [grill.id]),
    retirement: retirementOf(db, grill.id) ?? null,
    events: recordedEvents(db, grill.id),
  }
}

/**
 * One document with everything kept about a grill; for a composed squad page, each member
 * that is still stored (retired ones included) with its local-to-shared id mapping.
 */
export const exportGrill = (
  db: Database,
  id: string,
  now = Date.now(),
): object | undefined => {
  const exportedAt = new Date(now).toISOString()
  if (getGrill(db, id) !== undefined) {
    return { exportedAt, kind: 'grill', ...grillRecord(db, id) }
  }
  const page = readPage(db, id)
  if (page === undefined) {
    return undefined
  }
  const members = squadRegistrations(db, id).filter(
    registration => getGrill(db, registration.source) !== undefined,
  )
  return {
    exportedAt,
    kind: 'squad',
    page: {
      id,
      title: page.state.grill.title,
      session: page.state.grill.session,
      handovers: leadHandovers(db, id),
      mapping: members.map(registration => ({
        grill: registration.source,
        questions: registration.questions,
        rounds: registration.rounds,
      })),
      discussions: discussionThreads(snapshot(db, page.state.grill)),
      events: recordedEvents(db, id),
    },
    members: members.map(registration => grillRecord(db, registration.source)),
  }
}
