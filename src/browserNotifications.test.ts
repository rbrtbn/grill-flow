import { Schema } from 'effect'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import {
  BROWSER_NOTICES_KEY,
  type NoticeCandidate,
  disableBrowserNotices,
  enableBrowserNotices,
  noticeCandidates,
  noticeHref,
  restoreBrowserNotices,
  syncBrowserNotices,
} from './browserNotifications'
import { Snapshot } from './domain'

class MockNotice extends EventTarget {
  static permission: NotificationPermission = 'default'
  static requestPermission = vi.fn(async () => {
    MockNotice.permission = 'granted'
    return MockNotice.permission
  })
  static notices: Array<MockNotice> = []
  static fail = false
  static beforeShow = () => {}
  close = vi.fn()
  constructor(
    readonly title: string,
    readonly options: NotificationOptions,
  ) {
    super()
    MockNotice.beforeShow()
    if (MockNotice.fail) throw new Error('Fake constructor failure')
    MockNotice.notices.push(this)
  }
}
const originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks')
beforeEach(() => {
  localStorage.clear()
  MockNotice.permission = 'default'
  MockNotice.notices = []
  MockNotice.fail = false
  MockNotice.beforeShow = () => {}
  MockNotice.requestPermission.mockClear()
  vi.stubGlobal('isSecureContext', true)
  vi.stubGlobal('Notification', MockNotice)
  let queue = Promise.resolve<unknown>(undefined)
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: vi.fn(
        (_key: string, _options: unknown, operation: () => unknown) => {
          const next = queue.then(operation)
          queue = next.catch(() => undefined)
          return next
        },
      ),
    },
  })
})
afterEach(() => {
  localStorage.clear()
  restoreBrowserNotices()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  if (originalLocks === undefined) Reflect.deleteProperty(navigator, 'locks')
  else Object.defineProperty(navigator, 'locks', originalLocks)
  localStorage.clear()
})
const candidate = (
  changes: Partial<NoticeCandidate> = {},
): NoticeCandidate => ({
  key: '["question","alpha","Q1"]',
  version: 1,
  urgency: 'soon',
  title: 'A question',
  href: '/g/squad/question/Q1?source=alpha',
  ...changes,
})
const preferences = () => JSON.parse(localStorage.getItem(BROWSER_NOTICES_KEY)!)
const enable = async (baseline: ReadonlyArray<NoticeCandidate> = []) => {
  expect(await enableBrowserNotices()).toEqual({
    enabled: true,
    status: 'Granted',
  })
  expect(await syncBrowserNotices(baseline, true)).toEqual({
    enabled: true,
    status: 'Granted',
  })
}

it('stays off without a page opt-in even when OS permission already exists', () => {
  MockNotice.permission = 'granted'
  expect(restoreBrowserNotices()).toEqual({ enabled: false, status: 'Granted' })
  expect(MockNotice.requestPermission).not.toHaveBeenCalled()
  expect(MockNotice.notices).toEqual([])
})

it('requests permission only on enable, starts quietly and alerts once for each observed urgency change', async () => {
  expect(restoreBrowserNotices()).toEqual({ enabled: false, status: 'Default' })
  await enable([candidate()])
  expect(MockNotice.requestPermission).toHaveBeenCalledTimes(1)
  expect(MockNotice.notices).toHaveLength(0)
  await syncBrowserNotices(
    [candidate({ version: 2, urgency: 'blocking' })],
    false,
  )
  await syncBrowserNotices(
    [candidate({ version: 2, urgency: 'blocking' })],
    false,
  )
  await syncBrowserNotices(
    [candidate({ version: 3, urgency: 'blocking', title: 'Reworded title' })],
    false,
  )
  expect(MockNotice.notices).toHaveLength(1)
  await syncBrowserNotices([candidate({ version: 4 })], false)
  await syncBrowserNotices([candidate({ version: 5, urgency: 'none' })], false)
  await syncBrowserNotices([candidate({ version: 6 })], false)
  expect(MockNotice.notices).toHaveLength(3)
  expect(MockNotice.notices[0]?.title).toContain('Blocking')
  expect(
    new Set(MockNotice.notices.map(notice => notice.options.tag)).size,
  ).toBe(3)
})

it('serializes concurrent tabs and prevents stale snapshots from rolling an urgency backward', async () => {
  await enable([candidate()])
  const next = candidate({ version: 3, urgency: 'blocking' })
  await Promise.all([
    syncBrowserNotices([next], false),
    syncBrowserNotices([next], false),
  ])
  await syncBrowserNotices([candidate({ version: 2 })], false)
  await syncBrowserNotices([next], false)
  expect(MockNotice.notices).toHaveLength(1)
  expect(preferences().states[next.key]).toMatchObject({
    version: 3,
    urgency: 'blocking',
  })
})

it('persists attempts before OS effects and does not replay a failed constructor', async () => {
  await enable()
  MockNotice.beforeShow = () =>
    expect(preferences().states[candidate().key]).toMatchObject({
      version: 1,
      cycle: 1,
    })
  MockNotice.fail = true
  expect(await syncBrowserNotices([candidate()], false)).toEqual({
    enabled: false,
    status: 'Failed',
  })
  expect(preferences().enabled).toBe(false)
  MockNotice.fail = false
  await enableBrowserNotices()
  await syncBrowserNotices([candidate()], false)
  expect(MockNotice.notices).toHaveLength(0)
})

it('limits a burst to five attempts per poll without losing the remaining candidates', async () => {
  await enable()
  const batch = Array.from({ length: 7 }, (_, i) =>
    candidate({ key: `item-${i}` }),
  )
  await syncBrowserNotices(batch, false)
  expect(MockNotice.notices).toHaveLength(5)
  await syncBrowserNotices(batch, false)
  await syncBrowserNotices(batch, false)
  expect(MockNotice.notices).toHaveLength(7)
})

it('resumes a prior opt-in quietly, and another tab turning off prevents pending delivery', async () => {
  await enable([candidate()])
  expect(restoreBrowserNotices()).toEqual({ enabled: true, status: 'Granted' })
  await syncBrowserNotices(
    [candidate({ version: 2, urgency: 'blocking' })],
    true,
  )
  expect(MockNotice.notices).toHaveLength(0)
  await disableBrowserNotices()
  await syncBrowserNotices([candidate({ version: 3 })], false)
  expect(MockNotice.notices).toHaveLength(0)
  expect(restoreBrowserNotices().enabled).toBe(false)
})

it('reports denied and unsupported states without creating notifications or requesting hidden permission', async () => {
  MockNotice.permission = 'denied'
  expect(await enableBrowserNotices()).toEqual({
    enabled: false,
    status: 'Denied',
  })
  expect(MockNotice.requestPermission).not.toHaveBeenCalled()
  vi.stubGlobal('isSecureContext', false)
  expect(await enableBrowserNotices()).toEqual({
    enabled: false,
    status: 'Unsupported',
  })
  vi.stubGlobal('isSecureContext', true)
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: undefined,
  })
  expect(restoreBrowserNotices().status).toBe('Unsupported')
  expect(MockNotice.notices).toHaveLength(0)
})

it('leaves notifications off when the permission prompt is dismissed', async () => {
  MockNotice.requestPermission.mockImplementationOnce(async () => 'default')
  expect(await enableBrowserNotices()).toEqual({
    enabled: false,
    status: 'Default',
  })
  expect(preferences().enabled).toBe(false)
  expect(MockNotice.notices).toHaveLength(0)
})

it('fails closed when preferences cannot be persisted and recovers malformed values as off', async () => {
  for (const value of [
    '{',
    '[]',
    '{"version":1,"enabled":"yes","states":{}}',
  ]) {
    localStorage.setItem(BROWSER_NOTICES_KEY, value)
    expect(restoreBrowserNotices().enabled).toBe(false)
  }
  const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
    throw new Error('Fake storage unavailable')
  })
  expect(await enableBrowserNotices()).toEqual({
    enabled: false,
    status: 'Failed',
  })
  expect(MockNotice.notices).toHaveLength(0)
  spy.mockRestore()
})

it('emits click and error facts, closes the clicked card and accepts only local grill destinations', async () => {
  await enable()
  const opened = vi.fn(),
    failed = vi.fn()
  window.addEventListener('grill-flow-notice-open', opened)
  window.addEventListener('grill-flow-notice-failed', failed)
  try {
    await syncBrowserNotices([candidate()], false)
    const notice = MockNotice.notices[0]!
    notice.dispatchEvent(new Event('click'))
    notice.dispatchEvent(new Event('error'))
    expect(notice.close).toHaveBeenCalledOnce()
    expect(opened.mock.calls[0]?.[0].detail).toBe(candidate().href)
    expect(failed).toHaveBeenCalledOnce()
    for (const href of [
      'https://example.test/g/x',
      'javascript:alert(1)',
      '/g/../../api/build',
      '/g/\\evil',
      '/g/x\n',
    ])
      expect(noticeHref(href)).toBe(false)
  } finally {
    window.removeEventListener('grill-flow-notice-open', opened)
    window.removeEventListener('grill-flow-notice-failed', failed)
  }
})

it('uses canonical question and owner IDs across composed numbering, and suppresses unknown source versions', () => {
  const raw = JSON.parse(readFileSync('src/fixtures/grill.json', 'utf8'))
  const plain = Schema.decodeUnknownSync(Snapshot)({
    grill: {
      ...raw,
      steps: raw.steps.slice(0, 1).map((step: { question: object }) => ({
        ...step,
        question: {
          ...step.question,
          urgency: 'soon',
          dependsOn: [],
          when: [],
        },
      })),
    },
    answers: {},
    notes: {},
    own: {},
    asks: [],
    revisions: [],
    sends: [],
    activity: {
      entries: [],
      highWater: { [raw.id]: 10 },
      total: 0,
      truncated: false,
    },
  })
  const composed = Schema.decodeUnknownSync(Snapshot)({
    ...plain,
    grill: {
      ...plain.grill,
      id: 'squad',
      squad: { id: 'squad', section: 'Squad' },
      steps: plain.grill.steps.map(step => ({
        ...step,
        question: { ...step.question, id: 'Q115' },
      })),
    },
    questionOrigins: { Q115: { grill: raw.id, question: 'Q1' } },
  })
  expect(noticeCandidates(plain)[0]?.key).toBe(
    noticeCandidates(composed)[0]?.key,
  )
  expect(noticeCandidates(composed)[0]?.href).toContain('/question/Q1?source=')
  expect(noticeCandidates({ ...composed, activity: undefined })).toEqual([])
  expect(noticeCandidates({ ...composed, questionOrigins: undefined })).toEqual(
    [],
  )
  expect(noticeCandidates({ ...plain, answers: { Q1: 'a' } })[0]?.urgency).toBe(
    'none',
  )
})

it('alerts on published urgent owner steps without exposing their action or body', async () => {
  const raw = JSON.parse(readFileSync('src/fixtures/grill.json', 'utf8'))
  const owner = {
    source: 'alpha',
    event: 40,
    at: 1,
    item: {
      version: 1,
      kind: 'owner-step',
      id: 'manual',
      previous: 0,
      revision: 1,
      session: 't1',
      host: 'local',
      destination: 'https://example.test/owner',
      title: 'Owner task',
      body: 'Private reasoning',
      action: 'Sensitive action text',
      urgency: 'blocking',
      blockers: [],
      progress: { state: 'open' },
    },
  }
  const snapshot = Schema.decodeUnknownSync(Snapshot)({
    grill: raw,
    answers: {},
    notes: {},
    own: {},
    asks: [],
    revisions: [],
    sends: [],
    ownerSteps: [owner],
  })
  await enable()
  const active = noticeCandidates(snapshot)
  await syncBrowserNotices(active, false)
  expect(MockNotice.notices[0]?.options.body).toBe('Owner task')
  expect(active[0]?.href.startsWith('/g/alpha/item/')).toBe(true)
  const completed = Schema.decodeUnknownSync(Snapshot)({
    ...snapshot,
    ownerSteps: [
      {
        ...owner,
        event: 41,
        item: {
          ...owner.item,
          revision: 2,
          previous: 1,
          progress: { state: 'withdrawn', reason: 'Resolved' },
        },
      },
    ],
  })
  await syncBrowserNotices(noticeCandidates(completed), false)
  expect(MockNotice.notices).toHaveLength(1)
  expect(MockNotice.notices[0]?.close).toHaveBeenCalledOnce()
})
