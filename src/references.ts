import { Schema } from 'effect'

import { EvidenceState, ProviderReference } from './channel'
import type { Ref } from './domain'

export type ProviderReference = typeof ProviderReference.Type
export const ProviderReading = Schema.Struct({
  version: Schema.Literal(1),
  reference: ProviderReference,
  freshness: Schema.Literals(['loading', 'fresh', 'stale', 'unavailable']),
  checkedAt: Schema.NullOr(Schema.Number),
  validUntil: Schema.NullOr(Schema.Number),
  title: Schema.String,
  url: Schema.String,
  status: Schema.String,
  type: Schema.Literals([
    'triage',
    'backlog',
    'unstarted',
    'started',
    'completed',
    'canceled',
    'pr',
    'issue',
  ]),
  states: Schema.Array(EvidenceState),
  checks: Schema.Literals([
    'passed',
    'failed',
    'pending',
    'unknown',
    'not-applicable',
  ]),
  error: Schema.String,
})
export type ProviderReading = typeof ProviderReading.Type

export const referenceKey = (reference: ProviderReference): string =>
  reference.provider === 'linear'
    ? `linear:${reference.id}`
    : `github:${reference.repository.toLowerCase()}:${reference.kind}:${reference.number}`
export const referenceUrl = (reference: ProviderReference): string =>
  reference.provider === 'linear'
    ? `https://linear.app/rbrtbn/issue/${reference.id}`
    : `https://github.com/${reference.repository}/${reference.kind === 'pull' ? 'pull' : 'issues'}/${reference.number}`

export const referenceOf = (
  key: string,
  url?: string,
): ProviderReference | undefined => {
  if (url === undefined || url.trim() === '') {
    return /^[A-Z][A-Z0-9]*-[1-9][0-9]*$/.test(key)
      ? { provider: 'linear', id: key }
      : undefined
  }
  try {
    const parsed = new URL(url)
    if (
      parsed.protocol !== 'https:' ||
      parsed.username !== '' ||
      parsed.password !== '' ||
      parsed.port !== '' ||
      parsed.search !== ''
    ) {
      return undefined
    }
    if (parsed.hostname === 'github.com') {
      const match =
        /^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/(pull|issues)\/([1-9][0-9]*)\/?$/.exec(
          parsed.pathname,
        )
      if (match === null || !Number.isSafeInteger(Number(match[4]))) {
        return undefined
      }
      return {
        provider: 'github',
        repository: `${match[1]}/${match[2]}`.toLowerCase(),
        kind: match[3] === 'pull' ? 'pull' : 'issue',
        number: Number(match[4]),
      }
    }
    const linear =
      /^\/rbrtbn\/issue\/([A-Z][A-Z0-9]*-[1-9][0-9]*)(?:\/[^/]*)?\/?$/.exec(
        parsed.pathname,
      )
    return parsed.hostname === 'linear.app' && linear?.[1] !== undefined
      ? { provider: 'linear', id: linear[1] }
      : undefined
  } catch {
    return undefined
  }
}

export const mergeReferences = (
  sources: ReadonlyArray<Readonly<Record<string, Ref>>>,
  ambiguous: (key: string) => Ref,
): Readonly<Record<string, Ref>> =>
  sources.reduce<Readonly<Record<string, Ref>>>(
    (merged, refs) =>
      Object.fromEntries(
        [...new Set(Object.keys(merged).concat(Object.keys(refs)))].map(key => {
          const before = merged[key],
            next = refs[key]
          const a = referenceOf(key, before?.url),
            b = referenceOf(key, next?.url)
          const same =
            a !== undefined && b !== undefined
              ? referenceKey(a) === referenceKey(b)
              : before?.url === next?.url
          return [
            key,
            before === undefined
              ? next!
              : next === undefined
                ? before
                : same && before.state !== 'Ambiguous'
                  ? next
                  : ambiguous(key),
          ]
        }),
      ),
    {},
  )
