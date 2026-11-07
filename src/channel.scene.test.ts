import { Option, Schema } from 'effect'
import { Url } from 'foldkit'
import {
  all,
  expect,
  expectAll,
  given,
  role,
  scene,
  selector,
} from 'foldkit/scene'
import { readFileSync } from 'node:fs'
import { it } from 'vitest'

import { Grill, type Snapshot } from './domain'
import { PageData, init, update } from './main'
import { view } from './view'
import { ANSWER_HISTORY, UPDATES } from './workspace'

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
  Option.getOrThrow(Url.fromString('http://localhost/g/fixture/updates')),
).model
const loaded = { ...start, page: PageData.Success({ data: snapshot }) }

it('reads source-owned updates without answer controls and keeps superseded context available', () => {
  const updates: NonNullable<Snapshot['updates']> = [
    {
      source: 'member',
      event: 2,
      at: 2,
      displayBody: 'The current update about Q7.',
      item: {
        version: 1,
        kind: 'update',
        id: 'new',
        previous: 0,
        revision: 1,
        session: 't-worker',
        body: 'The current update about Q1.',
        question: 'Q1',
        supersedes: 'old',
      },
    },
    {
      source: 'member',
      event: 1,
      at: 1,
      supersededBy: 'new',
      item: {
        version: 1,
        kind: 'update',
        id: 'old',
        previous: 0,
        revision: 1,
        session: 't-worker',
        body: 'Earlier context',
      },
    },
  ]
  scene(
    { update, view },
    given({
      ...loaded,
      currentPart: UPDATES,
      page: PageData.Success({ data: { ...snapshot, updates } }),
    }),
    expect(selector('.f-updates h1')).toHaveText('Updates'),
    expect(selector('.f-updates')).toContainText('The current update about Q7'),
    expect(selector('.f-updates')).not.toContainText(
      'The current update about Q1.',
    ),
    expect(selector('.f-updates .f-source-question-link')).toHaveAttr(
      'href',
      '/g/fixture/question/Q1?source=member',
    ),
    expect(selector('.f-earlier-updates summary')).toHaveText(
      'Superseded updates · 1',
    ),
    expectAll(all.selector('.f-updates [role="radio"]')).toHaveCount(0),
  )
})

it('shows captured wording and note rather than substituting the latest question meaning', () => {
  const history: NonNullable<Snapshot['answerHistory']> = [
    {
      source: 'member',
      event: 72,
      at: 2,
      submission: 72,
      legacyLines: {},
      message: 'Extra message',
      state: 'delivered',
      answers: [
        {
          version: 1,
          question: 'Q1',
          key: 'a',
          own: '',
          note: 'Exact saved note',
          answerEvent: 71,
          answerRecordedAt: 1,
          sendRevision: 'old',
          recipient: 't-worker',
          context: {
            revision: 'old',
            displayPage: 'fixture',
            displayQuestion: 'Q1',
            round: 1,
            title: 'Original title',
            scope: 'Original scope',
            ask: 'Original question?',
            options: [
              {
                key: 'a',
                label: 'Original choice',
                effect: 'Original consequence',
                recommended: true,
              },
            ],
          },
        },
      ],
    },
    {
      source: 'member',
      event: 60,
      at: 1,
      submission: null,
      answers: [],
      legacyLines: { Q1: 'Q1 b' },
      message: '',
      state: 'failed',
    },
  ]
  scene(
    { update, view },
    given({
      ...loaded,
      currentPart: ANSWER_HISTORY,
      page: PageData.Success({
        data: {
          ...snapshot,
          answerHistory: history,
          questionOrigins: { Q1: { grill: 'member', question: 'Q1' } },
          questionRevisions: { Q1: 'later' },
        },
      }),
    }),
    expect(selector('.f-answer-history h1')).toHaveText('Answer history'),
    expect(selector('.f-answer-history')).toContainText('Original choice'),
    expect(selector('.f-answer-history')).toContainText('Original consequence'),
    expect(selector('.f-answer-history')).toContainText('Exact saved note'),
    expect(selector('.f-wording-changes summary')).toHaveText(
      'Compare original and current wording',
    ),
    expectAll(all.selector('.f-wording-diff ins')).not.toBeEmpty(),
    expectAll(all.selector('.f-wording-diff del')).not.toBeEmpty(),
    expect(selector('.f-answer-history')).toContainText(
      'Original answer context unavailable for this older send.',
    ),
    expect(selector('.f-recorded-choice')).not.toContainText(
      grill.steps[0]!.question.options[0]!.label,
    ),
    expect(selector('.f-extra-message')).toContainText('Extra message'),
    expect(selector('.f-legacy-answer')).toHaveText('Q1 b'),
  )
})

it.each([UPDATES, ANSWER_HISTORY])(
  'keeps an empty reading page usable with legacy snapshots: %s',
  currentPart => {
    scene(
      { update, view },
      given({ ...loaded, currentPart }),
      expect(role('heading', { level: 1 })).toExist(),
      expect(selector('.f-page .f-empty')).toExist(),
    )
  },
)

it('exposes the canonical source-qualified question link in scope details', () => {
  scene(
    { update, view },
    given({
      ...loaded,
      currentPart: 'question:Q1',
      page: PageData.Success({
        data: {
          ...snapshot,
          questionOrigins: {
            Q1: { grill: 'member', question: 'local-choice' },
          },
        },
      }),
    }),
    expect(role('link', { name: 'Source question link' })).toHaveAttr(
      'href',
      '/g/fixture/question/local-choice?source=member',
    ),
  )
})
