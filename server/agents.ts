import { Schema } from 'effect'

import type { PageAgent } from '../src/domain'

const Terminal = Schema.Struct({
  address: Schema.String,
  agent: Schema.optionalKey(Schema.NullOr(Schema.String)),
  name: Schema.optionalKey(Schema.NullOr(Schema.String)),
  parent: Schema.optionalKey(Schema.NullOr(Schema.String)),
  state: Schema.String,
  where: Schema.optionalKey(Schema.NullOr(Schema.String)),
})
type Terminal = typeof Terminal.Type
const Listing = Schema.Struct({ terminals: Schema.Array(Terminal) })

export type ListCommand = () => Promise<string>

const AGENT_PROGRAMS = new Set(['claude-code', 'claude', 'codex', 'pi'])
const FRESH_MS = 10_000

const spaceOf = (terminal: Terminal): string =>
  terminal.where?.split(' / ')[0]?.trim() ?? ''

/**
 * The running agents that share a Herdr space with the page's session, the squad's de facto
 * membership while Herdr carries no squad labels (docs/adr/0029). The lead is the one agent
 * whose parent is outside that set.
 */
export const pageAgents = (
  terminals: ReadonlyArray<Terminal>,
  session: string,
): ReadonlyArray<PageAgent> => {
  const anchor = terminals.find(terminal => terminal.address === session)
  const space = anchor === undefined ? '' : spaceOf(anchor)
  if (space === '') {
    return []
  }
  const members = terminals.filter(
    terminal =>
      spaceOf(terminal) === space &&
      terminal.state === 'live' &&
      AGENT_PROGRAMS.has(terminal.agent ?? ''),
  )
  const addresses = new Set(members.map(member => member.address))
  const roots = members.filter(
    member => member.parent == null || !addresses.has(member.parent),
  )
  const lead =
    roots.length === 1
      ? roots[0]
      : roots.find(root => /lead/i.test(root.name ?? ''))
  return members
    .map(member => ({
      address: member.address,
      name: member.name ?? '',
      program: member.agent ?? '',
      lead: member === lead,
    }))
    .sort(
      (a, b) =>
        Number(b.lead) - Number(a.lead) || a.address.localeCompare(b.address),
    )
}

/** Reads Herdr's listing in the background so a page poll never waits on `hc`. */
export const createAgentLister = (
  list: ListCommand,
  now: () => number = Date.now,
) => {
  const state: {
    terminals: ReadonlyArray<Terminal> | undefined
    next: number
    pending: boolean
  } = { terminals: undefined, next: 0, pending: false }
  const refresh = (): void => {
    state.pending = true
    void list()
      .then(
        text => Schema.decodeUnknownSync(Listing)(JSON.parse(text)).terminals,
        () => state.terminals,
      )
      .catch(() => state.terminals)
      .then(terminals => {
        state.terminals = terminals
        state.next = now() + FRESH_MS
        state.pending = false
      })
  }
  return (session: string): ReadonlyArray<PageAgent> | undefined => {
    if (!state.pending && state.next <= now()) {
      refresh()
    }
    return state.terminals === undefined
      ? undefined
      : pageAgents(state.terminals, session)
  }
}

export const listTerminalsCommand: ListCommand = async () => {
  const child = Bun.spawn(['hc', 'ls', '--all', '--json'], {
    stdout: 'pipe',
    stderr: 'ignore',
  })
  const [code, stdout] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
  ])
  if (code !== 0) {
    throw new Error(`hc ls exited ${code}`)
  }
  return stdout
}
