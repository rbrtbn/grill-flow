import { describe, expect, it } from 'bun:test'

import { createAgentLister, pageAgents } from './agents'

const space = 'squad.squad-eff-clp-lead / squad-eff · Claude lead · t2cr'
const terminals = [
  {
    address: 't2cr',
    name: 'squad-eff-clp-lead',
    agent: 'claude-code',
    parent: 't20c',
    state: 'live',
    where: space,
  },
  {
    address: 't2hq',
    name: 'stage1-t2cr-o2',
    agent: 'claude-code',
    parent: 't2cr',
    state: 'live',
    where: space,
  },
  {
    address: 't2hs',
    name: 'b1411',
    agent: 'codex',
    parent: 't2hq',
    state: 'live',
    where: space,
  },
  {
    address: 't2hr',
    name: 'rule-review',
    agent: 'sh',
    parent: 't2hq',
    state: 'finished',
    where: space,
  },
  {
    address: 't2fq',
    name: 'b1372',
    agent: 'codex',
    parent: 't2cr',
    state: 'finished',
    where: space,
  },
  {
    address: 't2gp',
    name: null,
    agent: 'claude-code',
    parent: null,
    state: 'live',
    where: 'rbrtbn / 1',
  },
]

describe('pageAgents', () => {
  it('lists running agents in the session space with the root as lead', () => {
    expect(pageAgents(terminals, 't2hq')).toEqual([
      {
        address: 't2cr',
        name: 'squad-eff-clp-lead',
        program: 'claude-code',
        lead: true,
      },
      {
        address: 't2hq',
        name: 'stage1-t2cr-o2',
        program: 'claude-code',
        lead: false,
      },
      { address: 't2hs', name: 'b1411', program: 'codex', lead: false },
    ])
  })

  it('lists nobody when the page session is not in Herdr', () => {
    expect(pageAgents(terminals, 't18v')).toEqual([])
  })

  it('names no lead when several roots share the space and none is called lead', () => {
    const roots = [
      {
        address: 't1',
        name: 'a',
        agent: 'codex',
        parent: null,
        state: 'live',
        where: 'x / 1',
      },
      {
        address: 't2',
        name: 'b',
        agent: 'codex',
        parent: null,
        state: 'live',
        where: 'x / 2',
      },
    ]
    expect(pageAgents(roots, 't1').some(agent => agent.lead)).toBe(false)
  })
})

describe('createAgentLister', () => {
  it('answers from the background listing and keeps it when a read fails', async () => {
    const clock = { now: 0 }
    const reads = { count: 0 }
    const lister = createAgentLister(
      async () => {
        reads.count += 1
        if (reads.count > 1) {
          throw new Error('hc down')
        }
        return JSON.stringify({ machines: [], terminals })
      },
      () => clock.now,
    )
    expect(lister('t2hq')).toBeUndefined()
    await Bun.sleep(0)
    expect(lister('t2hq')?.map(agent => agent.address)).toEqual([
      't2cr',
      't2hq',
      't2hs',
    ])
    clock.now = 20_000
    lister('t2hq')
    await Bun.sleep(0)
    expect(lister('t2hq')).toHaveLength(3)
  })
})
