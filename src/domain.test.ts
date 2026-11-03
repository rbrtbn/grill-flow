import { Option, Schema } from 'effect'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
  Grill,
  blockOf,
  diffBlocks,
  diffWords,
  neighbourStep,
  relationsOf,
  withQuestions,
  withRefs,
  withTerms,
  replyText,
  roundSteps,
  issuesOf,
  urgencyRank,
  usesUrgency,
  segments,
  splitParagraphs,
  statusOf,
  tally,
  planPhaseOf,
  waitingOnYou,
} from './domain'

const grill = Schema.decodeUnknownSync(Grill)(
  JSON.parse(readFileSync('src/fixtures/grill.json', 'utf8')),
)

describe('statusOf', () => {
  it('opens only questions with nothing to wait for', () => {
    expect(statusOf(grill, {}, 'Q1')._tag).toBe('Open')
    expect(statusOf(grill, {}, 'Q17')._tag).toBe('Open')
    expect(statusOf(grill, {}, 'Q2')).toEqual({ _tag: 'Waiting', on: ['Q1'] })
  })

  it('marks a question not needed when an upstream answer rules it out', () => {
    expect(statusOf(grill, { Q1: 'b' }, 'Q2')).toEqual({
      _tag: 'NotNeeded',
      because: 'you chose Q1 b',
    })
  })

  it('carries not needed down the chain and frees questions that only depended on it', () => {
    expect(statusOf(grill, { Q1: 'b' }, 'Q3')._tag).toBe('NotNeeded')
    expect(statusOf(grill, { Q1: 'b' }, 'Q6')._tag).toBe('NotNeeded')
    expect(statusOf(grill, { Q1: 'b' }, 'Q18')._tag).toBe('Open')
    expect(statusOf(grill, { Q1: 'b' }, 'Q7')._tag).toBe('Open')
  })

  it('reads an answer as answered once nothing upstream is open', () => {
    expect(statusOf(grill, { Q1: 'a', Q2: 'a' }, 'Q2')).toEqual({
      _tag: 'Answered',
      key: 'a',
    })
  })
})

describe('tally', () => {
  it('counts every question once', () => {
    const counts = tally(grill, { Q1: 'a' })
    expect(counts.total).toBe(21)
    expect(
      counts.answered + counts.open + counts.waiting + counts.notNeeded,
    ).toBe(21)
    expect(counts.answered).toBe(1)
  })
})

describe('replyText', () => {
  it('lists answers in page order, with notes and the open questions', () => {
    const text = replyText(
      grill,
      { Q1: 'a', Q4: 'b' },
      { Q4: 'keep clw for now', Q5: 'what about Linear' },
    )
    const lines = text.split('\n')
    expect(lines[0]).toBe('Round 1 (2 of 21 answered):')
    expect(lines[1]).toBe('Q1 a')
    expect(lines[2]).toBe('Q4 b (keep clw for now)')
    expect(lines[3]).toMatch(/^Open: Q2, Q3, Q16, Q5 \(what about Linear\), /)
  })

  it('says all recommended when every needed answer is the recommendation', () => {
    const answers = Object.fromEntries(
      grill.steps.map(step => [
        step.question.id,
        step.question.options.find(option => option.recommended)?.key ?? 'a',
      ]),
    )
    expect(replyText(grill, answers, {})).toMatch(
      /^Round 1: all recommended \(Q1 a, Q2 a, Q3 a, Q16 a,/,
    )
  })

  it('names the questions an answer ruled out', () => {
    expect(replyText(grill, { Q1: 'b' }, {})).toContain(
      'Not needed: Q2 (you chose Q1 b)',
    )
  })
})

describe('own answers', () => {
  it('writes an own answer into the reply', () => {
    const text = replyText(
      grill,
      { Q1: 'other' },
      { Q1: 'see note' },
      { Q1: 'only for the host side' },
    )
    expect(text.split('\n')[1]).toBe(
      'Q1 other: only for the host side (see note)',
    )
  })

  it('keeps later questions open after an own answer', () => {
    expect(statusOf(grill, { Q1: 'other' }, 'Q2')._tag).toBe('Open')
  })
})

describe('diffWords', () => {
  it('marks added and removed words and keeps the rest', () => {
    expect(diffWords('the cat sat', 'the dog sat')).toEqual([
      { _tag: 'Same', text: 'the ' },
      { _tag: 'Removed', text: 'cat' },
      { _tag: 'Added', text: 'dog' },
      { _tag: 'Same', text: ' sat' },
    ])
  })

  it('handles a rewrite from nothing', () => {
    expect(diffWords('', 'new text')).toEqual([
      { _tag: 'Added', text: 'new text' },
    ])
  })
})

describe('segments', () => {
  it('marks entity names in text and in backticks, and leaves other code alone', () => {
    const parts = segments(
      "The `box-1` server runs the agent and `hc`; the agent's worker waits.",
      grill.entities,
    )
    expect(parts.map(part => [part._tag, part.text])).toEqual([
      ['Text', 'The '],
      ['Entity', 'box-1'],
      ['Text', ' server runs the '],
      ['Entity', 'agent'],
      ['Text', ' and '],
      ['Code', 'hc'],
      ['Text', '; the '],
      ['Entity', 'agent'],
      ['Text', "'s "],
      ['Entity', 'worker'],
      ['Text', ' waits.'],
    ])
  })

  it('leaves names inside longer words alone', () => {
    expect(
      segments('sub-agent workers', grill.entities).map(part => part._tag),
    ).toEqual(['Text'])
  })
})

describe('withQuestions', () => {
  it("marks the grill's question ids and leaves unknown ids and longer words alone", () => {
    const parts = withQuestions(
      [{ _tag: 'Text', text: 'See Q2 and Q1, not Q99, Q123 or Q2-b.' }],
      grill,
    )
    expect(parts.map(part => [part._tag, part.text])).toEqual([
      ['Text', 'See '],
      ['Question', 'Q2'],
      ['Text', ' and '],
      ['Question', 'Q1'],
      ['Text', ', not Q99, Q123 or Q2-b.'],
    ])
  })
})

describe('figures', () => {
  const text = [
    'Two orders:',
    '',
    '```',
    'A  ──●── drop ──●── stealth',
    '',
    'B  ──●── stealth ──●── drop',
    '```',
    'After the block.',
  ].join('\n')

  it('keeps a fenced block whole across its blank lines', () => {
    expect(splitParagraphs(text)).toEqual([
      'Two orders:',
      '```\nA  ──●── drop ──●── stealth\n\nB  ──●── stealth ──●── drop\n```',
      'After the block.',
    ])
  })

  it('reads a fenced block as a figure with its spacing as written', () => {
    expect(blockOf(splitParagraphs(text)[1] ?? '')).toEqual({
      _tag: 'Figure',
      text: 'A  ──●── drop ──●── stealth\n\nB  ──●── stealth ──●── drop',
    })
  })
})

describe('blockOf', () => {
  it('reads a lead line and dash items as a list', () => {
    const block = blockOf('It keeps:\n- the wiki\n- web search\n  and more')
    expect(block._tag).toBe('List')
    expect(block._tag === 'List' && block.items).toEqual([
      'the wiki',
      'web search and more',
    ])
  })

  it('leaves a plain paragraph alone', () => {
    expect(blockOf('one line\nwrapped')).toEqual({
      _tag: 'Paragraph',
      text: 'one line wrapped',
    })
  })
})

describe('diffBlocks', () => {
  it('lays a rewrite into the new list, marking words in place', () => {
    const blocks = diffBlocks(
      'It keeps the wiki and search.',
      'It keeps:\n- the wiki\n- web search',
    )
    expect(blocks).toHaveLength(1)
    const list = blocks[0]
    expect(list?._tag).toBe('List')
    if (list?._tag === 'List') {
      expect(list.items).toHaveLength(2)
      expect(
        list.items.map(item =>
          item
            .filter(p => p._tag !== 'Removed')
            .map(p => p.text)
            .join(''),
        ),
      ).toEqual(['the wiki', 'web search'])
    }
  })

  it('keeps paragraphs apart', () => {
    expect(
      diffBlocks('one\n\ntwo', 'one\n\ntwo more').map(block => block._tag),
    ).toEqual(['Paragraph', 'Paragraph'])
  })
})

describe('neighbourStep', () => {
  const id = (step: Option.Option<{ id: string }>) =>
    Option.getOrElse(
      Option.map(step, s => s.id),
      () => 'none',
    )

  it('starts at the first section from the introduction', () => {
    expect(id(neighbourStep(grill, {}, Option.none(), 'next'))).toBe('step-q1')
    expect(id(neighbourStep(grill, {}, Option.none(), 'previous'))).toBe('none')
  })

  it('skips sections an answer made unnecessary', () => {
    expect(
      id(neighbourStep(grill, { Q1: 'b' }, Option.some('step-q1'), 'next')),
    ).toBe('step-q4')
  })
})

describe('skipping', () => {
  it('opens the questions that waited on a skipped one, and leaves it open', () => {
    expect(statusOf(grill, {}, 'Q2', ['Q1'])._tag).toBe('Open')
    expect(statusOf(grill, {}, 'Q1', ['Q1'])._tag).toBe('Open')
  })

  it('keeps an answer given while its upstream is still open', () => {
    expect(statusOf(grill, { Q2: 'a' }, 'Q2')).toEqual({
      _tag: 'Answered',
      key: 'a',
    })
    expect(replyText(grill, { Q2: 'a' }, {})).toContain('\nQ2 a')
  })
})

describe('withTerms', () => {
  it('marks each glossary term once, outside code and names', () => {
    const parts = withTerms(
      segments(
        'The gate and the gate, in `gate`, with a lease.',
        grill.entities,
      ),
      grill.terms,
    )
    expect(
      parts.filter(part => part._tag === 'Term').map(part => part.text),
    ).toEqual(['gate', 'lease'])
  })
})

describe('relationsOf', () => {
  it('links a question to what it waits for and to what its text names', () => {
    const snapshot = {
      grill,
      answers: {},
      notes: {},
      own: {},
      asks: [],
      revisions: [],
      sends: [],
      sent: {},
    }
    const relations = relationsOf(snapshot)
    expect(relations).toContainEqual({ from: 'Q18', to: 'Q10', kind: 'waits' })
    expect(relations).toContainEqual({ from: 'Q2', to: 'Q7', kind: 'mentions' })
  })
})

describe('squad fields', () => {
  const squad = Schema.decodeUnknownSync(Grill)({
    ...JSON.parse(readFileSync('src/fixtures/grill.json', 'utf8')),
    refs: {
      'SQD-101': {
        text: 'Retry webhooks',
        url: 'https://linear.app/x/issue/SQD-101',
        state: 'Todo',
        type: 'unstarted',
      },
      '#212': {
        text: 'feat: retry',
        url: 'https://github.com/x/y/pull/212',
        type: 'pr',
      },
    },
  })

  it('links every mention of a ref key in plain text, and leaves code and longer ids alone', () => {
    const marked = withRefs(
      segments('SQD-101 and PR #212, not SQD-1010 or `SQD-101`'),
      squad.refs,
    )
    expect(
      marked.filter(part => part._tag === 'Ref').map(part => part.text),
    ).toEqual(['SQD-101', '#212'])
    expect(
      marked.some(part => part._tag === 'Code' && part.text === 'SQD-101'),
    ).toBe(true)
  })

  it('ranks an unset urgency right after blocking', () => {
    const question = squad.steps[0]!.question
    expect(usesUrgency(squad)).toBe(false)
    expect(urgencyRank({ ...question, urgency: 'blocking' })).toBeLessThan(
      urgencyRank(question),
    )
    expect(urgencyRank(question)).toBeLessThan(
      urgencyRank({ ...question, urgency: 'soon' }),
    )
  })
})

describe('rounds', () => {
  const tagged = {
    ...grill,
    round: 2,
    steps: grill.steps.map(step =>
      step.question.id === 'Q1' || step.question.id === 'Q17'
        ? { ...step, question: { ...step.question, round: 2 } }
        : step,
    ),
  }

  it('replies with only the questions the current round asks', () => {
    expect(roundSteps(tagged).map(step => step.question.id)).toEqual([
      'Q1',
      'Q17',
    ])
    expect(replyText(tagged, { Q1: 'a', Q2: 'a', Q17: 'b' }, {})).toBe(
      'Round 2:\nQ1 a\nQ17 b',
    )
  })

  it('keeps every question when none carries a round', () => {
    expect(roundSteps(grill)).toHaveLength(grill.steps.length)
  })
})

describe('issues and urgency', () => {
  const tag =
    (issue: string, urgency?: 'blocking') =>
    (step: (typeof grill.steps)[number]) => ({
      ...step,
      question: { ...step.question, issue, ...(urgency ? { urgency } : {}) },
    })
  const tagged = {
    ...grill,
    steps: grill.steps.map((step, index) =>
      index < 3 ? tag(index === 1 ? 'SQD-2' : 'SQD-1', 'blocking')(step) : step,
    ),
  }

  it('lists each issue once, in page order', () => {
    expect(issuesOf(tagged)).toEqual(['SQD-1', 'SQD-2'])
  })

  it('lists by urgency only on a squad grill', () => {
    expect(usesUrgency(tagged)).toBe(false)
    expect(usesUrgency({ ...tagged, kind: 'squad' })).toBe(true)
  })
})

describe('plan', () => {
  const planned = Schema.decodeUnknownSync(Grill)({
    ...JSON.parse(readFileSync('src/fixtures/grill.json', 'utf8')),
    version: 2,
    plan: {
      critical: ['B', 'C'],
      issues: [
        { id: 'A', title: 'Building', phase: 'building', start: ['Q1'] },
        {
          id: 'B',
          title: 'Head of the chain',
          phase: 'gated',
          start: ['Q1', 'Q4'],
        },
        { id: 'C', title: 'After B', phase: 'later', follows: ['B'] },
        { id: 'D', title: 'Small', phase: 'gated', start: ['Q5'] },
        { id: 'E', title: 'Newer phase', phase: 'paused-by-rob', start: [] },
      ],
    },
  })
  const issue = (id: string) =>
    planned.plan?.issues.find(candidate => candidate.id === id) ?? fail(id)
  const fail = (id: string): never => {
    throw new Error(`no issue ${id}`)
  }

  it('reads each issue from the run and the answers', () => {
    expect(planPhaseOf(planned, issue('A'), {})).toBe('building')
    expect(planPhaseOf(planned, issue('B'), {})).toBe('you')
    expect(planPhaseOf(planned, issue('C'), {})).toBe('after')
    expect(planPhaseOf(planned, issue('B'), { Q1: 'a', Q4: 'a' })).toBe('ready')
  })

  it('reads a phase it does not know as not yet started', () => {
    expect(planPhaseOf(planned, issue('E'), {})).toBe('ready')
  })

  it('ranks the issue that holds the most work first', () => {
    expect(waitingOnYou(planned, {}).map(found => found.id)).toEqual(['B', 'D'])
  })

  it('also waits on a running build whose review needs an answer, after any build that cannot start', () => {
    const reviewing = Schema.decodeUnknownSync(Grill)({
      ...planned,
      plan: {
        issues: [
          { id: 'R', title: 'Running', phase: 'building', review: ['Q6'] },
          { id: 'S', title: 'Gated', phase: 'gated', start: ['Q5'] },
        ],
      },
    })
    expect(waitingOnYou(reviewing, {}).map(found => found.id)).toEqual([
      'S',
      'R',
    ])
    expect(waitingOnYou(reviewing, { Q5: 'a', Q6: 'a' })).toEqual([])
  })
})

describe('page addresses', () => {
  it('round-trips every kind of page through its path', async () => {
    const { pathOfPage, pageOfPath } = await import('./main')
    for (const page of [
      'plan',
      'overview',
      'decided',
      'card:cos-hardening-2',
      'issue:LAB-1103',
      'urgency:soon',
      'sandbox',
    ]) {
      expect(pageOfPath(pathOfPage('a grill', page))).toBe(page)
    }
    expect(pageOfPath('/g/a%20grill')).toBe('')
  })
})

describe('reasoning in Talk', () => {
  it('unfolds the question Talk is about, or the only one, unless the reader chose', async () => {
    const { isWhyOpen } = await import('./main')
    expect(isWhyOpen({}, 's1', true, false)).toBe(true)
    expect(isWhyOpen({}, 's1', false, false)).toBe(false)
    expect(isWhyOpen({}, 's1', false, true)).toBe(true)
    expect(isWhyOpen({ s1: false }, 's1', true, true)).toBe(false)
    expect(isWhyOpen({ s1: true }, 's1', false, false)).toBe(true)
  })
})

describe('ask targets', () => {
  it('takes a step, a concept or a card the grill has, and nothing else', async () => {
    const { hasTarget, isWholeTarget } = await import('./domain')
    const grill = Schema.decodeUnknownSync(Grill)(
      JSON.parse(readFileSync('examples/squad-sample.json', 'utf8')),
    )
    const step = grill.steps[0]!
    expect(hasTarget(grill, step.id)).toBe(true)
    expect(hasTarget(grill, `part:${step.part}`)).toBe(true)
    expect(hasTarget(grill, 'part:nowhere')).toBe(false)
    expect(hasTarget(grill, 'card:nowhere')).toBe(false)
    expect(hasTarget(grill, 'card:B3')).toBe(true)
    expect(isWholeTarget('card:x') && isWholeTarget('part:x')).toBe(true)
    expect(isWholeTarget(step.id)).toBe(false)
  })

  it('keys Talk by the card on a card page and by the concept elsewhere', async () => {
    const { talkKeyOf, generalTargetOf } = await import('./main')
    expect(talkKeyOf('card:c-2', 'timing')).toBe('card:c-2')
    expect(talkKeyOf('timing', 'timing')).toBe('timing')
    expect(talkKeyOf('urgency:soon', 'timing')).toBe('timing')
    expect(generalTargetOf('card:c-2')).toBe('card:c-2')
    expect(generalTargetOf('timing')).toBe('part:timing')
  })
})
