import { Option, Schema } from 'effect'
import { Url } from 'foldkit'
import {
  all,
  change,
  click,
  expect,
  expectAll,
  given,
  role,
  scene,
  selector,
} from 'foldkit/scene'
import { readFileSync } from 'node:fs'
import { describe, it } from 'vitest'

import { Grill } from './domain'
import { PageData, init, update } from './main'
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
            topic: 'Grants',
            urgency: 'soon' satisfies NonNullable<
              typeof first.question.urgency
            >,
            blocksAt: '2026-11-07T14:00:00+01:00',
          }
        : index === 2
          ? { topic: 'Grants' }
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

describe('question topics and nested blockers', () => {
  it('groups independent questions by topic, falls back to part titles and remembers folding', () => {
    const independent = {
      ...snapshot,
      grill: {
        ...grill,
        steps: grill.steps.map(step => ({
          ...step,
          question: { ...step.question, dependsOn: [], when: [] },
        })),
      },
    }
    scene(
      { update, view },
      given({ ...loaded, page: PageData.Success({ data: independent }) }),
      change(role('combobox', { name: 'Group questions by' }), 'Topic'),
      expect(role('navigation', { name: 'Questions by topic' })).toExist(),
      expectAll(all.selector('.f-round')).toHaveCount(2),
      expect(selector('.f-question-list')).toContainText(
        fixture.parts.find(part => part.id === first.part)!.title,
      ),
      click(role('button', { name: 'Grants · 0 of 2 sent' })),
      expectAll(all.selector('.f-question-item')).toHaveCount(1),
      change(role('combobox', { name: 'Group questions by' }), 'Round'),
      expectAll(all.selector('.f-question-item')).toHaveCount(3),
      change(role('combobox', { name: 'Group questions by' }), 'Topic'),
      expectAll(all.selector('.f-question-item')).toHaveCount(1),
    )
  })

  it.each(['Round', 'Agent', 'Topic'] satisfies ReadonlyArray<
    typeof loaded.workspace.grouping
  >)('nests dependents and folds the branch in %s view', grouping => {
    scene(
      { update, view },
      given(loaded),
      change(role('combobox', { name: 'Group questions by' }), grouping),
      expectAll(
        all.selector('.f-question-children .f-question-item'),
      ).toHaveCount(2),
      expectAll(all.selector('.f-question-signal')).toHaveCount(0),
      click(role('button', { name: 'Collapse dependents of Q1' })),
      expectAll(all.selector('.f-question-item')).toHaveCount(1),
      click(role('button', { name: 'Expand dependents of Q1' })),
      expectAll(all.selector('.f-question-item')).toHaveCount(3),
      expect(selector('.f-question-list .urgency-soon')).toHaveAttr(
        'title',
        'Blocks soon · Starts blocking 2026-11-07T14:00:00+01:00',
      ),
    )
  })

  it('distinguishes the draft pencil from the sent checkmark inside outlined circles', () => {
    scene(
      { update, view },
      given({ ...loaded, answers: { Q1: 'a' } }),
      expect(selector('.f-question-list .f-state-draft path')).toHaveAttr(
        'd',
        'm4 12 1-4 5-5 3 3-5 5-4 1m2-6 3 3',
      ),
    )
    scene(
      { update, view },
      given({
        ...loaded,
        answers: { Q1: 'a' },
        page: PageData.Success({ data: { ...snapshot, sent: { Q1: 'Q1 a' } } }),
      }),
      expect(selector('.f-question-list .f-state-sent path')).toHaveAttr(
        'd',
        'm4 8 3 3 5-6',
      ),
    )
  })

  it('colours only open circles with a named urgency', () => {
    const urgencies = [
      'blocking',
      'soon',
      'wait',
      'fyi',
      undefined,
    ] satisfies ReadonlyArray<typeof first.question.urgency>
    const state = {
      ...snapshot,
      grill: {
        ...grill,
        steps: urgencies.map((urgency, index) => ({
          ...first,
          id: `step-${index}`,
          question: {
            ...first.question,
            id: `Q${index + 1}`,
            ...(urgency === undefined ? {} : { urgency }),
          },
        })),
      },
    }
    scene(
      { update, view },
      given({ ...loaded, page: PageData.Success({ data: state }) }),
      expect(selector('.f-question-list .urgency-blocking')).toExist(),
      expect(selector('.f-question-list .urgency-soon')).toExist(),
      expect(selector('.f-question-list .urgency-wait')).toExist(),
      expect(selector('.f-question-list .urgency-fyi')).toExist(),
      expect(
        selector('.f-question-item[title^="Q5"] .f-state-open'),
      ).toHaveAttr('class', 'f-state f-state-open'),
    )
  })
})
