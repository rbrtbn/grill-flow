import { Array, Option, Schema, String } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

// MODEL

/** Text selected in a question, positioned in its quote root's coordinates. */
export const QuotedText = Schema.Struct({
  stepId: Schema.String,
  text: Schema.String,
  top: Schema.Number,
  bottom: Schema.Number,
  left: Schema.Number,
  placement: Schema.Literals(['Above', 'Below']),
})
export type QuotedText = typeof QuotedText.Type

export const QuoteSelection = defineTaggedUnion({
  Idle: {},
  Offered: { quoted: QuotedText },
  Composing: { quoted: QuotedText },
})
export type QuoteSelection = typeof QuoteSelection.Type

export const QUOTE_LIMIT = 1200
export const QUOTE_BOX = 'quote-box'
export const QUOTE_DRAFT = 'quote'
export const QUOTE_ROOT_ATTRIBUTE = 'data-quote-step'
export const QUOTE_POPOVER_CLASS = 'f-quote-popover'
// Half the popover's widest state, so it never pokes out of the reading column.
const EDGE = 180
// Room the toolbar needs above a selection before it flips below it.
const HEADROOM = 96

// DOMAIN

/**
 * Where a quote goes: the discussion the open panel shows, or the quoted question's own thread
 * while the panel is closed.
 */
export const quoteDestination = (
  isDiscussionOpen: boolean,
  maybeDiscussionTarget: Option.Option<string>,
  stepId: string,
): string =>
  isDiscussionOpen
    ? Option.getOrElse(maybeDiscussionTarget, () => stepId)
    : stepId

export const blockquote = (text: string): string =>
  text
    .trim()
    .split('\n')
    .map(line => (line.trim() === '' ? '>' : `> ${line}`))
    .join('\n')

export const quotedAsk = (quote: string, reply: string): string =>
  `${blockquote(quote)}\n\n${reply.trim()}`

export const withQuote = (draft: string, quote: string): string =>
  `${draft.trimEnd() === '' ? '' : `${draft.trimEnd()}\n\n`}${blockquote(quote)}\n\n`

/** Splits an ask into its leading quote, if any, and what was said about it. */
export const splitQuote = (
  text: string,
): Readonly<{ maybeQuote: Option.Option<string>; rest: string }> => {
  const lines = text.split('\n')
  const quoted = Array.takeWhile(lines, line => String.startsWith('>')(line))
  return Array.isArrayEmpty(quoted)
    ? { maybeQuote: Option.none(), rest: text }
    : {
        maybeQuote: Option.some(
          quoted.map(line => line.replace(/^> ?/, '')).join('\n'),
        ),
        rest: lines.slice(quoted.length).join('\n').trim(),
      }
}

// SELECTION

const insidePopover = (node: Node | null): boolean =>
  (node instanceof Element ? node : node?.parentElement)?.closest(
    `.${QUOTE_POPOVER_CLASS}`,
  ) != null

export const isInsideQuotePopover = (target: EventTarget | null): boolean =>
  target instanceof Node && insidePopover(target)

/**
 * The document's current selection when it lies within one question's quote root, measured
 * against that root so the popover can sit inside it and scroll with the text.
 */
export const readQuoteSelection = (): Option.Option<QuotedText> => {
  const selection = document.getSelection()
  if (
    selection === null ||
    selection.isCollapsed ||
    selection.rangeCount === 0 ||
    insidePopover(selection.anchorNode)
  ) {
    return Option.none()
  }
  const range = selection.getRangeAt(0)
  const container = range.commonAncestorContainer
  const root = (
    container instanceof Element ? container : container.parentElement
  )?.closest(`[${QUOTE_ROOT_ATTRIBUTE}]`)
  const text = selection
    .toString()
    .replace(/[ \t]+/g, ' ')
    .trim()
  if (root == null || text === '') {
    return Option.none()
  }
  const box = range.getBoundingClientRect()
  const frame = root.getBoundingClientRect()
  const center = box.left + box.width / 2 - frame.left
  return Option.some({
    stepId: root.getAttribute(QUOTE_ROOT_ATTRIBUTE) ?? '',
    text: text.slice(0, QUOTE_LIMIT),
    top: box.top - frame.top,
    bottom: box.bottom - frame.top,
    left: Math.min(Math.max(center, EDGE), Math.max(frame.width - EDGE, EDGE)),
    placement: box.top < HEADROOM ? 'Below' : 'Above',
  })
}
