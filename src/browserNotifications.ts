import { Schema } from 'effect'

import { type Snapshot, statusOf } from './domain'
import { sourceQuestionHref } from './sourceLinks'

export const BROWSER_NOTICES_KEY = 'grill-flow:browser-notifications:v1'
export const NoticeStatus = Schema.Literals([
  'Unknown',
  'Unsupported',
  'Default',
  'Granted',
  'Denied',
  'Failed',
])
export const NoticeResult = Schema.Struct({
  enabled: Schema.Boolean,
  status: NoticeStatus,
})
export type NoticeResult = typeof NoticeResult.Type
export const BrowserNoticeState = Schema.Struct({
  enabled: Schema.Boolean,
  status: NoticeStatus,
  ready: Schema.Boolean,
  asking: Schema.Boolean,
  pending: Schema.Boolean,
  primed: Schema.Boolean,
})
export const initialBrowserNotices = {
  enabled: false,
  status: 'Unknown',
  ready: false,
  asking: false,
  pending: false,
  primed: false,
} satisfies typeof BrowserNoticeState.Type
const Urgency = Schema.Literals(['none', 'soon', 'blocking'])
export const NoticeCandidate = Schema.Struct({
  key: Schema.String,
  version: Schema.Number,
  urgency: Urgency,
  title: Schema.String,
  href: Schema.String,
})
export type NoticeCandidate = typeof NoticeCandidate.Type
const Preferences = Schema.Struct({
  version: Schema.Literal(1),
  enabled: Schema.Boolean,
  states: Schema.Record(
    Schema.String,
    Schema.Struct({
      urgency: Urgency,
      cycle: Schema.Number.check(
        Schema.isInt(),
        Schema.isGreaterThanOrEqualTo(0),
        Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
      ),
      version: Schema.Number.check(
        Schema.isInt(),
        Schema.isGreaterThanOrEqualTo(0),
        Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
      ),
    }),
  ),
})
type Preferences = typeof Preferences.Type
const empty = (): Preferences => ({ version: 1, enabled: false, states: {} })
const liveNotices = new Map<string, Notification>()
const closeNotices = () => {
  liveNotices.forEach(notice => notice.close())
  liveNotices.clear()
}
const keyOf = (kind: string, source: string, id: string) =>
  JSON.stringify([kind, source, id])
const urgent = (value: string | undefined): 'none' | 'soon' | 'blocking' =>
  value === 'blocking' || value === 'soon' ? value : 'none'

export const noticeCandidates = (
  snapshot: Snapshot,
): ReadonlyArray<NoticeCandidate> => [
  ...snapshot.grill.steps.flatMap(step => {
    const origin =
      snapshot.questionOrigins?.[step.question.id] ??
      (snapshot.grill.squad?.id === snapshot.grill.id
        ? undefined
        : { grill: snapshot.grill.id, question: step.question.id })
    const version =
      origin === undefined
        ? undefined
        : snapshot.activity?.highWater[origin.grill]
    return origin === undefined ||
      version === undefined ||
      !Number.isSafeInteger(version)
      ? []
      : [
          {
            key: keyOf('question', origin.grill, origin.question),
            version,
            urgency:
              statusOf(snapshot.grill, snapshot.answers, step.question.id)
                ._tag === 'Open'
                ? urgent(step.question.urgency)
                : 'none',
            title: step.question.title,
            href: sourceQuestionHref(
              snapshot.grill.id,
              origin.grill,
              origin.question,
            ),
          },
        ]
  }),
  ...(snapshot.ownerSteps ?? []).map(({ source, item, event }) => ({
    key: keyOf('owner-step', source, item.id),
    version: event,
    urgency: item.progress.state === 'open' ? urgent(item.urgency) : 'none',
    title: item.title ?? 'Owner action',
    href: `/g/${encodeURIComponent(source)}/item/${encodeURIComponent(item.id)}`,
  })),
]

const permission = (): typeof NoticeStatus.Type => {
  if (
    !globalThis.isSecureContext ||
    typeof Notification === 'undefined' ||
    typeof Notification.requestPermission !== 'function' ||
    !navigator.locks?.request
  )
    return 'Unsupported'
  switch (Notification.permission) {
    case 'granted':
      return 'Granted'
    case 'denied':
      return 'Denied'
    case 'default':
      return 'Default'
    default:
      return 'Unsupported'
  }
}
const read = (): Preferences => {
  const raw = localStorage.getItem(BROWSER_NOTICES_KEY)
  if (raw === null) return empty()
  if (raw.length > 1_000_000) return empty()
  try {
    const result = Schema.decodeUnknownResult(Preferences)(JSON.parse(raw))
    return result._tag === 'Success' ? result.success : empty()
  } catch {
    return empty()
  }
}
const write = (preferences: Preferences) => {
  if (Object.keys(preferences.states).length > 4096)
    throw new Error('Notice state limit')
  const serialized = JSON.stringify(preferences)
  if (serialized.length > 1_000_000) throw new Error('Notice storage limit')
  localStorage.setItem(BROWSER_NOTICES_KEY, serialized)
}
const failed = (): NoticeResult => ({ enabled: false, status: 'Failed' })
const locked = async <A>(operation: () => A): Promise<A> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 2000)
  try {
    return await navigator.locks.request(
      BROWSER_NOTICES_KEY,
      { signal: controller.signal },
      () => {
        clearTimeout(timer)
        return operation()
      },
    )
  } finally {
    clearTimeout(timer)
  }
}

export const restoreBrowserNotices = (): NoticeResult => {
  try {
    const status = permission()
    const enabled = status === 'Granted' && read().enabled
    if (!enabled) closeNotices()
    return { enabled, status }
  } catch {
    return failed()
  }
}
export const enableBrowserNotices = async (): Promise<NoticeResult> => {
  try {
    let status = permission()
    if (status === 'Unsupported') return { enabled: false, status }
    if (status === 'Default') {
      await Notification.requestPermission()
      status = permission()
    }
    return await locked(() => {
      const enabled = status === 'Granted'
      write({ ...read(), enabled })
      return { enabled, status }
    })
  } catch {
    return failed()
  }
}
export const disableBrowserNotices = async (): Promise<NoticeResult> => {
  closeNotices()
  try {
    const disable = () => {
      write({ ...read(), enabled: false })
      return { enabled: false, status: permission() }
    }
    return typeof navigator.locks?.request === 'function'
      ? await locked(disable)
      : disable()
  } catch {
    return failed()
  }
}
export const noticeHref = (href: string): boolean => {
  try {
    const url = new URL(href, location.origin)
    return (
      href.startsWith('/g/') &&
      url.origin === location.origin &&
      url.pathname.startsWith('/g/') &&
      !href.includes('\\') &&
      !/[\r\n]/.test(href)
    )
  } catch {
    return false
  }
}

declare global {
  interface WindowEventMap {
    'grill-flow-notice-open': CustomEvent<string>
    'grill-flow-notice-failed': Event
  }
}

export const syncBrowserNotices = async (
  candidates: ReadonlyArray<NoticeCandidate>,
  baseline: boolean,
): Promise<NoticeResult> => {
  try {
    if (permission() === 'Unsupported')
      return { enabled: false, status: 'Unsupported' }
    return await locked(() => {
      const preferences = read(),
        status = permission()
      if (!preferences.enabled || status !== 'Granted') {
        closeNotices()
        return { enabled: false, status }
      }
      const states = new Map(Object.entries(preferences.states)),
        jobs: Array<NoticeCandidate & { cycle: number }> = []
      for (const candidate of candidates) {
        const previous = states.get(candidate.key)
        if (
          !Number.isSafeInteger(candidate.version) ||
          candidate.version < 0 ||
          (previous !== undefined && candidate.version <= previous.version)
        )
          continue
        if (previous?.urgency === candidate.urgency) {
          states.set(candidate.key, { ...previous, version: candidate.version })
          continue
        }
        if (candidate.urgency === 'none') {
          liveNotices.get(candidate.key)?.close()
          liveNotices.delete(candidate.key)
        }
        const shouldNotify = !baseline && candidate.urgency !== 'none'
        if (shouldNotify && jobs.length >= 5) continue
        const cycle = (previous?.cycle ?? 0) + 1
        if (!Number.isSafeInteger(cycle)) throw new Error('Notice cycle limit')
        states.set(candidate.key, {
          urgency: candidate.urgency,
          cycle,
          version: candidate.version,
        })
        if (shouldNotify) jobs.push({ ...candidate, cycle })
      }
      // Commit attempts before OS effects so retries and other tabs cannot repeat an escalation.
      const next = { ...preferences, states: Object.fromEntries(states) }
      write(next)
      try {
        for (const job of jobs) {
          liveNotices.get(job.key)?.close()
          const notice = new Notification(
            `Squad Board · ${job.urgency === 'blocking' ? 'Blocking' : 'Soon'}`,
            {
              body: job.title.slice(0, 180),
              tag: `grill-flow:${job.key}:${job.cycle}`,
            },
          )
          liveNotices.set(job.key, notice)
          notice.addEventListener('close', () => {
            if (liveNotices.get(job.key) === notice) liveNotices.delete(job.key)
          })
          notice.addEventListener('click', () => {
            notice.close()
            if (liveNotices.get(job.key) === notice) liveNotices.delete(job.key)
            if (noticeHref(job.href))
              window.dispatchEvent(
                new CustomEvent('grill-flow-notice-open', { detail: job.href }),
              )
          })
          notice.addEventListener('error', () =>
            window.dispatchEvent(new Event('grill-flow-notice-failed')),
          )
        }
      } catch {
        closeNotices()
        write({ ...next, enabled: false })
        return failed()
      }
      return { enabled: true, status }
    })
  } catch {
    return failed()
  }
}
