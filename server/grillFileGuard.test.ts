import { afterEach, beforeEach, expect, it } from 'bun:test'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const guard = resolve('plugin/hooks/grill-file-guard.py')
let checkout = ''
beforeEach(() => {
  checkout = mkdtempSync(join(tmpdir(), 'grill-flow-guard-'))
  mkdirSync(join(checkout, 'server'))
  mkdirSync(join(checkout, 'grills'))
  writeFileSync(join(checkout, 'server/authoring-guide.md'), '# guide\n')
  writeFileSync(join(checkout, 'grills/loaded.json'), '{"id": "loaded"}\n')
})
afterEach(() => rmSync(checkout, { recursive: true, force: true }))

const decide = async (
  tool: string,
  input: Record<string, unknown>,
  env: Record<string, string | undefined> = { GF_OUTBOX: undefined },
  cwd = checkout,
) => {
  const child = Bun.spawn(['python3', guard], {
    stdin: new Blob([
      JSON.stringify({
        hook_event_name: 'PreToolUse',
        tool_name: tool,
        cwd,
        tool_input: input,
      }),
    ]),
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, ...env },
  })
  const [code, out, error] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  expect(code).toBe(0)
  expect(error).toBe('')
  return out.trim() === '' ? null : JSON.parse(out).hookSpecificOutput
}
const bash = (command: string) => decide('Bash', { command })

it.each(['Write', 'Edit', 'MultiEdit'])(
  'denies %s on a loaded grill file and names the gf commands',
  async tool => {
    const denial = await decide(tool, {
      file_path: join(checkout, 'grills/loaded.json'),
    })
    expect(denial).toMatchObject({
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
    })
    expect(denial.permissionDecisionReason).toContain('`gf get loaded`')
    expect(denial.permissionDecisionReason).toContain(
      'gf question add|update|resolve loaded',
    )
    expect(denial.permissionDecisionReason).toContain('gf patch loaded')
    expect(denial.permissionDecisionReason).toContain('--expect-rev <rev>')
  },
)

it('denies a relative path resolved against the session folder', async () => {
  expect(
    await decide('Edit', { file_path: 'grills/loaded.json' }),
  ).toMatchObject({ permissionDecision: 'deny' })
})

it('allows creating a new grill file, and files outside a grill-flow checkout', async () => {
  expect(
    await decide('Write', { file_path: join(checkout, 'grills/new.json') }),
  ).toBeNull()
  const elsewhere = mkdtempSync(join(tmpdir(), 'other-repo-'))
  mkdirSync(join(elsewhere, 'grills'))
  writeFileSync(join(elsewhere, 'grills/loaded.json'), '{}')
  expect(
    await decide('Edit', { file_path: join(elsewhere, 'grills/loaded.json') }),
  ).toBeNull()
  rmSync(elsewhere, { recursive: true, force: true })
  expect(
    await decide('Edit', {
      file_path: join(checkout, 'server/authoring-guide.md'),
    }),
  ).toBeNull()
})

it.each([
  `python3 - << 'EOF'\nimport json\nd = json.load(open('grills/loaded.json'))\nopen('grills/loaded.json', 'w').write(json.dumps(d))\nEOF`,
  `python3 -c "from pathlib import Path; Path('grills/loaded.json').write_text('{}')"`,
  `jq '.round = 3' grills/loaded.json > tmp.json && mv tmp.json grills/loaded.json`,
  `jq '.round = 3' grills/loaded.json | tee grills/loaded.json`,
  `sed -i '' 's/Q7/Q8/' grills/loaded.json`,
  `bun run gf get loaded > grills/loaded.json`,
  `cat > grills/loaded.json << 'EOF'\n{}\nEOF`,
  `node -e "require('fs').writeFileSync('grills/loaded.json', '{}')"`,
  `cp /tmp/edited.json "grills/loaded.json"`,
])('denies a Bash write into a loaded grill file: %s', async command => {
  expect(await bash(command)).toMatchObject({ permissionDecision: 'deny' })
})

it.each([
  'cat grills/loaded.json',
  "jq '.steps | length' grills/loaded.json",
  'jq . grills/loaded.json > /tmp/copy.json',
  `python3 -c "import json; print(json.load(open('grills/loaded.json'))['round'])"`,
  "sed -n '1,20p' grills/loaded.json",
  'cp grills/loaded.json /tmp/backup.json',
  'bun run gf load grills/loaded.json --expect-rev 3 --reason "round 3"',
  `cat > grills/new.json << 'EOF'\n{}\nEOF`,
  'jq . "$FILE" > grills/$ID.json',
  'grep -c Q7 grills/loaded.json 2>/dev/null',
])('leaves a read or a new file alone: %s', async command => {
  expect(await bash(command)).toBeNull()
})

it('stays out of outbox sessions, other tools and malformed input', async () => {
  expect(
    await decide(
      'Edit',
      { file_path: join(checkout, 'grills/loaded.json') },
      { GF_OUTBOX: '/synthetic/outbox' },
    ),
  ).toBeNull()
  expect(
    await decide('Read', { file_path: join(checkout, 'grills/loaded.json') }),
  ).toBeNull()
  expect(
    await decide(
      'Edit',
      { file_path: 'grills/loaded.json' },
      { GF_OUTBOX: undefined },
      'relative',
    ),
  ).toBeNull()
  const child = Bun.spawn(['python3', guard], {
    stdin: new Blob(['{']),
    stdout: 'pipe',
  })
  expect(await child.exited).toBe(0)
  expect(await new Response(child.stdout).text()).toBe('')
})

it('is registered by the plugin for the tools it guards', () => {
  const hooks = JSON.parse(readFileSync('plugin/hooks/hooks.json', 'utf8'))
  expect(hooks.hooks.PreToolUse).toEqual([
    {
      matcher: 'Write|Edit|MultiEdit|Bash',
      hooks: [
        {
          type: 'command',
          command: 'python3 "${CLAUDE_PLUGIN_ROOT}/hooks/grill-file-guard.py"',
          timeout: 5,
        },
      ],
    },
  ])
})
