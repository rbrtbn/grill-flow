import { describe, expect, it } from 'bun:test'

import { createSessionProbe, sessionStateOf } from './sessionProbe'

const notFound =
  '{"error":{"hint":"see `hc ls --all`","kind":"not_found","message":"no terminal \\"t18v\\""}}'

describe('sessionStateOf', () => {
  it('reads live, stopped and missing terminals', () => {
    expect(sessionStateOf(0, '{"state":"live"}', '')).toBe('live')
    expect(sessionStateOf(0, '{"state":"finished"}', '')).toBe('stopped')
    expect(sessionStateOf(3, '', notFound)).toBe('missing')
  })

  it('has no answer when Herdr itself fails', () => {
    expect(sessionStateOf(1, '', 'connection refused')).toBeUndefined()
    expect(sessionStateOf(0, 'not json', '')).toBeUndefined()
  })
})

describe('createSessionProbe', () => {
  it('answers from the background read and refreshes once it goes stale', async () => {
    const calls: Array<string> = []
    const replies = [
      { code: 0, stdout: '{"state":"live"}', stderr: '' },
      { code: 3, stdout: '', stderr: notFound },
    ]
    const clock = { now: 0 }
    const probe = createSessionProbe(
      async address => {
        calls.push(address)
        return replies[calls.length - 1]!
      },
      () => clock.now,
    )
    expect(probe('t18v')).toBeUndefined()
    await Bun.sleep(0)
    expect(probe('t18v')).toBe('live')
    expect(calls).toHaveLength(1)
    clock.now = 20_000
    expect(probe('t18v')).toBe('live')
    await Bun.sleep(0)
    expect(probe('t18v')).toBe('missing')
    expect(calls).toHaveLength(2)
  })

  it('keeps the last known state when a read fails', async () => {
    const clock = { now: 0 }
    const reads = { count: 0 }
    const probe = createSessionProbe(
      async () => {
        reads.count += 1
        if (reads.count > 1) {
          throw new Error('hc missing')
        }
        return { code: 0, stdout: '{"state":"live"}', stderr: '' }
      },
      () => clock.now,
    )
    probe('t1')
    await Bun.sleep(0)
    clock.now = 20_000
    probe('t1')
    await Bun.sleep(0)
    expect(probe('t1')).toBe('live')
  })
})
