import type { Html, HtmlBuilder } from 'foldkit/html'

import { TEXT_LIMIT, isOverTextLimit } from './domain'
import type { Message } from './main'

// Counting starts near the limit, so a short draft carries no number.
const COUNT_FROM = TEXT_LIMIT - 400

const grouped = (count: number): string => count.toLocaleString('en-GB')

export const textLimitCount = (text: string, h: HtmlBuilder<Message>): Html =>
  text.length < COUNT_FROM
    ? h.empty
    : h.small(
        [h.Class(`char-count${isOverTextLimit(text) ? ' is-over' : ''}`)],
        [
          isOverTextLimit(text)
            ? `${grouped(text.length)} / ${grouped(TEXT_LIMIT)} characters · shorten by ${grouped(text.length - TEXT_LIMIT)} to send`
            : `${grouped(text.length)} / ${grouped(TEXT_LIMIT)} characters`,
        ],
      )
