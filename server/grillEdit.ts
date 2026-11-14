import type { Database } from 'bun:sqlite'
import { Schema, SchemaIssue } from 'effect'
import { readFileSync } from 'node:fs'

import { FORMAT_VERSION, Grill, type Step } from '../src/domain'
import {
  type FieldChange,
  type WriteProvenance,
  currentRev,
  fieldChanges,
  fieldLine,
  grillRevisions,
  revisionLines,
} from './history'
import { readPage } from './squad'
import { decodeGrill, getGrill, loadGrill, snapshot } from './store'

// Targeted edits of a stored grill (docs/adr/0032). Every edit becomes an ordinary load, so
// revisions, reasons, squad registration and the reload guard apply unchanged.

/** A refusal the agent can act on; the CLI prints its message and exits 2. */
export class EditError extends Error {}

// STRICT VALIDATION

export type Problem = Readonly<{ path: string; message: string }>

export class GrillInvalid extends EditError {
  constructor(readonly problems: ReadonlyArray<Problem>) {
    super(
      `The grill does not match the schema (src/domain.ts Grill); fix every problem below and write again:\n${problems
        .map(problem => `  ${problem.path || '/'}: ${problem.message}`)
        .join('\n')}`,
    )
  }
}

const UNKNOWN_KEY = 'unknown key'

const formatIssues = SchemaIssue.makeFormatterStandardSchemaV1({
  leafHook: issue =>
    issue._tag === 'UnexpectedKey'
      ? UNKNOWN_KEY
      : SchemaIssue.defaultLeafHook(issue),
})

const decodeAll = Schema.decodeUnknownResult(Grill, {
  errors: 'all',
  onExcessProperty: 'error',
})

/** An RFC 6901 pointer for a decode path, the form `gf get` and `gf patch` take. */
export const toPointer = (path: ReadonlyArray<unknown>): string =>
  path
    .map(segment => {
      const key =
        typeof segment === 'object' && segment !== null && 'key' in segment
          ? segment.key
          : segment
      return `/${String(key).replaceAll('~', '~0').replaceAll('/', '~1')}`
    })
    .join('')

const declaresNewerFormat = (raw: unknown): boolean =>
  typeof raw === 'object' &&
  raw !== null &&
  'version' in raw &&
  typeof raw.version === 'number' &&
  raw.version > FORMAT_VERSION

/**
 * Every schema problem at once, each with its pointer. Unknown keys are errors at the writer's
 * boundary; reads stay lenient (ADR 0001). A grill declaring a newer format than this checkout
 * may carry fields it does not know yet, so there they come back as warnings instead.
 */
export const strictCheck = (
  raw: unknown,
): Readonly<{
  errors: ReadonlyArray<Problem>
  unknownKeys: ReadonlyArray<Problem>
}> => {
  const result = decodeAll(raw)
  if (result._tag === 'Success') {
    return { errors: [], unknownKeys: [] }
  }
  const problems = formatIssues(result.failure.issue).issues.map(issue => ({
    path: toPointer(issue.path ?? []),
    message: issue.message,
  }))
  const tolerated = (problem: Problem) =>
    problem.message === UNKNOWN_KEY && declaresNewerFormat(raw)
  return {
    errors: problems.filter(problem => !tolerated(problem)),
    unknownKeys: problems.filter(tolerated),
  }
}

/** Decodes a grill a writer submits, refusing it with every problem listed. */
export const decodeStrict = (
  raw: unknown,
): Readonly<{ grill: Grill; unknownKeys: ReadonlyArray<Problem> }> => {
  const { errors, unknownKeys } = strictCheck(raw)
  if (errors.length > 0) {
    throw new GrillInvalid(errors)
  }
  return { grill: decodeGrill(raw), unknownKeys }
}

export const unknownKeyWarning = (
  unknownKeys: ReadonlyArray<Problem>,
): string =>
  `This checkout reads grill format ${FORMAT_VERSION} and dropped keys it does not know: ${unknownKeys
    .map(problem => problem.path)
    .join(', ')}. Pull grill-flow if they are newer fields.`

export const readJsonFile = (path: string): unknown => {
  const text = (() => {
    try {
      return readFileSync(path, 'utf8')
    } catch {
      throw new EditError(`cannot read ${path}`)
    }
  })()
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new EditError(
      `${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

// EXPECTED REVISIONS

const STALE_FIELD_LINES = 20

/** The write expected an older revision than the stored one; the CLI exits 3. */
export class StaleRev extends Error {
  constructor(
    readonly grillId: string,
    readonly expected: number,
    readonly current: number,
    readonly changes: ReadonlyArray<FieldChange>,
    revisions: ReadonlyArray<string>,
  ) {
    const shown = changes.slice(0, STALE_FIELD_LINES).map(fieldLine)
    const more = changes.length - shown.length
    super(
      [
        `Stale write refused: ${grillId} is at rev ${current}, but this write expected rev ${expected}.`,
        ...(revisions.length === 0
          ? []
          : [`Revisions since rev ${expected}:`, ...revisions]),
        ...(changes.length === 0
          ? []
          : [
              `Changed since rev ${expected}:`,
              ...shown,
              ...(more > 0 ? [`  ... and ${more} more`] : []),
            ]),
        `Read it again with gf get ${grillId}, redo your change on rev ${current}, and retry with --expect-rev ${current}.`,
      ].join('\n'),
    )
  }
}

/** Refuses unless the grill's newest revision is `expected`; 0 means not yet stored. */
export const assertRev = (
  db: Database,
  grillId: string,
  expected: number,
): void => {
  const current = currentRev(db, grillId)
  if (current === expected) {
    return
  }
  const revisions = grillRevisions(db, grillId)
  const from = revisions.find(revision => revision.rev === expected)
  const to = revisions.find(revision => revision.rev === current)
  throw new StaleRev(
    grillId,
    expected,
    current,
    from === undefined || to === undefined
      ? []
      : fieldChanges(from.grill, to.grill),
    revisionLines(revisions.filter(revision => revision.rev > expected)).map(
      line => `  ${line}`,
    ),
  )
}

export const parseExpectRev = (value: string | undefined): number => {
  if (value === undefined || !/^(0|[1-9]\d*)$/.test(value)) {
    throw new EditError(
      `--expect-rev takes the grill's current rev, a whole number (0 before its first recorded load); gf get <id> prints it`,
    )
  }
  return Number(value)
}

export type Loaded = Readonly<{
  grill: Grill
  rev: number
  unknownKeys: ReadonlyArray<Problem>
}>

/**
 * Validates strictly, then loads through `loadGrill`, refusing a stale `expectRev` inside the
 * same immediate transaction so no other writer lands between the check and the write.
 */
export const loadChecked = (
  db: Database,
  raw: unknown,
  provenance: WriteProvenance,
  expectRev?: number,
): Loaded => {
  const { grill, unknownKeys } = decodeStrict(raw)
  return db
    .transaction(() => {
      if (expectRev !== undefined) {
        assertRev(db, grill.id, expectRev)
      }
      const loaded = loadGrill(db, grill, provenance)
      return { grill: loaded, rev: currentRev(db, loaded.id), unknownKeys }
    })
    .immediate()
}

const storedGrill = (db: Database, id: string): Grill =>
  getGrill(db, id) ??
  ((): never => {
    throw new EditError(
      readPage(db, id) === undefined
        ? `no source grill ${id}`
        : `${id} is a composed squad page; name one of its member grills`,
    )
  })()

/**
 * Reads the stored grill, applies `edit` and loads the result, all in one transaction that
 * first checks `expectRev`. The edit returns raw JSON; strict validation judges it.
 */
export const editGrill = (
  db: Database,
  id: string,
  expectRev: number,
  edit: (grill: Grill) => unknown,
  provenance: WriteProvenance,
): Loaded =>
  db
    .transaction(() => {
      const stored = storedGrill(db, id)
      assertRev(db, id, expectRev)
      const next = edit(stored)
      const nextId =
        typeof next === 'object' && next !== null && 'id' in next
          ? next.id
          : undefined
      if (nextId !== id) {
        throw new EditError(
          `an edit keeps the grill id ${id}; load a new file to start another grill`,
        )
      }
      return loadChecked(db, next, provenance)
    })
    .immediate()

// JSON POINTER (RFC 6901) AND JSON PATCH (RFC 6902)

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const parsePointer = (pointer: string): ReadonlyArray<string> => {
  if (pointer === '') {
    return []
  }
  if (!pointer.startsWith('/')) {
    throw new EditError(
      `${JSON.stringify(pointer)} is not a JSON pointer: it starts with /, as in /steps/0/question`,
    )
  }
  return pointer
    .slice(1)
    .split('/')
    .map(token => token.replaceAll('~1', '/').replaceAll('~0', '~'))
}

const arrayIndex = (
  token: string,
  length: number,
  pointer: string,
  insert: boolean,
): number => {
  if (insert && token === '-') {
    return length
  }
  const index = /^(0|[1-9]\d*)$/.test(token) ? Number(token) : NaN
  if (!(index < length || (insert && index === length))) {
    throw new EditError(
      `${pointer}: ${JSON.stringify(token)} is not an index of an array of ${length}`,
    )
  }
  return index
}

const resolve = (
  doc: unknown,
  tokens: ReadonlyArray<string>,
  pointer: string,
): unknown =>
  tokens.reduce<unknown>((value, token) => {
    if (Array.isArray(value)) {
      return value[arrayIndex(token, value.length, pointer, false)]
    }
    if (isObject(value) && Object.hasOwn(value, token)) {
      return value[token]
    }
    throw new EditError(`nothing at ${pointer}`)
  }, doc)

export const readPointer = (doc: unknown, pointer: string): unknown =>
  resolve(doc, parsePointer(pointer), pointer)

const parentOf = (doc: unknown, pointer: string) => {
  const tokens = parsePointer(pointer)
  const parent = resolve(doc, tokens.slice(0, -1), pointer)
  if (!Array.isArray(parent) && !isObject(parent)) {
    throw new EditError(`${pointer}: its parent is not an object or array`)
  }
  return { parent, last: tokens.at(-1)! }
}

const addAt = (doc: unknown, pointer: string, value: unknown): unknown => {
  if (pointer === '') {
    return value
  }
  const { parent, last } = parentOf(doc, pointer)
  if (Array.isArray(parent)) {
    parent.splice(arrayIndex(last, parent.length, pointer, true), 0, value)
  } else {
    Object.defineProperty(parent, last, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    })
  }
  return doc
}

const removeAt = (doc: unknown, pointer: string): unknown => {
  if (pointer === '') {
    throw new EditError('a patch cannot remove the whole grill')
  }
  const { parent, last } = parentOf(doc, pointer)
  if (Array.isArray(parent)) {
    return parent.splice(arrayIndex(last, parent.length, pointer, false), 1)[0]
  }
  if (!Object.hasOwn(parent, last)) {
    throw new EditError(`nothing at ${pointer}`)
  }
  const removed = parent[last]
  delete parent[last]
  return removed
}

const deepEqual = (a: unknown, b: unknown): boolean =>
  Array.isArray(a) && Array.isArray(b)
    ? a.length === b.length &&
      a.every((item, index) => deepEqual(item, b[index]))
    : isObject(a) && isObject(b)
      ? Object.keys(a).length === Object.keys(b).length &&
        Object.keys(a).every(
          key => Object.hasOwn(b, key) && deepEqual(a[key], b[key]),
        )
      : a === b

const Pointer = Schema.String
export const PatchOperation = Schema.Union([
  Schema.Struct({
    op: Schema.Literals(['add', 'replace', 'test']),
    path: Pointer,
    value: Schema.Unknown,
  }),
  Schema.Struct({ op: Schema.Literal('remove'), path: Pointer }),
  Schema.Struct({
    op: Schema.Literals(['move', 'copy']),
    from: Pointer,
    path: Pointer,
  }),
])
export type PatchOperation = typeof PatchOperation.Type

const decodePatch = Schema.decodeUnknownResult(Schema.Array(PatchOperation), {
  errors: 'all',
})

export const parsePatch = (raw: unknown): ReadonlyArray<PatchOperation> => {
  const result = decodePatch(raw)
  if (result._tag === 'Failure') {
    throw new EditError(
      `A patch is a JSON array of RFC 6902 operations (add, remove, replace, move, copy, test):\n${formatIssues(
        result.failure.issue,
      )
        .issues.map(
          issue => `  ${toPointer(issue.path ?? []) || '/'}: ${issue.message}`,
        )
        .join('\n')}`,
    )
  }
  return result.success
}

const applyOperation = (doc: unknown, op: PatchOperation): unknown => {
  switch (op.op) {
    case 'add':
      return addAt(doc, op.path, structuredClone(op.value))
    case 'remove':
      removeAt(doc, op.path)
      return doc
    case 'replace':
      if (op.path === '') {
        return structuredClone(op.value)
      }
      removeAt(doc, op.path)
      return addAt(doc, op.path, structuredClone(op.value))
    case 'move':
      if (op.path.startsWith(`${op.from}/`)) {
        throw new EditError(`cannot move ${op.from} into its own child`)
      }
      return op.from === op.path
        ? doc
        : addAt(doc, op.path, removeAt(doc, op.from))
    case 'copy':
      return addAt(doc, op.path, structuredClone(readPointer(doc, op.from)))
    case 'test':
      if (!deepEqual(readPointer(doc, op.path), op.value)) {
        throw new EditError(
          `test failed: ${op.path} holds ${JSON.stringify(readPointer(doc, op.path))}`,
        )
      }
      return doc
  }
}

/** Applies every operation to a copy, or none: a failing one names its index. */
export const applyPatch = (
  doc: unknown,
  ops: ReadonlyArray<PatchOperation>,
): unknown =>
  ops.reduce((current, op, index) => {
    try {
      return applyOperation(current, op)
    } catch (error) {
      throw new EditError(
        `patch operation ${index} (${op.op} ${op.path}): ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }, structuredClone(doc))

/** RFC 7386: objects merge key by key, null removes a key, anything else replaces. */
export const mergePatch = (target: unknown, patch: unknown): unknown => {
  if (!isObject(patch)) {
    return patch
  }
  const merged: Record<string, unknown> = isObject(target) ? { ...target } : {}
  Object.entries(patch).forEach(([key, value]) => {
    if (value === null) {
      delete merged[key]
    } else {
      merged[key] = mergePatch(merged[key], value)
    }
  })
  return merged
}

// QUESTION EDITS

/** A step by its question id or, failing that, its step id. */
export const findStep = (
  grill: Grill,
  id: string,
): Readonly<{ index: number; step: Step }> | undefined => {
  const byQuestion = grill.steps.findIndex(step => step.question.id === id)
  const index =
    byQuestion >= 0 ? byQuestion : grill.steps.findIndex(step => step.id === id)
  return index < 0 ? undefined : { index, step: grill.steps[index]! }
}

const requireStep = (grill: Grill, id: string) =>
  findStep(grill, id) ??
  ((): never => {
    throw new EditError(`no question or step ${id} in ${grill.id}`)
  })()

const idsOf = (raw: unknown) => {
  const question =
    isObject(raw) && isObject(raw.question) ? raw.question : undefined
  return {
    step: isObject(raw) && typeof raw.id === 'string' ? raw.id : undefined,
    question: typeof question?.id === 'string' ? question.id : undefined,
  }
}

/**
 * Inserts a whole step after `after` (a step or question id) or at the end. Its ids must be
 * new to the grill, including questions already resolved (ADR 0027); a question without
 * `round` takes the grill's current round.
 */
export const addStep = (
  grill: Grill,
  target: string,
  raw: unknown,
  resolved: ReadonlyArray<string>,
  after?: string,
): unknown => {
  const ids = idsOf(raw)
  if (ids.step === undefined || ids.question === undefined) {
    throw new EditError(
      'gf question add takes a whole step: {id, part, heading, prose, question: {id, ...}}',
    )
  }
  if (target !== ids.step && target !== ids.question) {
    throw new EditError(
      `${target} names neither the new step (${ids.step}) nor its question (${ids.question})`,
    )
  }
  const taken = [ids.step, ids.question].filter(
    id =>
      grill.steps.some(step => step.id === id || step.question.id === id) ||
      resolved.includes(id),
  )
  if (taken.length > 0) {
    throw new EditError(
      `${taken.join(' and ')} already ${taken.length > 1 ? 'are' : 'is'} used in ${grill.id}, by a step, question or resolved outcome; give the new step fresh ids`,
    )
  }
  const step =
    isObject(raw) && isObject(raw.question) && !('round' in raw.question)
      ? { ...raw, question: { ...raw.question, round: grill.round } }
      : raw
  const at =
    after === undefined
      ? grill.steps.length
      : requireStep(grill, after).index + 1
  return {
    ...grill,
    steps: [...grill.steps.slice(0, at), step, ...grill.steps.slice(at)],
  }
}

/** Merges a partial step (RFC 7386) into one step; its ids stay as they are. */
export const updateStep = (
  grill: Grill,
  target: string,
  patch: unknown,
): unknown => {
  if (!isObject(patch)) {
    throw new EditError(
      'gf question update takes a JSON object of step fields, with question fields under "question"',
    )
  }
  const { index, step } = requireStep(grill, target)
  const merged = mergePatch(step, patch)
  const ids = idsOf(merged)
  if (ids.step !== step.id || ids.question !== step.question.id) {
    throw new EditError(
      `step and question ids are their identity (answers and history key on them); keep ${step.id} and ${step.question.id}`,
    )
  }
  return {
    ...grill,
    steps: grill.steps.map((other, at) => (at === index ? merged : other)),
  }
}

/** Takes a question down with its decided outcome (ADR 0027). */
export const resolveStep = (
  grill: Grill,
  target: string,
  outcome: string,
): Grill => {
  const text = outcome.trim()
  if (text === '') {
    throw new EditError(
      'a resolved question needs its decided outcome: --outcome "<what was decided>" or --file <text file>',
    )
  }
  const { step } = requireStep(grill, target)
  const id = step.question.id
  return {
    ...grill,
    steps: grill.steps.filter(other => other !== step),
    decided: [
      ...(grill.decided ?? []).filter(decision => decision.id !== id),
      { id, text },
    ],
  }
}

/** Questions that still wait on `id` through dependsOn or when. */
export const dependentsOf = (grill: Grill, id: string): ReadonlyArray<string> =>
  grill.steps
    .filter(
      step =>
        step.question.dependsOn.includes(id) ||
        step.question.when.some(condition => condition.question === id),
    )
    .map(step => step.question.id)

// CLI

const flag = (
  args: ReadonlyArray<string>,
  name: string,
): string | undefined => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

const VALUE_FLAGS = new Set([
  '--expect-rev',
  '--reason',
  '--file',
  '--after',
  '--outcome',
  '--question',
  '--session',
  '--skill-revision',
])

const positionals = (args: ReadonlyArray<string>): ReadonlyArray<string> =>
  args.filter(
    (arg, index) =>
      !arg.startsWith('--') && !VALUE_FLAGS.has(args[index - 1] ?? ''),
  )

export const EDIT_USAGE = `  gf get <grill-id> [<json-pointer> | <question-or-step-id>] [--question <id>] [--json]
                                       the stored grill, or one value in it, as JSON on stdout;
                                       its rev on stderr (--json: {"rev", "pointer", "value"})
  gf question add <grill-id> <new-step-or-question-id> --file <step.json> [--after <step-or-question-id>]
  gf question update <grill-id> <step-or-question-id> --file <fields.json>
  gf question resolve <grill-id> <step-or-question-id> (--outcome <text> | --file <text-file>)
                                       add a whole step, merge fields into one (RFC 7386, null
                                       removes), or take it down with its decided outcome
  gf patch <grill-id> --file <ops.json>  apply RFC 6902 operations to the stored grill
                                       question and patch need --expect-rev <rev> and --reason`

const required = (args: ReadonlyArray<string>, name: string): string => {
  const value = flag(args, name)?.trim()
  if (value === undefined || value === '' || value.startsWith('--')) {
    throw new EditError(`${name} is required here`)
  }
  return value
}

const readText = (path: string): string => {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    throw new EditError(`cannot read ${path}`)
  }
}

const getCommand = (
  db: Database,
  args: ReadonlyArray<string>,
): Readonly<{ out: string; err: string }> => {
  const [id = '', target] = positionals(args)
  const grill = storedGrill(db, id)
  const question = flag(args, '--question') ?? target
  const pointer =
    question === undefined || question.startsWith('/')
      ? (question ?? '')
      : `/steps/${requireStep(grill, question).index}`
  const value = readPointer(grill, pointer)
  const rev = currentRev(db, id)
  return args.includes('--json')
    ? { out: JSON.stringify({ rev, pointer, value }), err: '' }
    : {
        out: JSON.stringify(value, null, 2),
        err: `rev ${rev}${pointer === '' ? '' : `  ${pointer}`}`,
      }
}

/** Runs gf get, question and patch; returns what to print, or throws EditError/StaleRev. */
export const runEditCommand = (
  db: Database,
  command: 'get' | 'question' | 'patch',
  args: ReadonlyArray<string>,
  provenance: WriteProvenance,
  base: string,
): Readonly<{ out: string; err: string }> => {
  if (command === 'get') {
    return getCommand(db, args)
  }
  const expectRev = parseExpectRev(flag(args, '--expect-rev'))
  if (provenance.reason === '') {
    throw new EditError(
      `gf ${command} needs --reason "<why>", kept for gf history`,
    )
  }
  const [first = '', ...rest] = positionals(args)
  const action = command === 'question' ? first : 'patch'
  const [id = '', target = ''] = command === 'question' ? rest : [first]
  if (command === 'question' && target === '') {
    throw new EditError(
      'gf question add|update|resolve <grill-id> <step-or-question-id> ...',
    )
  }
  const warnings: Array<string> = []
  const edit = (grill: Grill): unknown => {
    switch (action) {
      case 'add':
        return addStep(
          grill,
          target,
          readJsonFile(required(args, '--file')),
          (snapshot(db, grill).grill.decided ?? []).map(
            decision => decision.id,
          ),
          flag(args, '--after'),
        )
      case 'update':
        return updateStep(grill, target, readJsonFile(required(args, '--file')))
      case 'resolve': {
        const outcome =
          flag(args, '--outcome') ?? readText(required(args, '--file'))
        const next = resolveStep(grill, target, outcome)
        const resolved = requireStep(grill, target).step.question.id
        const waiting = dependentsOf(next, resolved)
        if (waiting.length > 0) {
          warnings.push(
            `${waiting.join(', ')} still name${waiting.length === 1 ? 's' : ''} ${resolved} in dependsOn or when, so ${waiting.length === 1 ? 'it waits' : 'they wait'} on a question no longer on the page; update ${waiting.length === 1 ? 'it' : 'them'} with gf question update.`,
          )
        }
        return next
      }
      case 'patch':
        return applyPatch(
          grill,
          parsePatch(readJsonFile(required(args, '--file'))),
        )
      default:
        throw new EditError('gf question takes add, update or resolve')
    }
  }
  const loaded = editGrill(db, id, expectRev, edit, provenance)
  const done =
    command === 'patch'
      ? 'patched'
      : `${target} ${action === 'add' ? 'added' : `${action}d`}`
  return {
    out: `${done} on ${loaded.grill.id}: rev ${loaded.rev}, ${base}/g/${loaded.grill.id}`,
    err: [
      ...warnings,
      ...(loaded.unknownKeys.length > 0
        ? [unknownKeyWarning(loaded.unknownKeys)]
        : []),
    ].join('\n'),
  }
}
