import type { AgentReply, Snapshot, Step } from './domain'
import { questionSession } from './domain'

// Where Replies & decisions' content lives now: a reply in its session's thread and on the
// questions it names, a decided line on its answered question.

/**
 * The session a reply to a send came from. A reply carries no session, but agents open it with
 * their section's name ("Owner actions prototypes: …"); that names a source, and the source's
 * questions name the session. Anything else is the lead's.
 */
export const replySession = (snapshot: Snapshot, reply: AgentReply): string => {
  const grill = snapshot.grill
  const heading = reply.text.split('\n')[0]?.replace(/:\s*$/, '').trim() ?? ''
  const source = Object.entries(grill.sources ?? {}).find(
    ([, value]) => value.text.trim() === heading,
  )?.[0]
  const step =
    source === undefined
      ? undefined
      : grill.steps.find(item => item.question.from === source)
  return step === undefined
    ? grill.session
    : questionSession(grill, step.question)
}

/** The latest reply that names this question's key: the agent's word on the answer. */
export const replyOnQuestion = (
  snapshot: Snapshot,
  step: Step,
): AgentReply | undefined => {
  const key = step.question.key
  return key === undefined || key.length < 4
    ? undefined
    : [...(snapshot.replies ?? [])]
        .reverse()
        .find(reply => reply.text.includes(key))
}

/** The decided line for a question, matched by its origin on a squad page or by its id. */
export const decidedLine = (
  snapshot: Snapshot,
  step: Step,
): string | undefined => {
  const origin = snapshot.questionOrigins?.[step.question.id]
  const ids = [
    step.question.id,
    ...(origin === undefined ? [] : [`${origin.grill}::${origin.question}`]),
  ]
  return (snapshot.grill.decided ?? []).find(decision =>
    ids.includes(decision.id),
  )?.text
}
