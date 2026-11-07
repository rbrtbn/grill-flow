import type { Html, HtmlBuilder } from 'foldkit/html'

import type { Snapshot, Step } from './domain'
import { type QuestionDrawing, drawingAttemptKey } from './drawings'
import { Message, type Model } from './main'

type H = HtmlBuilder<Message>
const currentDrawing = (snapshot: Snapshot, question: string) =>
  snapshot.drawings?.find(drawing => drawing.displayQuestion === question)
const pending = (drawing: QuestionDrawing | undefined) =>
  drawing !== undefined &&
  drawing.response === undefined &&
  !drawing.stale &&
  drawing.delivery !== 'failed'

export const drawingButton = (
  model: Model,
  snapshot: Snapshot,
  step: Step,
  h: H,
): Html => {
  const id = step.question.id
  const drawing = currentDrawing(snapshot, id)
  const attempt =
    model.drawingAttempts[drawingAttemptKey(snapshot.grill.id, id)]
  const failed =
    attempt?._tag === 'Failed' && (drawing?.request ?? 0) <= attempt.previous
  return h.button(
    [
      h.Class('text-button f-draw-request'),
      h.Disabled(
        snapshot.questionRevisions?.[id] === undefined ||
          attempt?._tag === 'Requesting' ||
          pending(drawing),
      ),
      h.Title(
        snapshot.questionRevisions?.[id] === undefined
          ? 'Reload to request a drawing for the current wording.'
          : 'Ask this question’s owner for a table or flow.',
      ),
      h.OnClick(Message.ClickedDrawing({ question: id })),
    ],
    [
      failed ||
      (drawing?.response === undefined && drawing?.delivery === 'failed')
        ? 'Retry drawing request'
        : attempt?._tag === 'Requesting' || pending(drawing)
          ? 'Drawing requested'
          : drawing?.response === undefined
            ? 'Draw this'
            : 'Redraw',
    ],
  )
}

export const drawingPanel = (
  model: Model,
  snapshot: Snapshot,
  step: Step,
  render: (drawing: QuestionDrawing, h: H) => Html,
  h: H,
): Html => {
  const id = step.question.id
  const drawing = currentDrawing(snapshot, id)
  const attempt =
    model.drawingAttempts[drawingAttemptKey(snapshot.grill.id, id)]
  const failed =
    attempt?._tag === 'Failed' && (drawing?.request ?? 0) <= attempt.previous
  if (drawing === undefined && attempt === undefined) {
    return h.empty
  }
  return h.section(
    [h.Class('f-question-drawing'), h.AriaLabel('Drawing for this question')],
    [
      h.h2([], ['Drawing']),
      failed ? h.p([h.Role('alert')], [attempt.error]) : h.empty,
      drawing === undefined
        ? h.p(
            [h.Role('status')],
            [
              failed
                ? 'The request was not confirmed. Retry from Draw this.'
                : 'Saving the drawing request…',
            ],
          )
        : h.div(
            [],
            [
              h.p(
                [h.Class('hint f-drawing-meta')],
                [
                  `${drawing.source} · ${drawing.question} · request ${drawing.request} · ${drawing.recipient || 'Owner pickup'}`,
                ],
              ),
              drawing.stale
                ? h.p(
                    [h.Class('f-drawing-stale'), h.Role('status')],
                    [
                      'The question wording changed. This drawing belongs to the earlier wording.',
                    ],
                  )
                : h.empty,
              drawing.response === undefined
                ? h.p(
                    [h.Class('f-drawing-state'), h.Role('status')],
                    [
                      drawing.delivery === 'failed'
                        ? 'Drawing request delivery failed. Retry from Draw this.'
                        : drawing.delivery === 'pending'
                          ? 'Request saved; delivery is unconfirmed. Waiting for the owner’s drawing.'
                          : 'Request delivered. Waiting for the owner’s drawing.',
                    ],
                  )
                : h.div([h.Class('f-drawing-response')], [render(drawing, h)]),
              h.p([h.Class('hint')], [drawing.detail]),
            ],
          ),
    ],
  )
}
