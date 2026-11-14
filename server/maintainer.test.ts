import { describe, expect, it } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  clearMaintainer,
  readMaintainer,
  seedMaintainer,
  writeMaintainer,
} from './maintainer'

const fresh = () =>
  join(mkdtempSync(join(tmpdir(), 'grill-maintainer-')), 'maintainer')

describe('maintainer file', () => {
  it('seeds from the environment only while no maintainer is stored', () => {
    const path = fresh()
    seedMaintainer('  ', path)
    expect(readMaintainer(path)).toBeUndefined()
    seedMaintainer('t2hw', path)
    expect(readMaintainer(path)).toBe('t2hw')
    writeMaintainer('homelab/t9', path)
    seedMaintainer('t2hw', path)
    expect(readMaintainer(path)).toBe('homelab/t9')
  })

  it('refuses text that is not a Herdr address', () => {
    expect(() => writeMaintainer('t2 ; rm -rf', fresh())).toThrow(
      'not a Herdr address',
    )
  })

  it('clears to no maintainer', () => {
    const path = fresh()
    writeMaintainer('t2hw', path)
    clearMaintainer(path)
    expect(readMaintainer(path)).toBeUndefined()
    clearMaintainer(path)
  })
})
