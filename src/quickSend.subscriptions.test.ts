import { Effect, Option, Stream } from 'effect'
import { afterEach, expect, it, vi } from 'vitest'

import { Message, subscriptions } from './main'

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

it('tracks Command press/release and resets it when the window loses focus', async () => {
  const documentListen = vi.spyOn(document, 'addEventListener')
  const windowListen = vi.spyOn(window, 'addEventListener')
  const seen: Array<Message> = []
  const pending = Effect.runPromise(
    subscriptions.commandHeld.dependenciesToStream({ enabled: true }).pipe(
      Stream.tap(message => Effect.sync(() => seen.push(message))),
      Stream.take(4),
      Stream.runCollect,
      Effect.timeout('2 seconds'),
    ),
  )
  await vi.waitFor(() => {
    expect(documentListen.mock.calls.some(([type]) => type === 'keyup')).toBe(
      true,
    )
    expect(windowListen.mock.calls.some(([type]) => type === 'blur')).toBe(true)
  })
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Meta', metaKey: true }),
  )
  await vi.waitFor(() => expect(seen).toHaveLength(1))
  document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Meta' }))
  await vi.waitFor(() => expect(seen).toHaveLength(2))
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Meta', metaKey: true }),
  )
  await vi.waitFor(() => expect(seen).toHaveLength(3))
  window.dispatchEvent(new Event('blur'))
  expect(await pending).toEqual([
    Message.UpdatedCommandHeld({ held: true }),
    Message.UpdatedCommandHeld({ held: false }),
    Message.UpdatedCommandHeld({ held: true }),
    Message.UpdatedCommandHeld({ held: false }),
  ])
})

it('captures only modified header clicks before the normal review handler', async () => {
  const listen = vi.spyOn(document, 'addEventListener')
  const pending = Effect.runPromise(
    subscriptions.quickSendClick
      .dependenciesToStream({ enabled: true })
      .pipe(Stream.runHead, Effect.timeout('2 seconds')),
  )
  await vi.waitFor(() =>
    expect(listen.mock.calls.some(([type]) => type === 'click')).toBe(true),
  )
  const button = document.createElement('button')
  button.id = 'workspace-review-send'
  const label = button.appendChild(document.createElement('span'))
  document.body.append(button)
  const normal = vi.fn()
  button.addEventListener('click', normal)
  label.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true }),
  )
  expect(normal).toHaveBeenCalledTimes(1)
  const modified = new MouseEvent('click', {
    metaKey: true,
    bubbles: true,
    cancelable: true,
  })
  label.dispatchEvent(modified)
  expect(modified.defaultPrevented).toBe(true)
  expect(normal).toHaveBeenCalledTimes(1)
  expect(await pending).toEqual(Option.some(Message.ClickedQuickSend()))
})
