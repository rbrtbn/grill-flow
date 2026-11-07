import { Schema } from 'effect'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'

import {
  GRILL_FLOW_TARGET,
  OWN,
  type Grill,
  hasTarget,
  questionSession,
  roundOf,
} from '../src/domain'
import { dashboard } from './dashboard'
import { sendAnswerBatches } from './delivery'
import { askMessage } from './messages'
import { startRemotes } from './remote'
import { selectSend } from './sendSelection'
import {
  ROOT,
  appendEvent,
  getGrill,
  listGrills,
  open,
  remoteOf,
  snapshot,
} from './store'

const PORT = Number(process.env.GF_PORT ?? 4317)
const PREVIEW = process.env.GF_PREVIEW === '1'
const HOST = '127.0.0.1'
// Cookies ignore ports; previews must not replace the live server's write cookie.
const COOKIE_NAME = PORT === 4317 ? 'gf_token' : `gf_token_${PORT}`
const DIST = process.env.GF_DIST ?? join(ROOT, 'dist')
const db = open()
if (!PREVIEW && process.env.GF_POLL_REMOTES !== '0') startRemotes(db)

// The page's writes need this cookie. SameSite=Strict keeps other sites' pages from sending it, and
// the token survives restarts so an open tab keeps working.
const TOKEN_PATH = join(ROOT, 'data', 'token')
const token = existsSync(TOKEN_PATH)
  ? readFileSync(TOKEN_PATH, 'utf8').trim()
  : (() => {
      const fresh = randomBytes(24).toString('hex')
      writeFileSync(TOKEN_PATH, fresh, { mode: 0o600 })
      return fresh
    })()

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const cookieToken = (request: Request): string | undefined =>
  (request.headers.get('cookie') ?? '')
    .split(';')
    .map(part => part.trim().split('='))
    .find(([name]) => name === COOKIE_NAME)?.[1]

const writeAllowed = (request: Request): boolean => {
  const origin = request.headers.get('origin')
  const site = request.headers.get('sec-fetch-site')
  const sameOrigin =
    (origin === null ||
      origin === `http://${HOST}:${PORT}` ||
      origin === `http://localhost:${PORT}`) &&
    (site === null || site === 'same-origin')
  return (
    sameOrigin &&
    cookieToken(request) === token &&
    (request.headers.get('content-type') ?? '').startsWith('application/json')
  )
}

// index.html names the hashed bundles, so its hash changes with every new build of src/.
const buildId = (): string => {
  const index = join(DIST, 'index.html')
  return existsSync(index)
    ? new Bun.CryptoHasher('sha1')
        .update(readFileSync(index))
        .digest('hex')
        .slice(0, 12)
    : ''
}

// With --watch, rebuild the page whenever src/ changes; open pages reload on the next poll.
if (process.argv.includes('--watch')) {
  Bun.spawn(['bunx', 'vite', 'build', '--watch', '--logLevel', 'warn'], {
    cwd: ROOT,
    stdout: 'inherit',
    stderr: 'inherit',
  })
}

const page = (): Response => {
  const index = join(DIST, 'index.html')
  if (!existsSync(index)) {
    return new Response('Not built yet: run `bun run build` in grill-flow.', {
      status: 503,
    })
  }
  const content = PREVIEW
    ? readFileSync(index, 'utf8').replace(
        '<body>',
        '<body data-gf-preview="true"><div class="f-preview-notice" role="status">Working preview · copied data · sends stay local</div>',
      )
    : Bun.file(index)
  return new Response(content, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'set-cookie': `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict`,
    },
  })
}

const asset = (pathname: string): Response => {
  const path = normalize(join(DIST, pathname))
  if (!path.startsWith(DIST + '/') || !existsSync(path)) {
    return new Response('Not found', { status: 404 })
  }
  return new Response(Bun.file(path))
}

// hc types the text into the agent's terminal and presses Enter, as if Rob had typed it.
// A grill without a session has no terminal to type into: its asks and answers stay in the
// store for the agent to collect with `gf wait`.
const sendToSession = async (
  session: string,
  text: string,
): Promise<{ ok: boolean; detail: string }> => {
  if (session === '') {
    return { ok: true, detail: 'left for the agent to pick up' }
  }
  try {
    const child = Bun.spawn(['hc', 'send', session, text], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [code, stderr] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
    ])
    return code === 0
      ? { ok: true, detail: `sent to ${session}` }
      : {
          ok: false,
          detail: stderr.trim().slice(0, 300) || `hc exited ${code}`,
        }
  } catch (error) {
    return { ok: false, detail: `hc not available: ${String(error)}` }
  }
}

const sessionFor = (grillSession: string): string =>
  PREVIEW ? '' : (process.env.GF_SESSION ?? grillSession)

const clientSnapshot = (grill: Grill) => ({
  ...snapshot(db, grill),
  maintainerSession: process.env.GF_MAINTAINER_SESSION?.trim() || undefined,
})

const handleEvent = async (
  grillId: string,
  request: Request,
): Promise<Response> => {
  const grill = getGrill(db, grillId)
  if (!grill) {
    return json({ error: 'no such grill' }, 404)
  }
  const body = (await request.json()) as Record<string, unknown>
  const questionIds = new Set(grill.steps.map(step => step.question.id))
  const question = String(body.question ?? '')
  switch (body.kind) {
    case 'renamed-round': {
      const change = Schema.decodeUnknownResult(
        Schema.Struct({ round: Schema.Number, name: Schema.String }),
      )(body)
      if (
        change._tag === 'Failure' ||
        !Number.isInteger(change.success.round) ||
        change.success.name.trim().length > 80 ||
        !grill.steps.some(
          step => roundOf(grill, step.question) === change.success.round,
        )
      ) {
        return json(
          {
            error:
              'Choose an existing round and a name of at most 80 characters.',
          },
          400,
        )
      }
      appendEvent(db, grillId, 'renamed-round', {
        round: change.success.round,
        name: change.success.name.trim(),
      })
      break
    }
    case 'answered': {
      const step = grill.steps.find(s => s.question.id === question)
      const key = String(body.key ?? '')
      if (
        !step ||
        !(
          key === OWN ||
          step.question.options.some(option => option.key === key)
        )
      ) {
        return json({ error: 'unknown question or option' }, 400)
      }
      appendEvent(
        db,
        grillId,
        'answered',
        key === OWN
          ? { question, key, text: String(body.text ?? '').slice(0, 4000) }
          : { question, key },
      )
      break
    }
    case 'cleared':
      if (!questionIds.has(question)) {
        return json({ error: 'unknown question' }, 400)
      }
      appendEvent(db, grillId, 'cleared', { question })
      break
    case 'noted':
      if (!questionIds.has(question)) {
        return json({ error: 'unknown question' }, 400)
      }
      appendEvent(db, grillId, 'noted', {
        question,
        text: String(body.text ?? '').slice(0, 4000),
      })
      break
    case 'asked': {
      const stepId = String(body.stepId ?? '')
      const text = String(body.text ?? '')
        .trim()
        .slice(0, 4000)
      if (!hasTarget(grill, stepId) || text === '') {
        return json({ error: 'unknown step or empty ask' }, 400)
      }
      const recipient =
        stepId === GRILL_FLOW_TARGET
          ? process.env.GF_MAINTAINER_SESSION?.trim()
          : questionSession(
              grill,
              grill.steps.find(step => step.id === stepId)?.question,
            )
      if (recipient === undefined) {
        return json(
          { error: 'The grill-flow discussion session is not configured.' },
          400,
        )
      }
      const askId = appendEvent(db, grillId, 'asked', { stepId, text })
      const result = await sendToSession(
        sessionFor(recipient),
        askMessage(grillId, stepId, askId, text, gfFor(grillId, recipient)),
      )
      appendEvent(db, grillId, 'sent', { ...result, what: 'ask', askId })
      break
    }
    default:
      return json({ error: 'unknown event kind' }, 400)
  }
  return json(clientSnapshot(grill))
}

// A pulled grill's agent answers into its outbox from its own checkout, at the path the grill
// skill names, not from this machine's.
const gfFor = (grillId: string, session: string): string | undefined => {
  const remote = remoteOf(db, grillId)
  return remote === undefined || !session.startsWith(`${remote.machine}/`)
    ? undefined
    : `GF_OUTBOX=${dirname(remote.dir)} bun run --cwd ~/repos/rbrtbn/grill-flow gf`
}

const handleSend = async (
  grillId: string,
  request: Request,
): Promise<Response> => {
  const grill = getGrill(db, grillId)
  if (!grill) {
    return json({ error: 'no such grill' }, 404)
  }
  const body: unknown = await request.json().catch(() => null)
  const selection = selectSend(snapshot(db, grill), body)
  if (!selection.ok) {
    return json({ error: selection.error }, selection.status)
  }
  const result = await sendAnswerBatches(
    grill,
    selection,
    (session, text) => sendToSession(sessionFor(session), text),
    session => gfFor(grillId, session) ?? `bun run --cwd ${ROOT} gf`,
  )
  appendEvent(db, grillId, 'sent', {
    ...result,
    what: 'answers',
  })
  return json(clientSnapshot(grill))
}

Bun.serve({
  hostname: HOST,
  port: PORT,
  async fetch(request) {
    const url = new URL(request.url)
    const parts = url.pathname.split('/').filter(Boolean)
    if (request.method === 'GET') {
      if (parts.length === 0) {
        return await dashboard(db)
      }
      // Every page of a grill has its own path under /g/<id>; the app reads which from the URL.
      if (parts[0] === 'g' && parts.length >= 2 && parts.length <= 4) {
        return page()
      }
      if (parts[0] === 'api' && parts[1] === 'build' && parts.length === 2) {
        return json({ build: buildId() })
      }
      if (parts[0] === 'api' && parts[1] === 'grills' && parts.length === 2) {
        return json(listGrills(db))
      }
      if (parts[0] === 'api' && parts[1] === 'grills' && parts.length === 3) {
        const grill = getGrill(db, parts[2] ?? '')
        return grill
          ? json(clientSnapshot(grill))
          : json({ error: 'no such grill' }, 404)
      }
      return asset(url.pathname)
    }
    if (
      request.method === 'POST' &&
      parts[0] === 'api' &&
      parts[1] === 'grills' &&
      parts.length === 4
    ) {
      if (!writeAllowed(request)) {
        return json(
          { error: 'Reload the page: this tab has no valid session.' },
          403,
        )
      }
      const grillId = parts[2] ?? ''
      if (parts[3] === 'events') {
        return handleEvent(grillId, request)
      }
      if (parts[3] === 'send') {
        return handleSend(grillId, request)
      }
    }
    return new Response('Not found', { status: 404 })
  },
})

console.log(`grill-flow on http://${HOST}:${PORT}`)
