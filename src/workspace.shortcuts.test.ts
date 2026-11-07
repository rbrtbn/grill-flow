import { Effect, Option, Stream } from 'effect'
import { Url } from 'foldkit'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Message, init, subscriptions } from './main'

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

const listenForQuestionArrow = async () => {
  const listen = vi.spyOn(document, 'addEventListener')
  const result = Effect.runPromise(
    subscriptions.questionArrows
      .dependenciesToStream({ enabled: true })
      .pipe(Stream.runHead, Effect.timeout('2 seconds')),
  )
  await vi.waitFor(() =>
    expect(listen.mock.calls.some(([type]) => type === 'keydown')).toBe(true),
  )
  return { result }
}

describe('question arrow keyboard shortcuts', () => {
  it.each([
    { key: 'ArrowLeft', direction: 'Previous' satisfies 'Previous' | 'Next' },
    { key: 'ArrowRight', direction: 'Next' satisfies 'Previous' | 'Next' },
  ])('maps $key to $direction', async ({ key, direction }) => {
    const pending = await listenForQuestionArrow()
    const event = new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
    })
    document.body.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(await pending.result).toEqual(
      Option.some(Message.PressedQuestionArrow({ direction })),
    )
  })

  it.each([
    { tag: 'input', attribute: '', value: '' },
    { tag: 'textarea', attribute: '', value: '' },
    { tag: 'select', attribute: '', value: '' },
    { tag: 'div', attribute: 'contenteditable', value: 'true' },
    { tag: 'div', attribute: 'role', value: 'textbox' },
    { tag: 'div', attribute: 'role', value: 'slider' },
    { tag: 'div', attribute: 'class', value: 'f-discussion' },
  ])(
    'preserves arrows inside $tag $attribute=$value',
    async ({ tag, attribute, value }) => {
      const pending = await listenForQuestionArrow()
      const element = document.createElement(tag)
      if (attribute !== '') element.setAttribute(attribute, value)
      document.body.append(element)
      const target =
        tag === 'div'
          ? element.appendChild(document.createElement('span'))
          : element
      const ignored = new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        bubbles: true,
        cancelable: true,
      })
      target.dispatchEvent(ignored)
      expect(ignored.defaultPrevented).toBe(false)
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'ArrowRight',
          bubbles: true,
          cancelable: true,
        }),
      )
      expect(await pending.result).toEqual(
        Option.some(Message.PressedQuestionArrow({ direction: 'Next' })),
      )
    },
  )

  it('leaves modified, repeated, composing and already-handled arrows alone', async () => {
    const pending = await listenForQuestionArrow()
    const variants = [
      { altKey: true },
      { ctrlKey: true },
      { metaKey: true },
      { shiftKey: true },
      { repeat: true },
      { isComposing: true },
    ]
    variants.forEach(modifiers => {
      const event = new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        bubbles: true,
        cancelable: true,
        ...modifiers,
      })
      document.body.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
    })
    const handled = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true,
      cancelable: true,
    })
    handled.preventDefault()
    document.body.dispatchEvent(handled)
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowLeft',
        bubbles: true,
        cancelable: true,
      }),
    )
    expect(await pending.result).toEqual(
      Option.some(Message.PressedQuestionArrow({ direction: 'Previous' })),
    )
  })

  it('only enables arrows on a visible question page', () => {
    const model = init(
      Option.getOrThrow(
        Url.fromString('http://127.0.0.1:4317/g/fixture/question/Q1'),
      ),
    ).model
    expect(
      subscriptions.questionArrows.modelToDependencies(model).enabled,
    ).toBe(true)
    expect(
      subscriptions.questionArrows.modelToDependencies({
        ...model,
        currentPart: 'review',
      }).enabled,
    ).toBe(false)
    expect(
      subscriptions.questionArrows.modelToDependencies({
        ...model,
        workspace: { ...model.workspace, isSettingsOpen: true },
      }).enabled,
    ).toBe(false)
    expect(
      subscriptions.questionArrows.modelToDependencies({
        ...model,
        workspace: { ...model.workspace, isDiscussionExpanded: true },
      }).enabled,
    ).toBe(false)
  })

  it('does not subscribe while disabled', async () => {
    expect(
      await Effect.runPromise(
        subscriptions.questionArrows
          .dependenciesToStream({ enabled: false })
          .pipe(Stream.runCollect),
      ),
    ).toEqual([])
  })
})
