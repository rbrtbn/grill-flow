import { Option, Schema } from 'effect'
import { Url } from 'foldkit'
import { Command, given, message, model, story } from 'foldkit/story'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

import { GRILL_FLOW_TARGET, Grill, type Snapshot } from './domain'
import {
  FocusQuoteBox,
  FocusTalkBox,
  Message,
  PageData,
  init,
  update,
} from './main'

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
const quoted = {
  stepId: 'step-q1',
  text: 'the reasoning behind it',
  top: 120,
  bottom: 140,
  left: 300,
  placement: 'Above' as const,
}

it('adds the quote after the open discussion draft and opens that discussion', () => {
  story(
    update,
    given({
      ...loaded,
      side: 'Talk',
      talkDrafts: { 'ask:grill-flow': 'Two things.' },
      workspace: {
        ...loaded.workspace,
        maybeDiscussionTarget: Option.some(GRILL_FLOW_TARGET),
      },
    }),
    message(Message.SelectedQuoteText({ quoted })),
    message(Message.ClickedQuoteInDiscussion()),
    model(next => {
      expect(next.talkDrafts['ask:grill-flow']).toBe(
        'Two things.\n\n> the reasoning behind it\n\n',
      )
      expect(next.talkGeneration).toBe(loaded.talkGeneration + 1)
      expect(next.workspace.quote._tag).toBe('Idle')
    }),
    Command.expectExact(FocusTalkBox()),
    Command.resolve(FocusTalkBox, Message.CompletedFocus()),
  )
})

it('quotes into the selected question when the discussion panel is closed', () => {
  story(
    update,
    given({
      ...loaded,
      workspace: {
        ...loaded.workspace,
        maybeDiscussionTarget: Option.some(GRILL_FLOW_TARGET),
      },
    }),
    message(Message.SelectedQuoteText({ quoted })),
    message(Message.ClickedQuoteInDiscussion()),
    model(next => {
      expect(next.side).toBe('Talk')
      expect(next.workspace.maybeDiscussionTarget).toEqual(
        Option.some('step-q1'),
      )
      expect(next.talkDrafts['ask:step-q1']).toBe(
        '> the reasoning behind it\n\n',
      )
    }),
    Command.resolve(FocusTalkBox, Message.CompletedFocus()),
  )
})

it('keeps a composing reply when another selection or a clear arrives', () => {
  story(
    update,
    given(loaded),
    message(Message.SelectedQuoteText({ quoted })),
    message(Message.ClickedQuoteReply()),
    Command.resolve(FocusQuoteBox, Message.CompletedFocus()),
    message(
      Message.SelectedQuoteText({
        quoted: { ...quoted, text: 'something else' },
      }),
    ),
    message(Message.ClearedQuoteSelection()),
    model(next =>
      expect(next.workspace.quote).toEqual({ _tag: 'Composing', quoted }),
    ),
  )
})
