/// <reference types="vite/client" />
// PROTOTYPE shell shared by the discussion-threads studies (ask 9656): the page around the
// Discussion panel, in-memory threads, simulated delivery and replies. Each variant supplies
// only its panel. Nothing here talks to the grill-flow server.
import { Duration, Effect, Option, Schema } from 'effect'
import { Command, Dom, Runtime, Subscription, Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'

import {
  type Anchor,
  anchorOf,
  askerThread,
  cannedReply,
  type Line,
  longProse,
  question,
  questionOf,
  questions,
  seedAnchors,
  seedThreads,
  seedThreads2,
  session,
  threadAbout,
  threadKey,
  threadWith,
} from './data'
import { REF_PATTERN, refUrl, STEP_REPLY, STEPS } from './scenario'
import './shell.css'

const LineSchema = Schema.Struct({
  id: Schema.Number,
  from: Schema.String,
  text: Schema.String,
  at: Schema.String,
  state: Schema.Literals(['sending', 'delivered', 'reply']),
  unread: Schema.Boolean,
})
export const Model = Schema.Struct({
  question: Schema.String,
  active: Schema.String,
  threads: Schema.Record(Schema.String, Schema.Array(LineSchema)),
  remembered: Schema.Record(Schema.String, Schema.String),
  drafts: Schema.Record(Schema.String, Schema.String),
  ui: Schema.Record(Schema.String, Schema.String),
  anchors: Schema.Record(
    Schema.String,
    Schema.Array(Schema.Struct({ id: Schema.String, text: Schema.String })),
  ),
  nextId: Schema.Number,
  step: Schema.Number,
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  SelectedQuestion: { key: Schema.String },
  OpenedThread: { key: Schema.String },
  OpenedQuestionThread: { key: Schema.String },
  OpenedSide: { key: Schema.String },
  UpdatedDraft: { key: Schema.String, value: Schema.String },
  SentMessage: { key: Schema.String },
  Delivered: { key: Schema.String, id: Schema.Number },
  Replied: { key: Schema.String, text: Schema.String },
  SetUi: { name: Schema.String, value: Schema.String },
  PressedVariantArrow: { direction: Schema.Number },
  SelectedText: { text: Schema.String, x: Schema.Number, y: Schema.Number },
  AddedAnchor: {},
  ScenarioNext: {},
  PickedAnswer: { q: Schema.String, key: Schema.String, note: Schema.Boolean },
  SentAnswer: { q: Schema.String },
  SentText: { key: Schema.String, text: Schema.String },
  Ignored: {},
})
export type Message = typeof Message.Type
export type H = HtmlBuilder<Message>

export const VARIANTS = [
  { key: 'tabs', port: 4361, letter: 'A', name: 'Thread tabs', round: 1 },
  {
    key: 'timeline',
    port: 4362,
    letter: 'B',
    name: 'One addressed timeline',
    round: 1,
  },
  {
    key: 'inbox',
    port: 4363,
    letter: 'C',
    name: 'Thread list beside the panel',
    round: 1,
  },
  {
    key: 'stack',
    port: 4364,
    letter: 'D',
    name: 'Thread cards on the question',
    round: 1,
  },
  {
    key: 'under',
    port: 4365,
    letter: 'E',
    name: 'Conversation under the question',
    round: 2,
  },
  {
    key: 'margin',
    port: 4367,
    letter: 'F',
    name: 'Margin threads + message palette',
    round: 2,
  },
  {
    key: 'issue',
    port: 4368,
    letter: 'G',
    name: 'Question as an issue page',
    round: 2,
  },
  {
    key: 'board',
    port: 4369,
    letter: 'H',
    name: 'G page · split answers · sessions by work',
    round: 3,
  },
  {
    key: 'directory',
    port: 4370,
    letter: 'I',
    name: 'G page · answer then note · sessions by squad',
    round: 3,
  },
] as const

const roundOf = (variant: string) =>
  VARIANTS.find(item => item.key === variant)?.round ?? 1

const now = () => {
  const date = new Date()
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

const deliver = Command.define('Deliver', {
  args: { key: Schema.String, id: Schema.Number },
  messages: [Message.Delivered],
  execute: ({ key, id }) =>
    Effect.sleep(Duration.millis(450)).pipe(
      Effect.as(Message.Delivered({ key, id })),
    ),
})
const reply = Command.define('Reply', {
  args: { key: Schema.String, text: Schema.String },
  messages: [Message.Replied],
  execute: ({ key, text }) =>
    Effect.sleep(Duration.millis(2400)).pipe(
      Effect.as(Message.Replied({ key, text })),
    ),
})
const go = Command.define('Go', {
  args: { url: Schema.String },
  messages: [Message.Ignored],
  execute: ({ url }) =>
    Effect.sync(() => {
      window.location.href = url
      return Message.Ignored()
    }),
})
const focus = Command.define('Focus', {
  args: { selector: Schema.String },
  messages: [Message.Ignored],
  execute: ({ selector }) =>
    Effect.sleep(Duration.millis(30)).pipe(
      Effect.flatMap(() => Dom.focus(selector)),
      Effect.ignore,
      Effect.as(Message.Ignored()),
    ),
})
const reveal = Command.define('Reveal', {
  args: { key: Schema.String },
  messages: [Message.Ignored],
  execute: ({ key }) =>
    Effect.sleep(Duration.millis(40)).pipe(
      Effect.tap(() =>
        Effect.sync(() =>
          document
            .querySelector(`[data-thread="${CSS.escape(key)}"]`)
            ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }),
        ),
      ),
      Effect.as(Message.Ignored()),
    ),
})
const replaceUrl = Command.define('ReplaceUrl', {
  args: { key: Schema.String },
  messages: [Message.Ignored],
  execute: ({ key }) =>
    Effect.sync(() => {
      const url = new URL(window.location.href)
      url.searchParams.set('q', key)
      window.history.replaceState({}, '', url)
      return Message.Ignored()
    }),
})

const markRead = (model: Model, key: string): Model =>
  model.threads[key] === undefined
    ? model
    : {
        ...model,
        threads: {
          ...model.threads,
          [key]: model.threads[key].map(line => ({ ...line, unread: false })),
        },
      }

/** Opening a thread marks it read and makes it the one this question returns to. */
const open = (model: Model, key: string): Model => ({
  ...model,
  active: key,
  ui: { ...model.ui, menu: '' },
  remembered: { ...model.remembered, [model.question]: key },
  threads:
    model.threads[key] === undefined
      ? model.threads
      : {
          ...model.threads,
          [key]: model.threads[key].map(line => ({ ...line, unread: false })),
        },
})

export const variantUrl = (key: string, questionKey: string) => {
  const variant = VARIANTS.find(item => item.key === key) ?? VARIANTS[0]
  return `http://127.0.0.1:${variant.port}/prototypes/discussion-threads-${variant.key}/?q=${questionKey}`
}

const makeUpdate =
  (variant: string) =>
  (model: Model, message: Message): Update.Return<Model, Message> =>
    // oxlint-disable-next-line typescript/no-use-before-define
    match(variant, model, message)

const match = (
  variant: string,
  model: Model,
  message: Message,
): Update.Return<Model, Message> =>
  Message.match<Update.Return<Model, Message>>(message, {
    SelectedQuestion: ({ key }) => {
      const switched = { ...model, question: key }
      return {
        model: open(switched, model.remembered[key] ?? askerThread(key)),
        commands: [replaceUrl({ key })],
      }
    },
    OpenedThread: ({ key }) => ({
      model: open(model, key),
      commands: [reveal({ key })],
    }),
    // A side conversation (the messages panel) never changes what the question reopens.
    OpenedSide: ({ key }) => ({
      model: markRead(
        { ...model, ui: { ...model.ui, side: key, palette: '', menu: '' } },
        key,
      ),
    }),
    OpenedQuestionThread: ({ key }) => ({
      model: open({ ...model, question: questionOf(key) }, key),
      commands: [replaceUrl({ key: questionOf(key) })],
    }),
    UpdatedDraft: ({ key, value }) => ({
      model: { ...model, drafts: { ...model.drafts, [key]: value } },
    }),
    SentMessage: ({ key }) => {
      const text = (model.drafts[key] ?? '').trim()
      if (text === '') return { model }
      const line: Line = {
        id: model.nextId,
        from: 'rob',
        text,
        at: now(),
        state: 'sending',
        unread: false,
      }
      const sent = {
        ...model,
        nextId: model.nextId + 1,
        drafts: { ...model.drafts, [key]: '' },
        threads: {
          ...model.threads,
          [key]: [...(model.threads[key] ?? []), line],
        },
      }
      return {
        model: key === model.ui.side ? sent : open(sent, key),
        commands: [
          deliver({ key, id: line.id }),
          reply({ key, text: cannedReply(key) }),
        ],
      }
    },
    Delivered: ({ key, id }) => ({
      model: {
        ...model,
        threads: {
          ...model.threads,
          [key]: (model.threads[key] ?? []).map(line =>
            line.id === id ? { ...line, state: 'delivered' as const } : line,
          ),
        },
      },
    }),
    Replied: ({ key, text }) => ({
      model: {
        ...model,
        nextId: model.nextId + 1,
        threads: {
          ...model.threads,
          [key]: [
            ...(model.threads[key] ?? []),
            {
              id: model.nextId,
              from: threadWith(key),
              text,
              at: now(),
              state: 'reply' as const,
              unread: model.active !== key && model.ui.side !== key,
            },
          ],
        },
      },
    }),
    SetUi: ({ name, value }) => ({
      model: { ...model, ui: { ...model.ui, [name]: value } },
      commands:
        name === 'palette' && value === 'open'
          ? [focus({ selector: '.p-input' })]
          : [],
    }),
    PressedVariantArrow: ({ direction }) => {
      const set = VARIANTS.filter(item => item.round === roundOf(variant))
      const index = set.findIndex(item => item.key === variant)
      const next = set[(index + direction + set.length) % set.length]!
      return {
        model,
        commands: [go({ url: variantUrl(next.key, model.question) })],
      }
    },
    SelectedText: ({ text, x, y }) => ({
      model: {
        ...model,
        ui: { ...model.ui, sel: text, selX: String(x), selY: String(y) },
      },
    }),
    AddedAnchor: () => {
      const text = (model.ui.sel ?? '').trim()
      if (text === '') return { model }
      const anchor = { id: `n${model.nextId}`, text }
      const key = threadKey(
        `${model.question}#${anchor.id}`,
        question(model.question).asker,
      )
      return {
        model: open(
          {
            ...model,
            nextId: model.nextId + 1,
            ui: { ...model.ui, sel: '' },
            anchors: {
              ...model.anchors,
              [model.question]: [
                ...(model.anchors[model.question] ?? []),
                anchor,
              ],
            },
          },
          key,
        ),
      }
    },
    ScenarioNext: () => {
      const step = Math.min(model.step + 1, STEPS.length - 1)
      if (step === model.step) return { model }
      let next: Model = {
        ...model,
        step,
        ui: { ...model.ui, toast: STEPS[step]?.title ?? '' },
      }
      if (step === 1) {
        next = open(
          { ...next, question: 'pr-order' },
          model.remembered['pr-order'] ?? askerThread('pr-order'),
        )
        next = {
          ...next,
          nextId: next.nextId + 1,
          threads: {
            ...next.threads,
            [STEP_REPLY]: [
              ...(next.threads[STEP_REPLY] ?? []),
              {
                id: next.nextId,
                from: 't2j6',
                text: 'Follow-up: the grants run paused 74 minutes and the homelab run 81. Both would have kept their cache under B.',
                at: now(),
                state: 'reply' as const,
                unread: true,
              },
            ],
          },
        }
      }
      if (step === 5)
        next = {
          ...next,
          ui: { ...next.ui, 'pick:night-grant': 'B', 'sent:night-grant': 'B' },
        }
      return {
        model: next,
        commands: step === 1 ? [replaceUrl({ key: 'pr-order' })] : [],
      }
    },
    PickedAnswer: ({ q, key, note }) => ({
      model: {
        ...model,
        ui: {
          ...model.ui,
          [`pick:${q}`]: key,
          [`note:${q}`]:
            note || key === 'own' ? 'open' : (model.ui[`note:${q}`] ?? ''),
        },
      },
      commands: note || key === 'own' ? [focus({ selector: '.note-box' })] : [],
    }),
    SentAnswer: ({ q }) => ({
      model: {
        ...model,
        ui: {
          ...model.ui,
          [`sent:${q}`]: model.ui[`pick:${q}`] ?? '',
          [`sentNote:${q}`]: (model.drafts[`note:${q}`] ?? '').trim(),
          [`note:${q}`]: '',
        },
      },
    }),
    SentText: ({ key, text }) =>
      match(
        variant,
        { ...model, drafts: { ...model.drafts, [key]: text } },
        Message.SentMessage({ key }),
      ),
    Ignored: () => ({ model }),
  })

// ── Shared view pieces a variant may use ───────────────────────────────────

export const unreadCount = (model: Model, key: string) =>
  (model.threads[key] ?? []).filter(line => line.unread).length

export const threadLabel = (key: string) => {
  const about = threadAbout(key)
  const who = session(threadWith(key))
  return about === '-'
    ? who.name
    : anchorOf(key) !== undefined
      ? `${who.name} · passage in ${questionOf(key)}`
      : `${who.name} · about ${about}`
}

export const anchorText = (model: Model, key: string) =>
  (model.anchors[questionOf(key)] ?? []).find(item => item.id === anchorOf(key))
    ?.text ?? ''

/** Threads quoting a passage of the question, in the order the passages appear. */
export const passageThreads = (model: Model, questionKey: string) =>
  (model.anchors[questionKey] ?? []).flatMap(anchor =>
    Object.keys(model.threads)
      .concat(model.active)
      .filter(
        (key, index, all) =>
          all.indexOf(key) === index &&
          threadAbout(key) === `${questionKey}#${anchor.id}`,
      )
      .map(key => ({ key, anchor })),
  )

/** The question's reasoning with quoted passages marked; a mark opens its thread. */
export const proseView = (
  model: Model,
  questionKey: string,
  h: H,
  open: (key: string) => Message = key => Message.OpenedThread({ key }),
  texts?: ReadonlyArray<string>,
): ReadonlyArray<Html> => {
  const paragraphs = texts ??
    longProse[questionKey] ?? [question(questionKey).why]
  const anchors: ReadonlyArray<Anchor> = model.anchors[questionKey] ?? []
  const threads = passageThreads(model, questionKey)
  return paragraphs.map(text => {
    const pieces: Array<Html | string> = []
    let rest = text
    for (;;) {
      const hit = anchors
        .map(anchor => ({ anchor, at: rest.indexOf(anchor.text) }))
        .filter(item => item.at >= 0)
        .sort((a, b) => a.at - b.at)[0]
      if (hit === undefined) break
      const thread = threads.find(item => item.anchor.id === hit.anchor.id)
      const key =
        thread?.key ??
        threadKey(
          `${questionKey}#${hit.anchor.id}`,
          question(questionKey).asker,
        )
      pieces.push(...linkify(rest.slice(0, hit.at), h))
      pieces.push(
        h.mark(
          [
            h.Class(
              `passage${model.active === key ? ' is-active' : ''}${unreadCount(model, key) > 0 ? ' is-unread' : ''}`,
            ),
            h.Title('Open the thread on this passage'),
            h.OnClick(open(key)),
          ],
          [
            hit.anchor.text,
            h.sup([], [String((model.threads[key] ?? []).length || '•')]),
          ],
        ),
      )
      rest = rest.slice(hit.at + hit.anchor.text.length)
    }
    pieces.push(...linkify(rest, h))
    return h.p([h.Class('q-prose')], pieces)
  })
}

/** The quote-reply popover: selecting reasoning text offers a thread on that passage. */
export const selectionPopover = (model: Model, h: H): Html =>
  (model.ui.sel ?? '') === ''
    ? h.empty
    : h.div(
        [
          h.Class('sel-pop'),
          h.Style({
            left: `${model.ui.selX ?? 0}px`,
            top: `${Number(model.ui.selY ?? 0) + 6}px`,
          }),
        ],
        [
          h.button(
            [h.OnClick(Message.AddedAnchor())],
            [
              `Reply to this passage → ${session(question(model.question).asker).name}`,
            ],
          ),
        ],
      )

/** Text with Linear issues and pull requests turned into links. */
export const linkify = (text: string, h: H): ReadonlyArray<Html | string> =>
  text.split(REF_PATTERN).map(part => {
    const url = refUrl(part)
    return url === undefined
      ? part
      : h.a([h.Href(url), h.Target('_blank'), h.Class('ref-link')], [part])
  })

export const dot = (color: string, h: H): Html =>
  h.span([h.Class('who-dot'), h.Style({ background: color })], [])

export const lineView = (line: Line, h: H, showTo?: string): Html => {
  const mine = line.from === 'rob'
  const who = session(line.from)
  return h.div(
    [
      h.Class(
        `line ${mine ? 'is-mine' : 'is-theirs'}${line.unread ? ' is-unread' : ''}`,
      ),
    ],
    [
      h.div(
        [h.Class('line-head')],
        [
          mine
            ? h.strong([], ['You'])
            : h.strong([h.Style({ color: who.color })], [who.name]),
          showTo === undefined
            ? h.empty
            : h.span([h.Class('line-to')], [mine ? `→ ${showTo}` : '→ you']),
          h.span([h.Class('line-at')], [line.at]),
          mine
            ? h.span(
                [h.Class(`line-state state-${line.state}`)],
                [line.state === 'sending' ? 'Sending…' : 'Delivered'],
              )
            : line.unread
              ? h.span([h.Class('line-new')], ['New'])
              : h.empty,
        ],
      ),
      h.p([], linkify(line.text, h)),
    ],
  )
}

/** A message list pinned to its newest line, the way a chat opens. */
export const linesBox = (
  className: string,
  children: ReadonlyArray<Html>,
  h: H,
): Html =>
  h.div(
    [h.Class(`lines ${className}`)],
    [h.div([h.Class('lines-inner')], children)],
  )

/** Enter sends, Shift+Enter breaks a line; the draft belongs to its thread. */
export const composeBox = (
  model: Model,
  key: string,
  placeholder: string,
  h: H,
): Html =>
  h.keyed('textarea')(`box-${key}`, [
    h.Class('compose-box'),
    h.Rows(3),
    h.Value(model.drafts[key] ?? ''),
    h.Placeholder(placeholder),
    h.OnInput(value => Message.UpdatedDraft({ key, value })),
    h.OnKeyDownPreventDefault((pressed, { shiftKey }) =>
      pressed === 'Enter' && !shiftKey
        ? Option.some(Message.SentMessage({ key }))
        : Option.none(),
    ),
  ])

export const sidebar = (model: Model, h: H): Html =>
  h.nav(
    [h.Class('shell-sidebar'), h.AriaLabel('Questions')],
    [
      h.h2([], ['Squad · efficiency']),
      ...questions.map(item => {
        const unread = Object.keys(model.threads)
          .filter(key => questionOf(key) === item.key)
          .reduce((sum, key) => sum + unreadCount(model, key), 0)
        return h.button(
          [
            h.Class(
              `shell-q${model.question === item.key ? ' is-current' : ''}`,
            ),
            h.OnClick(Message.SelectedQuestion({ key: item.key })),
          ],
          [
            h.span([h.Class('shell-q-key')], [item.key]),
            h.span([], [item.title]),
            h.small(
              [],
              [`${item.round} · asked by ${session(item.asker).name}`],
            ),
            unread > 0 ? h.span([h.Class('badge')], [String(unread)]) : h.empty,
            (model.ui[`sent:${item.key}`] ?? '') === ''
              ? h.empty
              : h.small(
                  [h.Class('shell-answered')],
                  [`Answered ${model.ui[`sent:${item.key}`]}`],
                ),
          ],
        )
      }),
    ],
  )

export const questionCard = (model: Model, h: H): Html => {
  const item = question(model.question)
  return h.main(
    [h.Class('shell-question')],
    [
      h.p(
        [h.Class('shell-meta')],
        [
          `${item.round} · ${item.key} · asked by ${session(item.asker).name} (${item.asker})`,
        ],
      ),
      h.h1([], [item.title]),
      h.p([h.Class('shell-why')], [item.why]),
      h.p([h.Class('shell-ask')], [item.ask]),
      h.div(
        [h.Class('shell-options')],
        item.options.map(option =>
          h.button(
            [h.Class('shell-option')],
            [
              h.strong([], [`${option.key} · ${option.label}`]),
              h.span([], [option.effect]),
            ],
          ),
        ),
      ),
    ],
  )
}

const stateReadout = (model: Model, h: H): Html =>
  h.p(
    [h.Class('state-readout')],
    [
      'Returns to: ',
      ...questions.map(item => {
        const key = model.remembered[item.key] ?? askerThread(item.key)
        return h.span(
          [h.Class(item.key === model.question ? 'is-current' : '')],
          [`${item.key} → ${threadLabel(key)}`],
        )
      }),
    ],
  )

const scenarioPanel = (model: Model, h: H): Html =>
  h.div(
    [h.Class('scenario')],
    [
      h.p(
        [h.Class('scenario-title')],
        [`Scenario · step ${model.step + 1} of ${STEPS.length}`],
      ),
      h.ol(
        [],
        STEPS.map((step, index) =>
          h.li(
            [
              h.Class(
                index === model.step
                  ? 'is-now'
                  : index < model.step
                    ? 'is-done'
                    : '',
              ),
            ],
            [
              h.strong([], [step.title]),
              index === model.step ? h.small([], [step.detail]) : h.empty,
            ],
          ),
        ),
      ),
      h.div(
        [h.Class('scenario-actions')],
        [
          h.button(
            [h.OnClick(Message.PressedVariantArrow({ direction: 0 }))],
            ['Restart'],
          ),
          h.button(
            [
              h.Class('scenario-next'),
              h.Disabled(model.step >= STEPS.length - 1),
              h.OnClick(Message.ScenarioNext()),
            ],
            ['Next step →'],
          ),
        ],
      ),
    ],
  )

const switcher = (variant: string, model: Model, h: H): Html =>
  h.footer(
    [h.Class('prototype-switcher'), h.AriaLabel('Choose discussion prototype')],
    [
      h.button(
        [
          h.AriaLabel('Previous variant'),
          h.OnClick(Message.PressedVariantArrow({ direction: -1 })),
        ],
        ['←'],
      ),
      ...VARIANTS.filter(item => item.round === roundOf(variant)).map(item =>
        h.a(
          [
            h.Class(item.key === variant ? 'active' : ''),
            h.Href(variantUrl(item.key, model.question)),
          ],
          [`${item.letter} · ${item.name}`],
        ),
      ),
      h.button(
        [
          h.AriaLabel('Next variant'),
          h.OnClick(Message.PressedVariantArrow({ direction: 1 })),
        ],
        ['→'],
      ),
    ],
  )

export const start = (config: {
  variant: string
  description: string
  panel?: (model: Model, h: H) => Html
  body?: (model: Model, h: H) => Html
  panelClass?: string
}) => {
  const round2 = roundOf(config.variant) >= 2
  const initialQuestion = new URLSearchParams(window.location.search).get('q')
  const first = questions.some(item => item.key === initialQuestion)
    ? initialQuestion!
    : 'cache-budget'
  const variant = VARIANTS.find(item => item.key === config.variant)!
  Runtime.run(
    Runtime.makeApplication({
      Model,
      init: (): Update.Return<Model, Message> => ({
        model: open(
          {
            question: first,
            active: askerThread(first),
            threads: round2 ? seedThreads2 : seedThreads,
            remembered: {},
            drafts: {},
            ui: {},
            anchors: round2 ? seedAnchors : {},
            step: 0,
            nextId: 100,
          },
          askerThread(first),
        ),
      }),
      update: makeUpdate(config.variant),
      view: (model, h) => ({
        title: `${variant.letter} · ${variant.name} · Discussion threads`,
        body: h.div(
          [
            h.Class(
              `shell variant-${config.variant} ${config.panelClass ?? ''}`,
            ),
          ],
          [
            h.div(
              [h.Class('study-strip')],
              [
                h.strong(
                  [],
                  [`Discussion threads · ${variant.letter} · ${variant.name}`],
                ),
                h.span([], [config.description]),
              ],
            ),
            config.body === undefined
              ? h.div(
                  [h.Class('shell-body')],
                  [
                    sidebar(model, h),
                    questionCard(model, h),
                    config.panel?.(model, h) ?? h.empty,
                  ],
                )
              : config.body(model, h),
            selectionPopover(model, h),
            roundOf(config.variant) === 3
              ? scenarioPanel(model, h)
              : stateReadout(model, h),
            switcher(config.variant, model, h),
          ],
        ),
      }),
      subscriptions: Subscription.make<Model, Message>()(entry => ({
        selection: entry(
          {},
          {
            modelToDependencies: () => ({}),
            dependenciesToStream: () =>
              Dom.streamFromEventFilterMap({
                target: document,
                type: 'mouseup',
                filterMapEvent: event => {
                  if (
                    event.target instanceof Element &&
                    event.target.closest('.sel-pop')
                  )
                    return Option.none()
                  const selection = window.getSelection()
                  const text = selection?.toString().trim() ?? ''
                  const node = selection?.anchorNode
                  const inProse =
                    node !== null &&
                    node !== undefined &&
                    (node instanceof Element
                      ? node
                      : node.parentElement
                    )?.closest('.q-prose') != null
                  if (text === '' || !inProse || selection === null)
                    return Option.some(
                      Message.SelectedText({ text: '', x: 0, y: 0 }),
                    )
                  const rect = selection.getRangeAt(0).getBoundingClientRect()
                  return Option.some(
                    Message.SelectedText({
                      text,
                      x: rect.left,
                      y: rect.bottom,
                    }),
                  )
                },
              }),
          },
        ),
        palette: entry(
          {},
          {
            modelToDependencies: () => ({}),
            dependenciesToStream: () =>
              Dom.streamFromEventFilterMapPreventDefault({
                target: document,
                type: 'keydown',
                filterMapEvent: event =>
                  (event.metaKey || event.ctrlKey) && event.key === 'k'
                    ? Option.some(
                        Message.SetUi({ name: 'palette', value: 'open' }),
                      )
                    : event.key === 'Escape'
                      ? Option.some(
                          Message.SetUi({ name: 'palette', value: '' }),
                        )
                      : Option.none(),
              }),
          },
        ),
        arrows: entry(
          {},
          {
            modelToDependencies: () => ({}),
            dependenciesToStream: () =>
              Dom.streamFromEventFilterMapPreventDefault({
                target: document,
                type: 'keydown',
                filterMapEvent: event =>
                  !['ArrowLeft', 'ArrowRight'].includes(event.key) ||
                  (event.target instanceof Element &&
                    event.target.closest(
                      'input,textarea,select,[contenteditable]',
                    ))
                    ? Option.none()
                    : Option.some(
                        Message.PressedVariantArrow({
                          direction: event.key === 'ArrowLeft' ? -1 : 1,
                        }),
                      ),
              }),
          },
        ),
      })),
      container: document.getElementById('root'),
      devTools: false,
    }),
  )
}
