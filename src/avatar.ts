import type { Html, HtmlBuilder } from 'foldkit/html'

import type { Message } from './main'

type H = HtmlBuilder<Message>

// Eight muted hues (sessions.css --av-0 … --av-7). A session's hue comes from its address, so it
// is the same on every page and never changes; type stays in the text, not the colour.
const HUES = 8

export const hueOf = (address: string): number =>
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

// Builders are named after their issue (b1369), so their avatar shows its last two digits; a
// Herdr address (t2cr) shows its tail, an earlier run an ellipsis, anyone else an initial.
const agentInitials = (agent: string): string =>
  /^b\d+$/.test(agent)
    ? agent.slice(-2)
    : agent.startsWith('t2')
      ? agent.slice(2).toUpperCase()
      : agent === 'earlier run'
        ? '…'
        : agent.slice(0, 1).toUpperCase()

/** An agent that held a piece of work: a session's hue, initials that tell builders apart. */
export const agentAvatar = (
  agent: string,
  h: H,
  size: 'Row' | 'Small' | 'Large' = 'Row',
): Html =>
  h.span(
    [
      h.Class(
        `f-avatar is-agent is-hue-${hueOf(agent)}${size === 'Row' ? '' : ` is-${size.toLowerCase()}`}`,
      ),
      h.Title(agent),
    ],
    [agentInitials(agent)],
  )
