import { Option, Schema } from 'effect'
import { Url } from 'foldkit'
import { Command, given, message, model, story } from 'foldkit/story'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { Grill } from './domain'
import {
  MeasureSidebar,
  Message,
  PageData,
  SaveClosedLine,
  SaveSidebarWidths,
  ScrollToWhy,
  init,
  update,
} from './main'

const start = init(
  Option.getOrThrow(Url.fromString('http://127.0.0.1:4317/g/test')),
).model

const loaded = {
  ...start,
  page: PageData.Success({
    data: {
      grill: Schema.decodeUnknownSync(Grill)(
        JSON.parse(readFileSync('src/fixtures/grill.json', 'utf8')),
      ),
      answers: {},
      notes: {},
      own: {},
      asks: [],
      revisions: [],
      sends: [],
    },
  }),
}

describe('folding a question on the page', () => {
  it("folds and unfolds the question's reasoning in Talk with it", () => {
    story(
      update,
      given(loaded),
      message(Message.ClickedToggleQuestion({ question: 'Q2', open: true })),
      model(current => {
        expect(current.whyOpen['step-q2']).toBe(true)
      }),
      message(Message.ClickedToggleQuestion({ question: 'Q2', open: false })),
      model(current => {
        expect(current.whyOpen['step-q2']).toBe(false)
      }),
    )
  })
})

describe('Talk following the question page', () => {
  it('opens previously folded reasoning and scrolls Talk to the unanswered question', () => {
    story(
      update,
      given({
        ...loaded,
        currentPart: 'part-2',
        side: 'Talk',
        whyOpen: { 'step-q2': false },
      }),
      message(Message.ScrolledToAbout({ partId: 'part-2', about: 'Q2' })),
      model(current => {
        expect(current.talkAbout['part-2']).toBe('Q2')
        expect(current.whyOpen['step-q2']).toBe(true)
      }),
      Command.expectExact(ScrollToWhy({ stepId: 'step-q2' })),
      Command.resolve(ScrollToWhy, Message.CompletedScroll()),
      message(Message.ScrolledToAbout({ partId: 'part-2', about: 'Q3' })),
      model(current => {
        expect(current.talkAbout['part-2']).toBe('Q3')
        expect(current.whyOpen['step-q3']).toBe(true)
      }),
      Command.expectExact(ScrollToWhy({ stepId: 'step-q3' })),
      Command.resolve(ScrollToWhy, Message.CompletedScroll()),
    )
  })

  it('follows a question from another concept on a card page', () => {
    story(
      update,
      given({ ...loaded, currentPart: 'card:work', side: 'Talk' }),
      message(Message.ScrolledToQuestion({ question: 'Q2' })),
      model(current => {
        expect(current.maybeTalkPart).toEqual(Option.some('part-2'))
        expect(current.talkAbout['card:work']).toBe('Q2')
        expect(current.whyOpen['step-q2']).toBe(true)
      }),
      Command.expectExact(ScrollToWhy({ stepId: 'step-q2' })),
      Command.resolve(ScrollToWhy, Message.CompletedScroll()),
    )
  })

  it('leaves answered questions and a closed Talk panel alone', () => {
    story(
      update,
      given({ ...loaded, side: 'Talk', answers: { Q1: 'a' } }),
      message(Message.ScrolledToAbout({ partId: 'part-1', about: 'Q1' })),
      model(current => {
        expect(current.whyOpen['step-q1']).toBeUndefined()
      }),
      Command.expectNone(),
    )
    story(
      update,
      given({ ...loaded, side: 'None' }),
      message(Message.ScrolledToQuestion({ question: 'Q2' })),
      model(current => {
        expect(current.whyOpen['step-q2']).toBeUndefined()
        expect(current.talkAbout).toEqual({})
      }),
      Command.expectNone(),
    )
  })
})

describe("closing the agent's line in the top bar", () => {
  it('remembers the message it closed, for this grill', () => {
    story(
      update,
      given(loaded),
      message(Message.ClickedCloseAgentLine({ id: 'reply-7' })),
      model(current => {
        expect(current.maybeClosedLine).toEqual(Option.some('reply-7'))
        expect(current.readIds).toContain('reply-7')
      }),
      Command.expectExact(
        SaveClosedLine({ grillId: 'fixture', id: 'reply-7' }),
      ),
      Command.resolve(SaveClosedLine, Message.CompletedSaveClosedLine()),
    )
  })
})

describe('resizing a sidebar', () => {
  it('follows the pointer within its bounds and saves on release', () => {
    story(
      update,
      given(start),
      message(Message.PressedResizeHandle({ edge: 'Side' })),
      message(Message.MovedResizePointer({ edge: 'Side', width: 2000 })),
      model(current => {
        expect(current.maybeSideWidth).toEqual(Option.some(960))
        expect(current.maybeResizing).toEqual(Option.some('Side'))
      }),
      message(Message.ReleasedResizeHandle()),
      model(current => {
        expect(current.maybeResizing).toEqual(Option.none())
      }),
      Command.expectExact(
        SaveSidebarWidths({ widths: '{"nav":null,"side":960}' }),
      ),
      Command.resolve(SaveSidebarWidths, Message.CompletedSaveSidebarWidths()),
    )
  })

  it('steps from the width on screen with the keyboard, and a double click resets it', () => {
    story(
      update,
      given(start),
      message(Message.PressedResizeKey({ edge: 'Nav', step: 16 })),
      Command.resolve(
        MeasureSidebar,
        Message.CompletedMeasureSidebar({
          edge: 'Nav',
          maybeWidth: Option.some(250),
          step: 16,
        }),
      ),
      model(current => {
        expect(current.maybeNavWidth).toEqual(Option.some(266))
      }),
      Command.resolve(SaveSidebarWidths, Message.CompletedSaveSidebarWidths()),
      message(Message.DoubleClickedResizeHandle({ edge: 'Nav' })),
      model(current => {
        expect(current.maybeNavWidth).toEqual(Option.none())
      }),
      Command.resolve(SaveSidebarWidths, Message.CompletedSaveSidebarWidths()),
    )
  })

  it('clamps widths restored from the browser', () => {
    story(
      update,
      given(start),
      message(
        Message.RestoredSidebarWidths({
          maybeNav: Option.some(40),
          maybeSide: Option.none(),
        }),
      ),
      model(current => {
        expect(current.maybeNavWidth).toEqual(Option.some(180))
        expect(current.maybeSideWidth).toEqual(Option.none())
      }),
    )
  })
})

describe('a diagram in the reasoning', () => {
  it('shows the state the reader picks, then the paragraph they hover', () => {
    story(
      update,
      given(loaded),
      message(
        Message.ClickedDiagramState({ diagram: 'step:step-q2#0', state: 'b' }),
      ),
      model(current => {
        expect(current.diagramViews['step:step-q2#0']).toEqual({
          _tag: 'Chosen',
          state: 'b',
        })
      }),
      message(
        Message.HoveredDiagramParagraph({
          diagram: 'step:step-q2#0',
          title: 'Today',
        }),
      ),
      model(current => {
        expect(current.diagramViews['step:step-q2#0']).toEqual({
          _tag: 'Following',
          title: 'Today',
        })
      }),
    )
  })
})
