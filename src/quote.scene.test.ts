import { Option, Result, Schema } from 'effect'
import { Url } from 'foldkit'
import {
  Command,
  Mount,
  Subscription,
  click,
  expect,
  given,
  role,
  scene,
  selector,
} from 'foldkit/scene'
import { readFileSync } from 'node:fs'
import { describe, it } from 'vitest'

import { GRILL_FLOW_TARGET, Grill, type Snapshot } from './domain'
import {
  FillBox,
  FocusDraftBox,
  FocusQuoteBox,
  Message,
  PageData,
  PostEvent,
  ReadQuoteBox,
  RestoreDiscussionScroll,
  init,
  update,
} from './main'
import { view } from './view'

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
  maintainerSession: 't2hw',
}
const start = init(
  Option.getOrThrow(
    Url.fromString('http://127.0.0.1:4330/g/fixture/question/Q1'),
  ),
).model
const loaded = { ...start, page: PageData.Success({ data: snapshot }) }
const quoted = {
  stepId: 'step-q1',
  text: 'the reasoning behind it',
  top: 120,
  bottom: 140,
  left: 300,
  placement: 'Above' as const,
}
const fillOne = Mount.resolveAll([FillBox, Message.CompletedFillBox()])
const discussionMounted = Mount.resolveAll(
  [FillBox, Message.CompletedFillBox()],
  [FillBox, Message.CompletedFillBox()],
  [RestoreDiscussionScroll, Message.CompletedRestoreDiscussionScroll()],
)

describe('the selection popover', () => {
  it('replies to a selection from a composer inside the popover', () => {
    scene(
      { update, view },
      given(loaded),
      fillOne,
      Subscription.emit(Message.SelectedQuoteText({ quoted })),
      expect(role('toolbar', { name: 'Selected text' })).toExist(),
      expect(selector('.f-quote-popover')).toHaveStyle('top', '120px'),
      expect(selector('.f-quote-popover')).toHaveStyle('left', '300px'),
      click(role('button', { name: 'Reply' })),
      Command.expectExact(FocusQuoteBox()),
      Command.resolve(FocusQuoteBox, Message.CompletedFocus()),
      Mount.resolve(FillBox, Message.CompletedFillBox()),
      expect(role('textbox', { name: 'Reply · to Q1' })).toExist(),
      expect(selector('.f-quote-excerpt')).toHaveText(
        'the reasoning behind it',
      ),
      Subscription.emit(Message.ClearedQuoteSelection()),
      expect(role('textbox', { name: 'Reply · to Q1' })).toExist(),
      click(role('button', { name: 'Send' })),
      Command.expectExact(ReadQuoteBox()),
      Command.resolve(
        ReadQuoteBox,
        Message.CompletedReadQuoteBox({ text: 'Why this one?' }),
      ),
      Command.expectExact(
        PostEvent({
          grillId: 'fixture',
          body: JSON.stringify({
            kind: 'asked',
            stepId: 'step-q1',
            text: '> the reasoning behind it\n\nWhy this one?',
          }),
        }),
      ),
      Command.resolve(
        PostEvent,
        Message.CompletedPostEvent({ result: Result.fail('offline') }),
      ),
      Mount.expectEnded(FillBox),
      expect(selector('.f-quote-popover')).not.toExist(),
      expect(selector('aside.f-sessions')).not.toExist(),
    )
  })

  it('quotes a selection into the open discussion draft', () => {
    scene(
      { update, view },
      given({
        ...loaded,
        side: 'Talk',
        inbox: { ...loaded.inbox, isSessionDirectory: false },
        talkDrafts: { 'ask:grill-flow': 'Two things.' },
        workspace: {
          ...loaded.workspace,
          maybeDiscussionTarget: Option.some(GRILL_FLOW_TARGET),
        },
      }),
      discussionMounted,
      Subscription.emit(Message.SelectedQuoteText({ quoted })),
      expect(role('button', { name: 'Quote' })).toHaveAttr(
        'title',
        'Add it as a quote to the Board discussion',
      ),
      click(role('button', { name: 'Quote' })),
      Command.expectExact(FocusDraftBox({ key: 'ask:grill-flow' })),
      Command.resolve(FocusDraftBox, Message.CompletedFocus()),
      expect(selector('.f-quote-popover')).not.toExist(),
    )
  })

  it('closes on Escape and drops an offered toolbar when the selection clears', () => {
    scene(
      { update, view },
      given(loaded),
      fillOne,
      Subscription.emit(Message.SelectedQuoteText({ quoted })),
      Subscription.emit(Message.ClearedQuoteSelection()),
      expect(selector('.f-quote-popover')).not.toExist(),
      Subscription.emit(Message.SelectedQuoteText({ quoted })),
      click(role('button', { name: 'Reply' })),
      Command.resolve(FocusQuoteBox, Message.CompletedFocus()),
      Mount.resolve(FillBox, Message.CompletedFillBox()),
      Subscription.emit(Message.DismissedQuote()),
      Mount.expectEnded(FillBox),
      expect(selector('.f-quote-popover')).not.toExist(),
    )
  })
})
