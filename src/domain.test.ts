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
  withRefs,
  withTerms,
  replyText,
  roundSteps,
  urgencyRank,
  usesUrgency,
  segments,
  statusOf,
  tally,
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
