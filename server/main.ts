import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, normalize } from 'node:path'

import { OWN, replyText } from '../src/domain'
import {
  ROOT,
  appendEvent,
  getGrill,
  listGrills,
  open,
  snapshot,
} from './store'

const PORT = Number(process.env.GF_PORT ?? 4317)
const HOST = '127.0.0.1'
const DIST = join(ROOT, 'dist')
const db = open()

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
    .find(([name]) => name === 'gf_token')?.[1]

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
  return new Response(Bun.file(index), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'set-cookie': `gf_token=${token}; Path=/; HttpOnly; SameSite=Strict`,
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
const sendToSession = async (
  session: string,
  text: string,
): Promise<{ ok: boolean; detail: string }> => {
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
  process.env.GF_SESSION ?? grillSession

const askMessage = (
  grillId: string,
  stepId: string,
  askId: number,
  text: string,
): string =>
  stepId.startsWith('part:')
    ? [
        `[grill-flow] Ask on ${grillId}, the whole concept ${stepId.slice(5)} (ask ${askId}): ${text}`,
        `Answer it on the page: write your reply to a file, then run`,
        `bun run --cwd ${ROOT} gf revise ${grillId} ${stepId} --ask ${askId} --kind comment --file <path>`,
        `(to rewrite a step's reasoning as well, run the same with that step's id and --kind rewrite).`,
      ].join('\n')
    : [
        `[grill-flow] Ask on ${grillId}, step ${stepId} (ask ${askId}): ${text}`,
        `Answer it on the page: write a rewrite of that step's prose, or a comment, to a file, then run`,
        `bun run --cwd ${ROOT} gf revise ${grillId} ${stepId} --ask ${askId} --kind rewrite --file <path>`,
        `(use --kind comment to reply in the conversation instead of rewriting it).`,
      ].join('\n')

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
  // An ask is about one step, or about a whole concept as `part:<part id>`.
  const stepIds = new Set([
    ...grill.steps.map(step => step.id),
    ...grill.parts.map(part => `part:${part.id}`),
  ])
  const question = String(body.question ?? '')
  switch (body.kind) {
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
      if (!stepIds.has(stepId) || text === '') {
        return json({ error: 'unknown step or empty ask' }, 400)
      }
      const askId = appendEvent(db, grillId, 'asked', { stepId, text })
      const result = await sendToSession(
        sessionFor(grill.session),
        askMessage(grillId, stepId, askId, text),
      )
      appendEvent(db, grillId, 'sent', { ...result, what: 'ask', askId })
      break
    }
    default:
      return json({ error: 'unknown event kind' }, 400)
  }
  return json(snapshot(db, grill))
}

const handleSend = async (grillId: string): Promise<Response> => {
  const grill = getGrill(db, grillId)
  if (!grill) {
    return json({ error: 'no such grill' }, 404)
  }
  const state = snapshot(db, grill)
  const text = `[grill-flow] Answers from the ${grill.title} page:\n${replyText(grill, state.answers, state.notes, state.own)}`
  const result = await sendToSession(sessionFor(grill.session), text)
  appendEvent(db, grillId, 'sent', { ...result, what: 'answers', text })
  return json(snapshot(db, grill))
}

Bun.serve({
  hostname: HOST,
  port: PORT,
  async fetch(request) {
    const url = new URL(request.url)
    const parts = url.pathname.split('/').filter(Boolean)
    if (request.method === 'GET') {
      if (parts.length === 0) {
        const latest = listGrills(db)[0]
        return latest
          ? Response.redirect(`/g/${latest.id}`, 302)
          : new Response('No grills loaded yet.')
      }
      if (parts[0] === 'g' && parts.length === 2) {
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
          ? json(snapshot(db, grill))
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
        return handleSend(grillId)
      }
    }
    return new Response('Not found', { status: 404 })
  },
})

console.log(`grill-flow on http://${HOST}:${PORT}`)
