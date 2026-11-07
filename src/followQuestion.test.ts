import { Effect, Option, Stream } from 'effect'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Message, ScrollToWhy, subscriptions } from './main'

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

const place = (selector: string, top: number, height: number): Element => {
  const element = document.querySelector(selector)
  if (element === null) {
    throw new Error(`Missing ${selector}`)
  }
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, top, 400, height),
  )
  return element
}

describe('scrolling the question page', () => {
  it.each(['part-2', 'urgency:soon'])(
    'follows a visible unanswered question on %s',
    async page => {
      document.body.innerHTML = `
        <header class="topbar"></header>
        <h1 class="concept-title">Concept</h1>
        <div class="questions">
          <section id="q-Q1" class="question is-answered is-expanded"></section>
          <section id="q-Q2" class="question is-waiting is-expanded"></section>
          <section id="q-Q3" class="question is-open is-expanded"></section>
        </div>
      `
      place('.topbar', 0, 80)
      place('.concept-title', 100, 40)
      place('#q-Q1', 150, 400)
      place('#q-Q2', 550, 200)
      place('#q-Q3', window.innerHeight + 50, 200)
      const listen = vi.spyOn(window, 'addEventListener')
      const received = Effect.runPromise(
        subscriptions.followQuestion
          .dependenciesToStream({ page })
          .pipe(Stream.runHead, Effect.timeout('2 seconds')),
      )
      await vi.waitFor(() =>
        expect(listen.mock.calls.some(([type]) => type === 'scroll')).toBe(
          true,
        ),
      )
      window.dispatchEvent(new Event('scroll'))
      expect(await received).toEqual(
        Option.some(
          page === 'part-2'
            ? Message.ScrolledToAbout({ partId: page, about: 'Q2' })
            : Message.ScrolledToQuestion({ question: 'Q2' }),
        ),
      )
    },
  )

  it('emits once per question as the reading position moves down the page', async () => {
    document.body.innerHTML = `
      <header class="topbar"></header>
      <div class="questions">
        <section id="q-Q2" class="question is-open is-expanded"></section>
        <section id="q-Q3" class="question is-open is-expanded"></section>
      </div>
    `
    place('.topbar', 0, 80)
    const current = place('#q-Q2', 100, 500)
    const next = place('#q-Q3', window.innerHeight + 50, 500)
    const listen = vi.spyOn(window, 'addEventListener')
    const received = Effect.runPromise(
      subscriptions.followQuestion
        .dependenciesToStream({ page: 'part-2' })
        .pipe(Stream.take(2), Stream.runCollect, Effect.timeout('2 seconds')),
    )
    await vi.waitFor(() =>
      expect(listen.mock.calls.some(([type]) => type === 'scroll')).toBe(true),
    )
    window.dispatchEvent(new Event('scroll'))
    window.dispatchEvent(new Event('scroll'))
    vi.mocked(current.getBoundingClientRect).mockReturnValue(
      new DOMRect(0, -500, 400, 500),
    )
    vi.mocked(next.getBoundingClientRect).mockReturnValue(
      new DOMRect(0, 100, 400, 500),
    )
    window.dispatchEvent(new Event('scroll'))
    expect(await received).toEqual([
      Message.ScrolledToAbout({ partId: 'part-2', about: 'Q2' }),
      Message.ScrolledToAbout({ partId: 'part-2', about: 'Q3' }),
    ])
  })

  it('scrolls only the Talk messages to the reasoning heading', async () => {
    document.body.innerHTML = `
      <aside class="side talk">
        <div class="messages"><div id="why-step-q2"></div></div>
      </aside>
    `
    const messages = place('.messages', 150, 500)
    place('#why-step-q2', 900, 1200)
    messages.scrollTop = 100
    const sidebarScroll = vi.spyOn(messages, 'scrollTo')
    const pageScroll = vi.spyOn(window, 'scrollTo')
    const ancestorScroll = vi.spyOn(Element.prototype, 'scrollIntoView')
    await Effect.runPromise(ScrollToWhy({ stepId: 'step-q2' }).effect)
    expect(sidebarScroll).toHaveBeenCalledWith({
      top: 834,
      behavior: 'instant',
    })
    expect(pageScroll).not.toHaveBeenCalled()
    expect(ancestorScroll).not.toHaveBeenCalled()
  })
})
