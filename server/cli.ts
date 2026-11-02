import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { replyText, FORMAT_VERSION } from '../src/domain'
import { askMessage } from './messages'
import {
  ROOT,
  appendEvent,
  events,
  getGrill,
  loadGrill,
  open,
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
  gf wait <grill-id> [--since <id>]    wait for new asks or a sent reply, print them, exit`

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

const db = open()
const [command, ...args] = process.argv.slice(2)

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
    const isConcept = stepId.startsWith('part:')
    if (
      isConcept
        ? !grill.parts.some(part => `part:${part.id}` === stepId)
        : !grill.steps.some(step => step.id === stepId)
    ) {
      fail(`no step or concept ${stepId} in ${grill.id}`)
    }
    const kind = flag(args, '--kind') ?? (isConcept ? 'comment' : 'rewrite')
    if (kind !== 'rewrite' && kind !== 'comment') {
      fail('--kind is rewrite or comment')
    }
    if (isConcept && kind === 'rewrite') {
      fail('a concept takes a comment; rewrite a step by its own id')
    }
    const askFlag = flag(args, '--ask')
    if (
      askFlag &&
      !snapshot(db, grill).asks.some(
        ask => ask.id === Number(askFlag) && ask.stepId === stepId,
      )
    ) {
      fail(`no ask ${askFlag} on ${stepId}`)
    }
    const text = readFileSync(
      flag(args, '--file') ?? fail(usage),
      'utf8',
    ).trim()
    const id = appendEvent(db, grill.id, 'revised', {
      stepId,
      askId: askFlag ? Number(askFlag) : null,
      kind,
      text,
    })
    console.log(
      `revision ${id} on ${stepId} (${kind}); the open page picks it up within a few seconds`,
    )
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
      const news = fresh.flatMap(event => {
        const payload = JSON.parse(event.payload) as Record<string, unknown>
        if (event.kind === 'asked' && !answered.has(event.id)) {
          return [
            askMessage(
              grill.id,
              String(payload.stepId),
              event.id,
              String(payload.text),
            ),
          ]
        }
        if (event.kind === 'sent' && payload.what === 'answers') {
          return [String(payload.text)]
        }
        return []
      })
      if (news.length > 0) {
        console.log(news.join('\n\n'))
        console.log(
          `\nnext: bun run --cwd ${ROOT} gf wait ${grill.id} --since ${fresh.at(-1)?.id ?? since}`,
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
