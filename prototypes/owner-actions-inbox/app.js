// PROTOTYPE F · Inbox, D revised after Rob's round-3 feedback (2026-11-14):
// - questions live in the inbox groups as one expandable line each, linking to a filtered
//   Questions page (run, round, urgency);
// - interactive and helper sessions (no orchestrator, no run state) show up beside runs;
// - filters are multi-select facets with saved views, kept in the link;
// - Refresh asks chosen sessions to bring their items, questions or status up to date;
// - Done sits apart, as cards at the bottom.
import {
  mount, state, counts, esc, md, ago, urgencyChip, stateChip, where, placeKey, routeLine,
  doneLine, buttons, stepsList, originLine, heldBadge, copyBox, refresh, sessions, setExtraBar,
} from '../owner-actions-shared/chrome.js'
import { ops, toastBus } from '../owner-actions-shared/store.js'

// ---------- Sessions: run types beyond the orchestrator ----------
// Sample: t2j5, t2j6 and t2j8 are the real helper sessions asking on /g/squad right now.
Object.assign(sessions.t2hq, { type: 'orchestrator', run: 'stage1-t2cr' })
Object.assign(sessions.t2cr, { type: 'lead', run: 'squad-eff' })
Object.assign(sessions.t18v, { type: 'helper', run: 'grill-flow builder' })
Object.assign(sessions.t1mn, { type: 'ended', run: 'squad-eff (overnight)' })
Object.assign(sessions, {
  t2j5: { label: 'owner-actions prototypes', member: 'grill-flow-owner-actions', alive: true, type: 'interactive', lastActive: Date.parse('2026-11-14T03:38:00Z'), lastWhat: 'added two questions' },
  t2j6: { label: 'question-page conversations', member: 'grill-flow-discussion-threads', alive: true, type: 'interactive', lastActive: Date.parse('2026-11-14T03:31:00Z'), lastWhat: 'asked two questions' },
  t2j8: { label: 'send shortcuts', member: 'grill-flow-send-shortcuts', alive: true, type: 'interactive', lastActive: Date.parse('2026-11-14T03:05:00Z'), lastWhat: 'asked three questions' },
})
const TYPES = {
  orchestrator: { label: 'Orchestrated run', note: 'Follows the squad rules: run state, gates, grants through the grant log, one status per run.' },
  lead: { label: 'Squad lead', note: 'Plans and routes the squad’s work; owns the page.' },
  helper: { label: 'Helper', note: 'Builds for the squad and publishes items and status, without a run of its own.' },
  interactive: { label: 'Interactive', note: 'Joined the page only: no run state, gates or status of its own. It reports through questions and items; a line typed there counts in that session only, not across runs.' },
  ended: { label: 'Ended', note: 'Session closed or handed over; what it left is stale until someone takes it over.' },
}

// Extra inbox item from an interactive session, to show how one reads.
if (!state.actions.some(a => a.id === 'review-owner-actions'))
  state.actions.push({
    id: 'review-owner-actions',
    member: 'grill-flow-owner-actions',
    session: 't2j5',
    title: 'Look at the revised Inbox prototype',
    body: 'Variant F answers your round-3 notes: questions inside the groups, filters you can combine and link to, Refresh, interactive sessions, Done apart. Answer the three owner-actions questions after.',
    host: 'this browser',
    destination: 'http://127.0.0.1:4355/owner-actions-inbox/',
    action: 'Open the prototype and switch variants with the bar at the bottom.',
    urgency: 'wait',
    route: 'page',
    routeWhy: 'Opening a page needs no authority.',
    done: 'proof',
    progress: { state: 'open' },
    at: Date.parse('2026-11-14T03:40:00Z'),
  })

// ---------- Questions (the 8 open on /g/squad now, plus two illustrative orchestrator ones) ----------
const QUESTIONS = [
  { id: 'Q397', key: 'session-finder', title: 'How should the messages side find sessions?', context: 'The side keeps only conversations outside a question, and a squad can run a dozen sessions.', urgency: 'soon', session: 't2j6', round: 'Question page conversations' },
  { id: 'Q396', key: 'question-page-conversations', title: 'Which question-page layout do we build?', context: 'Conversations about a question move from the Discussion panel onto the question page.', urgency: 'soon', session: 't2j6', round: 'Question page conversations' },
  { id: 'Q398', key: 'answer-shape', title: 'LAB-1455 gate · answer-shape: one documented shape for owner answers?', context: 'Illustrative: a design gate the orchestrator would ask before LAB-1455 builds.', urgency: 'soon', session: 't2hq', round: 'LAB-1455 design gate' },
  { id: 'Q399', key: 'readback', title: 'LAB-1455 gate · readback: read back a refused answer instead of failing silently?', context: 'Illustrative, same gate.', urgency: 'wait', session: 't2hq', round: 'LAB-1455 design gate' },
  { id: 'Q391', key: 'send-shortcut-variant', title: 'Which send shortcut should be built?', context: 'Three prototypes run locally; until one is picked, sending still means Review & send.', urgency: 'wait', session: 't2j8', round: 'Send shortcuts' },
  { id: 'Q392', key: 'send-guard', title: 'How should a one-click send guard against a slip?', context: 'One-click sends make it easy to send an answer you meant to keep.', urgency: 'wait', session: 't2j8', round: 'Send shortcuts' },
  { id: 'Q393', key: 'cmd-enter-sends', title: 'Should ⌘↵ on a question send its answer?', context: '⌘↵ opens Review & send today, so changing it retrains a habit.', urgency: 'wait', session: 't2j8', round: 'Send shortcuts' },
  { id: 'Q389', key: 'owner-actions-grant-button', title: 'Build an “Answer on page” button for grants now?', context: 'Page answers aren’t grants until you add page to grant_sources.', urgency: 'wait', session: 't2j5', round: 'First prototypes' },
  { id: 'Q394', key: 'owner-actions-batching', title: 'Where should batching live?', context: 'All the merges, or all the lines for one session, in one sitting.', urgency: 'wait', session: 't2j5', round: 'Combined prototype' },
  { id: 'Q395', key: 'owner-actions-names', title: 'Which set of names should the pages use?', context: 'One vocabulary before any copy is written.', urgency: 'fyi', session: 't2j5', round: 'Combined prototype' },
]

// ---------- Names: the four Rob kept are locked; the rest are improved suggestions ----------
const SLOTS = [
  { key: 'inbox', label: 'Catch-up page', options: ['Inbox'], locked: true },
  { key: 'questions', label: 'Questions page', options: ['Questions'], locked: true },
  { key: 'runs', label: 'Runs page', options: ['Runs'], locked: true },
  { key: 'conversations', label: 'Conversations page', options: ['Conversations'], locked: true },
  { key: 'item', label: 'Something only you can do', options: ['Task', 'Action item', 'To-do', 'Request'], why: 'Inbox now holds questions too; “Task” names the do-something kind and pairs with Inbox the way Asana and Linear use it.' },
  { key: 'now', label: 'Urgency groups', options: ['Now · Next · Later', 'Urgent · Up next · Later', 'Today · This week · Someday'], why: 'Kept: the roadmap convention reads at a glance.' },
  { key: 'promised', label: 'An agent owes you this later', options: ['Waiting on agent', 'Upcoming', 'Expected', 'Pending'], why: '“Waiting on agent” mirrors the support-desk “Waiting on customer”: it says who holds it.' },
  { key: 'checking', label: 'You said done, agent confirming', options: ['Confirming', 'Verifying', 'In review', 'Awaiting proof'], why: 'Shorter than “Awaiting proof” and not confused with PR review.' },
  { key: 'hold', label: 'Don’t do X yet', options: ['Freeze', 'Hold', 'Do not', 'Paused'], why: 'Kept: a change freeze is the operations term.' },
  { key: 'status', label: 'Where a run stands', options: ['Status', 'Run status', 'Progress'], why: '“Status” also fits sessions that aren’t runs.' },
  { key: 'thread', label: 'Messages on a task', options: ['Thread', 'Comments', 'Messages'], why: 'Kept.' },
  { key: 'done', label: 'Finished, kept for reference', options: ['Recently done', 'Done', 'Completed', 'Archive'], why: '“Recently” says the cards age out and aren’t a to-do list.' },
  { key: 'refresh', label: 'Ask sessions to bring things up to date', options: ['Request update', 'Refresh', 'Sync', 'Re-check'], why: '“Refresh” suggests reloading the page; “Request update” says a message goes to the agents.' },
  { key: 'filter', label: 'Filter control', options: ['Filter', 'Show', 'Narrow'], why: 'The standard word.' },
  { key: 'views', label: 'Saved filter sets', options: ['Views', 'Saved filters', 'Presets'], why: 'Linear, Jira and GitHub all call them views.' },
  { key: 'tray', label: 'Header quick look', options: ['Inbox', 'Quick look', 'Peek'], why: 'Same word as the page it previews.' },
  { key: 'interactive', label: 'Sessions without a run', options: ['Interactive', 'Helper', 'Ad hoc', 'Side session'], why: '“Interactive” is what they are: you or an agent working in them directly.' },
]
const names = Object.fromEntries(SLOTS.map(s => [s.key, s.options[0]]))
const N = k => names[k]
const U = u => {
  const [now, next, later] = N('now').split(' · ')
  return u === 'blocking' || u === 'soon' ? now : u === 'wait' ? next : later
}
const bucketOf = u => (u === 'blocking' || u === 'soon' ? 'now' : u === 'wait' ? 'next' : 'later')
const uChip = u => urgencyChip(u).replace(/>[^<]+</, `>${esc(U(u))}<`)
const chip = a =>
  stateChip(a).replace('Coming back to you', esc(N('promised'))).replace('Checking', esc(N('checking'))).replace('>Done<', `>${esc(N('done'))}<`)

// ---------- Inbox entries: tasks and questions share facets ----------
const kindOf = a =>
  a.id.startsWith('merge') ? 'merge' : where(a).kind === 'terminal' ? 'type' : placeKey(a) === 'linear' ? 'edit' : 'page'
const KINDS = { question: 'Questions', merge: 'Merges', type: 'Lines to type', edit: 'Edits', page: 'On this page' }
const PLACES = {
  questions: 'On the Questions page',
  'terminal:t2hq': 'In t2hq',
  'terminal:t2cr': 'In t2cr',
  github: 'On GitHub',
  linear: 'In Linear',
  here: 'In this browser',
}
const taskEntry = a => ({ type: 'task', a, kind: kindOf(a), place: placeKey(a), run: a.session, bucket: a.optional ? 'later' : bucketOf(a.urgency) })
const questionEntry = q => ({ type: 'question', q, kind: 'question', place: 'questions', run: q.session, bucket: bucketOf(q.urgency) })

// ---------- Filters (multi-select facets, kept in the link) ----------
const filters = { kind: new Set(), run: new Set(), urgency: new Set() }
let groupBy = 'urgency'
const VIEWS = [
  { name: 'Everything', f: {} },
  { name: 'Merges and lines to type', f: { kind: ['merge', 'type'] }, group: 'place' },
  { name: 'Just questions', f: { kind: ['question'] }, group: 'run' },
  { name: 'Now only', f: { urgency: ['now'] } },
  { name: 'Interactive sessions', f: { run: ['t2j5', 't2j6', 't2j8'] }, group: 'run' },
]
const readHashQuery = () => new URLSearchParams(location.hash.split('?')[1] ?? '')
const loadFilters = () => {
  const p = readHashQuery()
  for (const k of Object.keys(filters)) filters[k] = new Set((p.get(k) ?? '').split(',').filter(Boolean))
  groupBy = p.get('group') ?? groupBy
}
const filterQuery = (f = filters, group = groupBy) => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(f)) if (v.size) p.set(k, [...v].join(','))
  if (group !== 'urgency') p.set('group', group)
  const s = p.toString()
  return s ? `?${s}` : ''
}
const passes = e =>
  (!filters.kind.size || filters.kind.has(e.kind)) &&
  (!filters.run.size || filters.run.has(e.run)) &&
  (!filters.urgency.size || filters.urgency.has(e.bucket))

// ---------- Refresh (ask sessions for an up-to-date version) ----------
let refreshOpen = new URLSearchParams(location.search).get('refresh') === '1'
const refreshPick = { scope: new Set(['items', 'questions', 'status']), sessions: new Set() }
const refreshLog = []
const refreshedAt = {}
const SCOPES = { items: 'Tasks and freezes', questions: 'Questions', status: 'Status / workflow state' }
const refreshMessage = () =>
  `[grill-flow] Rob asks for an up-to-date version of your ${[...refreshPick.scope].map(s => SCOPES[s].toLowerCase()).join(', ')} on page squad. Check each against the current state: revise what changed, withdraw what is done or no longer needed, add what is missing, then reply on the page.`
const RESPONSES = {
  t2hq: 'Updated: withdrew “Type your waiter answer” (you typed it at 03:20), revised Status, LAB-1455 gate questions unchanged.',
  t2cr: 'Checked: dotfiles#432 and grill-flow#19 still open on you; no change.',
  t18v: 'Checked: browser notifications still off; no change.',
  t2j5: 'Updated: Inbox prototype task now points at variant F; questions still current.',
  t2j6: 'Checked: both questions current.',
  t2j8: 'Rewrote send-guard’s context after the shortcut prototypes changed.',
}
const sendRefresh = targets => {
  const at = state.now
  targets.forEach(s => {
    const entry = { session: s, at, scope: [...refreshPick.scope], state: sessions[s].alive ? 'sent' : 'failed', reply: sessions[s].alive ? '' : 'Not delivered: session ended. Hand its items to another session or retire them.' }
    refreshLog.unshift(entry)
    if (!sessions[s].alive) return
    setTimeout(() => {
      entry.state = 'answered'
      entry.reply = RESPONSES[s] ?? 'Checked; no change.'
      refreshedAt[s] = state.now
      if (s === 't2hq') {
        const w = state.actions.find(a => a.id === 'type-card-15')
        if (w && w.progress.state === 'open') w.progress = { state: 'withdrawn', reason: 'You typed it at 03:20 (grant log gl-3fa1…)' }
      }
      refresh()
    }, 900 + Math.random() * 1600)
  })
  refreshOpen = false
  toastBus.show(`Asked ${targets.length} session${targets.length === 1 ? '' : 's'} for an update. Replies land under the page header.`)
  refresh()
}

// ---------- UI state ----------
const params = new URLSearchParams(location.search)
let trayOpen = params.get('tray') === '1'
let namesOpen = params.get('names') === '1'
let showDone = false
const expanded = new Set()
const qOpen = new Set(params.get('qopen')?.split(',') ?? [])
const threads = {}
let qSelected = null

const route = () => {
  const [path] = location.hash.replace(/^#\/?/, '').split('?')
  const [page, a] = path.split('/')
  return { page: page || 'inbox', a }
}
// Inbox filters live in its link; coming back to a bare #/inbox restores the last ones.
window.addEventListener('hashchange', () => {
  if (route().page === 'inbox') {
    if (location.hash.includes('?')) loadFilters()
    else history.replaceState(null, '', `#/inbox${filterQuery()}`)
  }
  trayOpen = false
  refreshOpen = false
  refresh()
})
loadFilters()

const openTasks = () => state.actions.filter(a => a.progress.state === 'open')
const entries = () => [...openTasks().map(taskEntry), ...QUESTIONS.map(questionEntry)]

// ---------- Header ----------
const header = r => {
  const c = counts()
  const due = entries().filter(e => e.bucket !== 'later')
  const dueQ = due.filter(e => e.type === 'question').length
  const nav = (label, page, extra = '') => `<a class="tb ${r.page === page ? 'is-active' : ''}" href="#/${page}">${label}${extra}</a>`
  return `<header class="bar">
    <div class="brand"><span class="mark">gf</span><b>Squad</b><span class="hint">squad-eff</span></div>
    <nav class="nav">
      <span class="split ${r.page === 'inbox' ? 'is-active' : ''}"><a class="tb" href="#/inbox">${esc(N('inbox'))} <span class="count c-hot" title="${due.length - dueQ} tasks and ${dueQ} questions in ${esc(N('now').split(' · ').slice(0, 2).join(' and '))}">${due.length}</span></a><button type="button" class="tb caret-btn" data-ui="tray" aria-expanded="${trayOpen}" title="${esc(N('tray'))} (.)">▾</button></span>
      ${nav(esc(N('questions')), 'questions', ` <span class="count">${QUESTIONS.length}</span>`)}
      ${nav(esc(N('runs')), 'runs')}
      <a class="tb" href="#/questions">${esc(N('conversations'))}</a>
    </nav>
    <nav class="nav-r">
      ${c.holds ? `<span class="freeze-pill">⏸ ${c.holds} ${esc(N('hold').toLowerCase())}</span>` : ''}
      <button class="tb" type="button">More</button>
    </nav>
  </header>${trayOpen ? tray() : ''}`
}

const tray = () => {
  const es = entries()
  return `<div class="tray" role="dialog" aria-label="${esc(N('tray'))}">
    <div class="tray-h"><b>${esc(N('tray'))}</b><span class="meta">press . to toggle</span></div>
    ${state.holds.filter(h => h.state === 'active').map(h => `<p class="tray-hold">⏸ ${esc(N('hold'))}: ${esc(h.title)}</p>`).join('')}
    ${['now', 'next', 'later']
      .map((b, i) => {
        const tasks = es.filter(e => e.bucket === b && e.type === 'task')
        const qs = es.filter(e => e.bucket === b && e.type === 'question')
        if (!tasks.length && !qs.length) return ''
        return `<h3>${esc(N('now').split(' · ')[i])} · ${tasks.length + qs.length}</h3>
          ${tasks.map(e => `<a class="tray-row" href="#/item/${e.a.id}"><span>${md(e.a.title)}</span><span class="meta">${esc(PLACES[e.place] ?? e.place)}</span></a>`).join('')}
          ${qs.length ? `<a class="tray-row" href="#/questions?urgency=${b}"><span>❓ ${qs.length} ${qs.length === 1 ? 'question' : 'questions'}</span><span class="meta">${[...new Set(qs.map(e => e.run))].join(', ')}</span></a>` : ''}`
      })
      .join('')}
    <div class="tray-f"><a href="#/inbox">Open ${esc(N('inbox'))}</a><a href="#/runs">Open ${esc(N('runs'))}</a></div>
  </div>`
}

// ---------- Page action: Request update ----------
const pageActions = (sessionsInView, label) => `<div class="page-actions">
    <button type="button" class="b" data-ui="refresh" aria-expanded="${refreshOpen}">⟳ ${esc(N('refresh'))} ▾</button>
    ${refreshOpen ? refreshMenu(sessionsInView, label) : ''}
  </div>`
const refreshMenu = (inView, label) => {
  if (!refreshPick.sessions.size) inView.forEach(s => refreshPick.sessions.add(s))
  return `<div class="refresh-menu" role="dialog" aria-label="${esc(N('refresh'))}">
    <h3>What to bring up to date</h3>
    ${Object.entries(SCOPES).map(([k, l]) => `<label class="ck"><input type="checkbox" data-ui="rscope" data-v="${k}" ${refreshPick.scope.has(k) ? 'checked' : ''}> ${esc(l)}</label>`).join('')}
    <h3>Which sessions <span class="meta">(${esc(label)})</span></h3>
    <div class="ck-grid">${Object.entries(sessions)
      .map(([s, info]) => `<label class="ck ${info.alive ? '' : 'dim'}"><input type="checkbox" data-ui="rsess" data-v="${s}" ${refreshPick.sessions.has(s) ? 'checked' : ''}> ${s} <span class="meta">${esc(TYPES[info.type]?.label ?? '')}${info.alive ? '' : ' · ended'}</span></label>`)
      .join('')}</div>
    <h3>Message</h3>
    <p class="msg-preview">${esc(refreshMessage())}</p>
    <p class="hint small">Delivered like a page ask (typed into each session). It asks for an update; it grants nothing.</p>
    <div class="btns"><button type="button" class="b b-primary" data-ui="rsend">Send to ${refreshPick.sessions.size}</button><button type="button" class="b b-ghost" data-ui="refresh">Cancel</button></div>
  </div>`
}
const refreshStrip = () =>
  refreshLog.length
    ? `<div class="refresh-strip"><b>${esc(N('refresh'))}</b> ${ago(refreshLog[refreshLog.length - 1].at)}: ${refreshLog
        .slice(0, 8)
        .map(e => `<span class="rs rs-${e.state}" title="${esc(e.reply)}">${e.session} ${e.state === 'sent' ? '…' : e.state === 'answered' ? '✓' : '✕'}</span>`)
        .join(' ')}
        <details><summary>Replies</summary><ul>${refreshLog.filter(e => e.reply).map(e => `<li><b>${e.session}</b>: ${esc(e.reply)}</li>`).join('')}</ul></details></div>`
    : ''

// ---------- Inbox ----------
const filterBar = () => {
  const es = entries()
  const facet = (key, label, opts) => `<div class="facet"><span class="vb-k">${label}</span><div class="pills">${opts
    .map(([v, l]) => {
      const n = es.filter(e => (key === 'urgency' ? e.bucket : e[key]) === v).length
      return `<button type="button" class="pill ${filters[key].has(v) ? 'on' : ''}" data-ui="facet" data-k="${key}" data-v="${v}" aria-pressed="${filters[key].has(v)}">${filters[key].has(v) ? '✓ ' : ''}${esc(l)} <span class="n">${n}</span></button>`
    })
    .join('')}</div></div>`
  const active = Object.values(filters).some(s => s.size)
  return `<section class="filters">
    <div class="views"><span class="vb-k">${esc(N('views'))}</span>${VIEWS.map(v => `<button type="button" class="view ${isView(v) ? 'on' : ''}" data-ui="view" data-v="${esc(v.name)}">${esc(v.name)}</button>`).join('')}<button type="button" class="view add" data-ui="saveview" title="Save the current filters as a view">+ Save view</button></div>
    ${facet('kind', N('filter'), Object.entries(KINDS))}
    ${facet('urgency', 'Urgency', [['now', U('soon')], ['next', U('wait')], ['later', U('fyi')]])}
    ${facet('run', 'Session', Object.keys(sessions).filter(s => sessions[s].alive).map(s => [s, s]))}
    <div class="facet"><span class="vb-k">Group by</span><div class="seg">${[['urgency', 'Urgency'], ['place', 'Where'], ['kind', 'Kind'], ['run', 'Session']].map(([k, l]) => `<button type="button" data-ui="groupby" data-v="${k}" class="${groupBy === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    ${active ? `<button type="button" class="b b-ghost clear" data-ui="clear">Clear filters</button>` : ''}
    <button type="button" class="b b-ghost" data-ui="copylink" title="Copy a link to this exact view">Copy link</button></div>
  </section>`
}
const isView = v =>
  Object.keys(filters).every(k => {
    const want = new Set(v.f[k] ?? [])
    return want.size === filters[k].size && [...want].every(x => filters[k].has(x))
  }) && (v.group ?? 'urgency') === groupBy

const taskRow = a => {
  const isOpen = expanded.has(a.id)
  const quick = !isOpen && a.copy && !a.steps
  const fresh = refreshedAt[a.session] ? `<span class="fresh" title="${a.session} confirmed this ${ago(refreshedAt[a.session])}">↻</span>` : ''
  return `<article class="item">
    <div class="item-head">
      <button type="button" class="caret" data-ui="toggle" data-id="${a.id}" aria-expanded="${isOpen}" aria-label="Expand">${isOpen ? '▾' : '▸'}</button>
      ${uChip(a.urgency)}
      <a class="t" href="#/item/${a.id}">${md(a.title)}</a>${heldBadge(a)}${fresh}
      ${sessionTag(a.session)}
      <span class="place">${esc(PLACES[placeKey(a)] ?? a.host)}</span>
    </div>
    ${quick ? `<div class="quick">${copyBox(a.id, a.copy, 'Copy')}${where(a).kind === 'terminal' ? `<button type="button" class="b" data-ui="copyFocus" data-id="${a.id}">Copy &amp; focus ${where(a).address}</button>` : ''}</div>` : ''}
    ${isOpen ? `<div class="item-body">${originLine(a)}<div class="prose">${md(a.body)}</div>${stepsList(a)}${routeLine(a)}${buttons(a)}${doneLine(a)}<a class="more" href="#/item/${a.id}">Details &amp; ${esc(N('thread').toLowerCase())} ›</a></div>` : ''}
  </article>`
}
const sessionTag = s => {
  const t = sessions[s]?.type
  return `<a class="stag st-${t}" href="#/runs/${s}" title="${esc(TYPES[t]?.note ?? '')}">${s}${t === 'interactive' ? ` · ${esc(N('interactive').toLowerCase())}` : ''}</a>`
}

// One line per group for its questions; expands inline, links to the filtered Questions page.
const questionLine = (qs, groupKey, query) => {
  if (!qs.length) return ''
  const id = `q:${groupKey}`
  const isOpen = qOpen.has(id)
  const runs = [...new Set(qs.map(e => e.run))]
  return `<article class="item qline">
    <div class="item-head">
      <button type="button" class="caret" data-ui="qtoggle" data-id="${id}" aria-expanded="${isOpen}" aria-label="Show questions">${isOpen ? '▾' : '▸'}</button>
      <span class="qbadge">❓ ${qs.length}</span>
      <button type="button" class="t qt" data-ui="qtoggle" data-id="${id}">${qs.length === 1 ? 'question' : 'questions'} to answer</button>
      <span class="meta">${runs.map(sessionTagText).join(', ')}</span>
      <a class="more" href="#/questions${query}">Answer ›</a>
    </div>
    ${isOpen ? `<ul class="qinline">${qs.map(e => `<li><a href="#/questions?q=${e.q.id}">${uChip(e.q.urgency)} <span class="qref">${e.q.id}</span> <b>${esc(e.q.title)}</b></a><span class="meta">${esc(e.q.key)} · ${e.q.session} · ${esc(e.q.round)}</span><p>${esc(e.q.context)}</p></li>`).join('')}</ul>` : ''}
  </article>`
}
const sessionTagText = s => (sessions[s]?.type === 'interactive' ? `${s} (${N('interactive').toLowerCase()})` : s)

const group = (key, title, es, extra = {}) => {
  const tasks = es.filter(e => e.type === 'task')
  const qs = es.filter(e => e.type === 'question')
  if (!tasks.length && !qs.length) return ''
  const base = new URLSearchParams()
  if (extra.q) Object.entries(extra.q).forEach(([k, v]) => base.set(k, v))
  if (filters.run.size && !base.has('run')) base.set('run', [...filters.run].join(','))
  if (filters.urgency.size && !base.has('urgency')) base.set('urgency', [...filters.urgency].join(','))
  const query = base.toString() ? `?${base}` : ''
  return `<section class="group"><div class="group-h"><h2>${title} <span class="n">${tasks.length + qs.length}</span></h2>${extra.actions ?? ''}</div>
    ${extra.note ?? ''}${tasks.map(e => taskRow(e.a)).join('')}${questionLine(qs, key, query)}</section>`
}

const inboxPage = () => {
  const es = entries().filter(passes)
  const [lNow, lNext, lLater] = N('now').split(' · ')
  const groups =
    groupBy === 'urgency'
      ? [['now', lNow], ['next', lNext], ['later', lLater]].map(([b, l]) => group(b, esc(l), es.filter(e => e.bucket === b), { q: { urgency: b } }))
      : groupBy === 'place'
        ? Object.entries(PLACES).map(([k, l]) =>
            group(k, esc(l), es.filter(e => e.place === k), {
              actions: k.startsWith('terminal') ? `<button type="button" class="b" data-op="focus" data-id="group:${k.slice(9)}" data-address="${k.slice(9)}">Focus ${k.slice(9)}</button>` : '',
              note: k.startsWith('terminal') ? '<p class="hint small">Type each line as its own message: one line answers one card.</p>' : '',
            }),
          )
        : groupBy === 'kind'
          ? Object.entries(KINDS).map(([k, l]) => group(k, esc(l), es.filter(e => e.kind === k)))
          : Object.keys(sessions).map(s =>
              group(s, `${s} <span class="sub">${esc(sessions[s].label)} · ${esc(TYPES[sessions[s].type].label)}</span>`, es.filter(e => e.run === s), {
                q: { run: s },
                actions: `<a class="more" href="#/runs/${s}">${esc(N('runs'))} ›</a>`,
                note: sessions[s].type === 'interactive' ? `<p class="hint small">${esc(TYPES.interactive.note)}</p>` : '',
              }),
            )
  const sessionsInView = [...new Set(es.map(e => e.run))].filter(s => sessions[s]?.alive)
  const promised = state.actions.filter(a => a.progress.state === 'promised' && passes(taskEntry(a)))
  const confirming = state.actions.filter(a => a.progress.state === 'reported' && passes(taskEntry(a)))
  const done = state.actions.filter(a => ['completed', 'withdrawn'].includes(a.progress.state))
  return `<main class="page">
    <div class="page-h"><h1>${esc(N('inbox'))}</h1>${pageActions(sessionsInView, Object.values(filters).some(f => f.size) ? 'sessions in this view' : 'every session on the page')}</div>
    <p class="lead">Everything the squad needs from you, ${groupBy === 'urgency' ? 'most urgent first' : `grouped by ${groupBy === 'run' ? 'session' : groupBy}`}. Questions sit with the tasks they belong with.</p>
    ${refreshStrip()}
    ${state.holds.filter(h => h.state === 'active').map(h => `<div class="hold"><b>⏸ ${esc(N('hold'))}: ${esc(h.title)}</b> until ${esc(h.clearsWhen)}. <span class="meta">${esc(h.session)} · ${ago(h.at)}</span><p>${md(h.body)}</p></div>`).join('')}
    ${filterBar()}
    ${groups.join('') || '<p class="hint">Nothing matches these filters.</p>'}
    ${promised.length ? `<section class="group"><div class="group-h"><h2>${esc(N('promised'))} <span class="n">${promised.length}</span></h2></div><p class="hint small">An agent owes you these and fills them in when its condition is met.</p>${promised.map(a => `<div class="item"><div class="item-head">${chip(a)} <a class="t" href="#/item/${a.id}">${md(a.title)}</a>${sessionTag(a.session)}<span class="meta">when ${esc(a.progress.until)}</span></div></div>`).join('')}</section>` : ''}
    ${confirming.length ? `<section class="group"><div class="group-h"><h2>${esc(N('checking'))} <span class="n">${confirming.length}</span></h2></div>${confirming.map(taskRow).join('')}</section>` : ''}
    ${statusList()}
    <section class="done-zone">
      <div class="done-h"><h2>${esc(N('done'))} <span class="n">${done.length}</span></h2><button type="button" class="b b-ghost" data-ui="showdone">${showDone ? 'Hide' : 'Show'}</button></div>
      ${showDone ? `<div class="done-cards">${done.map(a => `<a class="dcard" href="#/item/${a.id}"><span class="meta">${esc(a.session)} · ${ago(a.progress.checkedAt ?? a.at)}</span><b>${md(a.title)}</b><span class="meta">${esc(a.progress.proof ?? a.progress.reason ?? '')}</span></a>`).join('')}</div>` : '<p class="hint small">Not actionable; kept here for reference.</p>'}
    </section>
  </main>`
}

const statusList = () => `<section class="group"><div class="group-h"><h2>${esc(N('status'))}</h2><a href="#/runs" class="more">Open ${esc(N('runs'))} ›</a></div>
  ${Object.entries(sessions)
    .filter(([s]) => !filters.run.size || filters.run.has(s))
    .map(([s, info]) => {
      const u = state.updates.find(x => x.session === s)
      const line = u
        ? `${esc(u.lines[0][0])}: ${esc(u.lines[0][1])}`
        : info.type === 'interactive'
          ? `No status published · last active ${ago(info.lastActive)} (${esc(info.lastWhat)})`
          : 'No status published'
      return `<a class="runline ${!info.alive ? 'is-stale' : ''}" href="#/runs/${s}"><b>${s}</b> <span class="stag-in st-${info.type}">${esc(info.type === 'interactive' ? N('interactive') : TYPES[info.type].label)}</span> <span>${esc(info.label)}</span><span class="meta">${line}${u ? ` · ${ago(u.at)}` : ''}</span></a>`
    })
    .join('')}</section>`

// ---------- Runs ----------
const runsPage = focus => {
  const list = focus ? [focus] : Object.keys(sessions)
  const lane = s => {
    const info = sessions[s]
    const t = TYPES[info.type]
    const status = state.updates.find(u => u.session === s)
    const tasks = state.actions.filter(a => a.session === s && ['open', 'reported', 'promised'].includes(a.progress.state))
    const qs = QUESTIONS.filter(q => q.session === s)
    const rounds = [...new Set(qs.map(q => q.round))]
    const onYou = tasks.filter(a => a.progress.state === 'open').length + qs.length
    return `<section class="lane ${info.alive ? '' : 'is-ended'} ${focus ? 'is-focus' : ''} lane-${info.type}">
      <header class="lane-h"><div>
        <h2><a href="#/runs/${s}">${s}</a> <span class="meta">${esc(info.label)}</span></h2>
        <p class="ltype"><span class="stag-in st-${info.type}" title="${esc(t.note)}">${esc(info.type === 'interactive' ? N('interactive') : t.label)}</span>${focus ? ` <span class="meta">${esc(t.note)}</span>` : ''}</p>
        <p class="waiting">${info.alive ? (onYou ? `Waiting on <b>you (${onYou})</b>` : 'Not waiting on you') : 'Session ended · stale'}</p></div>
        ${info.alive ? `<button type="button" class="b" data-op="focus" data-id="lane:${s}" data-address="${s}">Focus</button>` : ''}
      </header>
      ${status
        ? `<details class="lane-status ${status.stale ? 'is-stale' : ''}" ${focus ? 'open' : ''}><summary>${esc(N('status'))} · ${ago(status.at)}${status.stale ? ' · stale' : ''}</summary><dl>${status.lines.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${md(v)}</dd>`).join('')}</dl></details>`
        : `<p class="nostatus">${info.type === 'interactive' ? `No run, so no status. Last active ${ago(info.lastActive)}: ${esc(info.lastWhat)}.` : 'No status published.'} <button type="button" class="linkish" data-ui="askstatus" data-v="${s}">${esc(N('refresh'))}</button></p>`}
      ${tasks.map(a => `<a class="node n-act" href="#/item/${a.id}">${a.progress.state === 'open' ? uChip(a.urgency) : chip(a)} <b>${md(a.title)}</b></a>`).join('')}
      ${qs.length ? `<div class="node n-q"><b>❓ ${qs.length} ${qs.length === 1 ? 'question' : 'questions'}</b> · ${rounds.map(r => `<a href="#/questions?run=${s}&round=${encodeURIComponent(r)}">${esc(r)} (${qs.filter(q => q.round === r).length})</a>`).join(' · ')}</div>` : ''}
      ${!tasks.length && !qs.length ? '<p class="hint">Nothing on you here.</p>' : ''}
    </section>`
  }
  const kinds = ['orchestrator', 'lead', 'helper', 'interactive', 'ended']
  return `<main class="${focus ? 'page' : 'board-wrap'}">
    <div class="runs-h"><h1>${esc(N('runs'))}${focus ? ` › ${esc(focus)}` : ''}</h1>${pageActions(focus ? [focus] : Object.keys(sessions).filter(s => sessions[s].alive), focus ? 'this session' : 'every live session')}</div>
    <p class="lead">Every session on the page: orchestrated runs follow the squad’s rules; ${esc(N('interactive').toLowerCase())} sessions only joined the page and report through questions and tasks.</p>
    ${refreshStrip()}
    ${focus ? '' : `<p class="legend">${kinds.filter(k => Object.values(sessions).some(x => x.type === k)).map(k => `<span class="stag-in st-${k}" title="${esc(TYPES[k].note)}">${esc(k === 'interactive' ? N('interactive') : TYPES[k].label)}</span> <span class="meta">${esc(TYPES[k].note)}</span>`).join('<br>')}</p>`}
    ${focus ? lane(focus) : `<div class="board">${kinds.flatMap(k => Object.keys(sessions).filter(s => sessions[s].type === k)).map(lane).join('')}</div>`}
  </main>`
}

// ---------- Questions page with filters ----------
const questionsPage = () => {
  const p = readHashQuery()
  const run = new Set((p.get('run') ?? '').split(',').filter(Boolean))
  const urg = new Set((p.get('urgency') ?? '').split(',').filter(Boolean))
  const round = p.get('round')
  const only = p.get('q')
  const list = QUESTIONS.filter(q => (!run.size || run.has(q.session)) && (!urg.size || urg.has(bucketOf(q.urgency))) && (!round || q.round === round) && (!only || q.id === only))
  const sel = QUESTIONS.find(q => q.id === (qSelected ?? only)) ?? list[0]
  const chips = [
    ...[...run].map(r => ['run', r, `Session ${r}`]),
    ...[...urg].map(u => ['urgency', u, U(u === 'now' ? 'soon' : u === 'next' ? 'wait' : 'fyi')]),
    ...(round ? [['round', round, `Round “${round}”`]] : []),
    ...(only ? [['q', only, only]] : []),
  ]
  const setQ = (k, v) => {
    const n = new URLSearchParams(p)
    const cur = new Set((n.get(k) ?? '').split(',').filter(Boolean))
    cur.has(v) ? cur.delete(v) : cur.add(v)
    cur.size ? n.set(k, [...cur].join(',')) : n.delete(k)
    n.delete('q')
    return `#/questions${n.toString() ? `?${n}` : ''}`
  }
  const rounds = [...new Set(QUESTIONS.map(q => `${q.session}|${q.round}`))]
  return `<main class="qpage2">
    <div class="page-h"><h1>${esc(N('questions'))}</h1>${pageActions([...new Set(list.map(q => q.session))], 'sessions asking these')}</div>
    ${refreshStrip()}
    <div class="qfilters">
      <div class="facet"><span class="vb-k">Session</span><div class="pills">${[...new Set(QUESTIONS.map(q => q.session))].map(s => `<a class="pill ${run.has(s) ? 'on' : ''}" href="${setQ('run', s)}">${run.has(s) ? '✓ ' : ''}${esc(sessionTagText(s))} <span class="n">${QUESTIONS.filter(q => q.session === s).length}</span></a>`).join('')}</div></div>
      <div class="facet"><span class="vb-k">Urgency</span><div class="pills">${['now', 'next', 'later'].map(b => `<a class="pill ${urg.has(b) ? 'on' : ''}" href="${setQ('urgency', b)}">${urg.has(b) ? '✓ ' : ''}${esc(U(b === 'now' ? 'soon' : b === 'next' ? 'wait' : 'fyi'))} <span class="n">${QUESTIONS.filter(q => bucketOf(q.urgency) === b).length}</span></a>`).join('')}</div></div>
      <div class="facet"><span class="vb-k">Round</span><div class="pills">${rounds.map(r => { const [s, name] = r.split('|'); const n = new URLSearchParams(); n.set('run', s); n.set('round', name); return `<a class="pill ${round === name ? 'on' : ''}" href="#/questions?${n}">${esc(name)} <span class="meta">${s}</span></a>` }).join('')}</div></div>
    </div>
    ${chips.length ? `<p class="active-filters">Showing <b>${list.length}</b> of ${QUESTIONS.length}: ${chips.map(([k, v, l]) => `<a class="fchip" href="${k === 'round' || k === 'q' ? `#/questions${(() => { const n = new URLSearchParams(p); n.delete(k); if (k === 'round') n.delete('run'); return n.toString() ? `?${n}` : '' })()}` : setQ(k, v)}">${esc(l)} ✕</a>`).join(' ')} <a href="#/questions" class="more">Clear all</a></p>` : ''}
    <div class="qgrid">
      <aside class="qlist">${list.map(q => `<button type="button" class="qrow ${sel?.id === q.id ? 'on' : ''}" data-ui="qsel" data-v="${q.id}">${uChip(q.urgency)} <span class="qref">${q.id}</span><span><b>${esc(q.title)}</b><span class="meta">${esc(q.key)} · ${esc(sessionTagText(q.session))} · ${esc(q.round)}</span></span></button>`).join('') || '<p class="hint">No questions match.</p>'}</aside>
      <article class="qbody">${sel ? `<p class="meta">${esc(sel.round)} · asked by ${esc(sessionTagText(sel.session))} · key <code>${esc(sel.key)}</code></p><h2>${esc(sel.title)}</h2><p class="ctx">${esc(sel.context)}</p><div class="qcard"><p class="hint">(Options and answering as on today’s question page.)</p></div>` : ''}</article>
    </div>
  </main>`
}

// ---------- Item page (D's, unchanged apart from names) ----------
const itemPage = id => {
  const a = state.actions.find(x => x.id === id)
  if (!a) return '<main class="page"><p>Not found.</p></main>'
  const w = where(a)
  const msgs = threads[a.id] ?? []
  return `<main class="item-page">
    <nav class="crumbs"><a href="#/inbox">${esc(N('inbox'))}</a> › <a href="#/runs/${a.session}">${esc(a.session)}</a> › ${esc(N('item'))}</nav>
    <div class="ip-grid"><article class="sheet">
      <p class="meta">${chip(a)} ${uChip(a.urgency)} · ${esc(KINDS[kindOf(a)])} · ${sessionTag(a.session)} · ${ago(a.at)}</p>
      <h1>${md(a.title)}</h1>
      <dl class="facts"><dt>Where</dt><dd>${esc(a.host)}${w.kind === 'link' ? ` · <a href="${esc(w.url)}" target="_blank" rel="noreferrer">${esc(w.url.replace(/^https?:\/\//, ''))}</a>` : ''}</dd><dt>What</dt><dd>${md(a.action)}</dd>${a.unblocks ? `<dt>Unblocks</dt><dd>${a.unblocks.map(esc).join(' · ')}</dd>` : ''}</dl>
      ${originLine(a)}<div class="prose">${md(a.body)}</div>${stepsList(a)}${routeLine(a)}${buttons(a)}${doneLine(a)}
    </article>
    <aside class="threadbox"><h2>${esc(N('thread'))} with ${esc(a.session)}</h2>
      <ol class="msgs">${msgs.map(m => `<li class="msg ${m.from === 'rob' ? 'me' : 'agent'}"><span class="who">${m.from === 'rob' ? 'You' : esc(m.from)}</span>${md(m.text)}</li>`).join('') || '<li class="hint">No messages yet.</li>'}</ol>
      <form class="composer" data-id="${a.id}"><textarea name="msg" rows="3" placeholder="Message ${esc(a.session)}…"></textarea><button type="submit" class="b b-primary">Send</button></form>
    </aside></div></main>`
}

const namesPanel = () => `<aside class="names" aria-label="Names">
  <div class="names-h"><h2>Names</h2><button type="button" class="b b-ghost" data-ui="names">Close</button></div>
  <p class="hint small">🔒 kept by you. The rest are my improved picks (first option), each with why; click to swap and see it in place.</p>
  ${SLOTS.map(sl => `<div class="slot"><span class="slot-k">${sl.locked ? '🔒 ' : ''}${esc(sl.label)}</span><div class="opts">${sl.options.map((o, i) => `<button type="button" class="opt ${names[sl.key] === o ? 'on' : ''}" data-ui="name" data-k="${sl.key}" data-v="${esc(o)}" ${sl.locked ? 'disabled' : ''}>${esc(o)}${i === 0 && !sl.locked ? ' ★' : ''}</button>`).join('')}</div>${sl.why ? `<p class="why">${esc(sl.why)}</p>` : ''}</div>`).join('')}
  <button type="button" class="b b-primary" data-ui="copyNames">Copy my picks</button>
</aside>`

const render = () => {
  const r = route()
  const page = r.page === 'runs' ? runsPage(r.a) : r.page === 'item' ? itemPage(r.a) : r.page === 'questions' ? questionsPage() : inboxPage()
  return `${header(r)}${page}${namesOpen ? namesPanel() : ''}`
}

setExtraBar('<button type="button" data-ui="names">Names</button>')

const toggleIn = (set, v) => (set.has(v) ? set.delete(v) : set.add(v))
const pushFilters = () => {
  const r = route()
  history.replaceState(null, '', `#/${r.page}${r.a ? `/${r.a}` : ''}${filterQuery()}`)
}

mount('F', render, (el, e) => {
  const ui = el.dataset.ui
  if (!ui) return false
  if (el.tagName !== 'INPUT') e.preventDefault?.()
  const v = el.dataset.v
  const id = el.dataset.id
  const act = {
    tray: () => (trayOpen = !trayOpen),
    names: () => (namesOpen = !namesOpen),
    toggle: () => toggleIn(expanded, id),
    qtoggle: () => toggleIn(qOpen, id),
    facet: () => (toggleIn(filters[el.dataset.k], v), pushFilters()),
    groupby: () => ((groupBy = v), pushFilters()),
    clear: () => (Object.values(filters).forEach(s => s.clear()), pushFilters()),
    view: () => {
      const view = VIEWS.find(x => x.name === v)
      for (const k of Object.keys(filters)) filters[k] = new Set(view.f[k] ?? [])
      groupBy = view.group ?? 'urgency'
      pushFilters()
    },
    saveview: () => {
      const name = prompt('Name this view', 'My view')
      if (name) VIEWS.push({ name, f: Object.fromEntries(Object.entries(filters).map(([k, s]) => [k, [...s]])), group: groupBy })
    },
    copylink: () => {
      navigator.clipboard?.writeText(location.href).catch(() => {})
      toastBus.show('Copied a link to this view.')
    },
    showdone: () => (showDone = !showDone),
    refresh: () => {
      refreshOpen = !refreshOpen
      refreshPick.sessions.clear()
    },
    rscope: () => toggleIn(refreshPick.scope, v),
    rsess: () => toggleIn(refreshPick.sessions, v),
    rsend: () => sendRefresh([...refreshPick.sessions]),
    askstatus: () => {
      refreshPick.scope = new Set(['status'])
      sendRefresh([v])
    },
    qsel: () => (qSelected = v),
    name: () => (names[el.dataset.k] = v),
    copyNames: () => {
      navigator.clipboard?.writeText(`names: ${SLOTS.map(s => `${s.key}=${names[s.key]}`).join(', ')}`).catch(() => {})
      toastBus.show('Copied your picks.')
    },
    copyFocus: () => {
      const a = state.actions.find(x => x.id === id)
      ops.copy(id, a.copy)
      ops.focus(id, where(a).address)
    },
  }[ui]
  if (!act) return false
  act()
  refresh()
  return true
})

document.addEventListener('submit', e => {
  const form = e.target.closest('.composer')
  if (!form) return
  e.preventDefault()
  const a = state.actions.find(x => x.id === form.dataset.id)
  const text = form.msg.value.trim()
  if (!text) return
  ;(threads[a.id] ??= []).push({ from: 'rob', text })
  refresh()
  setTimeout(() => {
    threads[a.id].push({ from: a.session, text: 'Got it. I will reply here once I have checked.' })
    refresh()
  }, 1000)
})
document.addEventListener('keydown', e => {
  if (e.target.closest('input,textarea,select')) return
  if (e.key === '.') {
    trayOpen = !trayOpen
    refresh()
  }
  if (e.key === 'Escape') {
    trayOpen = false
    refreshOpen = false
    refresh()
  }
})
