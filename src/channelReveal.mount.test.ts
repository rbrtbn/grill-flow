import { Effect, Option, Stream } from 'effect'
import { Mount } from 'foldkit'
import { afterEach, expect, it, vi } from 'vitest'

import { Message, RevealChannelItem } from './main'

afterEach(() => {
  vi.restoreAllMocks()
  document.body.replaceChildren()
})
const frame = () =>
  new Promise<void>(resolve => requestAnimationFrame(() => resolve()))

it('waits for fonts before the final fragment scroll and leaves the native archive user-controlled', async () => {
  const original = Object.getOwnPropertyDescriptor(document, 'fonts')
  const ready = Promise.withResolvers<FontFaceSet>()
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { ready: ready.promise },
  })
  const details = document.createElement('details')
  const summary = document.createElement('summary')
  summary.textContent = 'Earlier items'
  const target = document.createElement('article')
  target.id = 'gf-item-target'
  details.append(summary, target)
  document.body.append(details)
  const scroll = vi
    .spyOn(target, 'scrollIntoView')
    .mockImplementation(() => undefined)
  const focus = vi.spyOn(target, 'focus').mockImplementation(() => undefined)
  const running = Effect.runPromise(
    Effect.scoped(
      Stream.runHead(
        RevealChannelItem({ id: target.id }).f(
          target,
          Mount.liveViewStateChanges,
        ),
      ),
    ),
  )
  try {
    await frame()
    await frame()
    await frame()
    expect(details.open).toBe(true)
    expect(scroll).not.toHaveBeenCalled()
    ready.resolve(document.fonts)
    const result = await running
    expect(Option.getOrThrow(result)).toEqual(
      Message.CompletedRevealChannelItem({ id: target.id }),
    )
    expect(scroll).toHaveBeenCalledExactlyOnceWith({ block: 'start' })
    expect(focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true })
    expect(details.open).toBe(true)
    details.open = false
    await frame()
    expect(details.open).toBe(false)
  } finally {
    if (original === undefined) {
      Reflect.deleteProperty(document, 'fonts')
    } else {
      Object.defineProperty(document, 'fonts', original)
    }
  }
})
