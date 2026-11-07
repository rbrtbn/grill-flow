import type { Database } from 'bun:sqlite'
import { Schema } from 'effect'

import { Compare } from '../src/diagram'
import {
  type Grill,
  type Snapshot,
  Plan,
  sendableLines,
  questionSession,
  roundOf,
} from '../src/domain'
import { sendAnswerBatches, type SessionSender } from './delivery'
import { selectSend, type SendSelection } from './sendSelection'
import {
  appendEvent,
  getGrill,
  listGrills,
  snapshot,
  squadRegistrations,
  type SquadRegistration,
} from './store'

type Member = Readonly<{
  state: Snapshot
  registration: SquadRegistration
}>
export type Page = Readonly<{
  state: Snapshot
  members: ReadonlyArray<Member>
}>

const scope = (source: string, id: string): string => `${source}::${id}`
const mapText = (
  text: string,
  questions: Readonly<Record<string, string>>,
): string => text.replace(/https?:\/\/\S+|\bQ\d+\b/g, id => questions[id] ?? id)

const mapStructured = (
  value: unknown,
  questions: Readonly<Record<string, string>>,
): unknown =>
  JSON.parse(
    JSON.stringify(value, (_key, value) =>
      typeof value === 'string' ? mapText(value, questions) : value,
    ),
  )

const membersOf = (db: Database, id: string): ReadonlyArray<Member> => {
  const registrations = squadRegistrations(db, id)
  return registrations
    .flatMap(registration => {
      const grill = getGrill(db, registration.source)
      return grill?.squad?.id === id
        ? [{ state: snapshot(db, grill), registration }]
        : []
    })
    .sort(
      (a, b) =>
        Number(b.state.grill.squad?.lead === true) -
        Number(a.state.grill.squad?.lead === true),
    )
}

const targetFor = (grill: Grill, target: string): string => {
  if (target.startsWith('part:'))
    return `part:${scope(grill.id, target.slice(5))}`
  if (target === 'run') return `part:${scope(grill.id, 'run')}`
  return target === 'grill-flow' || target.startsWith('card:')
    ? target
    : scope(grill.id, target)
}

export const readPage = (db: Database, id: string): Page | undefined => {
  const direct = getGrill(db, id)
  if (direct !== undefined) return { state: snapshot(db, direct), members: [] }
  const members = membersOf(db, id)
  const leadMember = members.find(member => member.state.grill.squad?.lead)
  const lead = leadMember?.state.grill
  const leadQuestions = leadMember?.registration.questions ?? {}
  if (members.length === 0) return undefined
  const sections = members.flatMap(({ state, registration }) => {
    const grill = state.grill
    const questions = registration.questions
    const map = (text: string) => mapText(text, questions)
    const section = grill.squad!.section
    const sourceKey = scope(grill.id, 'member')
    const steps = grill.steps.map(step => ({
      ...step,
      id: scope(grill.id, step.id),
      part: scope(grill.id, step.part),
      heading: map(step.heading),
      prose: step.prose.map(map),
      question: {
        ...step.question,
        ...(step.question.compare === undefined
          ? {}
          : {
              compare: Schema.decodeUnknownSync(Compare)(
                mapStructured(step.question.compare, questions),
              ),
            }),
        id: questions[step.question.id]!,
        title: map(step.question.title),
        ask: map(step.question.ask),
        scope: map(step.question.scope),
        options: step.question.options.map(option => ({
          ...option,
          label: map(option.label),
          effect: map(option.effect),
        })),
        dependsOn: step.question.dependsOn.map(
          question => questions[question] ?? question,
        ),
        when: step.question.when.map(condition => ({
          ...condition,
          question: questions[condition.question] ?? condition.question,
        })),
        round: registration.rounds[String(roundOf(grill, step.question))]!,
        session: questionSession(grill, step.question),
        from:
          step.question.from === undefined
            ? sourceKey
            : scope(grill.id, step.question.from),
        row: step.question.row ?? `${grill.id}/${step.question.id}`,
      },
    }))
    const priority = grill.squad?.lead ? grill.squad.openForYou : undefined
    return [
      {
        grill,
        state,
        steps: [
          ...steps.filter(step => step.id === scope(grill.id, priority ?? '')),
          ...steps.filter(step => step.id !== scope(grill.id, priority ?? '')),
        ],
        parts: [
          {
            id: scope(grill.id, 'run'),
            title: section,
            summary: grill.intro.map(map).join('\n\n'),
          },
          ...grill.parts.map(part => ({
            ...part,
            id: scope(grill.id, part.id),
            title: `${section} · ${part.title}`,
            summary: map(part.summary),
          })),
        ],
        roundNames: Object.fromEntries(
          Object.entries(registration.rounds).map(([local, shared]) => [
            shared,
            grill.roundNames?.[local] ?? '',
          ]),
        ),
        roundNumbers: Object.fromEntries(
          Object.entries(registration.rounds).map(([local, shared]) => [
            shared,
            Number(local),
          ]),
        ),
        roundSections: Object.fromEntries(
          Object.values(registration.rounds).map(round => [round, section]),
        ),
        sources: {
          [sourceKey]: {
            text: section,
            link: `/g/${encodeURIComponent(grill.id)}`,
          },
          ...Object.fromEntries(
            Object.entries(grill.sources ?? {}).map(([key, source]) => [
              scope(grill.id, key),
              source,
            ]),
          ),
        },
        answers: Object.fromEntries(
          Object.entries(state.answers).map(([key, value]) => [
            questions[key],
            value,
          ]),
        ),
        notes: Object.fromEntries(
          Object.entries(state.notes).map(([key, value]) => [
            questions[key],
            value,
          ]),
        ),
        own: Object.fromEntries(
          Object.entries(state.own).map(([key, value]) => [
            questions[key],
            value,
          ]),
        ),
        sent: Object.fromEntries(
          Object.entries(state.sent ?? {}).map(([key, value]) => [
            questions[key],
            value.replace(/^Q\d+/, key => questions[key] ?? key),
          ]),
        ),
        asks: state.asks.map(ask => ({
          ...ask,
          stepId: targetFor(grill, ask.stepId),
          text: ask.text,
        })),
        revisions: state.revisions.map(revision => ({
          ...revision,
          stepId: targetFor(grill, revision.stepId),
          text: map(revision.text),
        })),
        replies: (state.replies ?? []).map(reply => ({
          ...reply,
          text: `${section}:\n\n${map(reply.text)}`,
        })),
        activeRound: registration.rounds[String(grill.round)],
      },
    ]
  })
  const merge = <T>(
    records: ReadonlyArray<Readonly<Record<string, T>>>,
  ): Record<string, T> => Object.assign({}, ...records)
  const grill: Grill = {
    version: 4,
    id,
    title: `${id === 'squad' ? 'Squad' : id} · Open for you`,
    squad: {
      id,
      section: 'Squad',
      ...(lead?.squad?.openForYou === undefined
        ? {}
        : { openForYou: scope(lead.id, lead.squad.openForYou) }),
    },
    kind: 'squad',
    session: lead?.session ?? '',
    round: Math.max(
      1,
      ...sections.flatMap(section =>
        section.activeRound === undefined ? [] : [section.activeRound],
      ),
    ),
    activeRounds: sections.flatMap(section =>
      section.activeRound === undefined ? [] : [section.activeRound],
    ),
    roundNames: merge(sections.map(section => section.roundNames)),
    roundSections: merge(sections.map(section => section.roundSections)),
    roundNumbers: merge(sections.map(section => section.roundNumbers)),
    entities: sections.flatMap(section => section.grill.entities),
    terms: sections.flatMap(section => section.grill.terms),
    intro: lead?.intro.map(text => mapText(text, leadQuestions)) ?? [
      'Questions and discussions from every squad member, in one place.',
    ],
    parts: sections.flatMap(section => section.parts),
    steps: sections.flatMap(section => section.steps),
    next: sections.flatMap(section =>
      section.grill.next.map(
        text =>
          `${section.grill.squad!.section}: ${mapText(text, members.find(member => member.state.grill.id === section.grill.id)!.registration.questions)}`,
      ),
    ),
    refs: merge(sections.map(section => section.grill.refs ?? {})),
    sources: merge(sections.map(section => section.sources)),
    decided: sections.flatMap(section =>
      (section.grill.decided ?? []).map(decision => ({
        ...decision,
        id: scope(section.grill.id, decision.id),
        text: mapText(
          decision.text,
          members.find(member => member.state.grill.id === section.grill.id)!
            .registration.questions,
        ),
      })),
    ),
    ...(lead?.plan === undefined
      ? {}
      : {
          plan: Schema.decodeUnknownSync(Plan)(
            mapStructured(lead.plan, leadQuestions),
          ),
        }),
  }
  const root = snapshot(db, grill)
  return {
    members,
    state: {
      ...root,
      answers: merge(sections.map(section => section.answers)),
      notes: merge(sections.map(section => section.notes)),
      own: merge(sections.map(section => section.own)),
      sent: merge(sections.map(section => section.sent)),
      asks: [...root.asks, ...sections.flatMap(section => section.asks)].sort(
        (a, b) => a.id - b.id,
      ),
      revisions: [
        ...root.revisions,
        ...sections.flatMap(section => section.revisions),
      ].sort((a, b) => a.id - b.id),
      replies: [
        ...(root.replies ?? []),
        ...sections.flatMap(section => section.replies),
      ].sort((a, b) => a.id - b.id),
      sends: [
        ...root.sends,
        ...sections.flatMap(section => section.state.sends),
      ].sort((a, b) => a.at - b.at),
    },
  }
}

export const listPages = (db: Database) => {
  const direct = listGrills(db)
  const ids = [
    ...new Set(
      direct.flatMap(({ id }) => {
        const squad = getGrill(db, id)?.squad
        return squad === undefined ? [] : [squad.id]
      }),
    ),
  ]
  return [
    ...ids.map(id => ({
      id,
      title: readPage(db, id)!.state.grill.title,
      loadedAt: Math.max(
        ...direct
          .filter(row => getGrill(db, row.id)?.squad?.id === id)
          .map(row => row.loadedAt),
      ),
    })),
    ...direct,
  ]
}

export const eventDestination = (
  page: Page,
  body: Record<string, unknown>,
): Readonly<{ grill: Grill; body: Record<string, unknown> }> => {
  const member = page.members.find(
    ({ state, registration }) =>
      (typeof body.question === 'string' &&
        Object.values(registration.questions).includes(body.question)) ||
      (body.kind === 'renamed-round' &&
        Object.values(registration.rounds).includes(Number(body.round))) ||
      (typeof body.stepId === 'string' &&
        (body.stepId.startsWith(`${state.grill.id}::`) ||
          body.stepId.startsWith(`part:${state.grill.id}::`))),
  )
  if (member === undefined) return { grill: page.state.grill, body }
  const grill = member.state.grill
  const question = Object.entries(member.registration.questions).find(
    ([, shared]) => shared === body.question,
  )?.[0]
  const round = Object.entries(member.registration.rounds).find(
    ([, shared]) => shared === body.round,
  )?.[0]
  const stepId =
    typeof body.stepId !== 'string'
      ? undefined
      : body.stepId === `part:${scope(grill.id, 'run')}`
        ? 'run'
        : body.stepId.replace(`${grill.id}::`, '')
  return {
    grill,
    body: {
      ...body,
      ...(question === undefined ? {} : { question }),
      ...(round === undefined ? {} : { round: Number(round) }),
      ...(stepId === undefined ? {} : { stepId }),
    },
  }
}

export const sendPageAnswers = async (
  db: Database,
  page: Page,
  selection: Extract<SendSelection, { ok: true }>,
  send: SessionSender,
  gf: (grill: Grill, session: string) => string,
): Promise<void> => {
  const selected = new Set(Object.keys(selection.lines))
  const batches = page.members.flatMap(member => {
    const questions = Object.entries(member.registration.questions)
      .filter(([, shared]) => selected.has(shared))
      .map(([local]) => local)
    return questions.length === 0 ? [] : [{ member, questions }]
  })
  if (batches.length === 0) {
    const grill = page.state.grill
    const result = await sendAnswerBatches(grill, selection, send, session =>
      gf(grill, session),
    )
    appendEvent(db, grill.id, 'sent', { ...result, what: 'answers' })
    return
  }
  await Promise.all(
    batches.map(async ({ member, questions }) => {
      const grill = member.state.grill
      const local = selectSend(member.state, {
        questions,
        message: selection.message,
        expectedLines: sendableLines(
          grill,
          member.state.answers,
          member.state.notes,
          member.state.own,
        ),
      })
      if (!local.ok) throw new Error(local.error)
      const result = await sendAnswerBatches(grill, local, send, session =>
        gf(grill, session),
      )
      appendEvent(db, grill.id, 'sent', { ...result, what: 'answers' })
    }),
  )
}
