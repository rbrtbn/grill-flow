import { Option, Schema } from 'effect'
import { Url } from 'foldkit'
import {
  Command,
  all,
  change,
  click,
  expect,
  expectAll,
  given,
  role,
  scene,
  selector,
  within,
} from 'foldkit/scene'
import { readFileSync } from 'node:fs'
import { it } from 'vitest'

import { Grill, type Snapshot } from './domain'
import { Message, PageData, SaveWorkspaceSettings, init, update } from './main'
import { view } from './view'

const fixture = Schema.decodeUnknownSync(Grill)(
  JSON.parse(readFileSync('src/fixtures/grill.json', 'utf8')),
)
const seed = fixture.steps[0]!
const snapshot: Snapshot = {
  grill: {
    ...fixture,
    roundNames: { '1': '  Features  ', '2': ' ' },
    steps: ['blocking', 'soon', 'wait', 'blocking', 'fyi', undefined].map(
      (urgency, index) => ({
        ...seed,
        id: `step-${index + 1}`,
        question: {
          ...seed.question,
          id: `Q${index + 1}`,
          title: `Choice ${index + 1}`,
          dependsOn: [],
          when: [],
          round: index < 3 ? 1 : 2,
          ...(urgency === undefined
            ? {}
            : {
                urgency:
                  urgency === 'blocking'
                    ? 'blocking'
                    : urgency === 'soon'
                      ? 'soon'
                      : urgency === 'wait'
                        ? 'wait'
                        : 'fyi',
              }),
        },
      }),
    ),
  },
  answers: { Q3: 'a', Q4: 'a' },
  notes: {},
  own: {},
  asks: [],
  revisions: [],
  sends: [],
  sent: { Q4: 'Q4 a' },
}
const loaded = {
  ...init(
    Option.getOrThrow(
      Url.fromString('http://127.0.0.1:4317/g/fixture/question/Q1'),
    ),
  ).model,
  page: PageData.Success({ data: snapshot }),
  answers: snapshot.answers,
}
const quick = (name: string) =>
  within(
    role('group', { name: 'Quick views' }),
    role('button', { name: new RegExp(`^${name}`) }),
  )
const round = (name: string) =>
  within(
    role('navigation', { name: 'Choose a round' }),
    role('button', { name: new RegExp(`^${name}`) }),
  )

it('shows trimmed round names, quick-view counts and the persistent active filter summary', () => {
  scene(
    { update, view },
    given(loaded),
    expectAll(all.role('combobox', { name: 'Group questions by' })).toHaveCount(
      0,
    ),
    expect(round('Features')).toContainText('3 match'),
    expect(round('Round 2')).toContainText('3 match'),
    expect(quick('All')).toContainText('6'),
    expect(quick('Needs attention')).toContainText('2'),
    expect(quick('Open')).toContainText('4'),
    expect(quick('Drafts')).toContainText('1'),
    expect(quick('Sent')).toContainText('1'),
    click(round('Features')),
    Command.resolve(
      SaveWorkspaceSettings,
      Message.CompletedSaveWorkspaceSettings(),
    ),
    expect(quick('All')).toContainText('3'),
    expect(quick('Sent')).toContainText('0'),
    click(quick('Needs attention')),
    Command.resolve(
      SaveWorkspaceSettings,
      Message.CompletedSaveWorkspaceSettings(),
    ),
    expectAll(all.selector('.f-question-item')).toHaveCount(2),
    expect(selector('.f-filter-readout')).toContainText(
      'Open · Blocking or Soon',
    ),
    click(role('button', { name: 'Custom filters' })),
    expect(role('combobox', { name: 'Urgency filter' })).toHaveValue('urgent'),
    change(role('combobox', { name: 'Urgency filter' }), 'unspecified'),
    Command.resolve(
      SaveWorkspaceSettings,
      Message.CompletedSaveWorkspaceSettings(),
    ),
    expectAll(all.selector('.f-question-item')).toHaveCount(0),
    expect(selector('.f-empty-nav')).toContainText('No questions match'),
    click(role('button', { name: 'Close custom filters' })),
    expectAll(all.role('combobox', { name: 'Urgency filter' })).toHaveCount(0),
    expect(selector('.f-filter-readout')).toContainText('Open · Unspecified'),
    click(quick('All')),
    Command.resolve(
      SaveWorkspaceSettings,
      Message.CompletedSaveWorkspaceSettings(),
    ),
    expectAll(all.selector('.f-question-item')).toHaveCount(3),
  )
})

it('counts quick views within the search and round while retaining the labeled app destinations', () => {
  scene(
    { update, view },
    given({
      ...loaded,
      workspace: {
        ...loaded.workspace,
        roundScopes: { fixture: 2 },
        search: 'Choice 4',
      },
    }),
    expect(quick('All')).toContainText('1'),
    expect(quick('Needs attention')).toContainText('0'),
    expect(quick('Sent')).toContainText('1'),
    expect(selector('.f-app-rail')).toContainText('Updates'),
    expect(selector('.f-app-rail')).toContainText('Answer history'),
    expect(selector('.f-app-rail')).toContainText('Your grills'),
    click(quick('Sent')),
    Command.resolve(
      SaveWorkspaceSettings,
      Message.CompletedSaveWorkspaceSettings(),
    ),
    expect(role('searchbox', { name: 'Find question or issue' })).toHaveValue(
      'Choice 4',
    ),
    expect(round('Round 2')).toHaveAttr('aria-pressed', 'true'),
    expectAll(all.selector('.f-question-item')).toHaveCount(1),
    expect(selector('.f-question-item')).toContainText('Q4'),
  )
})
