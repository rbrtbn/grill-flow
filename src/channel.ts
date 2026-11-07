import { Schema } from 'effect'

const Identifier = Schema.String.check(
  Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,79}$/),
  Schema.isTrimmed(),
)
const Text = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(20000),
)
const Timestamp = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
)
const Link = Schema.String.check(
  Schema.isPattern(/^https?:\/\/[^\s]+$/),
  Schema.isMaxLength(2000),
  Schema.isTrimmed(),
)
const ItemFields = {
  version: Schema.Literal(1),
  id: Identifier,
  previous: Schema.Number.check(
    Schema.isInt(),
    Schema.isGreaterThanOrEqualTo(0),
  ),
  revision: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
  session: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  body: Text,
  title: Schema.optionalKey(
    Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  ),
  question: Schema.optionalKey(Schema.String),
}
export const UpdateItem = Schema.Struct({
  ...ItemFields,
  kind: Schema.Literal('update'),
  supersedes: Schema.optionalKey(Identifier),
})
export type UpdateItem = typeof UpdateItem.Type

export const OwnerProgress = Schema.Union([
  Schema.Struct({ state: Schema.Literal('open') }),
  Schema.Struct({
    state: Schema.Literal('completed'),
    proof: Link,
    checkedAt: Timestamp,
    validUntil: Schema.optionalKey(Timestamp),
  }),
  Schema.Struct({ state: Schema.Literal('withdrawn'), reason: Text }),
])
export const OwnerDestination = Schema.Union([
  Link,
  Schema.Struct({
    kind: Schema.Literal('terminal'),
    address: Schema.String.check(
      Schema.isPattern(/^t[0-9a-z]+$/),
      Schema.isTrimmed(),
      Schema.isMaxLength(80),
    ),
  }),
])
export const OwnerStepItem = Schema.Struct({
  ...ItemFields,
  kind: Schema.Literal('owner-step'),
  host: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  destination: OwnerDestination,
  action: Text,
  urgency: Schema.Literals(['blocking', 'soon', 'wait', 'fyi']),
  blockers: Schema.Array(Identifier),
  progress: OwnerProgress,
})
export const DecisionItem = Schema.Struct({
  ...ItemFields,
  kind: Schema.Literal('decision'),
  deadline: Timestamp,
  affected: Schema.Array(Text),
  vetoResponses: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        receipt: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
        state: Schema.Literals(['acknowledged', 'stopped', 'continued']),
        text: Text,
      }),
    ),
  ),
  resolution: Schema.Union([
    Schema.Struct({ state: Schema.Literal('provisional') }),
    Schema.Struct({
      state: Schema.Literals(['withdrawn', 'confirmed']),
      reason: Text,
    }),
  ]),
})
export const ProviderReference = Schema.Union([
  Schema.Struct({
    provider: Schema.Literal('github'),
    repository: Schema.String.check(
      Schema.isPattern(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
    ),
    number: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
    kind: Schema.Literals(['pull', 'issue']),
  }),
  Schema.Struct({
    provider: Schema.Literal('linear'),
    id: Schema.String.check(Schema.isPattern(/^[A-Z][A-Z0-9]*-[1-9][0-9]*$/)),
  }),
])
export const EvidenceState = Schema.Literals([
  'open',
  'closed',
  'merged',
  'done',
  'in-progress',
  'draft',
  'failed',
  'passed',
  'unknown',
])
export const EvidenceItem = Schema.Struct({
  ...ItemFields,
  kind: Schema.Literal('evidence'),
  reference: ProviderReference,
  state: EvidenceState,
  proof: Link,
  checkedAt: Timestamp,
  validUntil: Timestamp,
})
export const BlockerCondition = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('question'),
    source: Schema.String,
    question: Schema.String,
    oneOf: Schema.Array(Schema.String).check(Schema.isMinLength(1)),
  }),
  Schema.Struct({
    kind: Schema.Literal('owner-step'),
    source: Schema.String,
    id: Identifier,
  }),
  Schema.Struct({
    kind: Schema.Literal('provider'),
    source: Schema.String,
    evidence: Identifier,
    reference: ProviderReference,
    state: EvidenceState,
  }),
])
export const BlockerItem = Schema.Struct({
  ...ItemFields,
  kind: Schema.Literal('blocker'),
  condition: BlockerCondition,
})
export const ChannelItem = Schema.Union([
  UpdateItem,
  OwnerStepItem,
  DecisionItem,
  EvidenceItem,
  BlockerItem,
])
export type ChannelItem = typeof ChannelItem.Type
const PublishedFields = {
  source: Schema.String,
  event: Schema.Number,
  at: Timestamp,
}
export const PublishedUpdate = Schema.Struct({
  ...PublishedFields,
  item: UpdateItem,
  displayBody: Schema.optionalKey(Schema.String),
  supersededBy: Schema.optionalKey(Schema.String),
})
export const PublishedOwnerStep = Schema.Struct({
  ...PublishedFields,
  item: OwnerStepItem,
})
export const VetoReceipt = Schema.Struct({
  version: Schema.Literal(1),
  source: Schema.String,
  event: Schema.Number,
  at: Timestamp,
  item: Identifier,
  revision: Schema.Number,
  decision: Text,
  deadline: Timestamp,
  session: Schema.String,
  late: Schema.Boolean,
  delivery: Schema.Literals(['pending', 'delivered', 'failed']),
  detail: Schema.String,
  acknowledgment: Schema.Literals([
    'none',
    'acknowledged',
    'stopped',
    'continued',
  ]),
  response: Schema.String,
})
export const PublishedDecision = Schema.Struct({
  ...PublishedFields,
  item: DecisionItem,
  window: Schema.Literals(['open', 'expired']),
  vetoes: Schema.Array(VetoReceipt),
})
export const PublishedBlocker = Schema.Struct({
  ...PublishedFields,
  item: BlockerItem,
  state: Schema.Literals(['blocked', 'clear', 'unknown']),
  checkedAt: Schema.NullOr(Timestamp),
  detail: Schema.String,
  proof: Schema.optionalKey(Link),
})

export const channelItemKey = (
  source: string,
  item: string,
  revision: number,
): string => JSON.stringify([source, item, revision])

export const ownerWorkCounts = (
  snapshot: Readonly<{
    ownerSteps?: ReadonlyArray<typeof PublishedOwnerStep.Type>
    decisions?: ReadonlyArray<typeof PublishedDecision.Type>
  }>,
): Readonly<{ actions: number; provisional: number }> => ({
  actions: (snapshot.ownerSteps ?? []).filter(
    entry => entry.item.progress.state === 'open',
  ).length,
  provisional: (snapshot.decisions ?? []).filter(
    entry => entry.item.resolution.state === 'provisional',
  ).length,
})
