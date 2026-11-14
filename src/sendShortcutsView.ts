import { Array, Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import {
  type Snapshot,
  type Step,
  questionAgent,
  roundLabel,
  roundOf,
} from './domain'
import { Message, type Model, readyOf, traySelection } from './main'
import {
  answerCount,
  byRound,
  recipientSummary,
  roundSteps,
  stepsOf,
  trayOrder,
  unsentSteps,
} from './sendShortcuts'
import { QUESTION_PAGE, REVIEW, answerLabel } from './workspace'

type H = HtmlBuilder<Message>

const button = (
  label: ReadonlyArray<Html | string>,
  message: Message,
  className: string,
  h: H,
  ...rest: ReadonlyArray<ReturnType<H['Title']>>
): Html =>
  h.button(
    [h.Type('button'), h.Class(className), h.OnClick(message), ...rest],
    label,
  )

const kbd = (keys: string, h: H): Html => h.kbd([h.Class('f-kbd')], [keys])

const heldSteps = (model: Model, snapshot: Snapshot): ReadonlyArray<Step> =>
  Option.match(model.maybeHeldSend, {
    onNone: () => [],
    onSome: held => stepsOf(snapshot.grill, held.questions),
  })

const heldLine = (model: Model, snapshot: Snapshot): string =>
  Option.match(model.maybeHeldSend, {
    onNone: () => '',
    onSome: held => {
      const steps = heldSteps(model, snapshot)
      const what = `${recipientSummary(snapshot.grill, steps)}`
      return held.left > 0
        ? `Sending ${what} in ${held.left} s. Nothing has left the page yet.`
        : `Sending ${what} after the send in progress.`
    },
  })

const heldActions = (h: H): ReadonlyArray<Html> => [
  button(
    ['Undo ', kbd('⌘Z', h)],
    Message.ClickedUndoSend(),
    'f-send-primary',
    h,
  ),
  button(['Send now'], Message.ClickedSendHeldNow(), 'f-send-secondary', h),
]

// Other rounds' ready drafts, so an older round's answers don't go unnoticed.
const otherRounds = (
  model: Model,
  snapshot: Snapshot,
  round: number,
  h: H,
): Html => {
  const groups = byRound(snapshot.grill, readyOf(model, snapshot)).filter(
    group => group.round !== round,
  )
  return Array.isReadonlyArrayEmpty(groups)
    ? h.empty
    : h.ul(
        [h.Class('f-send-strip-others')],
        groups.map(group =>
          h.li(
            [],
            [
              `${group.label} also has ${answerCount(group.steps.length)} unsent. `,
              button(
                [`Send ${group.steps.length === 1 ? 'it' : `all ${group.steps.length}`}`],
                Message.ClickedSendQuestions({
                  questions: group.steps.map(step => step.question.id),
                }),
                'text-button',
                h,
                h.Title(recipientSummary(snapshot.grill, group.steps)),
              ),
            ],
          ),
        ),
      )
}

/** Under a question's answer: send this answer, or its round's drafts, without Review. */
export const sendStripView = (
  model: Model,
  snapshot: Snapshot,
  step: Step,
  h: H,
): Html => {
  const grill = snapshot.grill
  const id = step.question.id
  const round = roundOf(grill, step.question)
  const roundName = roundLabel(grill, round, false)
  const ready = roundSteps(grill, readyOf(model, snapshot), round)
  const isUnsent = unsentSteps(
    snapshot,
    model.answers,
    model.notes,
    model.own,
  ).some(item => item.question.id === id)
  const isHeld = Option.exists(model.maybeHeldSend, held =>
    held.questions.includes(id),
  )
  if (isHeld) {
    return h.div(
      [h.Class('f-send-strip is-held'), h.Role('status')],
      [
        h.p([], [heldLine(model, snapshot)]),
        h.div([h.Class('f-send-strip-actions')], heldActions(h)),
      ],
    )
  }
  const sending =
    model.send === 'Sending' &&
    Option.exists(model.maybeSendSubset, ids => ids.includes(id))
  if (sending) {
    return h.div(
      [h.Class('f-send-strip'), h.Role('status')],
      [h.p([], [`Sending to ${questionAgent(grill, step.question)}…`])],
    )
  }
  const roundButton = (label: string): Html =>
    Array.isReadonlyArrayEmpty(ready)
      ? h.empty
      : h.span(
          [h.Class('f-send-strip-round')],
          [
            button(
              [label, ' ', kbd('⇧⌘↵', h)],
              Message.ClickedSendQuestions({
                questions: ready.map(item => item.question.id),
              }),
              'f-send-secondary',
              h,
            ),
            h.small([], [recipientSummary(grill, ready)]),
          ],
        )
  if (isUnsent) {
    const isKept = model.keptBack.includes(id)
    const others = ready.filter(item => item.question.id !== id)
    return h.div(
      [h.Class('f-send-strip')],
      [
        h.p(
          [],
          [
            isKept ? 'Kept back · not sent. ' : 'Draft · not sent. ',
            'Goes to ',
            h.b([], [questionAgent(grill, step.question)]),
            '.',
          ],
        ),
        h.div(
          [h.Class('f-send-strip-actions')],
          [
            button(
              ['Send this answer ', kbd('⌘↵', h)],
              Message.ClickedSendQuestions({ questions: [id] }),
              'f-send-primary',
              h,
            ),
            Array.isReadonlyArrayEmpty(others)
              ? h.empty
              : roundButton(`Send all ${ready.length} ready in ${roundName}`),
            button(
              [isKept ? 'Return to unsent' : 'Keep back'],
              Message.ClickedKeepBack({ question: id, kept: !isKept }),
              'text-button',
              h,
              h.Title(
                isKept
                  ? 'Count it as unsent again'
                  : 'Hold this draft on purpose: no count, no reminders',
              ),
            ),
          ],
        ),
        otherRounds(model, snapshot, round, h),
      ],
    )
  }
  const isOpen = model.answers[id] === undefined
  if (isOpen && Array.isReadonlyArrayNonEmpty(ready)) {
    return h.div(
      [h.Class('f-send-strip is-quiet')],
      [
        h.p(
          [],
          [
            `Not ready to answer this one? ${roundName} has ${answerCount(ready.length)} you can send now.`,
          ],
        ),
        h.div(
          [h.Class('f-send-strip-actions')],
          [roundButton(`Send ${answerCount(ready.length)}`)],
        ),
        otherRounds(model, snapshot, round, h),
      ],
    )
  }
  return h.empty
}

/** A held send seen from anywhere but its own question: the strip shows it there. */
export const heldSendBarView = (
  model: Model,
  snapshot: Snapshot,
  onScreen: Option.Option<Step>,
  h: H,
): Html =>
  Option.match(model.maybeHeldSend, {
    onNone: () => h.empty,
    onSome: held =>
      Option.exists(onScreen, step => held.questions.includes(step.question.id))
        ? h.empty
        : h.div(
            [h.Class('f-held-send'), h.Role('status')],
            [h.span([], [heldLine(model, snapshot)]), ...heldActions(h)],
          ),
  })

/** The header's unsent counter; a Command-click still quick-sends Review's selection. */
export const unsentLabel = (model: Model, snapshot: Snapshot): string => {
  const ready = readyOf(model, snapshot).length
  const kept = unsentSteps(
    snapshot,
    model.answers,
    model.notes,
    model.own,
  ).filter(step => model.keptBack.includes(step.question.id)).length
  return ready === 0 && kept === 0
    ? 'Review & send'
    : `${ready} unsent${kept > 0 ? ` · ${kept} kept back` : ''}`
}

export const nudgeView = (model: Model, snapshot: Snapshot, h: H): Html => {
  if (
    !model.isNudging ||
    model.isTrayOpen ||
    Option.isSome(model.maybeHeldSend)
  ) {
    return h.empty
  }
  return Option.match(Array.head(byRound(snapshot.grill, readyOf(model, snapshot))), {
    onNone: () => h.empty,
    onSome: group =>
      h.div(
        [h.Class('f-unsent-nudge'), h.Role('status')],
        [
          h.span(
            [],
            [
              `${answerCount(group.steps.length)} in ${roundLabel(snapshot.grill, group.round, false)} ${group.steps.length === 1 ? 'is' : 'are'} ready to send.`,
            ],
          ),
          button(
            ['Send'],
            Message.ClickedSendQuestions({
              questions: group.steps.map(step => step.question.id),
            }),
            'text-button',
            h,
            h.Title(recipientSummary(snapshot.grill, group.steps)),
          ),
          button(['Choose'], Message.ClickedUnsentTray(), 'text-button', h),
          button(['Not yet'], Message.ClickedNotYet(), 'text-button', h),
        ],
      ),
  })
}

/** Unsent drafts by round, each with its recipient, sent per round or as a selection. */
export const unsentTrayView = (
  model: Model,
  snapshot: Snapshot,
  h: H,
): Html => {
  if (!model.isTrayOpen) {
    return h.empty
  }
  const grill = snapshot.grill
  const ready = readyOf(model, snapshot)
  const order = trayOrder(grill, ready)
  const selected = traySelection(model, snapshot)
  const kept = unsentSteps(
    snapshot,
    model.answers,
    model.notes,
    model.own,
  ).filter(step => model.keptBack.includes(step.question.id))
  const row = (step: Step): Html => {
    const id = step.question.id
    const index = order.findIndex(item => item.question.id === id)
    return h.keyed('li')(
      id,
      [
        h.Class(`f-tray-row${index === model.trayCursor ? ' is-cursor' : ''}`),
      ],
      [
        h.input([
          h.Type('checkbox'),
          h.Checked(selected.includes(id)),
          h.AriaLabel(`Include ${step.question.title}`),
          h.OnClick(Message.ToggledReviewAnswer({ question: id })),
        ]),
        h.button(
          [
            h.Type('button'),
            h.Class('f-tray-question'),
            h.OnClick(
              Message.ClickedWorkspacePage({ page: `${QUESTION_PAGE}${id}` }),
            ),
          ],
          [
            h.b([], [step.question.title]),
            h.span([], [answerLabel(step, model.answers, model.own)]),
          ],
        ),
        h.span([h.Class('f-tray-to')], [`To ${questionAgent(grill, step.question)}`]),
        button(
          ['Keep back'],
          Message.ClickedKeepBack({ question: id, kept: true }),
          'f-tray-keep',
          h,
          h.Title('Hold this draft on purpose: no count, no reminders (k)'),
        ),
      ],
    )
  }
  return h.div(
    [h.Class('f-unsent-tray'), h.Role('dialog'), h.AriaLabel('Unsent answers')],
    [
      h.div(
        [h.Class('f-tray-head')],
        [
          h.b([], ['Unsent answers']),
          h.small(
            [],
            [
              kbd('↑↓', h),
              ' move ',
              kbd('space', h),
              ' include ',
              kbd('k', h),
              ' keep back ',
              kbd('⌘↵', h),
              ' send ',
              kbd('esc', h),
              ' close',
            ],
          ),
        ],
      ),
      ...byRound(grill, ready).map(group =>
        h.keyed('section')(
          `round-${group.round}`,
          [h.Class('f-tray-round')],
          [
            h.div(
              [h.Class('f-tray-round-head')],
              [
                h.span([], [group.label]),
                button(
                  [`Send ${group.steps.length}`],
                  Message.ClickedSendQuestions({
                    questions: group.steps.map(step => step.question.id),
                  }),
                  'f-send-secondary',
                  h,
                  h.Title(recipientSummary(grill, group.steps)),
                ),
              ],
            ),
            h.ul([], group.steps.map(row)),
          ],
        ),
      ),
      Array.isReadonlyArrayEmpty(ready)
        ? h.p([h.Class('f-empty')], ['Nothing ready to send.'])
        : h.empty,
      Array.isReadonlyArrayEmpty(kept)
        ? h.empty
        : h.details(
            [h.Class('f-tray-kept'), h.Open(true)],
            [
              h.summary(
                [],
                [`Kept back (${kept.length}) · not counted, no reminders`],
              ),
              h.ul(
                [],
                kept.map(step =>
                  h.keyed('li')(
                    step.question.id,
                    [],
                    [
                      h.span([], [step.question.title]),
                      h.span(
                        [h.Class('f-tray-to')],
                        [`To ${questionAgent(grill, step.question)}`],
                      ),
                      button(
                        ['Return'],
                        Message.ClickedKeepBack({
                          question: step.question.id,
                          kept: false,
                        }),
                        'text-button',
                        h,
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
      h.div(
        [h.Class('f-tray-foot')],
        [
          h.span(
            [],
            [
              Array.isReadonlyArrayEmpty(selected)
                ? 'Nothing selected'
                : recipientSummary(grill, stepsOf(grill, selected)),
            ],
          ),
          button(
            ['Review & send with a message'],
            Message.ClickedWorkspacePage({ page: REVIEW }),
            'text-button',
            h,
          ),
          h.button(
            [
              h.Type('button'),
              h.Class('f-send-primary'),
              h.Disabled(Array.isReadonlyArrayEmpty(selected)),
              h.OnClick(Message.ClickedSendQuestions({ questions: selected })),
            ],
            [`Send ${selected.length} `, kbd('⌘↵', h)],
          ),
        ],
      ),
    ],
  )
}

/** Following a link to another page with ready drafts unsent asks first. */
export const leaveDialogView = (
  model: Model,
  snapshot: Snapshot,
  h: H,
): Html =>
  Option.match(model.maybeLeaving, {
    onNone: () => h.empty,
    onSome: leaving => {
      const ready = readyOf(model, snapshot)
      const agents = Array.dedupe(
        ready.map(step => questionAgent(snapshot.grill, step.question)),
      )
      return h.div(
        [h.Class('f-leave-scrim')],
        [
          h.div(
            [
              h.Class('f-leave-dialog'),
              h.Role('alertdialog'),
              h.AriaLabel('Unsent answers'),
            ],
            [
              h.h2(
                [],
                [
                  `${answerCount(ready.length)} ${ready.length === 1 ? "isn't" : "aren't"} sent yet`,
                ],
              ),
              h.p(
                [],
                [
                  'They stay saved as drafts on this page if you leave; the asking sessions just won’t have them.',
                ],
              ),
              ...agents.map(agent =>
                h.p(
                  [h.Class('f-leave-group')],
                  [
                    h.b([], [`To ${agent}`]),
                    h.br([]),
                    ready
                      .filter(
                        step =>
                          questionAgent(snapshot.grill, step.question) === agent,
                      )
                      .map(step => step.question.title)
                      .join(' · '),
                  ],
                ),
              ),
              h.div(
                [h.Class('f-leave-actions')],
                leaving.isSending
                  ? [h.span([h.Role('status')], ['Sending…'])]
                  : [
                      button(['Stay'], Message.ClickedStay(), 'f-send-secondary', h),
                      button(
                        ['Leave, keep as drafts'],
                        Message.ClickedLeave(),
                        'f-send-secondary',
                        h,
                      ),
                      button(
                        [`Send ${ready.length} and leave`],
                        Message.ClickedSendAndLeave(),
                        'f-send-primary',
                        h,
                      ),
                    ],
              ),
            ],
          ),
        ],
      )
    },
  })
