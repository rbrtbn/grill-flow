import { Effect, Option, Stream } from 'effect'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Message, subscriptions } from './main'

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('quick answer keyboard shortcut', () => {
  it.each(['ctrlKey', 'metaKey'])(
    'works with %s outside the reading column and leaves discussion input alone',
    async modifier => {
      const listen = vi.spyOn(document, 'addEventListener')
      const result = Effect.runPromise(
        subscriptions.workspaceShortcut
          .dependenciesToStream({ page: 'question:Q1' })
          .pipe(Stream.runHead, Effect.timeout('2 seconds')),
      )
      await vi.waitFor(() =>
        expect(listen.mock.calls.some(([type]) => type === 'keydown')).toBe(
          true,
        ),
      )
      const discussion = document.createElement('aside')
      discussion.className = 'f-discussion'
      const textarea = document.createElement('textarea')
      discussion.append(textarea)
      document.body.append(discussion)
      const ignored = new KeyboardEvent('keydown', {
        key: 'Enter',
        [modifier]: true,
        bubbles: true,
        cancelable: true,
      })
      textarea.dispatchEvent(ignored)
      expect(ignored.defaultPrevented).toBe(false)
      const handled = new KeyboardEvent('keydown', {
        key: 'Enter',
        [modifier]: true,
        bubbles: true,
        cancelable: true,
      })
      document.body.dispatchEvent(handled)
      expect(handled.defaultPrevented).toBe(true)
      expect(await result).toEqual(
        Option.some(Message.PressedWorkspaceShortcut()),
      )
    },
  )
})
