import type { Html, HtmlBuilder } from 'foldkit/html'

import { type Snapshot, questionSession, statusOf } from './domain'
import type { Message } from './main'
import type { Roster, RosterMember } from './roster'
import { questionState } from './workspace'

type H = HtmlBuilder<Message>
const checked = (at: number | null): string =>
  at === null ? 'Not checked' : new Date(at).toLocaleString('en-GB')
const workFor = (member: RosterMember, runs: ReadonlyArray<Snapshot>) =>
  runs
    .filter(state =>
      member.run !== null
        ? state.grill.id === member.run
        : state.grill.session === member.address ||
          state.grill.steps.some(
            step =>
              questionSession(state.grill, step.question) === member.address,
          ) ||
          (state.ownerSteps ?? []).some(
            entry => entry.item.session === member.address,
          ),
    )
    .map(state => ({
      state,
      questions: state.grill.steps.filter(
        step =>
          questionSession(state.grill, step.question) === member.address &&
          statusOf(state.grill, state.answers, step.question.id)._tag ===
            'Open',
      ).length,
      drafts: state.grill.steps.filter(
        step =>
          questionSession(state.grill, step.question) === member.address &&
          statusOf(state.grill, state.answers, step.question.id)._tag !==
            'NotNeeded' &&
          questionState(state, step, state.answers, state.notes, state.own) ===
            'Draft',
      ).length,
      actions: (state.ownerSteps ?? []).filter(
        entry =>
          entry.item.session === member.address &&
          entry.item.progress.state === 'open',
      ).length,
    }))

const memberRow = (
  member: RosterMember,
  runs: ReadonlyArray<Snapshot>,
  h: H,
): Html => {
  const work = workFor(member, runs)
  const questions = work.reduce((total, entry) => total + entry.questions, 0)
  const drafts = work.reduce((total, entry) => total + entry.drafts, 0)
  const actions = work.reduce((total, entry) => total + entry.actions, 0)
  const waits = [
    ...(questions === 0
      ? []
      : [`${questions} question${questions === 1 ? '' : 's'}`]),
    ...(drafts === 0 ? [] : [`${drafts} draft${drafts === 1 ? '' : 's'}`]),
    ...(actions === 0 ? [] : [`${actions} action${actions === 1 ? '' : 's'}`]),
  ]
  return h.keyed('tr')(
    member.address,
    [],
    [
      h.td(
        [],
        [
          h.b([], [member.address]),
          h.small(
            [],
            [
              member.host ??
                (member.address.includes('/')
                  ? member.address.split('/')[0]!
                  : 'Local host'),
            ],
          ),
          h.small([], [member.role ?? 'Role not labelled']),
        ],
      ),
      h.td(
        [h.Class('f-roster-core')],
        [
          member.terminal === 'finished'
            ? 'Ended'
            : member.coreStatus === 'unknown'
              ? 'Not reported'
              : member.coreStatus,
          h.small(
            [],
            [
              member.detail === 'unavailable'
                ? `Stale · detail unavailable · last checked ${checked(member.checkedAt)}`
                : `Checked ${checked(member.checkedAt)}`,
            ],
          ),
        ],
      ),
      h.td(
        [h.Class('f-roster-work')],
        work.length === 0
          ? [member.run ?? 'No published work linked']
          : work.map(entry =>
              h.a(
                [h.Href(`/g/${encodeURIComponent(entry.state.grill.id)}/plan`)],
                [entry.state.grill.title],
              ),
            ),
      ),
      h.td(
        [h.Class('f-roster-waits')],
        [
          waits.length === 0 ? 'None published' : waits.join(' · '),
          member.terminal === 'finished' && waits.length > 0
            ? h.small([], ['Page items remain after session ended'])
            : h.empty,
        ],
      ),
      h.td([h.Class('f-roster-budget')], ['Not reported']),
    ],
  )
}

export const rosterView = (
  roster: Roster | undefined,
  runs: ReadonlyArray<Snapshot>,
  h: H,
): Html => {
  if (roster === undefined) {
    return h.empty
  }
  const active = roster.members.filter(member => member.terminal === 'live')
  const ended = roster.members.filter(member => member.terminal === 'finished')
  const table = (members: ReadonlyArray<RosterMember>) =>
    h.div(
      [h.Class('f-table-scroll')],
      [
        h.table(
          [h.Class('f-table f-roster-table')],
          [
            h.thead(
              [],
              [
                h.tr(
                  [],
                  [
                    'Session / host / role',
                    'Core status',
                    'Published work',
                    'Page waits on you',
                    'Budget',
                  ].map(text => h.th([h.Scope('col')], [text])),
                ),
              ],
            ),
            h.tbody(
              [],
              members.map(member => memberRow(member, runs, h)),
            ),
          ],
        ),
      ],
    )
  return h.section(
    [h.Class('f-roster'), h.AriaLabel('Squad roster')],
    [
      h.h2([], ['Squad roster']),
      h.p(
        [h.Class('hint')],
        [
          `Profile ${roster.profile} · ${active.length} live · ${ended.length} ended · ${checked(roster.checkedAt)}`,
        ],
      ),
      h.p(
        [h.Class('hint')],
        [
          'Membership and roles come from Herdr labels. Core blocked does not mean waiting on you. Page links match published run labels or route addresses; runtime identity and account budgets are not reported here.',
        ],
      ),
      roster.state === 'loading'
        ? h.p([h.Role('status')], ['Checking Herdr roster…'])
        : h.empty,
      roster.state === 'stale' || roster.state === 'unavailable'
        ? h.p(
            [h.Role('status')],
            [roster.error || 'Roster is stale; refreshing in the background.'],
          )
        : h.empty,
      roster.unavailableHosts.length > 0
        ? h.p(
            [h.Role('status')],
            [
              `Host unavailable: ${roster.unavailableHosts.join(', ')}. Its last readings may be stale.`,
            ],
          )
        : h.empty,
      roster.omitted + roster.unverified > 0
        ? h.p(
            [h.Class('hint')],
            [
              `${roster.omitted} sessions outside this bounded reading; ${roster.unverified} label/detail readings unavailable or unmatched.`,
            ],
          )
        : h.empty,
      active.length > 0
        ? table(active)
        : roster.state === 'ready'
          ? h.p(
              [h.Class('hint')],
              [
                roster.unverified > 0 || roster.unavailableHosts.length > 0
                  ? 'No verified live-session details in this reading.'
                  : 'No live sessions carry this profile label.',
              ],
            )
          : h.empty,
      ended.length > 0
        ? h.details(
            [h.Class('f-roster-ended')],
            [h.summary([], [`Ended sessions · ${ended.length}`]), table(ended)],
          )
        : h.empty,
    ],
  )
}
