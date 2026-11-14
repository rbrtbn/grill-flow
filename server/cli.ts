import { Schema } from 'effect'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  FORMAT_VERSION,
  type Snapshot,
  isWholeTarget,
  replyText,
} from '../src/domain'
import { ContextUnavailable, readSubmission } from './answerReceipts'
import {
  EXPECT_REV_REQUIRED,
  REASON_REQUIRED,
  expectRevWarning,
  guideText,
  guideView,
  isAuthoringCommand,
  needsReason,
  printAuthoringWarning,
  reasonWarning,
  writeProvenance,
} from './authoring'
import { publishItem } from './channel'
import { publishDrawing } from './drawings'
import {
  EDIT_USAGE,
  StaleRev,
  loadChecked,
  parseExpectRev,
  readJsonFile,
  runEditCommand,
  unknownKeyWarning,
} from './grillEdit'
import {
  grillRevisions,
  questionHistory,
  questionLines,
  revisionLines,
} from './history'
import { newsSince, runOutbox } from './outbox'
import { readRemotes, writeRemotes } from './remote'
import { readPage } from './squad'
import {
  ROOT,
  appendEvent,
  events,
  getGrill,
  open,
  replyToGrill,
  restoreGrill,
  retireGrill,
  reviseGrill,
  snapshot,
} from './store'

const BASE = `http://127.0.0.1:${process.env.GF_PORT ?? 4317}`

const usage = `gf: grill-flow's agent-side commands

  gf --skill [--if-newer-than <revision>] current complete authoring guide (read-only)
  Authoring writes accept --skill-revision <revision-read>; missing/stale revisions warn during migration.
  load, item, draw, restore and revise --kind rewrite take --reason <why>, kept for gf history;
  missing reasons warn (GF_REQUIRE_REASON=1 refuses them). --session <address> names the
  author, default $HC_TERMINAL_ID.

  gf up                                start the server unless it already answers
  gf load <grill.json> [--solo] [--expect-rev <rev>]
                                       load or replace a grill; without a squad field it joins
                                       the GF_SQUAD page, and --solo keeps it a page of its own.
                                       --expect-rev refuses (exit 3) when another write landed
                                       since <rev>; missing, it warns (GF_REQUIRE_EXPECT_REV=1
                                       refuses). Unknown keys anywhere are errors.
${EDIT_USAGE}
  gf handover <page> --session <address> --reason <text> [--member <grill-id>]
                                       make <address> the page's lead; deliveries still naming
                                       the previous lead go to it
  gf retire <grill-id> --reason <text>  hide a source grill, keeping its history
  gf restore <grill-id>                show a retired source grill again
  gf history <grill-id> [question-id] [--json]
                                       every load with its time, author and reason; for a
                                       question, what changed in each revision that touched it
  gf state <grill-id>                  the reply as it stands, plus asks waiting for an answer
  gf revise <grill-id> <step-id | part:<part-id> | card:<card> | run> --file <path> [--ask <id>] [--kind rewrite|comment]
                                       rewrite a step's prose (paragraphs split by blank lines),
                                       or reply with a comment; a concept takes comments only
  gf reply <grill-id> --file <path>    after a Send arrives: tell the user what you decided and
                                       what comes next; the page shows it as your reply
  gf draw <source-grill> <question> --request <id> --file <diagram.json> [--previous <n> --revision <n>]
                                      publish compare/flow JSON for a saved drawing request
  gf item <source-grill> --file <path> publish a versioned update, owner step, decision, evidence or blocker
  gf events <grill-id> [--since <id>]  the raw event log, one JSON line each
  gf grant --version                 probe immutable answer readback format
  gf grant <source-grill> <send-id>    read a captured submission; does not classify authority
                                     GF_OUTBOX: BLOCKED (exit 2); read on the serving machine
  gf pilot <init|bind|enqueue|delivery|inspect> --fixture-only --pilot-dir <temporary-dir> ...
  gf inbox --fixture-only --pilot-dir <temporary-dir> --source <id> --thread <id> --fixture <file>
  gf ack --fixture-only --pilot-dir <temporary-dir> --event <id> --fixture <file>
                                     inert fixtures only; no live runtime or delivery is enabled
                                      cite the canonical member grill + submitted event id,
                                      never the shared page or its sent event
                                      only answers[].context/key/own/note are page words;
                                      message and lines are not authority in v1
  gf wait <grill-id> [--since <id>]    wait for new asks or a sent reply, print them, exit
  gf remote add <machine> <outbox>     pull grills an agent on that machine writes to its outbox
  gf remote ls | rm <machine>          list or drop the outboxes this server pulls

  With GF_OUTBOX=<folder>, load, item, draw, revise, reply, state, events and wait use that folder instead,
  for an agent on a machine whose grills a server elsewhere pulls (gf remote add there).
  get, question and patch run on the serving machine only.`

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

const ADDRESS = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)?$/

// The Herdr space this session runs in; squad spaces are named `squad.<...>`.
const herdrSpace = (): string => {
  const address = process.env.HC_TERMINAL_ID
  if (address === undefined || address === '') {
    return ''
  }
  try {
    const child = Bun.spawnSync(['hc', 'get', address], { stderr: 'ignore' })
    const terminal: unknown = JSON.parse(child.stdout.toString())
    const where =
      typeof terminal === 'object' &&
      terminal !== null &&
      'labels' in terminal &&
      typeof terminal.labels === 'object' &&
      terminal.labels !== null &&
      'where' in terminal.labels &&
      typeof terminal.labels.where === 'string'
        ? terminal.labels.where
        : ''
    return where.split(' / ')[0]?.trim() ?? ''
  } catch {
    return ''
  }
}

/** One page per squad: a grill without a squad field joins GF_SQUAD's page unless --solo. */
const withSquadDefault = (raw: unknown, solo: boolean): unknown => {
  if (solo || typeof raw !== 'object' || raw === null || 'squad' in raw) {
    return raw
  }
  const id = 'id' in raw && typeof raw.id === 'string' ? raw.id : ''
  const squad = process.env.GF_SQUAD?.trim() ?? ''
  if (squad !== '' && squad !== id) {
    const section =
      'title' in raw && typeof raw.title === 'string' ? raw.title : id
    console.log(
      `joining the squad page ${BASE}/g/${squad} (GF_SQUAD) as "${section}"`,
    )
    return { ...raw, squad: { id: squad, section } }
  }
  const space = herdrSpace()
  if (space.startsWith('squad.')) {
    console.warn(
      `This session runs in the squad space ${space}, but ${id} joins no squad page, so its questions sit on a page of their own. Add "squad": {"id": "<squad profile>", "section": "<your work>"} or set GF_SQUAD; pass --solo when a separate page is intended.`,
    )
  }
  return raw
}

// Refusals print their message rather than a stack; a stale --expect-rev exits 3.
const guarded = <T>(write: () => T): T => {
  try {
    return write()
  } catch (error) {
    if (error instanceof StaleRev) {
      return fail(error.message, 3)
    }
    if (error instanceof Error) {
      return fail(error.message)
    }
    throw error
  }
}

const [command, ...args] = process.argv.slice(2)

if (command === '--skill') {
  if (
    args.includes('--if-newer-than') &&
    flag(args, '--if-newer-than') === undefined
  ) {
    fail('--if-newer-than needs a revision')
  }
  console.log(
    guideText(guideView(process.env.GF_OUTBOX), flag(args, '--if-newer-than')),
  )
  process.exit(0)
}

if (command === 'pilot' || command === 'inbox' || command === 'ack') {
  const { runRuntimePilotCli } = await import('./runtimePilotCli')
  process.exit(runRuntimePilotCli(command, args))
}

if (command === 'grant' && args[0] === '--version') {
  console.log(JSON.stringify({ versions: [1] }))
  process.exit(0)
}

const provenance = writeProvenance(args)
if (needsReason(command, args) && provenance.reason === '') {
  if (REASON_REQUIRED) {
    fail(reasonWarning(command ?? ''))
  }
  console.error(reasonWarning(command ?? ''))
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
  case 'draw': {
    const grill =
      getGrill(db, args[0] ?? '') ??
      fail('A drawing belongs to a canonical source grill.')
    const result = publishDrawing(
      db,
      grill,
      {
        version: 1,
        question: args[1],
        request: Number(flag(args, '--request')),
        previous: Number(flag(args, '--previous') ?? '0'),
        revision: Number(flag(args, '--revision') ?? '1'),
        diagram: JSON.parse(
          readFileSync(flag(args, '--file') ?? fail(usage), 'utf8'),
        ),
      },
      provenance.reason,
    )
    if (result.ok) {
      console.log(`published drawing on ${grill.id}, event ${result.event}`)
    } else {
      fail(result.error)
    }
    break
  }
  case 'item': {
    const grill =
      getGrill(db, args[0] ?? '') ??
      fail('An item belongs to a canonical source grill.')
    const result = publishItem(
      db,
      grill,
      JSON.parse(readFileSync(flag(args, '--file') ?? fail(usage), 'utf8')),
      Date.now(),
      provenance.reason,
    )
    if (result.ok) {
      console.log(`published item on ${grill.id}, event ${result.event}`)
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
          'GF_POLL_PROVIDERS',
          'GF_SESSION',
          'GF_MAINTAINER_SESSION',
          'GF_BACKUPS',
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
    const expectRev = args.includes('--expect-rev')
      ? guarded(() => parseExpectRev(flag(args, '--expect-rev')))
      : undefined
    if (expectRev === undefined) {
      if (EXPECT_REV_REQUIRED) {
        fail(expectRevWarning())
      }
      console.error(expectRevWarning())
    }
    const { grill, rev, unknownKeys } = guarded(() =>
      loadChecked(
        db,
        withSquadDefault(
          readJsonFile(args[0] ?? fail(usage)),
          args.includes('--solo'),
        ),
        provenance,
        expectRev,
      ),
    )
    if (unknownKeys.length > 0) {
      console.warn(unknownKeyWarning(unknownKeys))
    }
    console.log(
      `loaded ${grill.id}: ${grill.steps.length} steps, ${BASE}/g/${grill.id} (rev ${rev})`,
    )
    if ((grill.version ?? 1) > FORMAT_VERSION) {
      console.warn(
        `grill format ${grill.version} is newer than this checkout's ${FORMAT_VERSION}: the page shows what it knows; pull grill-flow for the rest`,
      )
    }
    break
  }
  case 'get':
  case 'question':
  case 'patch': {
    const { out, err } = guarded(() =>
      runEditCommand(db, command, args, provenance, BASE),
    )
    if (err !== '') {
      console.error(err)
    }
    console.log(out)
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
      ...(provenance.reason === '' ? {} : { reason: provenance.reason }),
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
        : restoreGrill(db, grill, provenance.reason)
    if (!result.ok) {
      fail(result.reason)
    }
    console.log(`${command === 'retire' ? 'retired' : 'restored'} ${id}`)
    break
  }
  case 'handover': {
    const id = args[0] ?? fail(usage)
    const session =
      flag(args, '--session') ?? fail('gf handover needs --session <address>')
    const reason = (flag(args, '--reason') ?? '').trim()
    const member = flag(args, '--member')
    if (!ADDRESS.test(session)) {
      fail(`${session} is not a Herdr address like t2cr or homelab/t12`)
    }
    if (reason === '') {
      fail('gf handover needs --reason <text>')
    }
    const page = readPage(db, id) ?? fail(`no page ${id}`)
    if (
      member !== undefined &&
      !page.members.some(item => item.state.grill.id === member)
    ) {
      fail(`${member} is not a member of ${id}`)
    }
    const from = page.state.grill.session
    appendEvent(db, id, 'squad-lead', {
      session,
      from,
      reason,
      ...(member === undefined ? {} : { member }),
    })
    console.log(
      from === '' || from === session
        ? `${id}: lead is ${session}`
        : `${id}: lead is now ${session}; deliveries to ${from} go to ${session}`,
    )
    break
  }
  case 'history': {
    const id = args[0] ?? fail(usage)
    if (getGrill(db, id) === undefined) {
      fail(
        readPage(db, id) === undefined
          ? `no source grill ${id}`
          : `${id} is a composed page; run gf history on one of its member grills`,
      )
    }
    const question = args[1]?.startsWith('--') ? undefined : args[1]
    const revisions = grillRevisions(db, id)
    const json = args.includes('--json')
    if (question === undefined) {
      console.log(
        json
          ? JSON.stringify(
              revisions.map(({ grill: _grill, ...revision }) => revision),
            )
          : revisionLines(revisions).join('\n') ||
              `${id} has no recorded revisions yet; its next load records them`,
      )
      break
    }
    const changes = questionHistory(revisions, question)
    console.log(
      json
        ? JSON.stringify({ grillId: id, question, changes })
        : questionLines(changes).join('\n') ||
            `no recorded revision of ${id} touches ${question}`,
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
      const news = newsSince(
        grill.id,
        fresh.map(event => ({
          id: event.id,
          kind: event.kind,
          payload: Schema.decodeUnknownSync(
            Schema.Record(Schema.String, Schema.Unknown),
          )(JSON.parse(event.payload)),
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

if (isAuthoringCommand(command)) {
  printAuthoringWarning(
    flag(args, '--skill-revision'),
    guideView(),
    'published',
  )
}
