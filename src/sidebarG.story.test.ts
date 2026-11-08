import { Option, Result, Schema } from 'effect'
import { Url } from 'foldkit'
import { Command, given, message, model, story } from 'foldkit/story'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

import { Grill, type Snapshot } from './domain'
import {
  Message,
  PageData,
  RestoreClosedLine,
  RestoreRead,
  SaveWorkspaceSettings,
  ScrollToTop,
  init,
  update,
} from './main'
import { selectedRounds } from './workspace'

const fixture = Schema.decodeUnknownSync(Grill)(
  JSON.parse(readFileSync('src/fixtures/grill.json', 'utf8')),
)
const snapshot: Snapshot = {
  grill: {
    ...fixture,
    steps: fixture.steps.slice(0, 3).map((step, index) => ({
      ...step,
      question: { ...step.question, round: index + 1, dependsOn: [], when: [] },
    })),
  },
  answers: {},
  notes: {},
  own: {},
  asks: [],
  revisions: [],
  sends: [],
}
const start = init(
  Option.getOrThrow(
    Url.fromString('http://127.0.0.1:4317/g/fixture/question/Q3'),
  ),
).model
const loaded = { ...start, page: PageData.Success({ data: snapshot }) }
const settings = Message.RestoredWorkspaceSettings({
  filter: 'Draft',
  urgencyFilter: 'soon',
  grouping: 'Agent',
  roundScopes: { fixture: 2, another: 7 },
  highlightTerms: true,
  collapseSentRounds: true,
})

it('changes quick views without clearing the selected round, search or send selection', () => {
  story(
    update,
    given({
      ...loaded,
      workspace: { ...loaded.workspace, search: 'question', excluded: ['Q1'] },
    }),
    message(Message.SelectedRoundScopes({ rounds: [2] })),
    Command.resolve(
      SaveWorkspaceSettings,
      Message.CompletedSaveWorkspaceSettings(),
    ),
    message(
      Message.SelectedQuestionView({ filter: 'Open', urgencyFilter: 'urgent' }),
    ),
    Command.resolve(
      SaveWorkspaceSettings,
      Message.CompletedSaveWorkspaceSettings(),
    ),
    model(current => {
      expect(selectedRounds(current.workspace, snapshot)).toEqual([2])
      expect(current.workspace.search).toBe('question')
      expect(current.workspace.excluded).toEqual(['Q1'])
      expect(current.workspace.filter).toBe('Open')
      expect(current.workspace.urgencyFilter).toBe('urgent')
    }),
    message(Message.SelectedRoundScopes({ rounds: [] })),
    Command.resolve(
      SaveWorkspaceSettings,
      Message.CompletedSaveWorkspaceSettings(),
    ),
    model(current => {
      expect(selectedRounds(current.workspace, snapshot)).toEqual([])
      expect(current.workspace.filter).toBe('Open')
      expect(current.workspace.urgencyFilter).toBe('urgent')
    }),
  )
})

const load = message(
  Message.CompletedLoadGrill({ result: Result.succeed(snapshot) }),
)
const loadResolved = () =>
  Command.resolveAll(
    [ScrollToTop, Message.CompletedScroll()],
    [
      RestoreRead,
      Message.RestoredRead({ maybeSince: Option.some(0), ids: [] }),
    ],
    [RestoreClosedLine, Message.RestoredClosedLine({ maybeId: Option.none() })],
  )

it.each(['settings-first', 'snapshot-first'])(
  'normalizes old Agent preferences and reveals a deep question with %s',
  order => {
    story(
      update,
      given(start),
      ...(order === 'settings-first'
        ? [message(settings), load, loadResolved()]
        : [
            load,
            loadResolved(),
            message(settings),
            Command.resolve(ScrollToTop, Message.CompletedScroll()),
          ]),
      model(current => {
        expect(current.workspace.grouping).toBe('Round')
        expect(current.workspace.roundScopes).toEqual({
          fixture: [2, 3],
          another: [7],
        })
        expect(current.workspace.filter).toBe('Draft')
        expect(current.workspace.urgencyFilter).toBe('soon')
        expect(current.workspace.highlightTerms).toBe(true)
        expect(current.workspace.expandedRounds).toContain(3)
      }),
    )
  },
)

it.each(['settings-first', 'snapshot-first'])(
  'preserves an independent round on reload with %s',
  order => {
    const reloaded = Message.RestoredWorkspaceSettings({
      ...settings,
      navigation: 'Reload',
    })
    story(
      update,
      given(start),
      ...(order === 'settings-first'
        ? [message(reloaded), load, loadResolved()]
        : [
            load,
            loadResolved(),
            message(reloaded),
            Command.resolve(ScrollToTop, Message.CompletedScroll()),
          ]),
      model(current => {
        expect(current.workspace.grouping).toBe('Round')
        expect(current.workspace.roundScopes).toEqual({
          fixture: [2],
          another: [7],
        })
        expect(current.workspace.filter).toBe('Draft')
        expect(current.currentPart).toBe('question:Q3')
      }),
    )
  },
)

it('reveals a back/forward target round while preserving status and search', () => {
  story(
    update,
    given({
      ...loaded,
      workspace: {
        ...loaded.workspace,
        roundScopes: { fixture: [3] },
        filter: 'Open',
        search: 'scope',
      },
    }),
    message(
      Message.ChangedUrl({
        url: Option.getOrThrow(
          Url.fromString('http://127.0.0.1:4317/g/fixture/question/Q1'),
        ),
      }),
    ),
    Command.resolve(ScrollToTop, Message.CompletedScroll()),
    model(current => {
      expect(selectedRounds(current.workspace, snapshot)).toEqual([3, 1])
      expect(current.workspace.search).toBe('scope')
      expect(current.workspace.filter).toBe('Open')
    }),
  )
})
