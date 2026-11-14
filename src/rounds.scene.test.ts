import { Option, Schema } from 'effect'
import { Url } from 'foldkit'
import {
  Mount,
  all,
  click,
  expect,
  expectAll,
  given,
  scene,
  selector,
} from 'foldkit/scene'
import { readFileSync } from 'node:fs'
import { describe, it } from 'vitest'

import { Grill } from './domain'
import { FillBox, Message, PageData, init, update } from './main'
import { view } from './view'

const fixture = Schema.decodeUnknownSync(Grill)(
  JSON.parse(readFileSync('src/fixtures/grill.json', 'utf8')),
)
const first = fixture.steps[0]!
const grill = {
  ...fixture,
  steps: fixture.steps.slice(0, 3).map((step, index) => ({
    ...step,
    part: first.part,
    question: {
      ...step.question,
      dependsOn: index === 0 ? [] : ['Q1'],
      when: index === 1 ? [{ question: 'Q1', oneOf: ['a'] }] : [],
      ...(index === 0
        ? {
            urgency: 'soon' satisfies NonNullable<
              typeof first.question.urgency
            >,
            blocksAt: '2026-11-07T14:00:00+01:00',
          }
        : {}),
    },
  })),
}
const snapshot = {
  grill,
  answers: {},
  notes: {},
  own: {},
  asks: [],
  revisions: [],
  sends: [],
}
const loaded = {
  ...init(
    Option.getOrThrow(
      Url.fromString('http://127.0.0.1:4317/g/fixture/question/Q1'),
    ),
  ).model,
  page: PageData.Success({ data: snapshot }),
}

describe('named rounds and nested blockers', () => {
  it('names the round and state of each row in the question page list', () => {
    const named = {
      ...snapshot,
      grill: { ...grill, roundNames: { '1': 'Stage definitions' } },
    }
    scene(
      { update, view },
      given({
        ...loaded,
        answers: { Q1: 'a' },
        workspace: { ...loaded.workspace, filter: 'All' },
        page: PageData.Success({ data: named }),
      }),
      Mount.resolveAll(
        [FillBox, Message.CompletedFillBox()],
        [FillBox, Message.CompletedFillBox()],
      ),
      click(selector('.f-question-list-toggle')),
      expectAll(all.selector('.f-question-list-row')).toHaveCount(3),
      expect(selector('.f-question-list-row')).toContainText(
        'Stage definitions',
      ),
      expect(selector('.f-question-list .f-state-draft path')).toHaveAttr(
        'd',
        'm4 8 3 3 5-6',
      ),
    )
  })
})
