import { Option } from 'effect'
import { describe, expect, it } from 'vitest'

import { quoteDestination, quotedAsk, splitQuote, withQuote } from './quote'

describe('quoteDestination', () => {
  it('follows the open discussion panel, else the quoted question', () => {
    expect(quoteDestination(true, Option.some('grill-flow'), 'step-q1')).toBe(
      'grill-flow',
    )
    expect(quoteDestination(true, Option.none(), 'step-q1')).toBe('step-q1')
    expect(quoteDestination(false, Option.some('grill-flow'), 'step-q1')).toBe(
      'step-q1',
    )
  })
})

describe('quoted text', () => {
  it('quotes every line and keeps blank ones inside the quote', () => {
    expect(quotedAsk(' First line\n\nSecond line ', ' Why? ')).toBe(
      '> First line\n>\n> Second line\n\nWhy?',
    )
  })

  it('appends a quote after an existing draft', () => {
    expect(withQuote('', 'Pick one')).toBe('> Pick one\n\n')
    expect(withQuote('Earlier thought  \n', 'Pick one')).toBe(
      'Earlier thought\n\n> Pick one\n\n',
    )
  })

  it('splits a leading quote from what was said about it', () => {
    expect(splitQuote('> First line\n>\n> Second line\n\nWhy?')).toEqual({
      maybeQuote: Option.some('First line\n\nSecond line'),
      rest: 'Why?',
    })
    expect(splitQuote('No quote here')).toEqual({
      maybeQuote: Option.none(),
      rest: 'No quote here',
    })
  })
})
