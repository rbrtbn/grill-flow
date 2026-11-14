// PROTOTYPE (ask 9673): shared host page, data and simulated send path for the three
// send-shortcut variants. Throwaway; nothing here talks to the live server or a session.

export type SessionId = 'grants' | 'homelab'
export const sessions: Record<SessionId, { name: string; address: string }> = {
  grants: { name: 'Grant checks', address: 't2k4' },
  homelab: { name: 'Homelab lanes', address: 't2m1' },
}
export const to = (session: SessionId) =>
  `${sessions[session].name} · ${sessions[session].address}`

type Choice = { key: string; label: string; consequence: string; recommended?: boolean }
export type Answer =
  | { state: 'open' }
  | { state: 'draft'; choice: string; own: string; at: string; failure?: string; held?: boolean }
  | { state: 'sending'; choice: string; own: string; at: string; send: number }
  | { state: 'sent'; choice: string; own: string; send: number; sentAt: string }
export type Question = {
  id: number
  key: string
  short: string
  title: string
  intro: string
  round: number
  session: SessionId
  urgency: 'blocking' | 'soon' | 'wait' | 'fyi'
  posted: string
  waiting?: string
  options: ReadonlyArray<Choice>
  answer: Answer
}
export type Round = { n: number; name: string; posted: string }

const rounds: ReadonlyArray<Round> = [
  { n: 2, name: 'Clean-up', posted: 'Yesterday 17:40' },
  { n: 3, name: 'Release & grants', posted: 'Today 09:05' },
]

const seed = (): Array<Question> => [
  {
    id: 1, key: 'old-pages-retire', short: 'Old pages retire', round: 2, session: 'homelab', urgency: 'wait', posted: 'Yesterday 17:40',
    title: 'When should an old squad page retire?',
    intro: 'Pages pile up after each run. Retiring one hides it from Your grills; its answers and receipts stay in the database.',
    options: [
      { key: 'a', label: 'After 14 days without a new question', consequence: 'Quiet pages disappear on their own; a new question revives them.', recommended: true },
      { key: 'b', label: 'Only when the lead retires it', consequence: 'Nothing disappears by itself, and the list keeps growing until someone tidies it.' },
    ],
    answer: { state: 'sent', choice: 'a', own: '', send: 4, sentAt: 'Yesterday 18:12' },
  },
  {
    id: 2, key: 'read-only-fallback', short: 'Read-only fallback', round: 2, session: 'grants', urgency: 'soon', posted: 'Yesterday 17:40',
    title: 'What should a page show while its source machine is offline?',
    intro: 'Homelab grills reach this page through their outbox. When the homelab sleeps, the page has only its last snapshot.',
    options: [
      { key: 'a', label: 'The last snapshot, read-only, with a banner', consequence: 'You can still read and draft; sends wait until the machine is back.', recommended: true },
      { key: 'b', label: 'Hide the grill until it returns', consequence: 'No stale content, but questions vanish without warning.' },
    ],
    answer: { state: 'sent', choice: 'a', own: '', send: 4, sentAt: 'Yesterday 18:12' },
  },
  {
    id: 3, key: 'retire-old-rules-adr', short: 'ADR for the old grant rules', round: 2, session: 'grants', urgency: 'wait', posted: 'Yesterday 17:40',
    title: 'Which ADR should retire the old grant rules?',
    intro: 'The night-grant rules in ADR 0014 no longer match how grants are checked. Either a new ADR supersedes it, or 0014 is amended.',
    options: [
      { key: 'a', label: 'A new ADR that supersedes 0014', consequence: 'History stays readable; two ADRs to follow for a while.', recommended: true },
      { key: 'b', label: 'Amend 0014 in place', consequence: 'One document, but the original reasoning is lost from the text.' },
    ],
    answer: { state: 'draft', choice: '?', own: "A new ADR, but keep 0014's evidence section word for word and link to it.", at: 'Yesterday 18:30' },
  },
  {
    id: 4, key: 'hook-trust-config', short: 'Hook trust and configuration', round: 2, session: 'homelab', urgency: 'wait', posted: 'Yesterday 17:40',
    title: 'Where should hook trust be configured?',
    intro: 'Each machine asks once whether to trust the squad hooks. The answer can live per repo or per machine.',
    options: [
      { key: 'a', label: "Per repo, in the repo's squad profile", consequence: 'Each repo opts in; a new repo asks again.' },
      { key: 'b', label: 'Once per machine, through chezmoi', consequence: 'Set once for every repo on the machine; a repo cannot opt out.', recommended: true },
    ],
    answer: { state: 'draft', choice: 'b', own: '', at: 'Yesterday 18:34' },
  },
  {
    id: 5, key: 'night-grant', short: 'Night grant for the runs', round: 3, session: 'grants', urgency: 'blocking', posted: 'Today 09:05',
    title: 'Which work can the squad continue without you tonight?',
    intro: 'Three runs are open. Safety decisions and merges still come back to you whichever scope you choose.',
    options: [
      { key: 'a', label: 'Continue within the agreed scope', consequence: 'Routine fixes and reviews keep moving; new safety questions wait for you.', recommended: true },
      { key: 'b', label: 'Stop at each decision', consequence: 'Nothing moves overnight without you.' },
    ],
    answer: { state: 'draft', choice: 'a', own: '', at: 'Today 09:41' },
  },
  {
    id: 6, key: 'grant-provenance', short: 'Keep grant provenance', round: 3, session: 'grants', urgency: 'soon', posted: 'Today 09:05',
    title: 'Should each grant record the page answer that created it?',
    intro: '`gf grant` reads evidence only. Recording the submission lets an audit trace a grant back to your words.',
    options: [
      { key: 'a', label: 'Yes, cite the submission', consequence: 'Every grant links to a frozen answer receipt.', recommended: true },
      { key: 'b', label: 'No, the grant text is enough', consequence: 'Simpler records; audits rely on timestamps.' },
    ],
    answer: { state: 'draft', choice: '?', own: 'Yes. Cite the member grill and its submission id, not the shared page id.', at: 'Today 09:44' },
  },
  {
    id: 7, key: 'laptop-awake', short: 'Keep the laptop awake', round: 3, session: 'homelab', urgency: 'soon', posted: 'Today 09:05',
    title: 'Should the workstation stay awake while runs are open?',
    intro: 'Runs stall when the laptop sleeps. Keeping it awake costs battery when it is unplugged.',
    options: [
      { key: 'a', label: 'Only while a run is active', consequence: 'Sleeps normally between runs.', recommended: true },
      { key: 'b', label: 'Always, while on mains power', consequence: 'Never sleeps on power, even with nothing running.' },
    ],
    answer: { state: 'draft', choice: 'a', own: '', at: 'Today 09:47' },
  },
  {
    id: 8, key: 'capacity-three-runs', short: 'Capacity for three runs', round: 3, session: 'homelab', urgency: 'blocking', posted: 'Today 09:05',
    title: 'Can the homelab carry three runs at once?',
    intro: 'Each run needs a lane with its own dev stack. Memory is the limit: two lanes fit comfortably, three need swap.',
    options: [
      { key: 'a', label: 'Yes, three lanes now', consequence: 'Faster tonight; builds may swap and slow down.' },
      { key: 'b', label: 'Two lanes until the memory upgrade', consequence: 'The third run queues until a lane frees up.', recommended: true },
    ],
    answer: { state: 'open' },
  },
  {
    id: 9, key: 'tag-sends', short: 'Tag sends with the run', round: 3, session: 'grants', urgency: 'wait', posted: 'Today 09:05',
    title: 'Should grill-flow tag each send with its run id?',
    intro: 'Tags would let the lead see which run an answer belongs to. How many run ids exist depends on the homelab capacity answer.',
    waiting: 'Waiting on Homelab lanes: their capacity numbers decide how many run ids there are.',
    options: [
      { key: 'a', label: 'Tag every send', consequence: 'Each receipt names its run.' },
      { key: 'b', label: 'Only when a page has more than one run', consequence: 'Fewer tags; single-run pages stay as they are.', recommended: true },
    ],
    answer: { state: 'open' },
  },
  {
    id: 10, key: 'source-labels', short: 'Source labels, not only ids', round: 3, session: 'homelab', urgency: 'fyi', posted: 'Today 09:05',
    title: 'Should the queue show source labels as well as ids?',
    intro: "Rows show the asking session's address. A label like Homelab lanes is easier to scan.",
    options: [
      { key: 'a', label: 'Label and address', consequence: 'Readable, slightly wider rows.', recommended: true },
      { key: 'b', label: 'Address only', consequence: 'Compact, as today.' },
    ],
    answer: { state: 'open' },
  },
]

export type Toast = {
  id: number
  kind: 'ok' | 'fail' | 'pending' | 'info'
  html: string
  actions?: ReadonlyArray<{ act: string; label: string; data?: string }>
  sticky?: boolean
}
export type SendLog = {
  n: number
  at: string
  ids: ReadonlyArray<number>
  message: string
  deliveries: Array<{ session: SessionId; ids: ReadonlyArray<number>; result: 'pending' | 'delivered' | 'failed'; detail: string }>
}

export const S = {
  questions: seed(),
  rounds,
  sends: [] as Array<SendLog>,
  nextSend: 7,
  offline: new Set<SessionId>(),
  selected: 5,
  page: 'question' as 'question' | 'review' | 'elsewhere',
  filter: 'All' as 'Open' | 'Drafts' | 'All',
  folded: new Set<number>(),
  toasts: [] as Array<Toast>,
  stateOpen: false,
  review: { excluded: new Set<number>(), message: '' },
  ui: {} as Record<string, unknown>,
}

export const byId = (id: number) => S.questions.find(q => q.id === id)!
export const roundOf = (n: number) => S.rounds.find(r => r.n === n)!
export const isDraft = (q: Question) => q.answer.state === 'draft'
export const drafts = (round?: number) =>
  S.questions.filter(q => isDraft(q) && (round === undefined || q.round === round))
export const answerText = (q: Question) => {
  const a = q.answer
  if (a.state === 'open') return ''
  if (a.choice === '?') return a.own
  return q.options.find(o => o.key === a.choice)?.label ?? ''
}
export const groupBySession = (ids: ReadonlyArray<number>) => {
  const groups: Array<{ session: SessionId; ids: Array<number> }> = []
  for (const id of ids) {
    const s = byId(id).session
    const g = groups.find(x => x.session === s)
    g ? g.ids.push(id) : groups.push({ session: s, ids: [id] })
  }
  return groups
}
export const recipientsLine = (ids: ReadonlyArray<number>) =>
  groupBySession(ids)
    .map(g => `${g.ids.length} to ${to(g.session)}`)
    .join(' · ')
export const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`
const clock = () =>
  new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

let toastId = 1
export const toast = (t: Omit<Toast, 'id'>, ms = 6000) => {
  const id = toastId++
  S.toasts.push({ ...t, id })
  if (!t.sticky) setTimeout(() => dismiss(id), ms)
  render()
  return id
}
export const dismiss = (id: number) => {
  S.toasts = S.toasts.filter(t => t.id !== id)
  render()
}

// Mirrors the real path: one POST with a `questions` subset; the server freezes one
// submission, then delivers one message per asking session (ADR 0005, 0011).
export const sendAnswers = (ids: ReadonlyArray<number>, message = '') => {
  const live = ids.filter(id => isDraft(byId(id)))
  if (live.length === 0) return
  const n = S.nextSend++
  const log: SendLog = {
    n,
    at: clock(),
    ids: live,
    message,
    deliveries: groupBySession(live).map(g => ({ ...g, result: 'pending', detail: 'Frozen, delivering' })),
  }
  S.sends.push(log)
  for (const id of live) {
    const q = byId(id)
    const a = q.answer as Extract<Answer, { state: 'draft' }>
    q.answer = { state: 'sending', choice: a.choice, own: a.own, at: a.at, send: n }
  }
  const pending = toast(
    { kind: 'pending', html: `Send #${n} frozen · delivering ${plural(live.length, 'answer')}: ${recipientsLine(live)}`, sticky: true },
  )
  log.deliveries.forEach((d, i) => {
    setTimeout(() => {
      const ok = !S.offline.has(d.session)
      d.result = ok ? 'delivered' : 'failed'
      d.detail = ok ? `Delivered to ${to(d.session)}` : `${sessions[d.session].address} did not accept the message (prototype: marked offline)`
      for (const id of d.ids) {
        const q = byId(id)
        const a = q.answer as Extract<Answer, { state: 'sending' }>
        q.answer = ok
          ? { state: 'sent', choice: a.choice, own: a.own, send: n, sentAt: clock() }
          : { state: 'draft', choice: a.choice, own: a.own, at: a.at, failure: `Not delivered in send #${n}: ${d.detail}` }
      }
      if (log.deliveries.every(x => x.result !== 'pending')) {
        dismiss(pending)
        settle(log)
      }
      render()
    }, 900 + i * 500)
  })
  render()
}

const settle = (log: SendLog) => {
  const ok = log.deliveries.filter(d => d.result === 'delivered')
  const failed = log.deliveries.filter(d => d.result === 'failed')
  const failedIds = failed.flatMap(d => d.ids)
  if (failed.length === 0) {
    toast({ kind: 'ok', html: `Send #${log.n} delivered · ${ok.map(d => `${plural(d.ids.length, 'answer')} to ${to(d.session)}`).join(' · ')}` })
    return
  }
  toast(
    {
      kind: 'fail',
      sticky: true,
      html:
        (ok.length > 0 ? `Send #${log.n} partly delivered. ${ok.map(d => `${to(d.session)} got ${plural(d.ids.length, 'answer')}`).join('; ')}. ` : `Send #${log.n} was not delivered. `) +
        `${failed.map(d => `${plural(d.ids.length, 'answer')} for ${to(d.session)}`).join('; ')} stayed unsent as drafts.`,
      actions: [{ act: 'retry', label: `Retry ${failedIds.length}`, data: failedIds.join(',') }],
    },
  )
}

export const setAnswer = (id: number, choice: string) => {
  const q = byId(id)
  if (q.answer.state === 'sent' || q.answer.state === 'sending') return
  const own = q.answer.state === 'draft' ? q.answer.own : ''
  q.answer = choice === '?' && own === ''
    ? { state: 'draft', choice, own: '', at: clock() }
    : { state: 'draft', choice, own, at: clock(), held: q.answer.state === 'draft' ? q.answer.held === true : false }
}
export const isReady = (q: Question) =>
  q.answer.state === 'draft' && (q.answer.choice !== '?' || q.answer.own.trim() !== '')

// ---------- rendering ----------

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export type Hooks = {
  id: 'A' | 'B' | 'C'
  name: string
  blurb: string
  headerActions?: () => string
  roundExtra?: (round: Round) => string
  rowExtra?: (q: Question) => string
  afterAnswer?: (q: Question) => string
  overlay?: () => string
  actions?: Record<string, (el: HTMLElement, ev: Event) => void>
  keydown?: (ev: KeyboardEvent) => boolean
  leave?: (where: string) => boolean
  stateExtra?: () => string
  barExtra?: () => string
}
let hooks: Hooks

const VARIANTS = [
  { id: 'A', port: 4371, dir: 'send-shortcuts-a', name: 'Send from the queue' },
  { id: 'B', port: 4372, dir: 'send-shortcuts-b', name: 'Send where you answer' },
  { id: 'C', port: 4373, dir: 'send-shortcuts-c', name: 'Unsent tray and nudge' },
] as const
const variantUrl = (i: number) => {
  const v = VARIANTS[(i + VARIANTS.length) % VARIANTS.length]!
  return `http://127.0.0.1:${v.port}/prototypes/${v.dir}/`
}

export const markOf = (q: Question) => {
  const a = q.answer
  const state =
    a.state === 'draft' && a.failure ? 'failed' : a.state === 'draft' && a.held ? 'held' : a.state
  const label = { open: 'Open', draft: 'Draft · not sent', held: 'Draft · kept back', failed: 'Not delivered · still a draft', sending: 'Sending', sent: 'Sent' }[state]
  return `<span class="state-mark ${state} ${q.urgency}" title="${label}" aria-label="${label}"></span>`
}
export const stateLabel = (q: Question) => {
  const a = q.answer
  if (a.state === 'open') return 'Open'
  if (a.state === 'sending') return `Sending · send #${a.send} frozen`
  if (a.state === 'sent') return `Sent · send #${a.send} · ${a.sentAt}`
  if (a.failure) return 'Not delivered · still a draft'
  if (a.held) return 'Draft · kept back'
  return 'Draft · not sent'
}

const visibleIn = (round: number) =>
  S.questions.filter(
    q =>
      q.round === round &&
      (S.filter === 'All' ||
        (S.filter === 'Open' && q.answer.state === 'open') ||
        (S.filter === 'Drafts' && (q.answer.state === 'draft' || q.answer.state === 'sending'))),
  )

const sidebar = () => `
<aside class="sidebar">
  <nav class="rail" aria-label="Pages">
    <div class="rail-brand">gf</div>
    <button data-act="go" data-where="question" class="${S.page !== 'elsewhere' ? 'active' : ''}" title="Questions">Q</button>
    <button data-act="go" data-where="needs" title="Needs you">!</button>
    <button data-act="go" data-where="grills" title="Your grills">≡</button>
  </nav>
  <div class="queue">
    <div class="queue-head">
      <strong>Squad questions</strong>
      <div class="filters">${(['Open', 'Drafts', 'All'] as const)
        .map(f => `<button data-act="filter" data-f="${f}" class="${S.filter === f ? 'active' : ''}">${f}</button>`)
        .join('')}</div>
    </div>
    <div class="queue-scroll">
      ${[...S.rounds].reverse().map(r => {
        const rows = visibleIn(r.n)
        const all = S.questions.filter(q => q.round === r.n)
        const sent = all.filter(q => q.answer.state === 'sent').length
        const folded = S.folded.has(r.n)
        return `<section class="round">
          <div class="round-head">
            <button class="round-toggle" data-act="fold" data-round="${r.n}" aria-expanded="${!folded}">
              <span class="chevron${folded ? '' : ' down'}"></span>
              <span>${esc(r.name)}</span><small>${sent}/${all.length} sent</small>
            </button>
            ${hooks.roundExtra?.(r) ?? ''}
          </div>
          ${folded ? '' : `<ul>${rows
            .map(
              q => `<li class="row-wrap${S.selected === q.id && S.page === 'question' ? ' selected' : ''}">
                <button class="question-row" data-act="select" data-id="${q.id}" title="${esc(q.short)} · ${stateLabel(q)} · asked by ${to(q.session)}">
                  ${markOf(q)}<span class="question-name">${esc(q.short)}</span>
                  <span class="who">${sessions[q.session].name}</span>
                </button>${hooks.rowExtra?.(q) ?? ''}</li>`,
            )
            .join('')}</ul>`}
        </section>`
      }).join('')}
    </div>
  </div>
</aside>`

const questionView = (q: Question) => {
  const a = q.answer
  const locked = a.state === 'sent' || a.state === 'sending'
  const chosen = a.state === 'open' ? '' : a.choice
  return `<article class="question-content">
    <div class="question-meta">
      <code class="qkey">${q.key}</code>
      <span>Asked by <strong>${to(q.session)}</strong></span>
      <span>${esc(roundOf(q.round).name)} · ${q.posted}</span>
      <span class="question-state">${markOf(q)}${stateLabel(q)}</span>
    </div>
    <h1>${esc(q.title)}</h1>
    <p class="question-intro">${esc(q.intro)}</p>
    ${q.waiting && a.state === 'open' ? `<p class="waiting">${esc(q.waiting)}</p>` : ''}
    <div class="answers${locked ? ' locked' : ''}">
      ${q.options
        .map(
          o => `<button data-act="choose" data-id="${q.id}" data-choice="${o.key}" class="${chosen === o.key ? 'chosen' : ''}" ${locked ? 'disabled' : ''}>
            <span class="option-letter">${o.key}</span>
            <div><strong>${esc(o.label)}</strong>${o.recommended ? ' <small>Recommended</small>' : ''}<p>${esc(o.consequence)}</p></div>
          </button>`,
        )
        .join('')}
      <button data-act="choose" data-id="${q.id}" data-choice="?" class="${chosen === '?' ? 'chosen' : ''}" ${locked ? 'disabled' : ''}>
        <span class="option-letter">?</span><div><strong>My own answer</strong><p>A different choice, in your words.</p></div>
      </button>
      ${chosen === '?' ? `<textarea id="own-${q.id}" data-own="${q.id}" rows="3" placeholder="Your answer" ${locked ? 'disabled' : ''}>${esc(a.state === 'open' ? '' : a.own)}</textarea>` : ''}
    </div>
    ${a.state === 'draft' && a.failure ? `<p class="failure">${esc(a.failure)} <button class="link" data-act="retry" data-ids="${q.id}">Retry this answer</button></p>` : ''}
    ${hooks.afterAnswer?.(q) ?? ''}
    <section class="reasoning">
      <h2>Why this question</h2>
      <p>${esc(q.intro)} The answer goes to ${esc(to(q.session))}, the session that asked it, and lands in its terminal as one message per send.</p>
    </section>
  </article>`
}

const reviewView = () => {
  const all = drafts()
  const chosen = all.filter(q => !S.review.excluded.has(q.id) && isReady(q))
  return `<article class="question-content review">
    <h1>Review & send</h1>
    <p class="question-intro">Today's page, kept in every variant: every unsent draft across rounds, a covering message, and one send.</p>
    ${S.rounds
      .map(r => {
        const ds = all.filter(q => q.round === r.n)
        return ds.length === 0 ? '' : `<h2>${esc(r.name)}</h2><ul class="review-list">${ds
          .map(
            q => `<li><label><input type="checkbox" data-act="review-toggle" data-id="${q.id}" ${S.review.excluded.has(q.id) ? '' : 'checked'}>
              <span><strong>${esc(q.short)}</strong> <code class="qkey">${q.key}</code><br><span class="muted">${esc(answerText(q)) || '<em>No text yet</em>'}</span><br><small>to ${to(q.session)}</small></span></label></li>`,
          )
          .join('')}</ul>`
      })
      .join('')}
    ${all.length === 0 ? '<p class="muted">Nothing left to send.</p>' : ''}
    <textarea id="review-message" data-review-message rows="2" placeholder="Optional message with this send">${esc(S.review.message)}</textarea>
    <p class="muted">${chosen.length ? recipientsLine(chosen.map(q => q.id)) : 'Select answers to send'}</p>
    <button class="primary" data-act="review-send" ${chosen.length ? '' : 'disabled'}>Send ${plural(chosen.length, 'answer')}</button>
  </article>`
}

const elsewhere = () => `<article class="question-content"><h1>Your grills</h1>
  <p class="question-intro">Stand-in for leaving this page. Unsent drafts stay saved on the page either way; they just aren't sent.</p>
  <button class="link" data-act="go" data-where="question">Back to the squad questions</button></article>`

const stateRows = () =>
  `<table><thead><tr><th>question</th><th>to</th><th>state</th><th>answer</th></tr></thead><tbody>${S.questions
    .map(q => `<tr><td>${q.key}</td><td>${sessions[q.session].address}</td><td>${stateLabel(q)}</td><td>${esc(answerText(q)).slice(0, 48)}</td></tr>`)
    .join('')}</tbody></table>
  <p><strong>Sends</strong> ${S.sends.length === 0 ? 'none yet' : ''}</p>
  <ul>${S.sends.map(s => `<li>#${s.n} ${s.at}: ${s.deliveries.map(d => `${sessions[d.session].address} ${d.result} (${d.ids.map(i => byId(i).key).join(', ')})`).join('; ')}</li>`).join('')}</ul>
  ${hooks.stateExtra?.() ?? ''}`

const protoBar = () => {
  const i = VARIANTS.findIndex(v => v.id === hooks.id)
  return `<div class="proto-bar" role="region" aria-label="Prototype controls">
    <a href="${variantUrl(i - 1)}" title="Previous variant (←)">←</a>
    <span><strong>${hooks.id}</strong> ${esc(hooks.name)}</span>
    <a href="${variantUrl(i + 1)}" title="Next variant (→)">→</a>
    <label><input type="checkbox" data-act="offline" ${S.offline.has('homelab') ? 'checked' : ''}> Homelab lanes offline</label>
    ${hooks.barExtra?.() ?? ''}
    <button data-act="state">${S.stateOpen ? 'Hide state' : 'State'}</button>
    <button data-act="reset">Reset</button>
    ${S.stateOpen ? `<div class="state-panel">${stateRows()}</div>` : ''}
  </div>`
}

const toasts = () => `<div class="toasts" aria-live="polite">${S.toasts
  .map(
    t => `<div class="toast ${t.kind}"><span>${t.html}</span>${(t.actions ?? [])
      .map(a => `<button data-act="${a.act}" data-ids="${a.data ?? ''}" data-toast="${t.id}">${esc(a.label)}</button>`)
      .join('')}${t.sticky && t.kind !== 'pending' ? `<button data-act="dismiss" data-toast="${t.id}" aria-label="Dismiss">×</button>` : ''}</div>`,
  )
  .join('')}</div>`

const defaultHeader = () =>
  `<button>Conversations</button><button>Replies</button>
   <button class="primary" data-act="go" data-where="review">Review & send · ${drafts().length}</button>`

const view = () => {
  const q = byId(S.selected)
  return `<div class="study-strip"><strong>Send shortcuts · ${hooks.id} · ${esc(hooks.name)}</strong><span>${esc(hooks.blurb)}</span><span class="muted">Illustrative data · sends are simulated and never leave this page</span></div>
  <header class="topbar"><strong>Squad</strong>
    <span>${S.page === 'review' ? 'Review & send' : S.page === 'elsewhere' ? 'Your grills' : `${esc(roundOf(q.round).name)} · <code class="qkey">${q.key}</code>`}</span>
    <div class="top-actions">${hooks.headerActions?.() ?? defaultHeader()}</div>
  </header>
  <div class="application">${sidebar()}<main class="main-content">${
    S.page === 'review' ? reviewView() : S.page === 'elsewhere' ? elsewhere() : questionView(q)
  }</main></div>
  ${hooks.overlay?.() ?? ''}${toasts()}${protoBar()}`
}

let root: HTMLElement
export const render = () => {
  if (!root) return
  const active = document.activeElement as HTMLTextAreaElement | null
  const focusId = active?.id
  const sel = active && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null
  root.innerHTML = view()
  if (focusId) {
    const el = document.getElementById(focusId) as HTMLTextAreaElement | null
    if (el) {
      el.focus()
      if (sel && 'setSelectionRange' in el) el.setSelectionRange(sel[0] ?? null, sel[1] ?? null)
    }
  }
}

export const go = (where: string) => {
  if (where !== 'question' && where !== 'review' && hooks.leave?.(where)) return
  S.page = where === 'review' ? 'review' : where === 'question' ? 'question' : 'elsewhere'
  render()
}

export const typing = (t: EventTarget | null) =>
  t instanceof Element && t.closest('input, textarea, select, [contenteditable]') !== null

const ids = (el: HTMLElement) =>
  (el.dataset.ids ?? '').split(',').filter(Boolean).map(Number)

export const mount = (h: Hooks) => {
  hooks = h
  root = document.getElementById('root')!
  const base: Record<string, (el: HTMLElement, ev: Event) => void> = {
    select: el => {
      S.selected = Number(el.dataset.id)
      S.page = 'question'
      render()
    },
    choose: el => {
      setAnswer(Number(el.dataset.id), el.dataset.choice!)
      render()
      if (el.dataset.choice === '?') document.getElementById(`own-${el.dataset.id}`)?.focus()
    },
    fold: el => {
      const n = Number(el.dataset.round)
      S.folded.has(n) ? S.folded.delete(n) : S.folded.add(n)
      render()
    },
    filter: el => {
      S.filter = el.dataset.f as typeof S.filter
      render()
    },
    go: el => go(el.dataset.where!),
    retry: el => {
      if (el.dataset.toast) dismiss(Number(el.dataset.toast))
      sendAnswers(ids(el))
    },
    dismiss: el => dismiss(Number(el.dataset.toast)),
    state: () => {
      S.stateOpen = !S.stateOpen
      render()
    },
    reset: () => location.reload(),
    offline: el => {
      ;(el as HTMLInputElement).checked ? S.offline.add('homelab') : S.offline.delete('homelab')
      render()
    },
    'review-toggle': el => {
      const id = Number(el.dataset.id)
      S.review.excluded.has(id) ? S.review.excluded.delete(id) : S.review.excluded.add(id)
      render()
    },
    'review-send': () => {
      const chosen = drafts().filter(q => !S.review.excluded.has(q.id) && isReady(q))
      sendAnswers(chosen.map(q => q.id), S.review.message)
      S.review.message = ''
    },
  }
  const actions = { ...base, ...(h.actions ?? {}) }
  document.addEventListener('click', ev => {
    const el = (ev.target as Element).closest<HTMLElement>('[data-act]')
    if (!el || el.tagName === 'INPUT') return
    const fn = actions[el.dataset.act!]
    if (fn) {
      ev.preventDefault()
      fn(el, ev)
    }
  })
  document.addEventListener('change', ev => {
    const el = ev.target as HTMLElement
    if (el.tagName === 'INPUT' && el.dataset.act) actions[el.dataset.act]?.(el, ev)
  })
  document.addEventListener('input', ev => {
    const el = ev.target as HTMLTextAreaElement
    if (el.dataset.own) {
      const q = byId(Number(el.dataset.own))
      if (q.answer.state === 'draft') {
        q.answer.own = el.value
        q.answer.at = clock()
      }
    }
    if ('reviewMessage' in el.dataset) S.review.message = el.value
  })
  // Re-render after typing settles so counters and send controls catch up.
  document.addEventListener('focusout', ev => {
    if ((ev.target as HTMLElement).dataset?.own) setTimeout(render, 0)
  })
  document.addEventListener('keydown', ev => {
    if (h.keydown?.(ev)) return
    if (typing(ev.target) || ev.metaKey || ev.ctrlKey || ev.altKey) return
    const i = VARIANTS.findIndex(v => v.id === h.id)
    if (ev.key === 'ArrowLeft') location.href = variantUrl(i - 1)
    if (ev.key === 'ArrowRight') location.href = variantUrl(i + 1)
  })
  render()
}
