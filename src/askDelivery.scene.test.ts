import { Option, Result, Schema } from 'effect'
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
import { describe, it } from 'vitest'

import { GRILL_FLOW_TARGET, Grill, type Snapshot } from './domain'
import {
  FillBox,
  Message,
  PageData,
  PostEvent,
  RestoreDiscussionScroll,
  init,
  update,
} from './main'
import { view } from './view'

const grill = Schema.decodeUnknownSync(Grill)(
  JSON.parse(readFileSync('src/fixtures/grill.json', 'utf8')),
)
const ask = {
  id: 41,
  stepId: GRILL_FLOW_TARGET,
  text: 'Can the page quote a highlight?',
  at: 1,
  answered: false,
}
const snapshot: Snapshot = {
  grill,
  answers: {},
  notes: {},
  own: {},
  asks: [],
  revisions: [],
  sends: [],
  maintainerSession: 't18v',
}
const start = init(
  Option.getOrThrow(
    Url.fromString('http://127.0.0.1:4330/g/fixture/question/Q1'),
  ),
).model
const onGrillFlow = (data: Snapshot) => ({
  ...start,
  side: 'Talk' as const,
  page: PageData.Success({ data }),
  workspace: {
    ...start.workspace,
    maybeDiscussionTarget: Option.some(GRILL_FLOW_TARGET),
  },
})
const mounted = Mount.resolveAll(
  [FillBox, Message.CompletedFillBox()],
  [RestoreDiscussionScroll, Message.CompletedRestoreDiscussionScroll()],
)

describe('ask delivery', () => {
  it('shows an undelivered ask and offers the grill session instead', () => {
    scene(
      { update, view },
      given(
        onGrillFlow({
          ...snapshot,
          maintainerState: 'missing',
          asks: [
            {
              ...ask,
              delivery: {
                state: 'failed',
                to: 't18v',
                detail:
                  '{"error":{"hint":"see `hc ls --all`","kind":"not_found","message":"no terminal \\"t18v\\""}}',
              },
            },
          ],
        }),
      ),
      mounted,
      expect(selector('.f-discussion-head .hint')).toHaveText(
        'Squad Board · t18v · not in Herdr',
      ),
      expect(selector('.f-maintainer-warning')).toContainText(
        't18v is no longer in Herdr',
      ),
      expect(role('alert')).toContainText('Not delivered to t18v.'),
      expect(role('alert')).toContainText('Herdr says: no terminal "t18v".'),
      expect(selector('.f-discussion-messages')).not.toContainText(
        'Working on it',
      ),
      click(role('button', { name: 'Send to t0 instead' })),
      Command.expectExact(
        PostEvent({
          grillId: 'fixture',
          body: JSON.stringify({
            kind: 'redelivered',
            askId: 41,
            stepId: GRILL_FLOW_TARGET,
            route: 'fallback',
          }),
        }),
      ),
      Command.resolve(
        PostEvent,
        Message.CompletedPostEvent({
          result: Result.fail('offline'),
        }),
      ),
    )
  })

  it('names the recipient of a delivered ask while it waits', () => {
    scene(
      { update, view },
      given(
        onGrillFlow({
          ...snapshot,
          maintainerState: 'live',
          asks: [
            {
              ...ask,
              delivery: { state: 'delivered', to: 't18v', detail: 'sent' },
            },
          ],
        }),
      ),
      mounted,
      expect(selector('.f-discussion-head .hint')).toHaveText(
        'Squad Board · t18v',
      ),
      expect(selector('.f-maintainer-warning')).not.toExist(),
      expect(selector('.f-discussion-messages')).toContainText(
        'Sent to t18v · waiting for a reply…',
      ),
    )
  })
})
