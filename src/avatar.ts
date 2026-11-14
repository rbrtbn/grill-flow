import type { Html, HtmlBuilder } from 'foldkit/html'

import type { Message } from './main'

type H = HtmlBuilder<Message>

// Eight muted hues (sessions.css --av-0 … --av-7). A session's hue comes from its address, so it
// is the same on every page and never changes; type stays in the text, not the colour.
const HUES = 8

const hueOf = (address: string): number =>
  [...address].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7) %
  HUES

/** A session's avatar: its initial on its hue. `size` picks the small chip form. */
export const sessionAvatar = (
  address: string,
  name: string,
  h: H,
  size: 'Row' | 'Small' | 'Large' = 'Row',
): Html =>
  h.span(
    [
      h.Class(
        `f-avatar is-hue-${hueOf(address)}${size === 'Row' ? '' : ` is-${size.toLowerCase()}`}`,
      ),
      h.AriaHidden(true),
    ],
    [(name.trim() || address).slice(0, 1).toUpperCase()],
  )
