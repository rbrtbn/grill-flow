import { describe, expect, it } from 'vitest'

import { segments, withEmphasis } from './domain'

describe('inline Markdown emphasis', () => {
  it('supports bold, italic and both with asterisks or underscores', () => {
    expect(
      withEmphasis(segments('**bold** *italic* __bold__ _italic_ ***both***')),
    ).toEqual([
      { _tag: 'Strong', text: 'bold', parts: [{ _tag: 'Text', text: 'bold' }] },
      { _tag: 'Text', text: ' ' },
      {
        _tag: 'Emphasis',
        text: 'italic',
        parts: [{ _tag: 'Text', text: 'italic' }],
      },
      { _tag: 'Text', text: ' ' },
      { _tag: 'Strong', text: 'bold', parts: [{ _tag: 'Text', text: 'bold' }] },
      { _tag: 'Text', text: ' ' },
      {
        _tag: 'Emphasis',
        text: 'italic',
        parts: [{ _tag: 'Text', text: 'italic' }],
      },
      { _tag: 'Text', text: ' ' },
      {
        _tag: 'Strong',
        text: 'both',
        parts: [
          {
            _tag: 'Emphasis',
            text: 'both',
            parts: [{ _tag: 'Text', text: 'both' }],
          },
        ],
      },
    ])
  })

  it('nests italic inside bold', () => {
    expect(withEmphasis(segments('**bold and *italic* text**'))).toEqual([
      {
        _tag: 'Strong',
        text: 'bold and italic text',
        parts: [
          { _tag: 'Text', text: 'bold and ' },
          {
            _tag: 'Emphasis',
            text: 'italic',
            parts: [{ _tag: 'Text', text: 'italic' }],
          },
          { _tag: 'Text', text: ' text' },
        ],
      },
    ])
  })

  it('keeps markers literal in code and URL destinations', () => {
    expect(
      withEmphasis(segments('`**literal**` [link](https://example.com/a_b_c)')),
    ).toEqual([
      { _tag: 'Code', text: '**literal**' },
      { _tag: 'Text', text: ' ' },
      { _tag: 'Link', text: 'link', url: 'https://example.com/a_b_c' },
    ])
  })

  it('preserves unpaired markers, whitespace and underscores within identifiers', () => {
    const input = 'path_with_parts **unfinished * spaced *'
    expect(
      withEmphasis(segments(input))
        .map(part => part.text)
        .join(''),
    ).toBe(input)
    expect(
      withEmphasis(segments(input)).every(part => part._tag === 'Text'),
    ).toBe(true)
  })

  it('renders escaped markers literally', () => {
    expect(
      withEmphasis(segments('\\*literal\\* and \\_literal\\_'))
        .map(part => part.text)
        .join(''),
    ).toBe('*literal* and _literal_')
  })
})
