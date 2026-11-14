import { Option, Schema } from 'effect'
import { Url } from 'foldkit'
import {
  Mount,
  expect,
  given,
  role,
  scene,
  selector,
  type,
} from 'foldkit/scene'
import { readFileSync } from 'node:fs'
import { it } from 'vitest'

import { Grill, type Snapshot, TEXT_LIMIT } from './domain'
import {
  FillBox,
  Message,
  PageData,
  RestoreDiscussionScroll,
  init,
  threadDraftKey,
  update,
} from './main'
import { view } from './view'
import { CONVERSATIONS, REVIEW, initialWorkspace } from './workspace'

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
const loaded = {
  ...init(
    Option.getOrThrow(Url.fromString('http://localhost/g/fixture/question/Q1')),
  ).model,
  page: PageData.Success({ data: snapshot }),
}

it('counts the Review message near the limit and holds Send while it is over', () => {
  scene(
    { update, view },
    given({
      ...loaded,
      currentPart: REVIEW,
      answers: { Q1: 'a' },
      sendMessage: 'x'.repeat(TEXT_LIMIT + 1),
    }),
    Mount.resolveAll([FillBox, Message.CompletedFillBox()]),
    expect(selector('.f-review-compose .char-count')).toHaveText(
      '4,001 / 4,000 characters · shorten by 1 to send',
    ),
    expect(role('button', { name: 'Send 1 answer' })).toBeDisabled(),
    type(selector('#send-message'), 'x'.repeat(3700)),
    expect(selector('.f-review-compose .char-count')).toHaveText(
      '3,700 / 4,000 characters',
    ),
    expect(role('button', { name: 'Send 1 answer' })).toBeEnabled(),
    type(selector('#send-message'), 'A short message'),
    expect(selector('.f-review-compose .char-count')).not.toExist(),
  )
})

it('holds Ask while a discussion draft is over the limit', () => {
  scene(
    { update, view },
    given({
      ...loaded,
      currentPart: CONVERSATIONS,
      workspace: {
        ...initialWorkspace,
        maybeDiscussionTarget: Option.some('run'),
      },
      talkDrafts: { [threadDraftKey('run')]: 'x'.repeat(TEXT_LIMIT + 20) },
    }),
    Mount.resolveAll(
      [FillBox, Message.CompletedFillBox()],
      [RestoreDiscussionScroll, Message.CompletedRestoreDiscussionScroll()],
    ),
    expect(selector('.f-discussion-compose .char-count')).toHaveText(
      '4,020 / 4,000 characters · shorten by 20 to send',
    ),
    expect(role('button', { name: 'Ask' })).toBeDisabled(),
  )
})

it('counts an own answer and a note on the question page', () => {
  scene(
    { update, view },
    given({
      ...loaded,
      answers: { Q1: 'other' },
      own: { Q1: 'o'.repeat(TEXT_LIMIT) },
      notes: { Q1: 'n'.repeat(TEXT_LIMIT + 2) },
    }),
    Mount.resolveAll(
      [FillBox, Message.CompletedFillBox()],
      [FillBox, Message.CompletedFillBox()],
    ),
    expect(selector('.f-answer-section')).toContainText(
      '4,000 / 4,000 characters',
    ),
    expect(selector('.f-answer-section')).toContainText(
      '4,002 / 4,000 characters · shorten by 2 to send',
    ),
  )
})
