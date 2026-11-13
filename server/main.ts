import { Schema } from 'effect'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'

import {
  GRILL_FLOW_TARGET,
  type Grill,
  hasTarget,
  questionSession,
  roundOf,
} from '../src/domain'
import { activityFeed } from './activity'
import {
  SubmissionConflict,
  answerHistory,
  questionRevisions,
  recordAnswer,
  replaySubmission,
  unconfirmedSends,
} from './answerReceipts'
import { attentionSnapshot, focusOwnerStep, requestVeto } from './attention'
import { publishedUpdates } from './channel'
import { dashboard } from './dashboard'
import { pageDrawings, requestDrawing } from './drawings'
import { InvalidSubmissionSource, askMessage, pageMessage } from './messages'
import { readProviderCommand } from './providerReads'
import { createReferenceReader } from './referenceReader'
import { startRemotes } from './remote'
import { createRosterReader, readRosterCommand } from './roster'
import { SendRequest, selectSend } from './sendSelection'
import { createSessionProbe, getSessionCommand } from './sessionProbe'
import {
  eventDestination,
  listPages,
  readPage,
  sendPageAnswers,
  sourceQuestionUrl,
  sourceText,
} from './squad'
import { ROOT, appendEvent, open, remoteOf, snapshot } from './store'

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

// Page deliveries remain refused as typed authority without hc identity (docs/adr/0010).
const sendToSession = async (
  session: string,
  text: string,
): Promise<{ ok: boolean; detail: string }> => {
  if (session === '') {
    return { ok: true, detail: 'left for the agent to pick up' }
  }
  try {
    const child = Bun.spawn(['hc', 'send', session, pageMessage(text)], {
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

const readRoster = createRosterReader(readRosterCommand)
const probeSession = createSessionProbe(getSessionCommand)
const readReferences = createReferenceReader(db, readProviderCommand)

const clientSnapshot = (grill: Grill) => {
  const page = readPage(db, grill.id)
  const state = page?.state ?? snapshot(db, grill)
  const sources = page?.members.length
    ? page.members.map(member => member.state.grill.id)
    : [grill.id]
  const references =
    PREVIEW || process.env.GF_POLL_PROVIDERS === '0'
      ? undefined
      : readReferences(page ?? { state, members: [] })
  return {
    ...state,
    activity: activityFeed(db, page ?? { state, members: [] }),
    ...(references === undefined
      ? {}
      : { grill: references.grill, referenceReadings: references.readings }),
    ...(state.grill.squad === undefined || PREVIEW
      ? {}
      : { roster: readRoster(state.grill.squad.id) }),
    drawings: page === undefined ? [] : pageDrawings(db, page),
    questionRevisions: questionRevisions(state.grill),
    ...attentionSnapshot(db, sources, Date.now(), references?.readings),
    updates: publishedUpdates(db, sources).map(entry => ({
      ...entry,
      displayBody:
        page === undefined
          ? entry.item.body
          : sourceText(page, entry.source, entry.item.body),
    })),
    answerHistory: answerHistory(db, sources),
    questionOrigins: Object.fromEntries(
      page?.members.length
        ? page.members.flatMap(member =>
            Object.entries(member.registration.questions).map(
              ([question, shared]) => [
                shared,
                { grill: member.state.grill.id, question },
              ],
            ),
          )
        : state.grill.steps.map(step => [
            step.question.id,
            { grill: grill.id, question: step.question.id },
          ]),
    ),
    unconfirmedSends: unconfirmedSends(
      db,
      page?.members.length
        ? page.members.map(member => member.state.grill.id)
        : [grill.id],
    ),
    ...maintainerFields(),
  }
}

const maintainerFields = () => {
  const session = process.env.GF_MAINTAINER_SESSION?.trim() || undefined
  const state =
    session === undefined || sessionFor(session) === ''
      ? undefined
      : probeSession(sessionFor(session))
  return {
    ...(session === undefined ? {} : { maintainerSession: session }),
    ...(state === undefined ? {} : { maintainerState: state }),
  }
}

// An ask's own recipient; a failed one may instead go to the grill's session (docs/adr/0028).
const askRecipient = (
  grill: Grill,
  stepId: string,
  route: 'own' | 'fallback',
): string | undefined =>
  route === 'fallback'
    ? questionSession(grill)
    : stepId === GRILL_FLOW_TARGET
      ? process.env.GF_MAINTAINER_SESSION?.trim() || undefined
      : questionSession(
          grill,
          grill.steps.find(step => step.id === stepId)?.question,
        )

const deliverAsk = async (
  grillId: string,
  ask: Readonly<{ id: number; stepId: string; text: string }>,
  recipient: string,
): Promise<void> => {
  const result = await sendToSession(
    sessionFor(recipient),
    askMessage(
      grillId,
      ask.stepId,
      ask.id,
      ask.text,
      gfFor(grillId, recipient),
    ),
  )
  appendEvent(db, grillId, 'sent', {
    ...result,
    what: 'ask',
    askId: ask.id,
    to: recipient,
  })
}

const handleEvent = async (
  grillId: string,
  request: Request,
): Promise<Response> => {
  const pageId = grillId
  const decodedBody = Schema.decodeUnknownResult(
    Schema.Record(Schema.String, Schema.Unknown),
  )(await request.json().catch(() => null))
  if (decodedBody._tag === 'Failure')
    return json({ error: 'Invalid event request' }, 400)
  const requestBody = decodedBody.success
  const page = readPage(db, pageId)
  if (!page) {
    return json({ error: 'no such grill' }, 404)
  }
  if (requestBody.kind === 'owner-focused') {
    const result = await focusOwnerStep(
      db,
      page,
      requestBody,
      async address => {
        const child = Bun.spawn(
          ['herdr-app', 'do', 'agent.focus', '--terminal', address],
          {
            stdout: 'ignore',
            stderr: 'pipe',
          },
        )
        const [code, error] = await Promise.all([
          child.exited,
          new Response(child.stderr).text(),
        ])
        return code === 0
          ? { ok: true, detail: 'Session opened.' }
          : {
              ok: false,
              detail:
                error.trim().slice(0, 300) ||
                'The session could not be opened.',
            }
      },
      PREVIEW,
    )
    return result.ok
      ? json(clientSnapshot(readPage(db, pageId)!.state.grill))
      : json({ error: result.error }, result.status)
  }
  if (requestBody.kind === 'veto-requested') {
    const result = await requestVeto(
      db,
      page,
      requestBody,
      (session, text) =>
        PREVIEW
          ? Promise.resolve({
              ok: false,
              detail: 'Preview: no terminal delivery was attempted.',
            })
          : sendToSession(sessionFor(session), text),
      (source, session) => gfFor(source, session) ?? `bun run --cwd ${ROOT} gf`,
    )
    if (!result.ok) {
      return json({ error: result.error }, result.status)
    }
    return json(clientSnapshot(readPage(db, pageId)!.state.grill))
  }
  const destination = eventDestination(page, requestBody)
  const grill = destination.grill
  const body = destination.body
  grillId = grill.id
  const questionIds = new Set(grill.steps.map(step => step.question.id))
  const question = String(body.question ?? '')
  if (body.kind === 'drawing-requested') {
    const result = await requestDrawing(
      db,
      grill,
      page.state.grill,
      String(requestBody.question ?? ''),
      body,
      (session, text) => sendToSession(sessionFor(session), text),
      session => gfFor(grill.id, session) ?? `bun run --cwd ${ROOT} gf`,
      PREVIEW,
    )
    return result.ok
      ? json(clientSnapshot(readPage(db, pageId)!.state.grill))
      : json({ error: result.error }, result.status)
  }
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
      const recorded = recordAnswer(
        db,
        grill,
        page.state.grill,
        String(requestBody.question ?? ''),
        body,
      )
      if (!recorded.ok) {
        return json({ error: recorded.error }, recorded.status)
      }
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
      const recipient = askRecipient(grill, stepId, 'own')
      if (recipient === undefined) {
        return json(
          { error: 'The grill-flow discussion session is not configured.' },
          400,
        )
      }
      const askId = appendEvent(db, grillId, 'asked', { stepId, text })
      await deliverAsk(grillId, { id: askId, stepId, text }, recipient)
      break
    }
    case 'redelivered': {
      const ask = snapshot(db, grill).asks.find(
        item => item.id === body.askId && item.stepId === body.stepId,
      )
      const route = body.route === 'fallback' ? 'fallback' : 'own'
      if (ask === undefined || ask.answered) {
        return json({ error: 'unknown or answered ask' }, 400)
      }
      const recipient = askRecipient(grill, ask.stepId, route)
      if (recipient === undefined || recipient === '') {
        return json({ error: 'No session to deliver this ask to.' }, 400)
      }
      await deliverAsk(grillId, ask, recipient)
      break
    }
    default:
      return json({ error: 'unknown event kind' }, 400)
  }
  return json(clientSnapshot(readPage(db, pageId)!.state.grill))
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
  const body: unknown = await request.json().catch(() => null)
  const page = readPage(db, grillId)
  if (!page) {
    return json({ error: 'no such grill' }, 404)
  }
  const grill = page.state.grill
  const decoded = Schema.decodeUnknownResult(SendRequest)(body)
  if (decoded._tag === 'Failure')
    return json({ error: 'Invalid send request' }, 400)
  const replay = replaySubmission(db, grillId, decoded.success)
  if (replay === 'conflict')
    return json(
      { error: 'This send request ID already names different content.' },
      409,
    )
  if (replay === 'replay') {
    return json(clientSnapshot(grill))
  }
  const selection = selectSend(page.state, body)
  if (!selection.ok) {
    return json({ error: selection.error }, selection.status)
  }
  try {
    await sendPageAnswers(
      db,
      page,
      selection,
      (session, text) => sendToSession(sessionFor(session), text),
      (source, session) =>
        gfFor(source.id, session) ?? `bun run --cwd ${ROOT} gf`,
      decoded.success,
    )
  } catch (error) {
    if (error instanceof InvalidSubmissionSource) {
      return json({ error: error.message }, 400)
    }
    if (error instanceof SubmissionConflict) {
      return json({ error: error.message }, 409)
    }
    throw error
  }
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
        if (
          parts[2] === 'question' &&
          parts.length === 4 &&
          url.searchParams.has('source')
        ) {
          const target = sourceQuestionUrl(
            db,
            decodeURIComponent(parts[1] ?? ''),
            url.searchParams.get('source') ?? '',
            decodeURIComponent(parts[3] ?? ''),
          )
          return target === undefined
            ? json({ error: 'No such source question on this page.' }, 404)
            : new Response(null, { status: 302, headers: { location: target } })
        }
        return page()
      }
      if (parts[0] === 'api' && parts[1] === 'build' && parts.length === 2) {
        return json({ build: buildId() })
      }
      if (parts[0] === 'api' && parts[1] === 'grills' && parts.length === 2) {
        return json(listPages(db))
      }
      if (parts[0] === 'api' && parts[1] === 'grills' && parts.length === 3) {
        const grill = readPage(db, parts[2] ?? '')?.state.grill
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
