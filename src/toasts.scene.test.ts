import { Option, Result, Schema } from 'effect'
import { Url } from 'foldkit'
import {
  Mount,
  all,
  click,
  expect,
  expectAll,
  given,
  role,
  scene,
  selector,
} from 'foldkit/scene'
import { readFileSync } from 'node:fs'
import { expect as assert, describe, it } from 'vitest'

import { Grill, type Snapshot } from './domain'
import {
  FillBox,
  Message,
  PageData,
  RestoreDiscussionScroll,
  init,
  unreadMessagesOf,
  update,
} from './main'
import { view } from './view'
import { CONVERSATIONS } from './workspace'

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
  replies: Array.from({ length: 5 }, (_, index) => ({
    id: index + 1,
    at: index + 1,
    text: `Agent reply ${index + 1}`,
  })),
}
const start = init(
  Option.getOrThrow(
    Url.fromString('http://127.0.0.1:4317/g/fixture/question/Q1'),
  ),
).model
const filled = Message.CompletedFillBox()
const fillOne = Mount.resolveAll([FillBox, filled])
const noMounts = Mount.resolveAll()
const loaded = {
  ...start,
  readSince: Option.some(0),
  page: PageData.Success({ data: snapshot }),
}

describe('agent toast notifications', () => {
  it.each([
    ['question:Q1', '5', fillOne],
    ['part-1', '5', noMounts],
  ])(
    'collapses and reopens without navigating or reading on %s',
    (currentPart, badge, resolveMounts) => {
      const collapsed = update(
        { ...loaded, currentPart },
        Message.ClickedNotificationTray(),
      )
      assert(collapsed.model.currentPart).toBe(currentPart)
      assert(collapsed.model.side).toBe(loaded.side)
      assert(collapsed.model.readIds).toEqual([])
      assert(collapsed.commands).toBeUndefined()
      const reopened = update(
        collapsed.model,
        Message.ClickedNotificationTray(),
      )
      assert(reopened.model.currentPart).toBe(currentPart)
      assert(reopened.model.readIds).toEqual([])
      assert(reopened.commands).toBeUndefined()
      scene(
        { update, view },
        given({ ...loaded, currentPart }),
        resolveMounts,
        click(role('button', { name: 'Hide 5 unread notifications' })),
        expectAll(all.selector('.toast')).toHaveCount(0),
        expect(selector('.notification-count')).toHaveText(badge),
        click(role('button', { name: 'Show 5 unread notifications' })),
        expectAll(all.selector('.toast')).toHaveCount(3),
      )
    },
  )

  it('updates the badge without reopening when another unread reply arrives', () => {
    const collapsed = update(loaded, Message.ClickedNotificationTray()).model
    const incoming = update(
      collapsed,
      Message.CompletedLoadGrill({
        result: Result.succeed({
          ...snapshot,
          replies: [
            ...(snapshot.replies ?? []),
            { id: 6, at: 6, text: 'New while collapsed' },
          ],
        }),
      }),
    )
    assert(incoming.model.readIds).toEqual([])
    assert(incoming.commands).toBeUndefined()
    scene(
      { update, view },
      given(incoming.model),
      fillOne,
      expectAll(all.selector('.toast')).toHaveCount(0),
      expect(role('button', { name: 'Show 6 unread notifications' })).toExist(),
      expect(selector('.notification-count')).toHaveText('6'),
      click(role('button', { name: 'Show 6 unread notifications' })),
      expectAll(all.selector('.toast')).toHaveCount(3),
      expect(selector('.toast')).toContainText('New while collapsed'),
    )
  })

  it('still marks an individually dismissed notification read', () => {
    const dismissed = update(
      loaded,
      Message.DismissedAgentMessage({ id: 'reply-5' }),
    )
    assert(dismissed.model.readIds).toEqual(['reply-5'])
    assert(unreadMessagesOf(dismissed.model)).toHaveLength(4)
    assert(dismissed.commands).toHaveLength(1)
  })

  it('omits the tray when there are no unread messages', () => {
    scene(
      { update, view },
      given({ ...loaded, readSince: Option.some(5) }),
      fillOne,
      expectAll(all.selector('.notification-tray-toggle')).toHaveCount(0),
      expectAll(all.selector('.toast')).toHaveCount(0),
    )
  })

  it.each([false, true])(
    'keeps notifications outside discussion when expanded is %s',
    isDiscussionExpanded => {
      scene(
        { update, view },
        given({
          ...loaded,
          side: 'Talk',
          inbox: { ...loaded.inbox, isSessionDirectory: false },
          workspace: { ...loaded.workspace, isDiscussionExpanded },
        }),
        Mount.resolveAll(
          [FillBox, filled],
          [FillBox, filled],
          [RestoreDiscussionScroll, Message.CompletedRestoreDiscussionScroll()],
        ),
        expect(selector('.f-discussion-compose')).toExist(),
        expect(selector('.f-frame .toasts')).toExist(),
        expectAll(all.selector('.f-main .toasts')).toHaveCount(0),
        expectAll(all.selector('.f-sessions .toasts')).toHaveCount(0),
        expectAll(all.selector('.f-discussion .toasts')).toHaveCount(0),
      )
    },
  )

  it('floats notifications over the full Conversations page, which has no sidebar', () => {
    scene(
      { update, view },
      given({ ...loaded, currentPart: CONVERSATIONS }),
      Mount.resolveAll(
        [FillBox, Message.CompletedFillBox()],
        [RestoreDiscussionScroll, Message.CompletedRestoreDiscussionScroll()],
      ),
      expect(selector('.f-discussion-compose')).toExist(),
      expect(selector('.f-frame .toasts')).toExist(),
      expectAll(all.selector('.f-question-pane .toasts')).toHaveCount(0),
      expectAll(all.selector('.f-main .toasts')).toHaveCount(0),
    )
  })
})
