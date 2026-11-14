import { Schema } from 'effect'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'

import { isWholeTarget } from '../src/domain'
import type { WriteProvenance } from './history'

// Bump when guide rules change so cached instructions can be replaced (ADR 0026).
export const SKILL_REVISION = 6
export const AuthoringGuide = Schema.Struct({
  version: Schema.Literal(1),
  host: Schema.String.check(Schema.isMinLength(1)),
  revision: Schema.Number.check(
    Schema.isInt(),
    Schema.isGreaterThan(0),
    Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
  ),
  digest: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  text: Schema.String.check(Schema.isMinLength(1)),
})
export type AuthoringGuide = typeof AuthoringGuide.Type
export type GuideView = Readonly<{
  guide: AuthoringGuide
  origin: 'host' | 'cached' | 'unverified'
}>
export const AuthoringWarning = Schema.Struct({
  event: Schema.Number,
  path: Schema.String,
  skillRevision: Schema.Unknown,
})
export type AuthoringWarning = typeof AuthoringWarning.Type
export const isAuthoringCommand = (command: string | undefined): boolean =>
  ['load', 'item', 'revise', 'reply', 'draw', 'question', 'patch'].includes(
    command ?? '',
  )

const digest = (text: string): string =>
  createHash('sha256').update(text).digest('hex')
export const hostGuide = (): AuthoringGuide => {
  const text = readFileSync(
    new URL('./authoring-guide.md', import.meta.url),
    'utf8',
  )
  return {
    version: 1,
    host: hostname(),
    revision: SKILL_REVISION,
    digest: digest(text),
    text,
  }
}
export const skillRevision = (value: unknown): number | undefined => {
  const number =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+$/.test(value)
        ? Number(value)
        : NaN
  return Number.isSafeInteger(number) && number >= 0 ? number : undefined
}
export const declaredRevision = (raw: unknown): unknown => {
  const parsed = Schema.decodeUnknownResult(
    Schema.Struct({ skillRevision: Schema.optionalKey(Schema.Unknown) }),
  )(raw)
  return parsed._tag === 'Success' ? parsed.success.skillRevision : undefined
}
export const revisionMetadata = (value: unknown): number | string | null =>
  value === undefined || value === null
    ? null
    : (skillRevision(value) ?? 'unrecognised')
export const stampAuthoring = <T extends object>(
  record: T,
  revision: unknown,
  provenance: WriteProvenance = { author: '', reason: '' },
) => ({
  ...record,
  skillRevision: revisionMetadata(revision),
  ...(provenance.reason === '' ? {} : { writeReason: provenance.reason }),
  ...(provenance.author === '' ? {} : { writeAuthor: provenance.author }),
})
// Write metadata rides beside a queued body and stays out of its replay identity.
const METADATA = new Set(['skillRevision', 'writeReason', 'writeAuthor'])
export const authoringBody = (
  raw: unknown,
): Readonly<Record<string, unknown>> => {
  const parsed = Schema.decodeUnknownSync(
    Schema.Record(Schema.String, Schema.Unknown),
  )(raw)
  return Object.fromEntries(
    Object.entries(parsed).filter(([key]) => !METADATA.has(key)),
  )
}
export const queuedProvenance = (raw: unknown): WriteProvenance => {
  const parsed = Schema.decodeUnknownResult(
    Schema.Struct({
      writeReason: Schema.optionalKey(Schema.String),
      writeAuthor: Schema.optionalKey(Schema.String),
    }),
  )(raw)
  return parsed._tag === 'Success'
    ? {
        author: parsed.success.writeAuthor ?? '',
        reason: parsed.success.writeReason ?? '',
      }
    : { author: '', reason: '' }
}

// Missing reasons warn during migration; GF_REQUIRE_REASON=1 turns the warning into a refusal
// once writers have caught up (docs/adr/0031).
export const REASON_REQUIRED = process.env.GF_REQUIRE_REASON === '1'
export const needsReason = (
  command: string | undefined,
  args: ReadonlyArray<string>,
): boolean => {
  if (command === 'revise') {
    const kind = args.includes('--kind')
      ? args[args.indexOf('--kind') + 1]
      : isWholeTarget(args[1] ?? '')
        ? 'comment'
        : 'rewrite'
    return kind === 'rewrite'
  }
  return ['load', 'item', 'draw', 'restore'].includes(command ?? '')
}
export const writeProvenance = (
  args: ReadonlyArray<string>,
): WriteProvenance => {
  const value = (name: string) =>
    args.includes(name) ? (args[args.indexOf(name) + 1] ?? '').trim() : ''
  return {
    author: value('--session') || (process.env.HC_TERMINAL_ID?.trim() ?? ''),
    reason: value('--reason'),
  }
}
// A load without --expect-rev warns until GF_REQUIRE_EXPECT_REV=1 refuses it, as reasons do
// (docs/adr/0032).
export const EXPECT_REV_REQUIRED = process.env.GF_REQUIRE_EXPECT_REV === '1'
export const expectRevWarning = (): string =>
  `Expected revision missing: pass --expect-rev <rev> on gf load (the rev gf get or your last write printed), so a newer write by another session is refused instead of overwritten. ${
    EXPECT_REV_REQUIRED
      ? 'GF_REQUIRE_EXPECT_REV=1 refuses loads without one.'
      : 'Accepted without one for now; it becomes required later.'
  }`
export const reasonWarning = (command: string): string =>
  `Write reason missing: pass --reason "<why>" on gf ${command}, so gf history can say why this changed. ${
    REASON_REQUIRED
      ? 'GF_REQUIRE_REASON=1 refuses writes without one.'
      : 'Accepted without one for now; reasons become required later.'
  }`

export const guideInState = (raw: unknown): AuthoringGuide | undefined => {
  const state = Schema.decodeUnknownResult(
    Schema.Struct({ authoringGuide: AuthoringGuide }),
  )(raw)
  return state._tag === 'Success' &&
    digest(state.success.authoringGuide.text) ===
      state.success.authoringGuide.digest
    ? state.success.authoringGuide
    : undefined
}
export const cachedGuide = (outbox: string): GuideView => {
  const candidates = existsSync(outbox)
    ? readdirSync(outbox, { withFileTypes: true }).flatMap(entry => {
        if (!entry.isDirectory()) {
          return []
        }
        try {
          const state = JSON.parse(
            readFileSync(join(outbox, entry.name, 'state.json'), 'utf8'),
          )
          const guide = guideInState(state)
          return guide === undefined ? [] : [guide]
        } catch {
          return []
        }
      })
    : []
  const hosts = new Set(candidates.map(guide => guide.host))
  const newest = [...candidates].sort((a, b) => b.revision - a.revision)[0]
  const conflicting =
    newest !== undefined &&
    candidates.some(
      guide =>
        guide.revision === newest.revision && guide.digest !== newest.digest,
    )
  return newest !== undefined && hosts.size === 1 && !conflicting
    ? { guide: newest, origin: 'cached' }
    : { guide: hostGuide(), origin: 'unverified' }
}
export const guideView = (outbox?: string): GuideView =>
  outbox ? cachedGuide(outbox) : { guide: hostGuide(), origin: 'host' }

export const guideText = (view: GuideView, since?: unknown): string => {
  const revision = skillRevision(since)
  const provenance =
    view.origin === 'host'
      ? `Host: ${view.guide.host}`
      : view.origin === 'cached'
        ? `Cached from host: ${view.guide.host}; current host freshness is unverified offline.`
        : 'Unverified bundled fallback; no unambiguous host-issued cache is available.'
  const header = `Guide revision: ${view.guide.revision}\n${provenance}\n`
  if (
    since !== undefined &&
    revision === view.guide.revision &&
    view.origin !== 'unverified'
  ) {
    return `${header}Unchanged against the available ${view.origin} guide.\n`
  }
  const mismatch =
    since !== undefined &&
    (revision === undefined || revision > view.guide.revision)
      ? 'Requested revision is unrecognised or newer than this available guide; this output does not establish that your instructions are current.\n'
      : ''
  return `${header}${mismatch}\n${view.guide.text}`
}
export const authoringWarning = (
  declared: unknown,
  view: GuideView,
  outcome: 'published' | 'queued',
): string | undefined => {
  if (
    skillRevision(declared) === view.guide.revision &&
    view.origin !== 'unverified'
  ) {
    return undefined
  }
  const reason =
    view.origin === 'unverified'
      ? 'unverified against the serving host'
      : declared === undefined || declared === null
        ? 'missing'
        : skillRevision(declared) === undefined
          ? 'unrecognised'
          : 'different from the available guide'
  const result =
    outcome === 'published'
      ? 'Published as submitted; the successful write was not rewritten or rejected.'
      : 'Queued as submitted; publication awaits the serving host import.'
  return `Authoring warning: --skill-revision is ${reason}. ${result}\nRead the complete guide below, apply it to your next write or make a deliberate correction, and declare --skill-revision ${view.guide.revision}.\n\n${guideText(view, declared)}`
}
export const printAuthoringWarning = (
  declared: unknown,
  view: GuideView,
  outcome: 'published' | 'queued',
): void => {
  const warning = authoringWarning(declared, view, outcome)
  if (warning !== undefined) {
    console.error(warning)
  }
}
export const readAuthoringWarnings = (
  raw: unknown,
): ReadonlyArray<AuthoringWarning> => {
  const parsed = Schema.decodeUnknownResult(
    Schema.Struct({
      authoringWarnings: Schema.optionalKey(Schema.Array(AuthoringWarning)),
    }),
  )(raw)
  return parsed._tag === 'Success'
    ? (parsed.success.authoringWarnings ?? [])
    : []
}
