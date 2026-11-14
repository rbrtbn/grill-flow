/// <reference types="vite/client" />
// PROTOTYPE shell shared by the discussion-threads studies (ask 9656): the page around the
// Discussion panel, in-memory threads, simulated delivery and replies. Each variant supplies
// only its panel. Nothing here talks to the grill-flow server.
import { Duration, Effect, Option, Schema } from 'effect'
import { Command, Dom, Runtime, Subscription, Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'

import {
  askerThread,
  cannedReply,
  type Line,
  question,
  questions,
  seedThreads,
  session,
  threadAbout,
  threadWith,
} from './data'
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
  nextId: Schema.Number,
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  SelectedQuestion: { key: Schema.String },
  OpenedThread: { key: Schema.String },
  OpenedQuestionThread: { key: Schema.String },
  UpdatedDraft: { key: Schema.String, value: Schema.String },
  SentMessage: { key: Schema.String },
  Delivered: { key: Schema.String, id: Schema.Number },
  Replied: { key: Schema.String, text: Schema.String },
  SetUi: { name: Schema.String, value: Schema.String },
  PressedVariantArrow: { direction: Schema.Number },
  Ignored: {},
})
export type Message = typeof Message.Type
export type H = HtmlBuilder<Message>

export const VARIANTS = [
  { key: 'tabs', port: 4361, letter: 'A', name: 'Thread tabs' },
  { key: 'timeline', port: 4362, letter: 'B', name: 'One addressed timeline' },
  {
    key: 'inbox',
    port: 4363,
    letter: 'C',
    name: 'Thread list beside the panel',
  },
  {
    key: 'stack',
    port: 4364,
    letter: 'D',
    name: 'Thread cards on the question',
  },
] as const

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
    Message.match<Update.Return<Model, Message>>(message, {
      SelectedQuestion: ({ key }) => {
        const switched = { ...model, question: key }
        return {
          model: open(switched, model.remembered[key] ?? askerThread(key)),
          commands: [replaceUrl({ key })],
        }
      },
      OpenedThread: ({ key }) => ({ model: open(model, key) }),
      OpenedQuestionThread: ({ key }) => ({
        model: open({ ...model, question: threadAbout(key) }, key),
        commands: [replaceUrl({ key: threadAbout(key) })],
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
        return {
          model: open(
            {
              ...model,
              nextId: model.nextId + 1,
              drafts: { ...model.drafts, [key]: '' },
              threads: {
                ...model.threads,
                [key]: [...(model.threads[key] ?? []), line],
              },
            },
            key,
          ),
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
                unread: model.active !== key,
              },
            ],
          },
        },
      }),
      SetUi: ({ name, value }) => ({
        model: { ...model, ui: { ...model.ui, [name]: value } },
      }),
      PressedVariantArrow: ({ direction }) => {
        const index = VARIANTS.findIndex(item => item.key === variant)
        const next =
          VARIANTS[(index + direction + VARIANTS.length) % VARIANTS.length]!
        return {
          model,
          commands: [go({ url: variantUrl(next.key, model.question) })],
        }
      },
      Ignored: () => ({ model }),
    })

// ── Shared view pieces a variant may use ───────────────────────────────────

export const unreadCount = (model: Model, key: string) =>
  (model.threads[key] ?? []).filter(line => line.unread).length

export const threadLabel = (key: string) => {
  const about = threadAbout(key)
  const who = session(threadWith(key))
  return about === '-' ? who.name : `${who.name} · about ${about}`
}

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
      h.p([], [line.text]),
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

const sidebar = (model: Model, h: H): Html =>
  h.nav(
    [h.Class('shell-sidebar'), h.AriaLabel('Questions')],
    [
      h.h2([], ['Squad · efficiency']),
      ...questions.map(item => {
        const unread = Object.keys(model.threads)
          .filter(key => threadAbout(key) === item.key)
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
          ],
        )
      }),
    ],
  )

const questionCard = (model: Model, h: H): Html => {
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
      ...VARIANTS.map(item =>
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
  panel: (model: Model, h: H) => Html
  panelClass?: string
}) => {
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
            threads: seedThreads,
            remembered: {},
            drafts: {},
            ui: {},
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
            h.div(
              [h.Class('shell-body')],
              [
                sidebar(model, h),
                questionCard(model, h),
                config.panel(model, h),
              ],
            ),
            stateReadout(model, h),
            switcher(config.variant, model, h),
          ],
        ),
      }),
      subscriptions: Subscription.make<Model, Message>()(entry => ({
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
