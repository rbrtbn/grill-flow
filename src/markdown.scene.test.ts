import { Option, Schema } from 'effect'
import { Url } from 'foldkit'
import { Mount, all, expect, given, nth, scene, selector } from 'foldkit/scene'
import { readFileSync } from 'node:fs'
import { describe, it } from 'vitest'

import { Grill } from './domain'
import { FillBox, Message, type Model, PageData, init, update } from './main'
import { view } from './view'

const fixture = Schema.decodeUnknownSync(Grill)(
  JSON.parse(readFileSync('src/fixtures/grill.json', 'utf8')),
)
const start = init(
  Option.getOrThrow(Url.fromString('http://127.0.0.1:4317/g/fixture')),
).model

const reading = (prose: ReadonlyArray<string>): Model => ({
  ...start,
  currentPart: 'part-1',
  side: 'Talk',
  whyOpen: { 'step-q1': true },
  page: PageData.Success({
    data: {
      grill: {
        ...fixture,
        refs: {
          'LAB-1178': {
            text: 'Move the dotfiles checkout',
            url: 'https://linear.app/rbrtbn/issue/LAB-1178',
          },
        },
        steps: fixture.steps.map(step =>
          step.question.id === 'Q1' ? { ...step, prose } : step,
        ),
      },
      answers: {},
      notes: {},
      own: {},
      asks: [],
      revisions: [],
      sends: [],
    },
  }),
})

describe('Markdown in the reasoning', () => {
  it('renders the Done and Open labels as bold inside list items', () => {
    scene(
      { update, view },
      given(
        reading([
          "### What has moved since it was filed\n- **Done:** hl's dotfiles checkout moved under `~/repos` (LAB-1178).\n- **Open:** the guard copy layer waits.",
        ]),
      ),
      Mount.resolveAll(
        [FillBox, Message.CompletedFillBox()],
        [FillBox, Message.CompletedFillBox()],
      ),
      expect(
        nth(all.selector('#why-step-q1 .why-body li strong'), 0),
      ).toHaveText('Done:'),
      expect(
        nth(all.selector('#why-step-q1 .why-body li strong'), 1),
      ).toHaveText('Open:'),
      expect(selector('#why-step-q1 .why-body li code')).toHaveText('~/repos'),
      expect(selector('#why-step-q1 .why-body .ref-link')).toHaveAttr(
        'href',
        'https://linear.app/rbrtbn/issue/LAB-1178',
      ),
      expect(selector('#why-step-q1 .why-body .ref-link')).toHaveAttr(
        'title',
        'LAB-1178 · Move the dotfiles checkout',
      ),
    )
  })

  it('keeps references and code working inside emphasis and fences literal', () => {
    scene(
      { update, view },
      given(
        reading([
          '**Keep LAB-1178 and Q2 with `code`**; *read this*; ***both styles***. [**Issue**](https://linear.app/rbrtbn/issue/LAB-1178). _LAB-1178 Q2 agent gate_ and the gate.',
          '```\n**literal** and *literal*\n```',
        ]),
      ),
      Mount.resolveAll(
        [FillBox, Message.CompletedFillBox()],
        [FillBox, Message.CompletedFillBox()],
      ),
      expect(selector('#why-step-q1 .why-body strong .ref-link')).toHaveAttr(
        'href',
        'https://linear.app/rbrtbn/issue/LAB-1178',
      ),
      expect(selector('#why-step-q1 .why-body strong .ref')).toHaveAttr(
        'aria-label',
        'Go to Q2',
      ),
      expect(selector('#why-step-q1 .why-body strong code')).toHaveText('code'),
      expect(nth(all.selector('#why-step-q1 .why-body em'), 0)).toHaveText(
        'read this',
      ),
      expect(selector('#why-step-q1 .why-body strong em')).toHaveText(
        'both styles',
      ),
      expect(selector('#why-step-q1 .why-body .text-link strong')).toHaveText(
        'Issue',
      ),
      expect(selector('#why-step-q1 .why-body em .ref-link')).toHaveAttr(
        'href',
        'https://linear.app/rbrtbn/issue/LAB-1178',
      ),
      expect(selector('#why-step-q1 .why-body em .entity')).toExist(),
      expect(selector('#why-step-q1 .why-body em .term')).toExist(),
      expect(selector('#why-step-q1 .why-body pre code')).toHaveText(
        '**literal** and *literal*',
      ),
    )
  })
})
