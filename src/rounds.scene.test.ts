import { Option, Schema } from 'effect'
import { Url } from 'foldkit'
import {
  Command,
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
import { Message, PageData, SaveWorkspaceSettings, init, update } from './main'
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
  it('shows named rounds in the sidebar and header, with a rename form', () => {
    const named = {
      ...snapshot,
      grill: { ...grill, roundNames: { '1': 'Stage definitions' } },
    }
    scene(
      { update, view },
      given({ ...loaded, page: PageData.Success({ data: named }) }),
      expect(selector('.f-round-name')).toContainText(
        'Round 1 · Stage definitions',
      ),
      expect(selector('.f-current-round')).toHaveText(
        'Round 1 · Stage definitions',
      ),
      click(role('button', { name: 'Rename' })),
      expect(role('textbox', { name: 'Name for round 1' })).toHaveValue(
        'Stage definitions',
      ),
      click(role('button', { name: 'Cancel' })),
      expectAll(all.selector('.f-round-editor')).toHaveCount(0),
    )
  })

  it.each(['Round', 'Agent'] satisfies ReadonlyArray<
    typeof loaded.workspace.grouping
  >)('nests dependents and folds the branch in %s view', grouping => {
    scene(
      { update, view },
      given(loaded),
      change(role('combobox', { name: 'Group questions by' }), grouping),
      Command.resolve(
        SaveWorkspaceSettings,
        Message.CompletedSaveWorkspaceSettings(),
      ),
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

  it('distinguishes the draft and sent checkmarks inside outlined circles', () => {
    scene(
      { update, view },
      given({ ...loaded, answers: { Q1: 'a' } }),
      expect(selector('.f-question-list .f-state-draft path')).toHaveAttr(
        'd',
        'm4 8 3 3 5-6',
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
