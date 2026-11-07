import { GRILL_FLOW_TARGET, isWholeTarget } from '../src/domain'
import { ROOT } from './store'

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
