import type { Database } from 'bun:sqlite'

import type { Grill } from '../src/domain'

export const seedLegacySource = (db: Database, grill: Grill): void => {
  db.run('UPDATE grills SET json = ? WHERE id = ?', [
    JSON.stringify(grill),
    grill.id,
  ])
}
