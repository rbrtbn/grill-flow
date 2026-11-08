import { GRILL_FLOW_TARGET, isWholeTarget } from '../src/domain'
import { ROOT } from './store'

export const pageMessage = (text: string): string =>
  `<grill-flow source="page">\n${text}\n</grill-flow>`

export class InvalidSubmissionSource extends Error {}

export const assertSubmissionSource = (grill: string): void => {
  if (!/^[A-Za-z0-9._-]+$/.test(grill)) {
    throw new InvalidSubmissionSource(
      'Answer delivery requires a source grill ID using only letters, digits, dot, underscore or hyphen.',
    )
  }
}

export const submissionMessage = (
  grill: string,
  send: number,
  text: string,
): string => {
  assertSubmissionSource(grill)
  if (!Number.isSafeInteger(send) || send <= 0) {
    throw new Error('Answer delivery requires a positive submission event ID.')
  }
  // The pair locates immutable readback; delivery text never supplies authority.
  return `<gf grill="${grill}" send="${send}">\n${text}\n</gf>`
}

/**
 * The text an ask arrives as in the agent's terminal, or from `gf wait`. `gf` is how the agent
 * runs the CLI where it is: this checkout here, or its own checkout with its outbox elsewhere.
 */
export const askMessage = (
  grillId: string,
  stepId: string,
  askId: number,
  text: string,
  gf = `bun run --cwd ${ROOT} gf`,
): string =>
  isWholeTarget(stepId)
    ? [
        `[grill-flow] Ask on ${grillId}, ${stepId === GRILL_FLOW_TARGET ? 'about grill-flow' : `the whole ${stepId === 'run' ? 'run' : `${stepId.startsWith('card:') ? 'card' : 'concept'} ${stepId.slice(5)}`}`} (ask ${askId}): ${text}`,
        `Answer it on the page: write your reply to a file, then run`,
        `${gf} revise ${grillId} ${stepId} --ask ${askId} --kind comment --file <path>`,
        `To rewrite a step as well: ${gf} revise ${grillId} <step-id> --kind rewrite --file <path> (omit --ask).`,
      ].join('\n')
    : [
        `[grill-flow] Ask on ${grillId}, step ${stepId} (ask ${askId}): ${text}`,
        `Answer it on the page: write a rewrite of that step's prose, or a comment, to a file, then run`,
        `${gf} revise ${grillId} ${stepId} --ask ${askId} --kind rewrite --file <path>`,
        `(use --kind comment to reply in the conversation instead of rewriting it).`,
      ].join('\n')
