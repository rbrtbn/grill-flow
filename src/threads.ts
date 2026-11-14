import type { Snapshot, Step } from './domain'

// One thread model for question pages, task pages and the sessions panel: a session, optionally
// about one subject (a question step id, or `item:<source>/<id>` for an owner step). Its target
// is `<subject>@<address>`; delivery, read state and replies come with the business logic.

export const threadTarget = (subject: string, address: string): string =>
  `${subject}@${address}`

export type ThreadLine = Readonly<{
  isYou: boolean
  name: string
  text: string
  time: string
  isNew?: boolean
}>

export type NestedThread = Readonly<{
  key: string
  kind: 'Passage' | 'Side'
  address: string
  name: string
  quote?: string
  // The passage is no longer in the question's current prose; the thread stays.
  orphanedIn?: number
  lines: ReadonlyArray<ThreadLine>
}>

const plainText = (paragraph: string): string =>
  paragraph
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/[*_`]/g, '')
    .trim()

const firstSentence = (paragraph: string): string => {
  const text = plainText(paragraph)
  return (text.match(/^[^.!?]{12,160}[.!?]/)?.[0] ?? text.slice(0, 90)).trim()
}

/** A prose paragraph that reads as a sentence, not a list, table or diagram. */
const quotable = (prose: ReadonlyArray<string>): string | undefined =>
  prose
    .flatMap(block => block.split(/\n\s*\n/))
    .find(
      paragraph =>
        /^[A-Z]/.test(paragraph.trim()) && !paragraph.includes('```'),
    )

/**
 * Preview-only sample threads for a question (`?fixture=owner-actions`): a passage thread on its
 * second paragraph, a passage the question no longer contains, and a side thread with the lead.
 */
export const fixtureThreads = (
  snapshot: Snapshot,
  step: Step,
  askerName: string,
): ReadonlyArray<NestedThread> => {
  const asker = step.question.session ?? snapshot.grill.session
  const lead = snapshot.grill.session
  const quoted = quotable(step.prose.slice(1)) ?? quotable(step.prose)
  const passage: ReadonlyArray<NestedThread> =
    quoted === undefined
      ? []
      : [
          {
            key: threadTarget(`${step.id}#passage`, asker),
            kind: 'Passage',
            address: asker,
            name: askerName,
            quote: firstSentence(quoted),
            lines: [
              {
                isYou: true,
                name: 'You',
                text: 'Is this still true after the last round?',
                time: '03:41',
              },
              {
                isYou: false,
                name: askerName,
                text: 'Yes. It holds for the runs going now; only new runs would see the change.',
                time: '03:44',
                isNew: true,
              },
            ],
          },
        ]
  const orphan: NestedThread = {
    key: threadTarget(`${step.id}#orphan`, asker),
    kind: 'Passage',
    address: asker,
    name: askerName,
    quote: 'Two of last week’s runs paused for over an hour at a time',
    orphanedIn: 2,
    lines: [
      {
        isYou: false,
        name: askerName,
        text: 'The grants run and the homelab run, both waiting on reviewer rounds.',
        time: '03:17',
      },
    ],
  }
  const side: ReadonlyArray<NestedThread> =
    lead === '' || lead === asker
      ? []
      : [
          {
            key: threadTarget(step.id, lead),
            kind: 'Side',
            address: lead,
            name: 'Squad lead',
            lines: [
              {
                isYou: true,
                name: 'You',
                text: 'Does this change what the night runs do?',
                time: '03:50',
              },
              {
                isYou: false,
                name: 'Squad lead',
                text: 'Only for runs that start after it lands; the ones going now keep today’s rule.',
                time: '03:52',
              },
            ],
          },
        ]
  return [...passage, orphan, ...side]
}

export const STARTERS: ReadonlyArray<readonly [string, string]> = [
  ['Contextualize this for me', 'Contextualize this for me.'],
  ['Give me an example', 'Give me an example.'],
  ['Compare the choices', 'Compare the choices.'],
  [
    'Ask for a clearer rewrite',
    'Please rewrite this question and its reasoning more clearly.',
  ],
  [
    'What would you pick?',
    'What would you pick, and what would change your mind?',
  ],
]
