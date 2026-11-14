import { Option, Schema } from 'effect'
import { Url } from 'foldkit'
import { Mount, expect, given, scene, selector } from 'foldkit/scene'
import { readFileSync } from 'node:fs'
import { it } from 'vitest'

import { Grill, OWN, type Snapshot } from './domain'
import { FillBox, Message, PageData, init, update } from './main'
import { view } from './view'
import { QUESTION_PAGE, REVIEW } from './workspace'

const grill = Schema.decodeUnknownSync(Grill)(
  JSON.parse(readFileSync('src/fixtures/grill.json', 'utf8')),
)
const snapshot: Snapshot = {
  grill,
  answers: {},
  notes: {},
  own: {},
  asks: [],
  revisions: [],
  sends: [],
}
const start = init(
  Option.getOrThrow(
    Url.fromString('http://127.0.0.1:4330/g/fixture/question/Q1'),
  ),
).model
const loaded = { ...start, page: PageData.Success({ data: snapshot }) }

it('fills the Review message box on mount and never binds its value to the Model', () => {
  scene(
    { update, view },
    given({
      ...loaded,
      currentPart: REVIEW,
      answers: { Q1: 'a' },
      sendMessage: 'unsent message',
    }),
    Mount.expectHas(FillBox({ text: 'unsent message' })),
    Mount.resolveAll([FillBox, Message.CompletedFillBox()]),
    expect(selector('#send-message')).toExist(),
    expect(selector('#send-message')).not.toHaveValue('unsent message'),
  )
})

it('fills the own answer box on mount and never binds its value to the Model', () => {
  scene(
    { update, view },
    given({
      ...loaded,
      currentPart: `${QUESTION_PAGE}Q1`,
      answers: { Q1: OWN },
      own: { Q1: 'my answer' },
    }),
    Mount.expectHas(FillBox({ text: 'my answer' })),
    Mount.resolveAll(
      [FillBox, Message.CompletedFillBox()],
      [FillBox, Message.CompletedFillBox()],
    ),
    expect(selector('#own-Q1')).not.toHaveValue('my answer'),
  )
})

it('fills the note box of a picked answer on mount and never binds its value to the Model', () => {
  scene(
    { update, view },
    given({
      ...loaded,
      currentPart: `${QUESTION_PAGE}Q1`,
      answers: { Q1: 'a' },
      notes: { Q1: 'my note' },
    }),
    Mount.expectHas(FillBox({ text: 'my note' })),
    Mount.resolveAll(
      [FillBox, Message.CompletedFillBox()],
      [FillBox, Message.CompletedFillBox()],
    ),
    expect(selector('#note-Q1')).not.toHaveValue('my note'),
  )
})
