import { afterEach, expect, it } from 'bun:test'
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const guard = resolve('plugin/hooks/page-write-guard.py')
const installer = resolve('scripts/install-page-write-guard.sh')
const checkout = '/synthetic/repos/rbrtbn/grill-flow'
const folders = new Set<string>()
afterEach(() => {
  folders.forEach(path => rmSync(path, { recursive: true, force: true }))
  folders.clear()
})
const folder = () => {
  const path = mkdtempSync(join(tmpdir(), 'grill-guard-'))
  folders.add(path)
  return path
}
const call = async (argv: Array<string>, input: string, env = process.env) => {
  const child = Bun.spawn(argv, {
    stdin: new Blob([input]),
    stdout: 'pipe',
    stderr: 'pipe',
    env,
  })
  const [code, out, error] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { code, out, error }
}
const payload = (command: string, cwd = checkout) => ({
  hook_event_name: 'PreToolUse',
  tool_name: 'Bash',
  cwd,
  tool_input: { command },
})
const classify = async (command: string, cwd = checkout) => {
  const result = await call(
    ['python3', guard],
    JSON.stringify(payload(command, cwd)),
  )
  expect(result.code).toBe(0)
  expect(result.error).toBe('')
  expect(result.out).not.toContain(command)
  return result.out.trim() === ''
    ? null
    : JSON.parse(result.out).hookSpecificOutput
}

it.each([
  'curl -X POST http://127.0.0.1:4317/api/grills/fake/events',
  'curl --request=PATCH http://localhost:4317/api/grills/fake/events',
  'curl -dfoo http://localhost:4317/api/grills/fake/send',
  'curl -sSd @fake.json http://localhost:4317/api/grills/fake/send',
  'curl --json={"fake":true} http://localhost:4317/api/grills/fake/send',
  'curl -Fanswer=fake http://localhost:4317/api/grills/fake/send',
  'curl -Tfake http://localhost:4317/fake',
  'http POST localhost:4317/api/grills/fake/send answer=fake',
  'python3 -c "import requests; requests.post(\'http://localhost:4317/fake\')"',
  "bun -e \"fetch('http://localhost:4317/fake', {method: 'DELETE'})\"",
  'curl -X "$METHOD" http://localhost:4317/fake',
  'cat data/token',
  'head -c 100 ./data/token',
  'cat ~/repos/rbrtbn/grill-flow/data/token',
  'bun -e "readFileSync(\'/synthetic/repos/rbrtbn/grill-flow/data/token\')"',
  'sqlite3 data/grill-flow.sqlite "SELECT * FROM events"',
  'sqlite3 data/grill-flow.sqlite "DELETE FROM events"',
  'bun -e "new Database(\'data/grill-flow.sqlite\')"',
  'bun -e "new Database(\'data/grill-flow.sqlite\', {readonly:false})"',
  'python3 -c "sqlite3.connect(\'file:data/grill-flow.sqlite?mode=ro\', uri=False)"',
  'sqlite3 -readonly data/grill-flow.sqlite ".open data/grill-flow.sqlite"',
  'sqlite3 -readonly data/grill-flow.sqlite "SELECT 1"; sqlite3 data/grill-flow.sqlite',
  "bun -e \"new Database('data/grill-flow.sqlite',{readonly:true}); new Database('data/grill-flow.sqlite')\"",
  'rm data/grill-flow.sqlite-wal',
  'sqlite3 -uri "file:data/grill-flow.sqlite?mode=ro&mode=rw" "DELETE FROM events"',
  'python3 -c "sqlite3.connect(\'file:data/grill-flow.sqlite?mode=ro&mode=rw\', uri=True)"',
  'printf fake > data/grill-flow.sqlite-shm',
  'cat << EOF\ncurl -X POST http://localhost:4317/fake\nEOF',
])('refuses visible protected command %s', async command => {
  expect(await classify(command)).toMatchObject({
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
  })
})

it.each([
  'curl -fsS http://127.0.0.1:4317/api/build',
  'curl --request GET http://localhost:4317/g/fake',
  'curl -XHEAD http://localhost:4317/api/build',
  'curl -d fake https://example.test/elsewhere',
  'test -e data/token',
  '[ -f data/token ]',
  'stat data/token',
  'sqlite3 -readonly data/grill-flow.sqlite "SELECT * FROM events"',
  'sqlite3 -uri "file:data/grill-flow.sqlite?mode=ro" "SELECT 1"',
  'sqlite3 -uri "file:data/grill-flow.sqlite?mode=ro&cache=shared" "SELECT 1; SELECT 2"',
  'bun -e "new Database(\'data/grill-flow.sqlite\', {readonly:true})"',
  'python3 -c "sqlite3.connect(\'file:data/grill-flow.sqlite?mode=ro\', uri=True)"',
  "python3 -c \"open('data/grill-flow.sqlite', 'rb')\"",
  'bun run gf events fake',
  'bun run gf state fake',
  'bun run gf grant fake 42',
  'bun run gf grant --version',
  'sqlite3 /synthetic/other.sqlite "SELECT 1"',
  'bun /synthetic/indirect-script.ts',
])('leaves allowed or out-of-boundary command %s undecided', async command => {
  expect(await classify(command)).toBeNull()
})

it('scopes relative token paths while refusing qualified paths outside the checkout', async () => {
  expect(await classify('cat data/token', '/synthetic/other')).toBeNull()
  expect(
    await classify('cat ../grill-flow/data/token', '/synthetic/other'),
  ).toMatchObject({ permissionDecision: 'deny' })
  expect(await classify('test -e data/token; cat data/token')).toMatchObject({
    permissionDecision: 'deny',
  })
})

it.each([
  '',
  '{',
  '[]',
  '{}',
  '{"tool_name":"Bash"}',
  JSON.stringify({ ...payload('echo safe'), cwd: 'relative' }),
  JSON.stringify(payload('echo "unfinished')),
  JSON.stringify(payload('echo\u0000bad')),
  'x'.repeat(1_048_577),
])('fails closed without echoing malformed input', async raw => {
  const result = await call(['python3', guard], raw)
  expect(result.code).toBe(0)
  expect(result.error).toBe('')
  expect(JSON.parse(result.out)).toEqual({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason:
        'Grill-flow guard refused malformed hook input.',
    },
  })
})

it('does not inspect other tools, execute command text or expose a command sentinel', async () => {
  expect(
    await call(['python3', guard], JSON.stringify({ tool_name: 'Read' })),
  ).toEqual({ code: 0, out: '', error: '' })
  const dir = folder(),
    marker = join(dir, 'should-not-exist'),
    secret = 'FAKE_COMMAND_SENTINEL'
  const result = await call(
    ['python3', guard],
    JSON.stringify(
      payload(`touch ${marker}; curl -d ${secret} http://localhost:4317/fake`),
    ),
  )
  expect(result.out + result.error).not.toContain(secret)
  expect(existsSync(marker)).toBe(false)
  const allowed = await call(
    ['python3', guard],
    JSON.stringify(payload(`touch ${marker}`)),
  )
  expect(allowed.out).toBe('')
  expect(existsSync(marker)).toBe(false)
})

const installFixture = (version = '2.1.319') => {
  const dir = folder(),
    account = join(dir, 'account'),
    bin = join(dir, 'bin')
  mkdirSync(account)
  mkdirSync(bin)
  const cli = join(bin, 'claude')
  writeFileSync(
    cli,
    `#!/bin/sh\n[ "$1" = '--version' ] || exit 2\nprintf '%s\\n' '${version} (Claude Code)'\n`,
  )
  chmodSync(cli, 0o700)
  return {
    dir,
    account,
    settings: join(account, 'settings.json'),
    env: {
      ...process.env,
      CLAUDE_CONFIG_DIR: account,
      PATH: bin + ':' + process.env.PATH,
    },
  }
}

it('keeps packaging inactive and merges one failure-blocking hook only on explicit apply', async () => {
  const f = installFixture(),
    secret = 'FAKE_SETTINGS_SENTINEL'
  const previous = {
    env: { PRIVATE_EXAMPLE: secret },
    hooks: {
      PreToolUse: [
        {
          matcher: 'Read',
          hooks: [{ type: 'command', command: 'existing-reader' }],
        },
      ],
      Stop: [],
    },
  }
  writeFileSync(f.settings, JSON.stringify(previous))
  expect(existsSync(resolve('plugin/hooks/hooks.json'))).toBe(false)
  const example = JSON.parse(
    readFileSync('plugin/hooks/claude-hooks.example.json', 'utf8'),
  )
  expect(example.hooks.PreToolUse[0].hooks[0]).toMatchObject({
    timeout: 5,
    onFailure: 'block',
  })
  const preview = await call(['bash', installer], '', f.env)
  expect(preview.code).toBe(0)
  expect(preview.out).toContain('Dry run')
  expect(JSON.parse(readFileSync(f.settings, 'utf8'))).toEqual(previous)
  expect(readdirSync(f.account)).toEqual(['settings.json'])
  const applied = await call(['bash', installer, '--apply'], '', f.env)
  expect(applied.code).toBe(0)
  expect(preview.out + applied.out + applied.error).not.toContain(secret)
  const settings = JSON.parse(readFileSync(f.settings, 'utf8'))
  expect(settings.env).toEqual(previous.env)
  expect(settings.hooks.Stop).toEqual([])
  expect(settings.hooks.PreToolUse[0]).toEqual(previous.hooks.PreToolUse[0])
  const installed = settings.hooks.PreToolUse[1]
  expect(installed.matcher).toBe('Bash')
  expect(installed.hooks[0]).toMatchObject({
    type: 'command',
    timeout: 5,
    onFailure: 'block',
  })
  expect(readFileSync(installed.hooks[0].args[0], 'utf8')).toBe(
    readFileSync(guard, 'utf8'),
  )
  expect(statSync(f.settings).mode & 0o777).toBe(0o600)
  const backups = readdirSync(f.account).filter(name => name.includes('backup'))
  expect(backups).toHaveLength(1)
  expect(
    JSON.parse(readFileSync(join(f.account, backups[0]!), 'utf8')),
  ).toEqual(previous)
  const before = readFileSync(f.settings, 'utf8')
  const repeated = await call(
    ['bash', installer, '--apply', '--settings', f.settings],
    '',
    f.env,
  )
  expect(repeated.code).toBe(0)
  expect(repeated.out).toContain('already configured')
  expect(readFileSync(f.settings, 'utf8')).toBe(before)
  expect(
    readdirSync(f.account).filter(name => name.includes('backup')),
  ).toEqual(backups)
})

it.each(['2.1.294', 'unknown'])(
  'refuses an unsupported Claude version %s without changing settings',
  async version => {
    const f = installFixture(version)
    writeFileSync(f.settings, '{}')
    const result = await call(['bash', installer, '--apply'], '', f.env)
    expect(result.code).toBe(2)
    expect(readFileSync(f.settings, 'utf8')).toBe('{}')
    expect(readdirSync(f.account)).toEqual(['settings.json'])
  },
)

it.each(['[]', '{', '{"hooks":[]}', '{"hooks":{"PreToolUse":{}}}'])(
  'refuses malformed settings without echoing them or writing a backup',
  async text => {
    const f = installFixture()
    writeFileSync(f.settings, text)
    const result = await call(['bash', installer, '--apply'], '', f.env)
    expect(result.code).toBe(2)
    expect(result.out).toBe('')
    expect(readFileSync(f.settings, 'utf8')).toBe(text)
    expect(readdirSync(f.account)).toEqual(['settings.json'])
  },
)

it('refuses managed symlink settings and guard directories without following them', async () => {
  const f = installFixture(),
    target = join(f.dir, 'managed.json')
  writeFileSync(target, '{}')
  symlinkSync(target, f.settings)
  expect((await call(['bash', installer, '--apply'], '', f.env)).code).toBe(2)
  expect(readFileSync(target, 'utf8')).toBe('{}')
  rmSync(f.settings)
  writeFileSync(f.settings, '{}')
  symlinkSync(f.dir, join(f.account, 'grill-flow-hooks'))
  expect((await call(['bash', installer, '--apply'], '', f.env)).code).toBe(2)
  expect(readFileSync(f.settings, 'utf8')).toBe('{}')
})

it('replaces only its own prior version and requires an explicit account', async () => {
  const f = installFixture()
  const previous = join(
    f.account,
    'grill-flow-hooks',
    'page-write-guard-0123456789abcdef.py',
  )
  const unrelated = {
    matcher: 'Bash',
    hooks: [{ type: 'command', command: 'unrelated' }],
  }
  writeFileSync(
    f.settings,
    JSON.stringify({
      hooks: {
        PreToolUse: [
          unrelated,
          {
            matcher: 'Bash',
            hooks: [{ type: 'command', command: 'python3', args: [previous] }],
          },
        ],
      },
    }),
  )
  expect((await call(['bash', installer, '--apply'], '', f.env)).code).toBe(0)
  const hooks = JSON.parse(readFileSync(f.settings, 'utf8')).hooks.PreToolUse
  expect(hooks).toHaveLength(2)
  expect(hooks[0]).toEqual(unrelated)
  expect(hooks[1].hooks[0].args[0]).not.toBe(previous)
  const result = await call(['bash', installer, '--apply'], '', {
    ...f.env,
    CLAUDE_CONFIG_DIR: '',
  })
  expect(result.code).toBe(2)
  expect(result.error).toContain('Choose an account')
})
