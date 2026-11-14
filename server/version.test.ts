import { expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const versionOf = (path: string): unknown =>
  JSON.parse(readFileSync(path, 'utf8')).version

// A release tags package.json's version; agents run the plugin's (docs/adr/0035).
it('keeps the app and the plugin on one version', () => {
  expect(versionOf('plugin/.claude-plugin/plugin.json')).toBe(
    versionOf('package.json'),
  )
})
