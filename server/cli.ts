import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  FORMAT_VERSION,
  type Snapshot,
  isWholeTarget,
  replyText,
} from '../src/domain'
import { ContextUnavailable, readSubmission } from './answerReceipts'
import { publishUpdate } from './channel'
import { newsSince, runOutbox } from './outbox'
import { readRemotes, writeRemotes } from './remote'
import { readPage } from './squad'
import {
  ROOT,
  events,
  getGrill,
  loadGrill,
  open,
  replyToGrill,
  reviseGrill,
  retireGrill,
  restoreGrill,
  snapshot,
} from './store'

const BASE = `http://127.0.0.1:${process.env.GF_PORT ?? 4317}`

const usage = `gf: grill-flow's agent-side commands

  gf up                                start the server unless it already answers
  gf load <grill.json>                 load or replace a grill
  gf retire <grill-id> --reason <text>  hide a source grill, keeping its history
  gf restore <grill-id>                show a retired source grill again
  gf state <grill-id>                  the reply as it stands, plus asks waiting for an answer
  gf revise <grill-id> <step-id | part:<part-id> | card:<card> | run> --file <path> [--ask <id>] [--kind rewrite|comment]
                                       rewrite a step's prose (paragraphs split by blank lines),
                                       or reply with a comment; a concept takes comments only
  gf reply <grill-id> --file <path>    after a Send arrives: tell the user what you decided and
                                       what comes next; the page shows it as your reply
  gf item <source-grill> --file <path> publish a versioned update without creating a question
  gf events <grill-id> [--since <id>]  the raw event log, one JSON line each
  gf grant --version                 probe immutable answer readback format
  gf grant <source-grill> <send-id>    read a captured submission; does not classify authority
                                      cite the canonical member grill + submitted event id,
                                      never the shared page or its sent event
                                      only answers[].context/key/own/note are page words;
                                      message and lines are not authority in v1
  gf wait <grill-id> [--since <id>]    wait for new asks or a sent reply, print them, exit
  gf remote add <machine> <outbox>     pull grills an agent on that machine writes to its outbox
  gf remote ls | rm <machine>          list or drop the outboxes this server pulls

  With GF_OUTBOX=<folder>, load, revise, reply, state, events and wait work on that folder instead,
  for an agent on a machine whose grills a server elsewhere pulls (gf remote add there).`

const flag = (
  args: ReadonlyArray<string>,
  name: string,
): string | undefined => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

const fail = (message: string, code = 2): never => {
  console.error(message)
  process.exit(code)
}

const [command, ...args] = process.argv.slice(2)

if (command === 'grant' && args[0] === '--version') {
  console.log(JSON.stringify({ versions: [1] }))
  process.exit(0)
}

const outbox = process.env.GF_OUTBOX
if (outbox !== undefined && outbox !== '') {
  await runOutbox(outbox, command, args, usage)
  process.exit(0)
}

const db = open()

const requireGrill = (id: string | undefined) =>
  readPage(db, id ?? '')?.state.grill ?? fail(`no grill ${id}`)

const answers = (): Promise<boolean> =>
  fetch(`${BASE}/api/build`).then(
    response => response.ok,
    () => false,
  )

switch (command) {
  case 'item': {
    const grill =
      getGrill(db, args[0] ?? '') ??
      fail('An item belongs to a canonical source grill.')
    const result = publishUpdate(
      db,
      grill,
      JSON.parse(readFileSync(flag(args, '--file') ?? fail(usage), 'utf8')),
    )
    if (result.ok) {
      console.log(`published update on ${grill.id}, event ${result.event}`)
    } else {
      fail(result.reason)
    }
    break
  }
  case 'grant': {
    const source = args[0] ?? fail(usage)
    const send = Number(args[1])
    if (!getGrill(db, source) || !Number.isSafeInteger(send) || send <= 0) {
      fail(
        'Readback requires a canonical source grill and positive submission event ID.',
      )
    }
    try {
      const receipt = readSubmission(db, source, send)
      if (
        receipt.answers.length === 0 ||
        receipt.answers.some(
          answer => answer.context === null || answer.answerEvent === null,
        )
      ) {
        fail(
          'Required answer context is unavailable; legacy and message-only sends cannot supply this readback.',
          3,
        )
      }
      console.log(JSON.stringify(receipt))
    } catch (error) {
      if (error instanceof ContextUnavailable) {
        fail(error.message, 3)
      }
      fail(
        error instanceof Error ? error.message : 'Submission readback failed.',
      )
    }
    break
  }
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
        'env',
        ...[
          'GF_PORT',
          'GF_DB',
          'GF_DIST',
          'GF_PREVIEW',
          'GF_POLL_REMOTES',
          'GF_SESSION',
          'GF_MAINTAINER_SESSION',
        ].flatMap(name =>
          process.env[name] === undefined
            ? []
            : [`${name}=${process.env[name]}`],
        ),
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
    const page = readPage(db, grill.id)!
    if (page.state.retirement !== undefined) {
      console.log(`Retired: ${page.state.retirement.reason}\n`)
    }
    const printWaiting = (state: Snapshot) => {
      const waiting = state.asks.filter(ask => !ask.answered)
      if (waiting.length > 0) {
        console.log('\nAsks waiting for an answer:')
        waiting.forEach(ask =>
          console.log(`  ask ${ask.id} on ${ask.stepId}: ${ask.text}`),
        )
      }
    }
    const printState = (state: Snapshot) => {
      console.log(replyText(state.grill, state.answers, state.notes, state.own))
      printWaiting(state)
    }
    if (page.members.length === 0) {
      printState(page.state)
    } else {
      console.log(`${grill.id}: ${page.members.length} member sections`)
      page.members.forEach(({ state }) => {
        console.log(
          `\n${state.grill.squad!.section} (${state.grill.id}, ${state.grill.session || 'no session'})`,
        )
        printState(state)
      })
      printWaiting(snapshot(db, grill))
    }
    break
  }
  case 'reply': {
    const grill = requireGrill(args[0])
    const result = replyToGrill(
      db,
      grill,
      readFileSync(flag(args, '--file') ?? fail(usage), 'utf8'),
    )
    if (!result.ok) {
      fail(result.reason)
    } else {
      console.log(
        `reply ${result.id} on ${grill.id}; the open page shows it within a few seconds`,
      )
    }
    break
  }
  case 'revise': {
    const grill = requireGrill(args[0])
    const stepId = args[1] ?? fail(usage)
    const kind =
      flag(args, '--kind') ?? (isWholeTarget(stepId) ? 'comment' : 'rewrite')
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
  case 'retire':
  case 'restore': {
    const id = args[0] ?? fail(usage)
    const grill = getGrill(db, id) ?? fail(`no source grill ${id}`)
    const result =
      command === 'retire'
        ? retireGrill(db, grill, flag(args, '--reason') ?? '')
        : restoreGrill(db, grill)
    if (!result.ok) {
      fail(result.reason)
    }
    console.log(`${command === 'retire' ? 'retired' : 'restored'} ${id}`)
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
