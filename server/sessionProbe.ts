import type { SessionState } from '../src/domain'

export type GetCommand = (
  address: string,
) => Promise<{ code: number; stdout: string; stderr: string }>

const FRESH_MS = 15_000

/** What `hc get` says about one address; undefined when Herdr gave no answer either way. */
export const sessionStateOf = (
  code: number,
  stdout: string,
  stderr: string,
): SessionState | undefined => {
  if (code === 0) {
    try {
      const terminal: unknown = JSON.parse(stdout)
      return typeof terminal === 'object' &&
        terminal !== null &&
        'state' in terminal &&
        terminal.state === 'live'
        ? 'live'
        : 'stopped'
    } catch {
      return undefined
    }
  }
  return /"kind"\s*:\s*"not_found"/.test(stderr + stdout)
    ? 'missing'
    : undefined
}

/**
 * Herdr's view of a session, refreshed in the background so a page poll never waits on `hc`.
 * The first read of an address answers undefined while its probe runs.
 */
export const createSessionProbe = (
  get: GetCommand,
  now: () => number = Date.now,
) => {
  const cache = new Map<
    string,
    { value: SessionState | undefined; next: number; pending: boolean }
  >()
  const refresh = (address: string): void => {
    const previous = cache.get(address)
    cache.set(address, {
      value: previous?.value,
      next: previous?.next ?? 0,
      pending: true,
    })
    void get(address)
      .then(
        ({ code, stdout, stderr }) =>
          sessionStateOf(code, stdout, stderr) ?? previous?.value,
        () => previous?.value,
      )
      .then(value =>
        cache.set(address, { value, next: now() + FRESH_MS, pending: false }),
      )
  }
  return (address: string): SessionState | undefined => {
    const entry = cache.get(address)
    if (entry === undefined || (!entry.pending && entry.next <= now())) {
      refresh(address)
    }
    return entry?.value
  }
}

export const getSessionCommand: GetCommand = async address => {
  const child = Bun.spawn(['hc', 'get', address], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { code, stdout, stderr }
}
