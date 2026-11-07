import type { Database } from 'bun:sqlite'
import { Schema } from 'effect'

import { type Grill, questionSession } from '../src/domain'
import { DrawingDiagram, type QuestionDrawing } from '../src/drawings'
import { AnswerContext } from '../src/questionContext'
import { captureQuestionContext, questionRevisions } from './answerReceipts'
import type { SessionSender } from './delivery'
import type { Page } from './squad'
import { ROOT, appendEvent, events } from './store'

const Positive = Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0))
const Previous = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
)
const Request = Schema.Struct({
  question: Schema.String,
  contextRevision: Schema.String,
  previous: Previous,
  requestId: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(200),
  ),
})
const Frozen = Schema.Struct({
  ...Request.fields,
  version: Schema.Literal(1),
  recipient: Schema.String,
  context: AnswerContext,
})
export const DrawingReply = Schema.Struct({
  version: Schema.Literal(1),
  question: Schema.String,
  request: Positive,
  previous: Previous,
  revision: Positive,
  diagram: DrawingDiagram,
})
const requests = (db: Database, source: string) =>
  events(db, source)
    .filter(event => event.kind === 'drawing-requested')
    .map(event => ({
      ...event,
      value: Schema.decodeUnknownSync(Frozen)(JSON.parse(event.payload)),
    }))
const replies = (db: Database, source: string) =>
  events(db, source)
    .filter(event => event.kind === 'drawing-published')
    .map(event => ({
      ...event,
      value: Schema.decodeUnknownSync(DrawingReply)(JSON.parse(event.payload)),
    }))
const word = (value: string) => `'${value.replaceAll("'", "'\\''")}'`

export const drawingMessage = (
  source: string,
  request: number,
  raw: unknown,
  gf = `bun run --cwd ${ROOT} gf`,
): string => {
  const value = Schema.decodeUnknownSync(Frozen)(raw)
  return [
    `[grill-flow] Draw ${source} / ${value.question} (request ${request}).`,
    'Return raw diagram JSON, kind compare or flow, for this frozen question context:',
    JSON.stringify(value.context),
    `Write the diagram to a file, then run ${gf} draw ${word(source)} ${word(value.question)} --request ${request} --file <diagram.json>`,
    'A comment is not a drawing response. The original question and its answers stay separate.',
  ].join('\n')
}

type DrawResult =
  | Readonly<{ ok: true; event: number }>
  | Readonly<{ ok: false; status: number; error: string }>
export const requestDrawing = async (
  db: Database,
  source: Grill,
  display: Grill,
  displayQuestion: string,
  raw: unknown,
  send: SessionSender,
  gf: (session: string) => string,
  preview = false,
): Promise<DrawResult> => {
  const decoded = Schema.decodeUnknownResult(Request)(raw)
  if (decoded._tag === 'Failure') {
    return {
      ok: false,
      status: 400,
      error: 'Invalid drawing request. Reload before requesting a drawing.',
    }
  }
  const request = decoded.success
  const frozen = db
    .transaction(() => {
      const history = requests(db, source.id)
      const replay = history.find(
        entry => entry.value.requestId === request.requestId,
      )
      if (replay !== undefined) {
        return replay.value.question === request.question &&
          replay.value.contextRevision === request.contextRevision &&
          replay.value.previous === request.previous &&
          replay.value.context.displayPage === display.id &&
          replay.value.context.displayQuestion === displayQuestion
          ? ({ ok: true, event: replay.id, fresh: false } satisfies {
              ok: true
              event: number
              fresh: boolean
            })
          : ({
              ok: false,
              status: 409,
              error: 'That drawing request ID already names another context.',
            } satisfies { ok: false; status: number; error: string })
      }
      const step = source.steps.find(
        step => step.question.id === request.question,
      )
      const shown = display.steps.find(
        step => step.question.id === displayQuestion,
      )
      if (
        step === undefined ||
        shown === undefined ||
        questionRevisions(display)[displayQuestion] !== request.contextRevision
      ) {
        return {
          ok: false,
          status: 409,
          error: 'The question changed. Reload before requesting a drawing.',
        } satisfies { ok: false; status: number; error: string }
      }
      const latest = history
        .filter(entry => entry.value.question === request.question)
        .slice(-1)[0]
      if ((latest?.id ?? 0) !== request.previous) {
        return {
          ok: false,
          status: 409,
          error: 'Another drawing was requested. Reload to see its progress.',
        } satisfies { ok: false; status: number; error: string }
      }
      const value = Schema.decodeUnknownSync(Frozen)({
        ...request,
        version: 1,
        recipient: questionSession(source, step.question),
        context: captureQuestionContext(source, display, step, shown),
      })
      return {
        ok: true,
        event: appendEvent(db, source.id, 'drawing-requested', value),
        fresh: true,
        value,
      } satisfies {
        ok: true
        event: number
        fresh: boolean
        value: typeof Frozen.Type
      }
    })
    .immediate()
  if (!frozen.ok) {
    return frozen
  }
  if (!frozen.fresh || !('value' in frozen)) {
    return { ok: true, event: frozen.event }
  }
  const value = frozen.value
  const text = drawingMessage(
    source.id,
    frozen.event,
    value,
    gf(value.recipient),
  )
  const attempted = !preview && value.recipient !== ''
  const result = attempted
    ? await send(value.recipient, text).catch(error => ({
        ok: false,
        detail: String(error).slice(0, 300),
      }))
    : {
        ok: false,
        detail: preview
          ? 'Preview: no terminal delivery attempted.'
          : 'Saved for the owner to pick up; no terminal route is configured.',
      }
  appendEvent(db, source.id, 'drawing-delivery', {
    request: frozen.event,
    attempted,
    ...result,
  })
  return { ok: true, event: frozen.event }
}

export const publishDrawing = (
  db: Database,
  source: Grill,
  raw: unknown,
): DrawResult => {
  const decoded = Schema.decodeUnknownResult(DrawingReply)(raw)
  if (decoded._tag === 'Failure') {
    return {
      ok: false,
      status: 400,
      error: 'Invalid version-1 compare/flow drawing response.',
    }
  }
  const reply = decoded.success
  return db
    .transaction((): DrawResult => {
      const request = requests(db, source.id).find(
        entry =>
          entry.id === reply.request && entry.value.question === reply.question,
      )
      if (request === undefined) {
        return {
          ok: false,
          status: 400,
          error:
            'The drawing must answer this source question’s saved request.',
        }
      }
      const history = replies(db, source.id).filter(
        entry => entry.value.request === reply.request,
      )
      const replay = history.find(
        entry => entry.value.revision === reply.revision,
      )
      if (replay !== undefined) {
        return JSON.stringify(replay.value) === JSON.stringify(reply)
          ? { ok: true, event: replay.id }
          : {
              ok: false,
              status: 409,
              error: 'That drawing revision already has different content.',
            }
      }
      if (
        reply.revision !== reply.previous + 1 ||
        (history.slice(-1)[0]?.value.revision ?? 0) !== reply.previous
      ) {
        return {
          ok: false,
          status: 409,
          error: 'Reread the drawing’s latest revision before publishing.',
        }
      }
      const diagram = reply.diagram
      const valid =
        JSON.stringify(diagram).length <= 100_000 &&
        (diagram.kind === 'compare'
          ? diagram.rows.length > 0 &&
            diagram.rows.length <= 100 &&
            diagram.rows.every(row =>
              Object.keys(row.cells).every(
                key =>
                  key === 'now' ||
                  request.value.context.options.some(
                    option => option.key === key,
                  ),
              ),
            )
          : diagram.lanes.length > 0 &&
            diagram.lanes.length <= 12 &&
            diagram.steps.length > 0 &&
            diagram.steps.length <= 80 &&
            Object.keys(diagram.states).length > 0 &&
            Object.keys(diagram.states).length <= 16 &&
            new Set(diagram.lanes.map(lane => lane.id)).size ===
              diagram.lanes.length &&
            Object.values(diagram.states).every(
              state =>
                (state.band === undefined ||
                  (Number.isInteger(state.band.from) &&
                    Number.isInteger(state.band.to) &&
                    state.band.from >= 1 &&
                    state.band.to >= state.band.from &&
                    state.band.to <= diagram.steps.length)) &&
                Object.entries(state.nodes).every(
                  ([lane, nodes]) =>
                    diagram.lanes.some(
                      item => item.id === lane && lane.trim() !== '',
                    ) && nodes.length <= diagram.steps.length,
                ),
            ))
      if (!valid) {
        return {
          ok: false,
          status: 400,
          error:
            'The drawing is oversized or contains unknown choices, lanes or steps.',
        }
      }
      return {
        ok: true,
        event: appendEvent(db, source.id, 'drawing-published', reply),
      }
    })
    .immediate()
}

export const pageDrawings = (
  db: Database,
  page: Page,
): ReadonlyArray<QuestionDrawing> => {
  const sources =
    page.members.length > 0
      ? page.members.map(member => ({
          grill: member.state.grill,
          questions: member.registration.questions,
        }))
      : [
          {
            grill: page.state.grill,
            questions: Object.fromEntries(
              page.state.grill.steps.map(step => [
                step.question.id,
                step.question.id,
              ]),
            ),
          },
        ]
  const current = questionRevisions(page.state.grill)
  return sources.flatMap(({ grill, questions }) => {
    const history = events(db, grill.id)
    const latest = new Map(
      requests(db, grill.id).map(entry => [entry.value.question, entry]),
    )
    const responses = replies(db, grill.id)
    return [...latest.values()].flatMap(entry => {
      const displayQuestion = questions[entry.value.question]
      if (
        displayQuestion === undefined ||
        current[displayQuestion] === undefined
      ) {
        return []
      }
      const response = responses
        .filter(reply => reply.value.request === entry.id)
        .slice(-1)[0]
      const delivery = history
        .filter(event => event.kind === 'drawing-delivery')
        .map(event => JSON.parse(event.payload))
        .reverse()
        .find(event => event.request === entry.id)
      return [
        {
          source: grill.id,
          question: entry.value.question,
          displayQuestion,
          request: entry.id,
          at: entry.at,
          recipient: entry.value.recipient,
          context: entry.value.context,
          stale: current[displayQuestion] !== entry.value.context.revision,
          delivery:
            delivery === undefined || !delivery.attempted
              ? 'pending'
              : delivery.ok
                ? 'delivered'
                : 'failed',
          detail:
            delivery?.detail ??
            'Delivery is unconfirmed; the saved request remains available.',
          ...(response === undefined
            ? {}
            : {
                response: {
                  version: 1,
                  event: response.id,
                  at: response.at,
                  revision: response.value.revision,
                  diagram: response.value.diagram,
                },
              }),
        } satisfies QuestionDrawing,
      ]
    })
  })
}
