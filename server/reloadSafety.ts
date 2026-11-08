import { OWN, type Grill, type Snapshot } from '../src/domain'

export class PickedOptionConflict extends Error {}

export const assertPickedOptionsRetained = (
  previous: Pick<Snapshot, 'grill' | 'answers'>,
  next: Grill,
): void => {
  for (const [id, key] of Object.entries(previous.answers)) {
    if (key === OWN) continue
    const old = previous.grill.steps.find(
      step => step.question.id === id,
    )?.question
    // Already removed historical answers remain readable; they are not a new removal.
    if (old === undefined) continue
    const current = next.steps.find(step => step.question.id === id)?.question
    const picked = current?.options.find(option => option.key === key)
    const fail = (reason: string): never => {
      throw new PickedOptionConflict(
        `Reload refused for ${JSON.stringify(next.id)} ${JSON.stringify(id)} pick ${JSON.stringify(key)}: ${reason}. Keep the picked question and option key, or ask the owner to clear or change the answer on the page.`,
      )
    }
    if (current === undefined) fail('the answered question was removed')
    if (picked === undefined)
      fail('the picked option key was removed or changed')
    const original = old.options.find(option => option.key === key)
    if (original === undefined || picked === undefined || current === undefined)
      continue
    const sameWords = (option: { label: string; effect: string }) =>
      option.label === original.label && option.effect === original.effect
    if (
      !sameWords(picked) &&
      current.options.some(
        option =>
          option.key !== key &&
          sameWords(option) &&
          !old.options.some(
            before => before.key === option.key && sameWords(before),
          ),
      )
    ) {
      fail(
        'the picked option moved to a different key while its key was reused',
      )
    }
  }
}
