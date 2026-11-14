import { Option, Schema } from 'effect'
import { Url } from 'foldkit'
import {
  Command,
  Mount,
  click,
  expect,
  given,
  role,
  scene,
  selector,
} from 'foldkit/scene'
import { readFileSync } from 'node:fs'
import { it } from 'vitest'

import { Snapshot } from './domain'
import {
  FillBox,
  FocusTalkBox,
  Message,
  PageData,
  PushPage,
  RestoreDiscussionScroll,
  ScrollToTop,
  init,
  update,
} from './main'
import { view } from './view'

const fixture = JSON.parse(readFileSync('src/fixtures/grill.json', 'utf8'))
const grill = {
  ...fixture,
  steps: fixture.steps.map(
    (step: { question: Record<string, unknown> }, index: number) => ({
      ...step,
      question: {
        ...step.question,
        session: index % 2 === 0 ? 't-even' : 't-odd',
        urgency: 'soon',
      },
    }),
  ),
}
const snapshot = Schema.decodeUnknownSync(Snapshot)({
  grill,
  answers: {},
  notes: {},
  own: {},
  asks: [],
  revisions: [],
  sends: [],
  agents: [
    { address: 't-even', name: 'Even builder', program: 'claude', lead: false },
  ],
})
const loaded = (path: string) => ({
  ...init(Option.getOrThrow(Url.fromString(`http://localhost${path}`))).model,
  page: PageData.Success({ data: snapshot }),
})

it('opens the sessions panel beside the page and a session conversation from it', () => {
  scene(
    { update, view },
    given(loaded('/g/fixture/inbox')),
    expect(role('complementary', { name: 'Sessions' })).not.toExist(),
    click(role('button', { name: 'Sessions' })),
    expect(selector('.f-sessions-pinned')).toContainText('Squad lead'),
    expect(role('complementary', { name: 'Sessions' })).not.toContainText(
      'Recent conversations',
    ),
    expect(role('complementary', { name: 'Sessions' })).not.toContainText(
      'Pinned',
    ),
    expect(role('group', { name: 'Order' })).toContainText('Recent'),
    expect(selector('.f-sessions select')).not.toExist(),
    expect(selector('.f-sessions-list .f-avatar')).toExist(),
    click(role('button', { name: /Even builder/ })),
    Command.resolve(FocusTalkBox, Message.CompletedFocus()),
    expect(selector('.f-identity')).toContainText('Even builder'),
    expect(role('textbox', { name: 'Message t-even' })).toExist(),
    Mount.resolveAll(
      [FillBox, Message.CompletedFillBox()],
      [RestoreDiscussionScroll, Message.CompletedRestoreDiscussionScroll()],
    ),
    click(role('button', { name: '‹ Sessions' })),
    Mount.expectEnded(FillBox),
    Mount.expectEnded(RestoreDiscussionScroll),
    expect(selector('.f-sessions-search')).toExist(),
  )
})

it('walks only the questions the address filters keep', () => {
  scene(
    { update, view },
    given(loaded('/g/fixture/question/Q1?run=t-even')),
    expect(selector('.f-active-filters')).toContainText('Session t-even'),
    expect(selector('.f-question-count')).toHaveText(/^1 of /),
    Mount.resolveAll([FillBox, Message.CompletedFillBox()]),
    click(role('button', { name: 'Next question' })),
    Command.expectExact(
      PushPage({ url: '/g/fixture/question/Q3?run=t-even' }),
      ScrollToTop(),
    ),
    Command.resolve(PushPage, Message.CompletedNavigate()),
    Command.resolve(ScrollToTop, Message.CompletedScroll()),
    expect(selector('.f-question-title')).toHaveText('Title Q3'),
  )
})

it('opens a conversation in the middle of the Conversations page, beside the same panel', () => {
  scene(
    { update, view },
    given(loaded('/g/fixture/inbox')),
    click(role('button', { name: 'Conversations' })),
    Command.resolve(PushPage, Message.CompletedNavigate()),
    Command.resolve(ScrollToTop, Message.CompletedScroll()),
    Mount.resolveAll(
      [FillBox, Message.CompletedFillBox()],
      [RestoreDiscussionScroll, Message.CompletedRestoreDiscussionScroll()],
    ),
    expect(selector('.f-sessions.is-docked .f-sessions-pinned')).toContainText(
      'Squad lead',
    ),
    click(role('button', { name: /Even builder/ })),
    Command.resolve(FocusTalkBox, Message.CompletedFocus()),
    expect(role('region', { name: 'Conversation' })).toContainText(
      'Even buildert-even · Interactive',
    ),
    expect(selector('.f-sessions:not(.is-docked)')).not.toExist(),
    expect(selector('.f-session-row.is-current')).toContainText('Even builder'),
    click(role('button', { name: /^Inbox/ })),
    Command.resolve(PushPage, Message.CompletedNavigate()),
    Command.resolve(ScrollToTop, Message.CompletedScroll()),
    Mount.expectEnded(FillBox),
    Mount.expectEnded(RestoreDiscussionScroll),
    expect(role('complementary', { name: 'Sessions' })).not.toExist(),
  )
})
