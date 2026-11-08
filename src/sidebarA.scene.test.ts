import { Option, Schema } from 'effect'
import { Url } from 'foldkit'
import {
  Command,
  Mount,
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
import {
  FillBox,
  Message,
  PageData,
  PushPage,
  SaveWorkspaceSettings,
  ScrollToTop,
  init,
  update,
} from './main'
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
it('uses three quick views and a native Filters popdown without app or round rails', () => {
  scene(
    { update, view },
    given({ ...loaded, workspace: { ...loaded.workspace, filter: 'All' } }),
    expectAll(all.selector('.f-app-rail')).toHaveCount(0),
    expectAll(all.selector('.f-round-rail')).toHaveCount(0),
    expectAll(all.selector('.f-quick-views button')).toHaveCount(3),
    expectAll(all.role('button', { name: /^Needs attention/ })).toHaveCount(0),
    expectAll(all.role('button', { name: 'Rename' })).toHaveCount(0),
    expect(role('button', { name: 'Filters' })).toHaveAttr(
      'popovertarget',
      'workspace-filters',
    ),
    expect(selector('#workspace-filters')).toHaveAttr('popover', 'auto'),
    expect(selector('.f-round-filter')).toContainText('Features · 3 match'),
    expect(selector('.f-round-filter')).toContainText('Round 2 · 3 match'),
    expect(quick('Open')).toContainText('4'),
    expect(quick('Drafts')).toContainText('1'),
    expect(quick('All')).toContainText('6'),
    click(role('checkbox', { name: 'Features' })),
    Command.resolve(
      SaveWorkspaceSettings,
      Message.CompletedSaveWorkspaceSettings(),
    ),
    expect(quick('All')).toContainText('3'),
    click(quick('Open')),
    Command.resolve(
      SaveWorkspaceSettings,
      Message.CompletedSaveWorkspaceSettings(),
    ),
    expectAll(all.selector('.f-question-item')).toHaveCount(2),
    change(role('combobox', { name: 'Urgency filter' }), 'unspecified'),
    Command.resolve(
      SaveWorkspaceSettings,
      Message.CompletedSaveWorkspaceSettings(),
    ),
    expectAll(all.selector('.f-question-item')).toHaveCount(0),
    expect(selector('.f-filter-readout')).toContainText('Open · Unspecified'),
    expect(role('checkbox', { name: 'Features' })).toBeChecked(),
    expect(selector('.f-round-filter')).toContainText('Features · 0 match'),
    click(quick('All')),
    Command.resolve(
      SaveWorkspaceSettings,
      Message.CompletedSaveWorkspaceSettings(),
    ),
    expectAll(all.selector('.f-question-item')).toHaveCount(3),
  )
})

it('keeps search and round scope while Sent is selected through advanced filters', () => {
  scene(
    { update, view },
    given({
      ...loaded,
      workspace: {
        ...loaded.workspace,
        roundScopes: { fixture: [2] },
        search: 'Choice 4',
      },
    }),
    expect(quick('Open')).toContainText('0'),
    expect(quick('Drafts')).toContainText('0'),
    expect(quick('All')).toContainText('1'),
    expect(selector('.f-primary-nav')).toContainText('Updates'),
    expect(selector('.f-app-popdown')).toContainText('Answer history'),
    expect(selector('.f-app-popdown')).toContainText('Your grills'),
    change(role('combobox', { name: 'Question state filter' }), 'Sent'),
    Command.resolve(
      SaveWorkspaceSettings,
      Message.CompletedSaveWorkspaceSettings(),
    ),
    expect(role('searchbox', { name: 'Find question or issue' })).toHaveValue(
      'Choice 4',
    ),
    expect(role('checkbox', { name: 'Round 2' })).toBeChecked(),
    expectAll(all.selector('.f-question-item')).toHaveCount(1),
    expect(selector('.f-question-item')).toContainText('Q4'),
  )
})

it('qualifies matching round scopes by source and keeps global drafts available outside the queue filter', () => {
  scene(
    { update, view },
    given({
      ...loaded,
      page: PageData.Success({
        data: {
          ...snapshot,
          grill: {
            ...snapshot.grill,
            roundSections: { '1': 'Alpha', '2': 'Beta' },
          },
        },
      }),
      workspace: {
        ...loaded.workspace,
        search: 'Choice 1',
        roundScopes: { fixture: [1] },
      },
    }),
    expect(selector('.f-round-filter')).toContainText(
      'Alpha / Features · 1 match',
    ),
    expect(selector('.f-round-filter')).not.toContainText('Beta'),
    expectAll(all.selector('.f-question-item')).toHaveCount(1),
    expect(
      role('button', { name: 'Review & send · 1', exact: true }),
    ).toExist(),
    click(role('button', { name: 'Review & send · 1', exact: true })),
    Command.resolve(PushPage, Message.CompletedNavigate()),
    Command.resolve(ScrollToTop, Message.CompletedScroll()),
    Mount.resolve(FillBox, Message.CompletedFillBox()),
    expect(selector('.f-review')).toContainText('Q3'),
    expect(role('button', { name: 'Send 1 answer' })).toBeEnabled(),
    expect(role('searchbox', { name: 'Find question or issue' })).toHaveValue(
      'Choice 1',
    ),
  )
})

it('selects multiple rounds in Filters and hides the badge after clearing advanced filters', () => {
  scene(
    { update, view },
    given(loaded),
    expectAll(all.selector('.f-round-scope')).toHaveCount(0),
    expectAll(all.selector('.f-filter-badge')).toHaveCount(0),
    click(role('checkbox', { name: 'Features', exact: true })),
    Command.resolve(
      SaveWorkspaceSettings,
      Message.CompletedSaveWorkspaceSettings(),
    ),
    expectAll(all.selector('.f-question-item')).toHaveCount(2),
    expect(selector('.f-filter-badge')).toHaveText('1'),
    click(role('checkbox', { name: 'Round 2', exact: true })),
    Command.resolve(
      SaveWorkspaceSettings,
      Message.CompletedSaveWorkspaceSettings(),
    ),
    expect(role('checkbox', { name: 'Features', exact: true })).toBeChecked(),
    expect(role('checkbox', { name: 'Round 2', exact: true })).toBeChecked(),
    expectAll(all.selector('.f-question-item')).toHaveCount(4),
    expect(selector('.f-filter-badge')).toHaveText('1'),
    change(role('combobox', { name: 'Urgency filter' }), 'soon'),
    Command.resolve(
      SaveWorkspaceSettings,
      Message.CompletedSaveWorkspaceSettings(),
    ),
    expect(selector('.f-filter-badge')).toHaveText('2'),
    click(role('button', { name: 'All rounds' })),
    Command.resolve(
      SaveWorkspaceSettings,
      Message.CompletedSaveWorkspaceSettings(),
    ),
    expect(selector('.f-filter-badge')).toHaveText('1'),
    change(role('combobox', { name: 'Urgency filter' }), 'All'),
    Command.resolve(
      SaveWorkspaceSettings,
      Message.CompletedSaveWorkspaceSettings(),
    ),
    expectAll(all.selector('.f-filter-badge')).toHaveCount(0),
    expect(role('button', { name: 'All rounds' })).toHaveAttr(
      'aria-pressed',
      'true',
    ),
  )
})

it('sorts the whole queue across rounds and keeps its filter and global draft count', () => {
  scene(
    { update, view },
    given(loaded),
    expect(role('button', { name: 'Sort questions' })).toHaveAttr(
      'popovertarget',
      'workspace-sort',
    ),
    expect(selector('#workspace-sort')).toHaveAttr('popover', 'auto'),
    click(role('button', { name: 'Recency', exact: true })),
    Command.resolve(
      SaveWorkspaceSettings,
      Message.CompletedSaveWorkspaceSettings(),
    ),
    expect(selector('.f-question-list .f-question-item')).toContainText('Q6'),
    expect(role('button', { name: 'Recency', exact: true })).toHaveAttr(
      'aria-pressed',
      'true',
    ),
    expect(quick('Open')).toHaveAttr('aria-pressed', 'true'),
    expect(
      role('button', { name: 'Review & send · 1', exact: true }),
    ).toExist(),
    click(role('button', { name: 'Urgency', exact: true })),
    Command.resolve(
      SaveWorkspaceSettings,
      Message.CompletedSaveWorkspaceSettings(),
    ),
    expect(selector('.f-question-list .f-question-item')).toContainText('Q1'),
    expect(role('navigation', { name: 'Questions by urgency' })).toExist(),
  )
})
