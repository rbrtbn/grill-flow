import { Option, Result, Schema } from 'effect'
import { Url } from 'foldkit'
import { Command, given, message, model, story } from 'foldkit/story'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

import { channelItemKey } from './channel'
import { Snapshot } from './domain'
import { Message, PageData, PostVeto, init, update } from './main'

const snapshot = Schema.decodeUnknownSync(Snapshot)({
  grill: JSON.parse(readFileSync('src/fixtures/grill.json', 'utf8')),
  answers: {},
  notes: {},
  own: {},
  asks: [],
  revisions: [],
  sends: [],
  decisions: [
    {
      source: 'alpha',
      event: 4,
      at: 1000,
      window: 'open',
      vetoes: [],
      item: {
        version: 1,
        kind: 'decision',
        id: 'choice',
        previous: 0,
        revision: 1,
        session: 't-owner',
        body: 'Exact decision',
        deadline: 4000,
        affected: [],
        resolution: { state: 'provisional' },
      },
    },
  ],
})
const start = init(
  Option.getOrThrow(Url.fromString('http://localhost/g/fixture/needs-you')),
).model
const loaded = { ...start, page: PageData.Success({ data: snapshot }) }
const click = Message.ClickedVeto({
  source: 'alpha',
  item: 'choice',
  revision: 1,
})

it('preserves concurrent answer/note/own drafts and their pending save through a veto response', () => {
  story(
    update,
    given({
      ...loaded,
      pendingEvents: 1,
      answers: { Q1: 'a' },
      notes: { Q1: 'Unsent note' },
      own: { Q1: 'DOM transcript saved locally' },
    }),
    message(click),
    Command.expectExact(
      PostVeto({
        grillId: 'fixture',
        source: 'alpha',
        item: 'choice',
        revision: 1,
      }),
    ),
    Command.resolve(
      PostVeto,
      Message.CompletedPostVeto({
        source: 'alpha',
        item: 'choice',
        revision: 1,
        result: Result.succeed(snapshot),
      }),
    ),
    model(current => {
      expect(current.answers.Q1).toBe('a')
      expect(current.notes.Q1).toBe('Unsent note')
      expect(current.own.Q1).toBe('DOM transcript saved locally')
      expect(current.pendingEvents).toBe(1)
      expect(current.vetoAttempts).toEqual({})
    }),
  )
})

it('ignores absent, stale and duplicate veto identities without producing a delivery', () => {
  story(
    update,
    given(loaded),
    message(
      Message.ClickedVeto({ source: 'foreign', item: 'choice', revision: 1 }),
    ),
    message(
      Message.ClickedVeto({ source: 'alpha', item: 'choice', revision: 2 }),
    ),
    model(current => expect(current.vetoAttempts).toEqual({})),
  )
  const sending = update(loaded, click)
  const repeated = update(sending.model, click)
  expect(repeated.commands).toBeUndefined()
  expect(
    repeated.model.vetoAttempts[channelItemKey('alpha', 'choice', 1)]?._tag,
  ).toBe('Sending')
})
