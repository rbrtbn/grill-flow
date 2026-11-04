import { Option } from 'effect'
import { describe, expect, it } from 'vitest'

import {
  type Compare,
  DiagramView,
  compareTable,
  diagramOf,
  flagCounts,
  isChanged,
  proseItems,
  proseSections,
  shownOf,
  titleOf,
} from './diagram'
import { paragraphsOf } from './domain'

const zones = (follow?: Record<string, { state: string; focus?: string }>) =>
  [
    '```diagram',
    JSON.stringify({
      kind: 'zones',
      title: 'Who owns it',
      zones: [
        { id: 'wiki', label: 'Squad wiki' },
        { id: 'owner', label: 'cos-rob' },
      ],
      states: {
        now: {
          items: [{ label: 'Due time', in: ['wiki', 'owner'], flag: 'twice' }],
        },
        a: { items: [{ label: 'Due time', in: 'owner' }] },
      },
      ...(follow === undefined ? {} : { follow }),
    }),
    '```',
  ].join('\n')

describe('diagramOf', () => {
  it('reads a ```diagram block of a known kind', () => {
    const diagram = Option.getOrThrow(diagramOf(zones()))
    expect(diagram.kind).toBe('zones')
  })

  it('gives none for broken JSON, an unknown kind or a plain block', () => {
    expect(Option.isNone(diagramOf('```diagram\n{"kind": "zones",\n```'))).toBe(
      true,
    )
    expect(Option.isNone(diagramOf('```diagram\n{"kind": "venn"}\n```'))).toBe(
      true,
    )
    expect(Option.isNone(diagramOf('```\nA -> B\n```'))).toBe(true)
  })
})

describe('paragraph titles', () => {
  it('splits a ### first line off as the title', () => {
    expect(titleOf('### Today\nThe plan holds it twice.')).toEqual({
      title: Option.some('Today'),
      text: 'The plan holds it twice.',
    })
  })

  it('survives paragraphsOf, which joins the other lines', () => {
    expect(paragraphsOf('### Today\nThe plan\nholds it twice.')).toEqual([
      '### Today\nThe plan holds it twice.',
    ])
  })

  it("takes a ### line on its own as the next paragraph's title", () => {
    const items = proseItems(['### Today', 'The plan holds it twice.'])
    expect(items).toEqual([
      {
        _tag: 'Text',
        paragraph: 'The plan holds it twice.',
        title: Option.some('Today'),
      },
    ])
  })
})

describe('proseSections', () => {
  it('pins a diagram over the paragraphs up to the last one it follows', () => {
    const sections = proseSections(
      proseItems([
        'Before.',
        zones({ Recommended: { state: 'a' }, 'Answer b': { state: 'now' } }),
        '### Recommended\nOne owner.',
        'Untitled, between.',
        '### Answer b\nTwo owners.',
        '### Left open\nLater.',
      ]),
    )
    expect(sections.map(section => section._tag)).toEqual([
      'Plain',
      'Pinned',
      'Plain',
    ])
    const pinned = sections[1]
    expect(
      pinned?._tag === 'Pinned' && pinned.items.map(item => item.paragraph),
    ).toEqual(['One owner.', 'Untitled, between.', 'Two owners.'])
  })

  it('leaves a diagram without follow, or with nothing after to follow, in place', () => {
    expect(
      proseSections(proseItems([zones(), '### A\nText.'])).map(s => s._tag),
    ).toEqual(['Plain', 'Plain'])
    expect(
      proseSections(
        proseItems(['### A\nText.', zones({ A: { state: 'a' } })]),
      ).map(s => s._tag),
    ).toEqual(['Plain', 'Plain'])
  })

  it('numbers diagrams in order, so each keeps its own state', () => {
    const items = proseItems([zones(), 'Text.', zones()])
    expect(
      items.flatMap(item => (item._tag === 'Diagram' ? [item.index] : [])),
    ).toEqual([0, 1])
  })
})

describe('shownOf', () => {
  const diagram = Option.getOrThrow(
    diagramOf(zones({ 'cos-rob runs it': { state: 'now', focus: 'owner' } })),
  )

  it("shows the question's answer when the diagram has that state, else its first", () => {
    expect(shownOf(diagram, Option.none(), Option.some('a')).state).toBe('a')
    expect(shownOf(diagram, Option.none(), Option.some('other')).state).toBe(
      'now',
    )
  })

  it('shows what the reader picked, or what the followed paragraph names', () => {
    expect(
      shownOf(
        diagram,
        Option.some(DiagramView.Chosen({ state: 'a' })),
        Option.none(),
      ).state,
    ).toBe('a')
    expect(
      shownOf(
        diagram,
        Option.some(DiagramView.Following({ title: 'cos-rob runs it' })),
        Option.some('a'),
      ),
    ).toEqual({
      state: 'now',
      focus: Option.some('owner'),
      following: Option.some('cos-rob runs it'),
    })
  })

  it('falls back when a pick names a state the diagram lacks', () => {
    expect(
      shownOf(
        diagram,
        Option.some(DiagramView.Chosen({ state: 'z' })),
        Option.none(),
      ).state,
    ).toBe('now')
  })
})

describe('compareTable', () => {
  const compare: Compare = {
    now: 'Today',
    rows: [
      { label: 'Lessons', cells: { now: 'Wiki', a: 'Wiki', b: 'Wiki' } },
      {
        label: 'Due time',
        cells: {
          now: { value: 'Wiki + cos-rob', flag: 'twice' },
          a: 'cos-rob',
          b: { value: '?', flag: 'open' },
        },
      },
    ],
  }

  it("orders columns as today then the question's options, folding rows alike everywhere", () => {
    const table = compareTable(compare, ['a', 'b'])
    expect(table.columns).toEqual(['now', 'a', 'b'])
    expect(table.rows.map(row => row.label)).toEqual(['Due time'])
    expect(table.same.map(row => row.label)).toEqual(['Lessons'])
  })

  it('marks cells that differ from today and counts each flag per column', () => {
    const row = compare.rows[1]!
    expect(isChanged(row, 'a')).toBe(true)
    expect(isChanged(row, 'now')).toBe(false)
    expect(flagCounts(compare.rows, 'now')).toEqual([
      { flag: 'twice', count: 1 },
    ])
    expect(flagCounts(compare.rows, 'a')).toEqual([])
  })
})
