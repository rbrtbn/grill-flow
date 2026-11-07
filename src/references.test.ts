import { describe, expect, it } from 'vitest'

import {
  mergeReferences,
  referenceKey,
  referenceOf,
  referenceUrl,
} from './references'

describe('validated provider references', () => {
  it('normalizes exact provider identities without treating arbitrary links or PR numbers as fetch targets', () => {
    const pr = referenceOf(
      '#100',
      'https://github.com/Rbrtbn/Squad/pull/100#discussion',
    )!
    expect(referenceKey(pr)).toBe('github:rbrtbn/squad:pull:100')
    expect(referenceUrl(pr)).toBe('https://github.com/rbrtbn/squad/pull/100')
    expect(referenceOf('LAB-1280')).toEqual({
      provider: 'linear',
      id: 'LAB-1280',
    })
    expect(
      referenceOf('text', 'https://linear.app/rbrtbn/issue/LAB-1280/a-title'),
    ).toEqual({ provider: 'linear', id: 'LAB-1280' })
    for (const url of [
      'http://github.com/a/b/pull/1',
      'https://github.com.evil.test/a/b/pull/1',
      'https://user:password@github.com/a/b/pull/1',
      'https://github.com/a/b/pull/1?token=secret',
      'https://github.com/a/b/actions/runs/1',
      'https://github.com/a/b/pull/1/files',
      'https://github.com/a/b/pull/999999999999999999999',
      'https://github.com:444/a/b/pull/1',
      'https://linear.app/other/issue/LAB-1',
      'file:///tmp/reference',
      'javascript:alert(1)',
    ])
      expect(referenceOf('LAB-1', url)).toBeUndefined()
    expect(referenceOf('#100')).toBeUndefined()
    expect(referenceOf('--help')).toBeUndefined()
  })

  it('keeps equivalent shared links but refuses conflicting or partly unidentified source targets', () => {
    const ambiguous = () => ({ text: 'Open the source', state: 'Ambiguous' })
    const a = { text: 'First PR', url: 'https://github.com/first/repo/pull/1' }
    const b = { text: 'Other PR', url: 'https://github.com/second/repo/pull/1' }
    expect(
      mergeReferences([{ '#1': a }, { '#1': b }], ambiguous)['#1'],
    ).toEqual(ambiguous())
    expect(
      mergeReferences(
        [{ '#1': a }, { '#1': { text: 'Unidentified PR' } }],
        ambiguous,
      )['#1'],
    ).toEqual(ambiguous())
    expect(
      mergeReferences([{ '#1': a }, { '#1': b }, { '#1': a }], ambiguous)['#1'],
    ).toEqual(ambiguous())
    const equivalent = {
      ...a,
      url: 'https://github.com/FIRST/repo/pull/1#comment',
    }
    expect(
      mergeReferences([{ '#1': a }, { '#1': equivalent }], ambiguous)['#1'],
    ).toEqual(equivalent)
    expect(
      mergeReferences(
        [
          { 'LAB-1': { text: 'Issue' } },
          {
            'LAB-1': {
              text: 'Named issue',
              url: 'https://linear.app/rbrtbn/issue/LAB-1/title',
            },
          },
        ],
        ambiguous,
      )['LAB-1']?.state,
    ).not.toBe('Ambiguous')
  })
})
