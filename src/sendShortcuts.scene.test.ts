import { Option, Schema } from 'effect'
import { Url } from 'foldkit'
import {
  Command,
  click,
  expect,
  given,
  role,
  scene,
  selector,
} from 'foldkit/scene'
import { readFileSync } from 'node:fs'
import { it } from 'vitest'

import { Grill, type Snapshot } from './domain'
import { Message, PageData, SaveKeptBack, init, update } from './main'
import { view } from './view'

const fixture = Schema.decodeUnknownSync(Grill)(
  JSON.parse(readFileSync('src/fixtures/grill.json', 'utf8')),
)
const grill = {
  ...fixture,
  round: 2,
  steps: fixture.steps.slice(0, 4).map((step, index) => ({
    ...step,
    question: {
      ...step.question,
      dependsOn: [],
      when: [],
      round: index < 3 ? 2 : 1,
      session: index === 1 ? 'homelab' : 'grants',
    },
  })),
}
const answers = { Q1: 'a', Q2: 'b', Q16: 'a' }
const snapshot: Snapshot = {
  grill,
  answers,
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
  answers,
}

it('offers sending the answer and its round under the question, naming who gets them', () => {
  scene(
    { update, view },
    given(loaded),
    expect(role('button', { name: '3 unsent', exact: true })).toExist(),
    expect(selector('.f-send-strip')).toContainText('Goes to grants'),
    expect(selector('.f-send-strip')).toContainText(
      '1 answer to grants · 1 answer to homelab',
    ),
    expect(selector('.f-send-strip-others')).toContainText(
      'Round 1 also has 1 answer unsent',
    ),
    click(role('button', { name: /Send this answer/ })),
    expect(selector('.f-send-strip.is-held')).toContainText(
      'Nothing has left the page yet',
    ),
    click(role('button', { name: /Undo/ })),
    expect(selector('.f-send-strip.is-held')).not.toExist(),
  )
})

it('offers the round on an open question the reader is not ready to answer', () => {
  scene(
    { update, view },
    given({ ...loaded, currentPart: 'question:Q3' }),
    expect(selector('.f-send-strip.is-quiet')).toContainText(
      'Not ready to answer this one?',
    ),
    expect(role('button', { name: /Send 2 answers/ })).toExist(),
  )
})

it('lists unsent drafts by round with recipients in the tray', () => {
  scene(
    { update, view },
    given(loaded),
    click(role('button', { name: '3 unsent', exact: true })),
    expect(role('dialog', { name: 'Unsent answers' })).toExist(),
    expect(selector('.f-unsent-tray')).toContainText('To homelab'),
    expect(role('button', { name: 'Send 2', exact: true })).toExist(),
    expect(role('button', { name: 'Send 1', exact: true })).toExist(),
    click(selector('.f-tray-keep')),
    Command.resolve(SaveKeptBack, Message.CompletedSaveKeptBack()),
    expect(selector('.f-tray-kept')).toContainText('Kept back (1)'),
    expect(role('button', { name: '2 unsent · 1 kept back' })).toExist(),
  )
})

it('asks before leaving with ready drafts unsent', () => {
  scene(
    { update, view },
    given({
      ...loaded,
      maybeLeaving: Option.some({
        href: 'http://localhost/g/other',
        isSending: false,
      }),
    }),
    expect(role('alertdialog', { name: 'Unsent answers' })).toContainText(
      "3 answers aren't sent yet",
    ),
    expect(role('button', { name: 'Send 3 and leave' })).toExist(),
    expect(role('button', { name: 'Leave, keep as drafts' })).toExist(),
  )
})
