import { Option, Schema } from 'effect'
import { Url } from 'foldkit'
import { expect, given, scene, selector } from 'foldkit/scene'
import { readFileSync } from 'node:fs'
import { it } from 'vitest'

import { Grill, type QuestionTimes, type Snapshot } from './domain'
import { PageData, init, update } from './main'
import { view } from './view'

const snapshot: Snapshot = {
  grill: Schema.decodeUnknownSync(Grill)(
    JSON.parse(readFileSync('src/fixtures/grill.json', 'utf8')),
  ),
  answers: {},
  notes: {},
  own: {},
  asks: [],
  revisions: [],
  sends: [],
}
const start = init(
  Option.getOrThrow(Url.fromString('http://localhost/g/fixture/question/Q1')),
).model
// Local times, so the label reads the same in every time zone.
const at = (day: number, hour: number, minute: number): number =>
  new Date(2026, 10, day, hour, minute).getTime()
const showing = (times: Readonly<Record<string, QuestionTimes>>) => ({
  ...start,
  page: PageData.Success({ data: { ...snapshot, questionTimes: times } }),
})

it.each([
  [{ posted: at(13, 22, 10) }, 'Posted 13 Nov 22:10'],
  [
    { posted: at(13, 22, 10), edited: at(13, 23, 41) },
    'Posted 13 Nov 22:10 · edited 23:41',
  ],
  [
    { posted: at(13, 22, 10), edited: at(14, 9, 5) },
    'Posted 13 Nov 22:10 · edited 14 Nov 09:05',
  ],
])('shows when the question was posted and last edited', (times, label) => {
  scene(
    { update, view },
    given(showing({ Q1: times })),
    expect(selector('.f-question-meta .f-question-times')).toHaveText(label),
  )
})

it('leaves the times out when the server sends none for the question', () => {
  scene(
    { update, view },
    given(showing({ Q2: { posted: at(13, 22, 10) } })),
    expect(selector('.f-question-meta')).toExist(),
    expect(selector('.f-question-times')).not.toExist(),
  )
})
