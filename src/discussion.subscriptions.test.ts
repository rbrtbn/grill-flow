import { Effect, Option, Stream } from 'effect'
import { afterEach, expect, it, vi } from 'vitest'

import { Message, subscriptions } from './main'

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

it('marks only messages actually visible inside the discussion viewport after a dwell', async () => {
  const pane = document.createElement('div')
  pane.className = 'f-discussion-messages'
  vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(200, 100, 500, 400),
  )
  document.body.append(pane)
  const placements = [
    { id: 'visible', box: new DOMRect(220, 120, 300, 80) },
    { id: 'below', box: new DOMRect(220, 600, 300, 80) },
    { id: 'sideways', box: new DOMRect(800, 120, 300, 80) },
    { id: 'hidden', box: new DOMRect(220, 120, 300, 80), visibility: 'hidden' },
    { id: 'collapsed', box: new DOMRect(0, 0, 0, 0) },
  ]
  placements.forEach(({ id, box, visibility }) => {
    const element = document.createElement('div')
    element.id = `talk-agent-${id}`
    element.style.visibility = visibility ?? 'visible'
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(box)
    pane.append(element)
  })
  const pending = Effect.runPromise(
    subscriptions.seeAgent
      .dependenciesToStream({
        unread: placements.map(item => item.id).join(','),
      })
      .pipe(Stream.runHead, Effect.timeout('3 seconds')),
  )
  expect(await pending).toEqual(
    Option.some(Message.SawAgentMessages({ ids: ['visible'] })),
  )
})
