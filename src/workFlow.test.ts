import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { WORK_FIXTURE } from './workFixture'
import {
  type WorkItem,
  type WorkLog,
  WorkLog as WorkLogSchema,
  duration,
  leftLine,
  openIssues,
  timelineScale,
  timelineX,
  trackStages,
  workModel,
} from './workFlow'

const item = (
  id: string,
  state: WorkItem['state'],
  moves: ReadonlyArray<readonly [string, WorkItem['state'], string]>,
  extra: Partial<WorkItem> = {},
): WorkItem => ({
  id,
  title: `Issue ${id}`,
  linearStatus: 'In Progress',
  pr: null,
  prState: null,
  state,
  dependsOn: [],
  blockedBy: null,
  doing: '',
  rounds: { review: 0, fix: 0 },
  estimateLeft: null,
  transitions: moves.map(([at, moveState, agent]) => ({
    at,
    state: moveState,
    agent,
    note: '',
  })),
  ...extra,
})

const log = (issues: ReadonlyArray<WorkItem>): WorkLog => ({
  run: {
    id: 'run',
    lead: 't2cr',
    orchestrator: 't2hq',
    startedAt: '2026-11-10T00:00:00Z',
    notes: '',
  },
  issues,
  sources: [],
  gaps: [],
  now: '2026-11-12T12:00:00Z',
})

describe('duration', () => {
  it('writes minutes, hours and days the way the page does', () => {
    expect(duration(0)).toBe('—')
    expect(duration(Number.NaN)).toBe('—')
    expect(duration(45 * 60000)).toBe('45m')
    expect(duration(2.5 * 3600000)).toBe('2.5h')
    expect(duration(2 * 3600000)).toBe('2h')
    expect(duration(13.4 * 3600000)).toBe('13h')
    expect(duration(24 * 3600000)).toBe('1d')
    expect(duration(28 * 3600000)).toBe('1d 4h')
  })
})

describe('workModel', () => {
  const building = item('LAB-1', 'review', [
    ['2026-11-12T08:00:00Z', 'building', 'b1'],
    ['2026-11-12T10:00:00Z', 'review', 'reviewer'],
  ])
  const blocked = item(
    'LAB-2',
    'design-gate',
    [['2026-11-12T11:00:00Z', 'design-gate', 'arbiter']],
    { blockedBy: 'Waits on Rob' },
  )
  const merged = item('LAB-3', 'merged', [
    ['2026-11-10T00:00:00Z', 'building', 'b3'],
    ['2026-11-10T06:00:00Z', 'fixing', 'b3'],
    ['2026-11-10T08:00:00Z', 'review', 'reviewer'],
    ['2026-11-10T09:00:00Z', 'fixing', 'b3'],
    ['2026-11-10T10:00:00Z', 'merged', 't2cr'],
  ])
  const planned = item(
    'LAB-4',
    'planned',
    [['2026-11-11T00:00:00Z', 'planned', 't2cr']],
    { dependsOn: ['LAB-1'] },
  )
  const model = workModel(log([building, blocked, merged, planned]))

  it('groups issues and puts blocked work first', () => {
    expect(model.active.map(issue => issue.id)).toEqual(['LAB-2', 'LAB-1'])
    expect(model.done.map(issue => issue.id)).toEqual(['LAB-3'])
    expect(model.later.map(issue => issue.id)).toEqual(['LAB-4'])
  })

  it('runs open segments to now and closes finished ones', () => {
    const issue = model.issues.find(found => found.id === 'LAB-1')
    expect(issue?.segments.map(segment => segment.to - segment.from)).toEqual([
      2 * 3600000,
      2 * 3600000,
    ])
    expect(issue?.spent).toBe(4 * 3600000)
    expect(issue?.stepsLeft).toBe(3)
    expect(issue?.sinceLast).toBe(2 * 3600000)
  })

  it('counts fix loops, handovers and time per state', () => {
    const issue = model.issues.find(found => found.id === 'LAB-3')
    expect(issue?.reviewLoops).toBe(2)
    expect(issue?.agents).toEqual(['b3', 'reviewer', 'b3', 't2cr'])
    expect(issue?.perState.fixing).toBe(3 * 3600000)
    expect(issue && leftLine(issue)).toBe('Done')
  })

  it('keeps the flow position a blocked move was reached from', () => {
    const issue = workModel(
      log([
        item('LAB-5', 'blocked', [
          ['2026-11-12T08:00:00Z', 'review', 'reviewer'],
          ['2026-11-12T09:00:00Z', 'blocked', 'reviewer'],
        ]),
      ]),
    ).active[0]
    expect(issue?.isBlocked).toBe(true)
    expect(issue?.at).toBe('review')
    expect(issue?.perState.review).toBe(4 * 3600000)
  })

  it('sums the stats strip', () => {
    expect(model.stats).toMatchObject({
      inProgress: 2,
      blocked: 1,
      done: 1,
      planned: 1,
      medianCycle: 10 * 3600000,
      handovers: 4,
    })
  })
})

describe('trackStages', () => {
  it('marks stages behind, current and ahead, with who held each', () => {
    const issue = workModel(
      log([
        item('LAB-1', 'review', [
          ['2026-11-12T08:00:00Z', 'building', 'b1'],
          ['2026-11-12T10:00:00Z', 'review', 'reviewer'],
        ]),
      ]),
    ).active[0]
    const stages = issue === undefined ? [] : trackStages(issue)
    expect(stages.map(stage => [stage.stage, stage.mark])).toEqual([
      ['design-gate', 'Past'],
      ['building', 'Past'],
      ['review', 'Here'],
      ['fixing', 'Future'],
      ['merge-ready', 'Future'],
      ['merged', 'Future'],
    ])
    expect(stages[2]?.agent).toBe('reviewer')
  })
})

describe('timeline', () => {
  it('ticks each midnight and leaves room after now', () => {
    const model = workModel(
      log([
        item('LAB-1', 'building', [['2026-11-10T12:00:00Z', 'building', 'b1']]),
      ]),
    )
    const scale = timelineScale(model)
    expect(scale.days.map(day => new Date(day).toISOString())).toEqual([
      '2026-11-11T00:00:00.000Z',
      '2026-11-12T00:00:00.000Z',
    ])
    expect(timelineX(scale, model.start)).toBe(0)
    expect(timelineX(scale, model.now)).toBeCloseTo(100 / 1.18)
  })
})

describe('openIssues', () => {
  it('reads the open rows from the page query', () => {
    expect(openIssues('open=LAB-1426,LAB-1451&done=1')).toEqual([
      'LAB-1426',
      'LAB-1451',
    ])
    expect(openIssues('')).toEqual([])
  })
})

describe('the preview fixture', () => {
  it('decodes as a work log and reads as the prototype did', () => {
    expect(Schema.decodeUnknownResult(WorkLogSchema)(WORK_FIXTURE)._tag).toBe(
      'Success',
    )
    const model = workModel(WORK_FIXTURE)
    expect(model.issues).toHaveLength(18)
    expect(model.stats.inProgress).toBe(model.active.length)
    expect(model.active[0]?.isBlocked).toBe(true)
  })
})
