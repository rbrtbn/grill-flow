import { Option } from 'effect'

import { type Grill, KEY_REFERENCE, type Step, stepByKey } from '../src/domain'

// Question keys and the clarity lint (docs/adr/0034). Key form and uniqueness are schema
// problems at the writer's boundary; the lint warns, and only GF_REQUIRE_CONTEXT=1 refuses.

export type Finding = Readonly<{ path: string; message: string }>

export const KEY_FORM = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

const keyPath = (index: number) => `/steps/${index}/question/key`

/** Form and uniqueness of every key a writer submits; problems join the schema check's. */
export const keyFormProblems = (grill: Grill): ReadonlyArray<Finding> =>
  grill.steps.flatMap((step, index) => {
    const key = step.question.key
    if (key === undefined) {
      return []
    }
    if (!KEY_FORM.test(key) || key.length < 3 || key.length > 48) {
      return [
        {
          path: keyPath(index),
          message: `"${key}" is not a key: 3 to 48 characters of lowercase letters, digits and single hyphens, starting with a letter, such as deploy-order`,
        },
      ]
    }
    const first = grill.steps.findIndex(other => other.question.key === key)
    return first === index
      ? []
      : [
          {
            path: keyPath(index),
            message: `"${key}" is already the key of ${grill.steps[first]!.question.id}; each question needs its own`,
          },
        ]
  })

/**
 * Keys are permanent: a question keeps the key it was loaded with, and a key once used names
 * that question for good, so chat, transcripts and retros never point at the wrong one.
 */
export const keyHistoryProblems = (
  grill: Grill,
  earlier: ReadonlyArray<Grill>,
): ReadonlyArray<Finding> => {
  const keyOf = new Map<string, string>()
  const ownerOf = new Map<string, string>()
  earlier.forEach(previous =>
    previous.steps.forEach(({ question }) => {
      if (question.key !== undefined) {
        keyOf.set(question.id, question.key)
        ownerOf.set(question.key, question.id)
      }
    }),
  )
  return grill.steps.flatMap(({ question }, index) => {
    const before = keyOf.get(question.id)
    if (before !== undefined && before !== question.key) {
      return [
        {
          path:
            question.key === undefined
              ? `/steps/${index}/question`
              : keyPath(index),
          message: `${question.id} was loaded with key "${before}", and a key never changes or goes away; keep it. To rename, resolve ${question.id} and add a new question with the new key`,
        },
      ]
    }
    const owner =
      question.key === undefined ? undefined : ownerOf.get(question.key)
    return owner !== undefined && owner !== question.id
      ? [
          {
            path: keyPath(index),
            message: `"${question.key}" was the key of ${owner} in an earlier revision; keys are never reused, so pick another`,
          },
        ]
      : []
  })
}

// CLARITY LINT

const BARE_Q = /(?<![\w-])Q\d+(?![\w-])/g
const ACRONYM = /(?<![\w-])[A-Z]{2,6}(?![\w-])/g
const DEFINED_INLINE = /\(([A-Z]{2,6})\)/g
const KNOWN_ACRONYMS = new Set([
  'PR',
  'CI',
  'API',
  'URL',
  'ID',
  'UI',
  'JSON',
  'ADR',
  'CLI',
  'HTTP',
  'OK',
  'UTC',
])

/** Text with code spans, links and `[[key]]` references blanked, as the lint should read it. */
const readable = (text: string): string =>
  text
    .replace(/`[^`]*`/g, ' ')
    .replace(/\[[^\]\n]*\]\(\S+?\)/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(KEY_REFERENCE, ' ')

type Field = Readonly<{ path: string; text: string; clarity: boolean }>

/** The texts a reader reads cold; `clarity` marks those the Q-number rule covers. */
const fieldsOf = (step: Step, index: number): ReadonlyArray<Field> => {
  const at = `/steps/${index}`
  const q = step.question
  return [
    { path: `${at}/heading`, text: step.heading, clarity: false },
    ...step.prose.flatMap((text, paragraph) =>
      text.trimStart().startsWith('```')
        ? []
        : [{ path: `${at}/prose/${paragraph}`, text, clarity: true }],
    ),
    { path: `${at}/question/title`, text: q.title, clarity: false },
    ...(q.context === undefined
      ? []
      : [{ path: `${at}/question/context`, text: q.context, clarity: true }]),
    { path: `${at}/question/ask`, text: q.ask, clarity: true },
    { path: `${at}/question/scope`, text: q.scope, clarity: false },
    ...q.options.flatMap((option, k) => [
      {
        path: `${at}/question/options/${k}/label`,
        text: option.label,
        clarity: true,
      },
      {
        path: `${at}/question/options/${k}/effect`,
        text: option.effect,
        clarity: true,
      },
    ]),
  ]
}

const definedWords = (grill: Grill): ReadonlySet<string> => {
  const words = (text: string) => text.match(ACRONYM) ?? []
  const allText = grill.steps.flatMap(step =>
    fieldsOf(step, 0).map(field => field.text),
  )
  return new Set([
    ...KNOWN_ACRONYMS,
    ...grill.terms.flatMap(term => [term.term, ...term.aliases].flatMap(words)),
    ...grill.entities.flatMap(entity =>
      [entity.name, ...entity.aliases].flatMap(words),
    ),
    ...[...grill.intro, ...allText].flatMap(text =>
      [...text.matchAll(DEFINED_INLINE)].map(match => match[1]!),
    ),
  ])
}

const sameStep = (a: Step, b: Step | undefined) =>
  b !== undefined && JSON.stringify(a) === JSON.stringify(b)

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Clarity findings for the steps this write adds or changes, all in one pass, so an edit to one
 * question never repeats findings on questions it left alone.
 */
/**
 * `siblings` are the other member grills of this grill's squad page, which a qualified
 * `[[member/key]]` may name; undefined means they can't be seen here (an outbox on another
 * machine), so such references are left unchecked rather than reported.
 */
export const lintGrill = (
  grill: Grill,
  previous?: Grill,
  siblings?: ReadonlyArray<Grill>,
): ReadonlyArray<Finding> => {
  const resolves = (reference: string): boolean => {
    if (Option.isSome(stepByKey(grill, reference))) {
      return true
    }
    const slash = reference.indexOf('/')
    if (slash < 0 || reference.slice(0, slash) === grill.id) {
      return false
    }
    return (
      siblings === undefined ||
      siblings.some(sibling => Option.isSome(stepByKey(sibling, reference)))
    )
  }
  const before = new Map(
    (previous?.steps ?? []).map(step => [step.question.id, step]),
  )
  const order = new Map(
    grill.steps.map((step, index) => [step.question.id, index]),
  )
  const defined = definedWords(grill)
  const reported = new Set<string>()
  const otherIds = grill.steps
    .map(step => step.question.id)
    .filter(id => id.length > 1)
  const idPattern =
    otherIds.length === 0
      ? undefined
      : new RegExp(
          `(?<![\\w-])(?:${otherIds.map(escape).join('|')})(?![\\w-])`,
          'g',
        )
  return grill.steps.flatMap((step, index): ReadonlyArray<Finding> => {
    if (sameStep(step, before.get(step.question.id))) {
      return []
    }
    const q = step.question
    const later = (id: string) => (order.get(id) ?? -1) > index
    const textFindings = fieldsOf(step, index).flatMap(field => {
      const text = readable(field.text)
      const references = [...field.text.matchAll(KEY_REFERENCE)].map(match =>
        match[1]!.trim(),
      )
      const unresolved = references
        .filter(reference => !resolves(reference))
        .map(reference => ({
          path: field.path,
          message: reference.includes('/')
            ? `[[${reference}]] names no question in ${grill.id} or another member of its squad page; write [[key]] for a question here, or [[member-grill-id/key]] for another member's`
            : `[[${reference}]] names no question in ${grill.id}; write [[key]] with a key a question here has`,
        }))
      const forwardKeys = references
        .flatMap(reference =>
          Option.toArray(stepByKey(grill, reference)).map(target => ({
            label: `[[${reference}]]`,
            target,
          })),
        )
        .filter(({ target }) => later(target.question.id))
      const tokens = [
        ...new Set([
          ...(field.clarity ? (text.match(BARE_Q) ?? []) : []),
          ...(idPattern === undefined ? [] : (text.match(idPattern) ?? [])),
        ]),
      ].filter(token => token !== q.id)
      const bare = tokens.flatMap(token => {
        const target = grill.steps.find(other => other.question.id === token)
        const suggestion =
          target?.question.key === undefined
            ? 'give it a key and write [[its-key]]'
            : `write [[${target.question.key}]]`
        if (target !== undefined && later(token)) {
          return [
            {
              path: field.path,
              message: `forward reference to "${token}", which comes later on the page — say what each answer to it would mean here, or put this question after it; ${suggestion}`,
            },
          ]
        }
        return field.clarity && /^Q\d+$/.test(token)
          ? [
              {
                path: field.path,
                message: `bare "${token}" — refer to the question by key (${suggestion}); squad pages renumber questions`,
              },
            ]
          : []
      })
      const forward = forwardKeys.map(({ label }) => ({
        path: field.path,
        message: `forward reference to ${label}, which comes later on the page — say what each answer to it would mean here, or put this question after it`,
      }))
      const acronyms = [...new Set(text.match(ACRONYM) ?? [])]
        .filter(word => !defined.has(word) && !reported.has(word))
        .map(word => {
          reported.add(word)
          return {
            path: field.path,
            message: `"${word}" is not defined — spell it out on first use, as "<words> (${word})", or add it to terms`,
          }
        })
      return [...bare, ...forward, ...unresolved, ...acronyms]
    })
    return [
      ...(q.context === undefined || q.context.trim() === ''
        ? [
            {
              path: `/steps/${index}/question`,
              message:
                'no context — set question.context: what is being decided, why now, and what happens if it waits, for a reader new to this run',
            },
          ]
        : []),
      ...(q.key === undefined
        ? [
            {
              path: `/steps/${index}/question`,
              message:
                'no key — set question.key to a short kebab-case name and use it in chat, sends and commits',
            },
          ]
        : []),
      ...textFindings,
    ]
  })
}

export const isMissingContext = (finding: Finding): boolean =>
  finding.message.startsWith('no context')

export const lintLines = (findings: ReadonlyArray<Finding>): string =>
  findings
    .map(finding => `lint: ${finding.path}: ${finding.message}`)
    .join('\n')
