import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { DATA_DIR } from './store'

// The server reads this file on every snapshot, so `gf maintainer set` takes effect without a
// restart; GF_MAINTAINER_SESSION only seeds it when it is absent (docs/adr/0035).
const MAINTAINER_PATH = join(DATA_DIR, 'maintainer')

export const ADDRESS = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)?$/

export const readMaintainer = (path = MAINTAINER_PATH): string | undefined => {
  const stored = existsSync(path) ? readFileSync(path, 'utf8').trim() : ''
  return stored === '' ? undefined : stored
}

export const writeMaintainer = (
  session: string,
  path = MAINTAINER_PATH,
): void => {
  if (!ADDRESS.test(session)) {
    throw new Error(
      `${session} is not a Herdr address (t7, a name, or machine/t7).`,
    )
  }
  writeFileSync(path, `${session}\n`)
}

export const seedMaintainer = (
  seed: string | undefined,
  path = MAINTAINER_PATH,
): void => {
  const session = seed?.trim() ?? ''
  if (session !== '' && !existsSync(path)) {
    writeMaintainer(session, path)
  }
}

export const clearMaintainer = (path = MAINTAINER_PATH): void =>
  rmSync(path, { force: true })
