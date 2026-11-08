import type { Attribute, HtmlBuilder } from 'foldkit/html'

import { type Message, type Model, RevealChannelItem } from './main'

export const isChannelTarget = (model: Model, id: string): boolean =>
  model.channelReveal._tag === 'Pending' && model.channelReveal.id === id

export const channelRevealAttributes = (
  model: Model,
  id: string,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Attribute<Message>> => [
  h.Id(id),
  ...(isChannelTarget(model, id) ? [h.OnMount(RevealChannelItem({ id }))] : []),
]
