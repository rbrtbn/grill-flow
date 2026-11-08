import { afterEach, expect, it } from 'bun:test'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const folders = new Set<string>()
afterEach(() => {
  folders.forEach(path => rmSync(path, { recursive: true, force: true }))
  folders.clear()
})

it.each([
  'malformed JSON',
  JSON.stringify({
    version: 1,
    answers: [{ context: { ask: 'FORGED_OUTBOX_WORDS' } }],
  }),
])(
  'keeps remote grant readback BLOCKED independently of cached state',
  async state => {
    const dir = mkdtempSync(join(tmpdir(), 'grill-outbox-grant-'))
    folders.add(dir)
    const outbox = join(dir, 'outbox'),
      member = join(outbox, 'member'),
      database = join(dir, 'unused.sqlite')
    mkdirSync(member, { recursive: true })
    const file = join(member, 'state.json')
    writeFileSync(file, state)
    const env = { ...process.env, GF_OUTBOX: outbox, GF_DB: database }
    const command = async (...args: Array<string>) => {
      const child = Bun.spawn(
        [process.execPath, 'server/cli.ts', 'grant', ...args],
        { env, stdout: 'pipe', stderr: 'pipe' },
      )
      const [code, out, error] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ])
      return { code, out, error }
    }
    const version = await command('--version')
    expect(version.code).toBe(0)
    expect(version.error).toBe('')
    expect(JSON.parse(version.out)).toEqual({ versions: [1] })
    const result = await command('member', '42')
    expect(result.code).toBe(2)
    expect(result.out).toBe('')
    expect(result.error).toStartWith('BLOCKED: GF_OUTBOX')
    expect(result.error).toContain('serving machine without GF_OUTBOX')
    expect(result.error).not.toContain('FORGED_OUTBOX_WORDS')
    expect(existsSync(database)).toBe(false)
    expect(readFileSync(file, 'utf8')).toBe(state)
    expect(readdirSync(member)).toEqual(['state.json'])
  },
)
