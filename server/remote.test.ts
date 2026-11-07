import { expect, it } from 'bun:test'
import { Schema } from 'effect'
import { readFileSync } from 'node:fs'

import { Grill } from '../src/domain'
import { grillOnMachine } from './remote'

it('qualifies remote question recipients while preserving explicit machine addresses', () => {
  const fixture = Schema.decodeUnknownSync(Grill)(
    JSON.parse(readFileSync('src/fixtures/grill.json', 'utf8')),
  )
  const grill = {
    ...fixture,
    session: 't1',
    steps: fixture.steps.map((step, index) => ({
      ...step,
      question: {
        ...step.question,
        session: index === 0 ? 't2' : index === 1 ? 'other/t3' : ' ',
      },
    })),
  }
  const remote = grillOnMachine(grill, 'homelab')
  expect(remote.session).toBe('homelab/t1')
  expect(remote.steps[0]?.question.session).toBe('homelab/t2')
  expect(remote.steps[1]?.question.session).toBe('other/t3')
  expect(remote.steps[2]?.question.session).toBe(' ')
})
