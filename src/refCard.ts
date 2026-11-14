import type { Html, HtmlBuilder } from 'foldkit/html'

import { Message } from './main'

type H = HtmlBuilder<Message>

export type RefKind = 'Session' | 'Round' | 'Issue' | 'PR' | 'Key' | 'Task'

/** What a reference's card says: the same shape for every kind. */
export type RefCard = Readonly<{
  kind: RefKind
  id: string
  title: string
  subtitle?: string
  rows: ReadonlyArray<readonly [string, string]>
  // A preview-only sample, flagged so nobody mistakes it for live data.
  sampleNote?: string
  href?: string
  page?: Readonly<{ label: string; page: string }>
}>

const slug = (text: string): string =>
  text.toLowerCase().replace(/[^a-z0-9]+/g, '-')

const cardBody = (card: RefCard, h: H): ReadonlyArray<Html> => [
  h.span(
    [h.Class('f-ref-kind')],
    [card.kind === 'PR' ? 'Pull request' : card.kind],
  ),
  h.b([h.Class('f-ref-title')], [card.title]),
  card.subtitle === undefined
    ? h.empty
    : h.span([h.Class('f-ref-subtitle')], [card.subtitle]),
  card.rows.length === 0
    ? h.empty
    : h.dl(
        [],
        card.rows.flatMap(([label, value]) => [
          h.dt([], [label]),
          h.dd([], [value]),
        ]),
      ),
  card.sampleNote === undefined
    ? h.empty
    : h.span([h.Class('f-ref-sample')], [card.sampleNote]),
  card.href === undefined && card.page === undefined
    ? h.empty
    : h.span(
        [h.Class('f-ref-links')],
        [
          card.page === undefined
            ? h.empty
            : h.button(
                [
                  h.Type('button'),
                  h.Class('text-button'),
                  h.OnClick(
                    Message.ClickedWorkspacePage({ page: card.page.page }),
                  ),
                ],
                [card.page.label],
              ),
          card.href === undefined
            ? h.empty
            : h.a(
                [
                  h.Class('text-link'),
                  h.Href(card.href),
                  h.Target('_blank'),
                  h.Rel('noreferrer'),
                ],
                ['Open ↗'],
              ),
        ],
      ),
]

/**
 * A reference with its card: the card opens while the pointer or focus is on the reference,
 * and a click pins it (a native popover, closed by Escape or a click elsewhere). `place` keeps
 * ids unique when the same reference shows twice on a page. A trigger that already acts on
 * click, such as a filter chip, passes `pin: false` and keeps its own action.
 */
export const refView = (
  card: RefCard,
  place: string,
  trigger: Html | string,
  h: H,
  pin = true,
): Html => {
  const id = `ref-${slug(place)}-${slug(card.kind)}-${slug(card.id)}`
  return h.span(
    [h.Class('f-ref'), h.Style({ '--ref-anchor': `--${id}` })],
    [
      pin
        ? h.button(
            [
              h.Type('button'),
              h.Class('f-ref-trigger'),
              h.Popovertarget(id),
              h.AriaLabel(`${card.kind} ${card.title}`),
            ],
            [trigger],
          )
        : trigger,
      h.div(
        [
          h.Id(id),
          h.Popover('auto'),
          h.Class('f-ref-card'),
          h.Role('group'),
          h.AriaLabel(`${card.kind} ${card.title}`),
        ],
        [h.div([h.Class('f-ref-body')], cardBody(card, h))],
      ),
    ],
  )
}
