import { Option, Schema } from 'effect'
import { Url } from 'foldkit'
import {
  Mount,
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
import { FillBox, Message, PageData, init, update } from './main'
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
    expect(selector('.f-answer-history h1')).toHaveText('Log'),
    expect(selector('.f-answer-history')).toContainText('Send 72'),
    expect(selector('.f-answer-history')).toContainText('Q1 a'),
    expect(selector('.f-log-message')).toContainText('Extra message'),
    expect(selector('.f-answer-history')).toContainText('Earlier send'),
    expect(selector('.f-answer-history')).toContainText(
      'Delivery failed or partial',
    ),
  )
  scene(
    { update, view },
    given({
      ...loaded,
      currentPart: 'question:Q1',
      page: PageData.Success({
        data: {
          ...snapshot,
          answerHistory: history,
          questionOrigins: { Q1: { grill: 'member', question: 'Q1' } },
          questionRevisions: { Q1: 'later' },
        },
      }),
    }),
    Mount.resolveAll([FillBox, Message.CompletedFillBox()]),
    expect(selector('.f-sent-answer summary')).toContainText('Sent a'),
    expect(selector('.f-sent-answer')).toContainText('Original choice'),
    expect(selector('.f-sent-answer')).toContainText('Exact saved note'),
    expect(selector('.f-wording-changes summary')).toHaveText(
      'Compare original and current wording',
    ),
    expectAll(all.selector('.f-wording-diff ins')).not.toBeEmpty(),
    expect(selector('.f-recorded-choice')).not.toContainText(
      grill.steps[0]!.question.options[0]!.label,
    ),
  )
})

it.each([ANSWER_HISTORY])(
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
      whyOpen: { 'step-q1': true },
      page: PageData.Success({
        data: {
          ...snapshot,
          questionOrigins: {
            Q1: { grill: 'member', question: 'local-choice' },
          },
        },
      }),
    }),
    Mount.resolveAll([FillBox, Message.CompletedFillBox()]),
    expect(role('link', { name: 'Source question link' })).toHaveAttr(
      'href',
      '/g/fixture/question/local-choice?source=member',
    ),
  )
})
