import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { replyText, FORMAT_VERSION } from '../src/domain'
import { newsSince, runOutbox } from './outbox'
import { readRemotes, writeRemotes } from './remote'
import {
  ROOT,
  events,
  getGrill,
  loadGrill,
  open,
  reviseGrill,
  snapshot,
} from './store'

const BASE = `http://127.0.0.1:${process.env.GF_PORT ?? 4317}`

const usage = `gf: grill-flow's agent-side commands

  gf up                                start the server unless it already answers
  gf load <grill.json>                 load or replace a grill
  gf state <grill-id>                  the reply as it stands, plus asks waiting for an answer
  gf revise <grill-id> <step-id | part:<part-id>> --file <path> [--ask <id>] [--kind rewrite|comment]
                                       rewrite a step's prose (paragraphs split by blank lines),
                                       or reply with a comment; a concept takes comments only
  gf events <grill-id> [--since <id>]  the raw event log, one JSON line each
  gf wait <grill-id> [--since <id>]    wait for new asks or a sent reply, print them, exit
  gf remote add <machine> <outbox>     pull grills an agent on that machine writes to its outbox
  gf remote ls | rm <machine>          list or drop the outboxes this server pulls

  With GF_OUTBOX=<folder>, load, revise, state, events and wait work on that folder instead,
  for an agent on a machine whose grills a server elsewhere pulls (gf remote add there).`

const flag = (
  args: ReadonlyArray<string>,
  name: string,
): string | undefined => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

const fail = (message: string): never => {
  console.error(message)
  process.exit(2)
}

const [command, ...args] = process.argv.slice(2)

const outbox = process.env.GF_OUTBOX
if (outbox !== undefined && outbox !== '') {
  await runOutbox(outbox, command, args, usage)
  process.exit(0)
}

const db = open()

const requireGrill = (id: string | undefined) =>
  getGrill(db, id ?? '') ?? fail(`no grill ${id}`)

const answers = (): Promise<boolean> =>
  fetch(`${BASE}/api/build`).then(
    response => response.ok,
    () => false,
  )

switch (command) {
  case 'up': {
    if (await answers()) {
      console.log(`grill-flow is up at ${BASE}`)
      break
    }
    if (!existsSync(join(ROOT, 'dist', 'index.html'))) {
      Bun.spawnSync(['bunx', 'vite', 'build', '--logLevel', 'warn'], {
        cwd: ROOT,
        stdout: 'inherit',
        stderr: 'inherit',
      })
    }
    // Under hc it outlives the agent that started it, and `hc read grill-flow` shows its log.
    Bun.spawnSync(
      [
        'hc',
        'run',
        '--bg',
        '--outlive-parent',
        '--name',
        'grill-flow',
        '--cwd',
        ROOT,
        'bun',
        'run',
        'serve',
      ],
      { stdout: 'ignore', stderr: 'inherit' },
    )
    for (let tries = 0; tries < 40 && !(await answers()); tries += 1) {
      await Bun.sleep(250)
    }
    if (!(await answers())) {
      fail('grill-flow did not start; read its log with `hc read grill-flow`')
    }
    console.log(`grill-flow is up at ${BASE}`)
    break
  }
  case 'load': {
    const grill = loadGrill(
      db,
      JSON.parse(readFileSync(args[0] ?? fail(usage), 'utf8')),
    )
    console.log(
      `loaded ${grill.id}: ${grill.steps.length} steps, ${BASE}/g/${grill.id}`,
    )
    if ((grill.version ?? 1) > FORMAT_VERSION) {
      console.warn(
        `grill format ${grill.version} is newer than this checkout's ${FORMAT_VERSION}: the page shows what it knows; pull grill-flow for the rest`,
      )
    }
    break
  }
  case 'state': {
    const grill = requireGrill(args[0])
    const state = snapshot(db, grill)
    console.log(replyText(grill, state.answers, state.notes, state.own))
    const waiting = state.asks.filter(ask => !ask.answered)
    if (waiting.length > 0) {
      console.log('\nAsks waiting for an answer:')
      waiting.forEach(ask =>
        console.log(`  ask ${ask.id} on ${ask.stepId}: ${ask.text}`),
      )
    }
    break
  }
  case 'revise': {
    const grill = requireGrill(args[0])
    const stepId = args[1] ?? fail(usage)
    const kind =
      flag(args, '--kind') ??
      (stepId.startsWith('part:') ? 'comment' : 'rewrite')
    if (kind !== 'rewrite' && kind !== 'comment') {
      fail('--kind is rewrite or comment')
    }
    const askFlag = flag(args, '--ask')
    const result = reviseGrill(db, grill, {
      stepId,
      askId: askFlag ? Number(askFlag) : null,
      kind: kind === 'rewrite' ? 'rewrite' : 'comment',
      text: readFileSync(flag(args, '--file') ?? fail(usage), 'utf8'),
    })
    if (!result.ok) {
      fail(result.reason)
    } else {
      console.log(
        `revision ${result.id} on ${stepId} (${kind}); the open page picks it up within a few seconds`,
      )
    }
    break
  }
  case 'remote': {
    const [action, machine, dir] = args
    const remotes = readRemotes()
    if (action === 'add' && machine && dir) {
      writeRemotes([
        ...remotes.filter(remote => remote.machine !== machine),
        { machine, dir },
      ])
      console.log(
        `pulling ${machine}:${dir}; the server picks it up on its next pass, within a few seconds`,
      )
    } else if (action === 'rm' && machine) {
      writeRemotes(remotes.filter(remote => remote.machine !== machine))
      console.log(`stopped pulling ${machine}`)
    } else if (action === 'ls' || action === undefined) {
      remotes.forEach(remote => console.log(`${remote.machine}  ${remote.dir}`))
    } else {
      fail(usage)
    }
    break
  }
  case 'events': {
    const grill = requireGrill(args[0])
    events(db, grill.id, Number(flag(args, '--since') ?? 0)).forEach(event =>
      console.log(
        JSON.stringify({ ...event, payload: JSON.parse(event.payload) }),
      ),
    )
    break
  }
  case 'wait': {
    // For a session hc can't reach, such as Claude desktop: run it in the background and
    // answer what it prints, then run the `next:` line it ends with.
    const grill = requireGrill(args[0])
    const latest = () => events(db, grill.id).at(-1)?.id ?? 0
    const since = Number(flag(args, '--since') ?? latest())
    for (;;) {
      const fresh = events(db, grill.id, since)
      const answered = new Set(
        snapshot(db, grill)
          .asks.filter(ask => ask.answered)
          .map(ask => ask.id),
      )
      const news = newsSince(
        grill.id,
        fresh.map(event => ({
          id: event.id,
          kind: event.kind,
          payload: JSON.parse(event.payload) as Record<string, unknown>,
        })),
        answered,
      )
      if (news.lines.length > 0) {
        console.log(news.lines.join('\n\n'))
        console.log(
          `\nnext: bun run --cwd ${ROOT} gf wait ${grill.id} --since ${news.lastId}`,
        )
        break
      }
      await Bun.sleep(1000)
    }
    break
  }
  default:
    console.log(usage)
}
