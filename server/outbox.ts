import { Schema } from 'effect'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

import { ChannelItem } from '../src/channel'
import {
  type Grill,
  type Snapshot,
  hasTarget,
  isWholeTarget,
  replyText,
} from '../src/domain'
import { remoteItemError } from './channel'
import { DrawingReply, drawingMessage } from './drawings'
import { askMessage, pageMessage } from './messages'
import { ROOT, decodeGrill } from './store'

// The agent side on a machine without the server: grills and replies go into an outbox folder
// that a grill-flow server elsewhere pulls over hc, and its state.json comes back beside them
// (server/remote.ts).

type StateFile = Readonly<{
  lastEventId: number
  snapshot: Snapshot
  events: ReadonlyArray<
    Readonly<{ id: number; kind: string; payload: Record<string, unknown> }>
  >
}>

export type News = Readonly<{
  lines: ReadonlyArray<string>
  lastId: number
}>

/** What an agent should see since an event: asks not yet answered, and replies Rob sent. */
export const newsSince = (
  grillId: string,
  fresh: ReadonlyArray<
    Readonly<{ id: number; kind: string; payload: Record<string, unknown> }>
  >,
  answeredAsks: ReadonlySet<number>,
  gf?: string,
): News => ({
  lines: fresh.flatMap(event =>
    event.kind === 'asked' && !answeredAsks.has(event.id)
      ? [
          askMessage(
            grillId,
            String(event.payload.stepId),
            event.id,
            String(event.payload.text),
            gf,
          ),
        ]
      : event.kind === 'drawing-requested' &&
          !fresh.some(
            reply =>
              reply.kind === 'drawing-published' &&
              reply.payload.request === event.id,
          )
        ? [pageMessage(drawingMessage(grillId, event.id, event.payload, gf))]
        : event.kind === 'sent' && event.payload.what === 'answers'
          ? [pageMessage(String(event.payload.text))]
          : [],
  ),
  lastId: fresh.at(-1)?.id ?? 0,
})

const fail = (message: string): never => {
  console.error(message)
  process.exit(2)
}

const flag = (
  args: ReadonlyArray<string>,
  name: string,
): string | undefined => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

// Written whole and renamed into place, so a pull never reads half a file.
const writeAtomic = (path: string, text: string): void => {
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, text)
  renameSync(temporary, path)
}

export const runOutbox = async (
  outbox: string,
  command: string | undefined,
  args: ReadonlyArray<string>,
  usage: string,
): Promise<void> => {
  const folder = (id: string | undefined): string =>
    join(outbox, id ?? fail(usage))
  const grillOf = (id: string | undefined): Grill => {
    const path = join(folder(id), 'grill.json')
    return existsSync(path)
      ? decodeGrill(JSON.parse(readFileSync(path, 'utf8')))
      : fail(`no grill ${id} in ${outbox}`)
  }
  const stateOf = (id: string | undefined): StateFile | undefined => {
    const path = join(folder(id), 'state.json')
    return existsSync(path)
      ? (JSON.parse(readFileSync(path, 'utf8')) as StateFile)
      : undefined
  }
  switch (command) {
    case 'draw': {
      const grill = grillOf(args[0])
      const decoded = Schema.decodeUnknownResult(DrawingReply)({
        version: 1,
        question: args[1],
        request: Number(flag(args, '--request')),
        previous: Number(flag(args, '--previous') ?? '0'),
        revision: Number(flag(args, '--revision') ?? '1'),
        diagram: JSON.parse(
          readFileSync(flag(args, '--file') ?? fail(usage), 'utf8'),
        ),
      })
      if (decoded._tag === 'Failure') {
        return fail('Invalid drawing response. Use compare or flow JSON.')
      }
      const reply = decoded.success
      const path = join(
        folder(grill.id),
        'drawings',
        `${reply.request}-${String(reply.revision).padStart(10, '0')}.json`,
      )
      const text = `${JSON.stringify(reply)}\n`
      if (existsSync(path) && readFileSync(path, 'utf8') !== text) {
        fail('That immutable drawing revision already has different content.')
      }
      mkdirSync(join(folder(grill.id), 'drawings'), { recursive: true })
      if (!existsSync(path)) {
        writeAtomic(path, text)
      }
      console.log(
        `queued drawing response in ${path}; the serving host validates its request context`,
      )
      break
    }
    case 'item': {
      const grill = grillOf(args[0])
      const decoded = Schema.decodeUnknownResult(ChannelItem)(
        JSON.parse(readFileSync(flag(args, '--file') ?? fail(usage), 'utf8')),
      )
      if (decoded._tag === 'Failure') {
        return fail('Invalid version-1 channel item.')
      }
      const item = decoded.success
      const remoteError = remoteItemError(item)
      if (remoteError !== undefined) {
        fail(remoteError)
      }
      if (item.body.trim() === '' || item.revision !== item.previous + 1) {
        fail('A channel item needs text and the next revision after previous.')
      }
      const name = `${item.id}-${String(item.revision).padStart(10, '0')}.json`
      const path = join(folder(grill.id), 'items', name)
      const text = `${JSON.stringify(item)}\n`
      if (existsSync(path) && readFileSync(path, 'utf8') !== text) {
        fail('That immutable item file already has different content.')
      }
      mkdirSync(join(folder(grill.id), 'items'), { recursive: true })
      if (!existsSync(path)) {
        writeAtomic(path, text)
      }
      console.log(
        `queued ${item.id} revision ${item.revision} in ${path}; the serving machine validates and publishes it`,
      )
      break
    }
    case 'grant':
      fail('Read submission evidence on the serving machine without GF_OUTBOX.')
      break
    case 'retire':
    case 'restore':
      fail('Run retire/restore on the serving machine without GF_OUTBOX.')
      break
    case 'load': {
      const grill = decodeGrill(
        JSON.parse(readFileSync(args[0] ?? fail(usage), 'utf8')),
      )
      mkdirSync(join(folder(grill.id), 'revisions'), { recursive: true })
      writeAtomic(
        join(folder(grill.id), 'grill.json'),
        `${JSON.stringify(grill, null, 2)}\n`,
      )
      console.log(
        `wrote ${grill.id} to ${folder(grill.id)}; the server pulling this outbox shows it within a few seconds`,
      )
      break
    }
    case 'revise': {
      const grill = grillOf(args[0])
      const stepId = args[1] ?? fail(usage)
      const isWhole = isWholeTarget(stepId)
      if (!hasTarget(grill, stepId)) {
        fail(`no step, concept or card ${stepId} in ${grill.id}`)
      }
      const kind = flag(args, '--kind') ?? (isWhole ? 'comment' : 'rewrite')
      if (kind !== 'rewrite' && kind !== 'comment') {
        fail('--kind is rewrite or comment')
      }
      if (isWhole && kind === 'rewrite') {
        fail('a concept or card takes a comment; rewrite a step by its own id')
      }
      const askFlag = flag(args, '--ask')
      const text = readFileSync(
        flag(args, '--file') ?? fail(usage),
        'utf8',
      ).trim()
      // The server checks the ask against its record when it takes the reply in.
      const name = `${Date.now()}-${process.pid}.json`
      mkdirSync(join(folder(grill.id), 'revisions'), { recursive: true })
      writeAtomic(
        join(folder(grill.id), 'revisions', name),
        `${JSON.stringify({ stepId, askId: askFlag ? Number(askFlag) : null, kind, text })}\n`,
      )
      console.log(
        `wrote ${kind} on ${stepId} as revisions/${name}; the open page shows it within a few seconds`,
      )
      break
    }
    case 'reply': {
      const grill = grillOf(args[0])
      const text = readFileSync(
        flag(args, '--file') ?? fail(usage),
        'utf8',
      ).trim()
      if (text === '') {
        fail('the reply is empty')
      }
      // A reply rides with the revisions; the server tells them apart by kind (server/remote.ts).
      const name = `${Date.now()}-${process.pid}.json`
      mkdirSync(join(folder(grill.id), 'revisions'), { recursive: true })
      writeAtomic(
        join(folder(grill.id), 'revisions', name),
        `${JSON.stringify({ kind: 'reply', text })}\n`,
      )
      console.log(
        `wrote your reply as revisions/${name}; the open page shows it within a few seconds`,
      )
      break
    }
    case 'state': {
      const grill = grillOf(args[0])
      const state = stateOf(args[0])
      if (state === undefined) {
        console.log(
          `No state yet for ${grill.id}: the server hasn't pulled this outbox since it was written.`,
        )
        break
      }
      const { answers, notes, own, asks } = state.snapshot
      console.log(replyText(state.snapshot.grill, answers, notes, own))
      const waiting = asks.filter(ask => !ask.answered)
      if (waiting.length > 0) {
        console.log('\nAsks waiting for an answer:')
        waiting.forEach(ask =>
          console.log(`  ask ${ask.id} on ${ask.stepId}: ${ask.text}`),
        )
      }
      break
    }
    case 'events': {
      const since = Number(flag(args, '--since') ?? 0)
      ;(stateOf(args[0])?.events ?? [])
        .filter(event => event.id > since)
        .forEach(event => console.log(JSON.stringify(event)))
      break
    }
    case 'wait': {
      const grill = grillOf(args[0])
      const since = Number(
        flag(args, '--since') ?? stateOf(args[0])?.lastEventId ?? 0,
      )
      for (;;) {
        const state = stateOf(args[0])
        const news = newsSince(
          grill.id,
          (state?.events ?? []).filter(event => event.id > since),
          new Set(
            (state?.snapshot.asks ?? [])
              .filter(ask => ask.answered)
              .map(ask => ask.id),
          ),
          `GF_OUTBOX=${outbox} bun run --cwd ${ROOT} gf`,
        )
        if (news.lines.length > 0) {
          console.log(news.lines.join('\n\n'))
          console.log(
            `\nnext: GF_OUTBOX=${outbox} gf wait ${grill.id} --since ${news.lastId}`,
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
}
