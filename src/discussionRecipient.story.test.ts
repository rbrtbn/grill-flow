import { Option, Schema } from 'effect'
import { Url } from 'foldkit'
import { Command, given, message, model, story } from 'foldkit/story'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

import { GRILL_FLOW_TARGET, Grill, type Snapshot } from './domain'
import {
  FocusTalkBox,
  Message,
  PageData,
  PushPage,
  RestoreDiscussionPosition,
  ScrollToTop,
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
  maintainerSession: 't2hw',
}
const loaded = {
  ...init(
    Option.getOrThrow(Url.fromString('http://localhost/g/fixture/question/Q1')),
  ).model,
  side: 'Talk' as const,
  page: PageData.Success({ data: snapshot }),
}
const navigated = [
  Command.resolve(PushPage, Message.CompletedNavigate()),
  Command.resolve(ScrollToTop, Message.CompletedScroll()),
] as const

it('keeps the recipient picked on a question when the reader leaves and comes back', () => {
  story(
    update,
    given(loaded),
    message(Message.SelectedDiscussionTarget({ target: GRILL_FLOW_TARGET })),
    Command.resolve(
      RestoreDiscussionPosition,
      Message.CompletedRestoreDiscussionPosition(),
    ),
    Command.resolve(FocusTalkBox, Message.CompletedFocus()),
    message(Message.ClickedWorkspacePage({ page: 'question:Q2' })),
    ...navigated,
    model(next =>
      expect(next.workspace.maybeDiscussionTarget).toEqual(
        Option.some('step-q2'),
      ),
    ),
    message(Message.ClickedWorkspacePage({ page: 'question:Q1' })),
    ...navigated,
    model(next => {
      expect(next.workspace.maybeDiscussionTarget).toEqual(
        Option.some(GRILL_FLOW_TARGET),
      )
      expect(next.workspace.discussionTargets).toEqual({
        'step-q1': GRILL_FLOW_TARGET,
      })
    }),
  )
})
