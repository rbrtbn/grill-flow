// PROTOTYPE D/E · Combined. Rob's round-2 feedback (2026-11-14): keep A's urgency list as the
// catch-up page, C's Runs page and header dropdown (on every page, Questions included), B's
// batching by place and kind, and B's detail sheet as a full item page with a thread to the
// session. D folds batching into "Group by" on the catch-up page; E adds batch cards and a
// one-at-a-time batch mode. The Names panel swaps every label so Rob can pick the copy.
import {
  mount, state, counts, esc, md, ago, urgencyChip, stateChip, where, placeKey, routeLine,
  doneLine, buttons, stepsList, originLine, heldBadge, copyBox, refresh, sessions, setExtraBar, holdOf,
} from '../owner-actions-shared/chrome.js'
import { ops, toastBus } from '../owner-actions-shared/store.js'

const variant = new URLSearchParams(location.search).get('variant') === 'E' ? 'E' : 'D'

// ---------- Naming ----------
const SLOTS = [
  { key: 'inbox', label: 'Catch-up page (from A)', options: ['Inbox', 'Waiting on you', 'My work', 'Action items', 'Queue'] },
  { key: 'tray', label: 'Header quick look (from C)', options: ['Inbox', 'On you', 'Assigned to you', 'Up next'] },
  { key: 'trayPlace', label: 'Where the quick look opens', options: ['Count on the nav item', 'Bell icon, right of header', 'Both'] },
  { key: 'runs', label: 'Runs page (from C)', options: ['Runs', 'Sessions', 'Agents', 'Activity'] },
  { key: 'questions', label: 'Questions page', options: ['Questions', 'Decisions'] },
  { key: 'item', label: 'One thing to do', options: ['Action item', 'Task', 'To-do', 'Owner step', 'Request'] },
  { key: 'now', label: 'Most urgent group', options: ['Now', 'Do now', 'Urgent', 'Blocking'] },
  { key: 'next', label: 'Second group', options: ['Next', 'Up next', 'When you’re ready', 'Soon'] },
  { key: 'later', label: 'Least urgent group', options: ['Later', 'Whenever', 'Someday', 'Low priority'] },
  { key: 'promised', label: 'Agent will come back with it', options: ['Upcoming', 'Coming back to you', 'Waiting on agent', 'Pending', 'Expected'] },
  { key: 'checking', label: 'You said done, agent verifying', options: ['Verifying', 'Checking', 'In review', 'Awaiting proof'] },
  { key: 'hold', label: 'Don’t do X yet', options: ['Freeze', 'Hold', 'Do not', 'Paused'] },
  { key: 'status', label: 'Run status section', options: ['Run status', 'Where runs stand', 'Status', 'Updates'] },
  { key: 'thread', label: 'Messages on an item', options: ['Thread', 'Comments', 'Conversation', 'Messages'] },
  { key: 'done', label: 'Finished items', options: ['Done', 'Completed', 'Resolved'] },
  { key: 'batch', label: 'Working through a group', options: ['Batch', 'Focus mode', 'Run through', 'Work through'] },
  { key: 'groupby', label: 'Grouping control', options: ['Group by', 'View', 'Sort by'] },
  { key: 'kindType', label: 'Lines typed into a session', options: ['Lines to type', 'Grants & answers', 'Terminal'] },
]
const SETS = [
  {
    name: 'Inbox',
    rec: true,
    note: 'Linear and GitHub call the triage list an Inbox; Now / Next / Later is the roadmap convention; a Freeze is the change-management word for “don’t ship X yet”.',
    values: { inbox: 'Inbox', tray: 'Inbox', trayPlace: 'Count on the nav item', runs: 'Runs', questions: 'Questions', item: 'Action item', now: 'Now', next: 'Next', later: 'Later', promised: 'Upcoming', checking: 'Verifying', hold: 'Freeze', status: 'Run status', thread: 'Thread', done: 'Done', batch: 'Batch', groupby: 'Group by', kindType: 'Lines to type' },
  },
  {
    name: 'My work',
    note: 'Asana and Jira: tasks assigned to you, comments on each, a focus mode to work through them.',
    values: { inbox: 'My work', tray: 'Assigned to you', trayPlace: 'Bell icon, right of header', runs: 'Sessions', questions: 'Decisions', item: 'Task', now: 'Urgent', next: 'Up next', later: 'Later', promised: 'Waiting on agent', checking: 'In review', hold: 'Do not', status: 'Status', thread: 'Comments', done: 'Completed', batch: 'Focus mode', groupby: 'View', kindType: 'Grants & answers' },
  },
  {
    name: 'Waiting on you',
    note: 'Today’s grill-flow voice, extended: plain words over industry terms.',
    values: { inbox: 'Waiting on you', tray: 'On you', trayPlace: 'Count on the nav item', runs: 'Runs', questions: 'Questions', item: 'Owner step', now: 'Do now', next: 'When you’re ready', later: 'Whenever', promised: 'Coming back to you', checking: 'Checking', hold: 'Hold', status: 'Where runs stand', thread: 'Thread', done: 'Done', batch: 'Batch', groupby: 'Group by', kindType: 'Lines to type' },
  },
  {
    name: 'Queue',
    note: 'On-call and ops tools: a queue of requests, blocking first, resolved when closed.',
    values: { inbox: 'Queue', tray: 'Up next', trayPlace: 'Both', runs: 'Agents', questions: 'Questions', item: 'Request', now: 'Blocking', next: 'Next', later: 'Low priority', promised: 'Pending', checking: 'Awaiting proof', hold: 'Freeze', status: 'Status', thread: 'Messages', done: 'Resolved', batch: 'Run through', groupby: 'Sort by', kindType: 'Terminal' },
  },
]
const RECOMMENDED = SETS[0].values
let names = { ...RECOMMENDED }
const N = key => names[key]
const plural = (word, n) => (n === 1 ? word : word.endsWith('y') ? `${word.slice(0, -1)}ies` : word.endsWith('s') ? word : `${word}s`)

// Chips follow the chosen names, so urgency reads Now / Next / Later everywhere.
const chip = a =>
  stateChip(a)
    .replace('Coming back to you', esc(N('promised')))
    .replace('Checking', esc(N('checking')))
    .replace('>Done<', `>${esc(N('done'))}<`)
const uChip = u => urgencyChip(u).replace(/>[^<]+</, `>${esc(N(u === 'blocking' || u === 'soon' ? 'now' : u === 'wait' ? 'next' : 'later'))}<`)

// ---------- Item classification (from B) ----------
const kindOf = a =>
  a.id.startsWith('merge') ? 'merge' : where(a).kind === 'terminal' ? 'type' : placeKey(a) === 'linear' ? 'edit' : 'setup'
const KINDS = () => ({ merge: 'Merges', type: N('kindType'), edit: 'Edits', setup: 'Setup' })
const PLACES = {
  'terminal:t2hq': { label: 'In t2hq', sub: sessions.t2hq.label, address: 't2hq' },
  'terminal:t2cr': { label: 'In t2cr', sub: sessions.t2cr.label, address: 't2cr' },
  github: { label: 'On GitHub', sub: 'merges' },
  linear: { label: 'In Linear', sub: 'edits in your name' },
  here: { label: 'On this page', sub: 'the page can do these' },
}
const bucket = a => (a.urgency === 'blocking' || a.urgency === 'soon' ? 'now' : a.urgency === 'wait' && !a.optional ? 'next' : 'later')

// Detail that B's sheet makes room for, written by the agent when Rob has time to read.
const EXTRA = {
  'type-card-16': { ifWait: 'The revert draft squad#162 stays open and the 25.8.0 bugs stay unfixed, so the plugin freeze stays too.', related: ['LAB-1454', 'squad#162'] },
  'type-card-15': { ifWait: 'Three draft PRs (squad#161, #163, #164) keep idle builders and no reviews start.', related: ['squad#161', 'squad#163', 'squad#164'] },
  'type-card-17': { ifWait: 'LAB-1451 is not amended; its build waits for squad#161 anyway.', related: ['LAB-1451'] },
  'type-card-18': { ifWait: 'LAB-1449 is not amended; its build also waits for squad#157.', related: ['LAB-1449'] },
  'merge-157': { ifWait: 'LAB-1449 never builds, and your grant follow-up on the version-gate answer stays upcoming.', related: ['LAB-1426', 'LAB-1453', 'LAB-1449'] },
  'merge-grill-mod': { ifWait: 'Session titles keep the old grill counts. Nothing else waits.', related: ['dotfiles#432'] },
  'merge-gf-19': { ifWait: 'Agents keep seeing a harmless lint warning on cross-member links.', related: ['grill-flow#19'] },
  'lab-1019-milestone': { ifWait: 'The stage 2 milestone report counts LAB-1019 wrongly.', related: ['LAB-1019'] },
  'admit-1455': { ifWait: 'LAB-1455 waits for a later run.', related: ['LAB-1455'] },
  'q380-grant-followup': { ifWait: 'Runs already going keep the old version gate.', related: ['LAB-1449', 'squad#157'] },
}

// ---------- Threads (B's sheet + Rob's ask: talk to the session on the item itself) ----------
const threads = {
  'merge-157': [
    { from: 'rob', text: 'Can’t you merge this under the overnight grant?', at: Date.parse('2026-11-14T02:50:00Z') },
    { from: 't2hq', text: 'No. It is a round-cap merge that changes merging.md: `squad-check gate` refuses agents, and a page answer can’t back a Cap merge either. Merge it at fcee236e on GitHub; I post proof once I see it merged.', at: Date.parse('2026-11-14T02:51:00Z') },
  ],
}
const QUICK = [
  { key: 'clarify', label: 'Clarify this' },
  { key: 'update', label: 'Update the steps' },
  { key: 'later', label: 'Not now, remind me later' },
  { key: 'instead', label: 'Can you do it instead?' },
]
const replyTo = (a, intent) =>
  ({
    clarify: `${a.title}: ${a.body.split('. ').slice(0, 2).join('. ')}. Ask if any part is still unclear.`,
    update: 'Revised: I re-checked the current state and updated the steps above (revision 2). Nothing else changed.',
    later: 'Moved to Later. I will raise it again if it starts blocking anything.',
    instead:
      a.route === 'yourself'
        ? `I can’t: ${a.routeWhy ?? 'this one needs you.'}`
        : a.route === 'page-answer'
          ? 'Only with a grant I can cite: type the line in t2hq (or, once page is in grant_sources, answer on the page).'
          : 'Not without your typed go; the line above is exactly what I need.',
    free: 'Got it. I will reply here once I have checked.',
  })[intent]

// ---------- UI state ----------
// ?tray=1, ?names=0 and ?group=place open a state directly, for sharing by link.
const params = new URLSearchParams(location.search)
let trayOpen = params.get('tray') === '1'
let namesOpen = params.has('names') ? params.get('names') === '1' : !sessionStorageGet('names-seen')
let groupBy = params.get('group') ?? 'urgency'
let kindFilter = 'all'
let draft = ''
const expanded = new Set()
const batchDone = new Set()

function sessionStorageGet(key) {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}
const route = () => {
  const [page, a, b] = location.hash.replace(/^#\/?/, '').split('/')
  return { page: page || 'inbox', a, b }
}
window.addEventListener('hashchange', () => {
  trayOpen = false
  window.scrollTo(0, 0)
  refresh()
})

const active = () => state.actions.filter(a => ['open', 'reported', 'promised'].includes(a.progress.state))
const open = () => state.actions.filter(a => a.progress.state === 'open')

// ---------- Header with quick look ----------
const header = r => {
  const c = counts()
  const place = N('trayPlace')
  const onNav = place !== 'Bell icon, right of header'
  const bell = place !== 'Count on the nav item'
  const count = `<span class="count ${c.waiting ? 'c-hot' : ''}">${c.waiting}</span>${c.whenever ? `<span class="plus">+${c.whenever}</span>` : ''}`
  const navItem = (label, page, extra = '') =>
    `<a class="tb ${r.page === page ? 'is-active' : ''}" href="#/${page}">${label}${extra}</a>`
  return `<header class="bar">
    <div class="brand"><span class="mark">gf</span><b>Squad</b><span class="hint">squad-eff</span></div>
    <nav class="nav">
      <span class="split ${r.page === 'inbox' ? 'is-active' : ''}">
        <a class="tb" href="#/inbox">${esc(N('inbox'))} ${onNav ? count : ''}</a>${onNav ? `<button type="button" class="tb caret-btn" data-ui="tray" aria-expanded="${trayOpen}" title="Quick look (.)">▾</button>` : ''}
      </span>
      ${navItem(esc(N('questions')), 'questions', ` <span class="count">${c.questions}</span>`)}
      ${navItem(esc(N('runs')), 'runs')}
      <a class="tb" href="#/questions">Conversations</a>
    </nav>
    <nav class="nav-r">
      ${c.holds ? `<span class="freeze-pill" title="${esc(state.holds.find(h => h.state === 'active')?.title ?? '')}">⏸ ${c.holds} ${esc(N('hold').toLowerCase())}</span>` : ''}
      ${bell ? `<button type="button" class="tb bell" data-ui="tray" aria-expanded="${trayOpen}" title="${esc(N('tray'))} (.)">🔔 ${count}</button>` : ''}
      <button class="tb" type="button">More</button>
    </nav>
  </header>${trayOpen ? tray(bell && !onNav) : ''}`
}

const tray = right => {
  const groups = ['now', 'next', 'later'].map(k => [k, open().filter(a => bucket(a) === k)])
  const runsWaiting = Object.keys(sessions)
    .map(s => [s, open().filter(a => a.session === s).length])
    .filter(([, n]) => n)
  return `<div class="tray ${right ? 'at-right' : ''}" role="dialog" aria-label="${esc(N('tray'))}">
    <div class="tray-h"><b>${esc(N('tray'))}</b><span class="meta">press . to toggle</span></div>
    ${state.holds.filter(h => h.state === 'active').map(h => `<p class="tray-hold">⏸ ${esc(N('hold'))}: ${esc(h.title)}</p>`).join('')}
    ${groups
      .filter(([, l]) => l.length)
      .map(([k, l]) => `<h3>${esc(N(k))} · ${l.length}</h3>${l.map(a => `<a class="tray-row" href="#/item/${a.id}"><span>${md(a.title)}</span><span class="meta">${esc(placeLabel(a))}</span></a>`).join('')}`)
      .join('')}
    <h3>By run</h3>
    <div class="tray-runs">${runsWaiting.map(([s, n]) => `<a href="#/runs/${s}" class="chip-link">${s} · ${n}</a>`).join('')}</div>
    <div class="tray-f">
      <a href="#/inbox">Open ${esc(N('inbox'))}</a><a href="#/runs">Open ${esc(N('runs'))}</a>
      <span class="meta">${counts().promised} ${esc(N('promised').toLowerCase())} · ${counts().checking} ${esc(N('checking').toLowerCase())}</span>
    </div>
  </div>`
}

const placeLabel = a => (where(a).kind === 'terminal' ? where(a).address : PLACES[placeKey(a)]?.label.replace(/^(On|In) /, '') ?? a.host)

// ---------- Rows ----------
const row = a => {
  const isOpen = expanded.has(a.id)
  const quick = !isOpen && a.progress.state === 'open' && a.copy && !a.steps
  return `<article class="item p-${a.progress.state}">
    <div class="item-head">
      <button type="button" class="caret" data-ui="toggle" data-id="${a.id}" aria-expanded="${isOpen}" aria-label="Expand">${isOpen ? '▾' : '▸'}</button>
      ${a.progress.state === 'open' ? uChip(a.urgency) : chip(a)}
      <a class="t" href="#/item/${a.id}">${md(a.title)}</a>
      ${heldBadge(a)}
      ${threads[a.id]?.length ? `<span class="meta" title="${esc(N('thread'))}">💬 ${threads[a.id].length}</span>` : ''}
      <span class="place">${esc(placeLabel(a))}</span>
    </div>
    ${quick ? `<div class="quick">${copyBox(a.id, a.copy, 'Copy')}${where(a).kind === 'terminal' ? `<button type="button" class="b" data-ui="copyFocus" data-id="${a.id}" title="Copies the line and brings ${where(a).address} forward; you paste and press Enter">Copy &amp; focus ${where(a).address}</button>` : ''}</div>` : ''}
    ${isOpen ? `<div class="item-body">${originLine(a)}<div class="prose">${md(a.body)}</div>${stepsList(a)}${routeLine(a)}${buttons(a)}${doneLine(a)}<a class="more" href="#/item/${a.id}">Details &amp; ${esc(N('thread').toLowerCase())} ›</a></div>` : ''}
  </article>`
}

const section = (title, items, note = '', actions = '') =>
  items.length === 0
    ? ''
    : `<section class="group"><div class="group-h"><h2>${title} <span class="n">${items.length}</span></h2>${actions}</div>${note}${items.map(row).join('')}</section>`

const freezeBanner = () =>
  state.holds
    .filter(h => h.state === 'active')
    .map(h => `<div class="hold"><b>⏸ ${esc(N('hold'))}: ${esc(h.title)}</b> until ${esc(h.clearsWhen)}. <span class="meta">${esc(h.session)} · ${ago(h.at)}</span><p>${md(h.body)} Covers ${h.blocks.map(b => `<code>${esc(b)}</code>`).join(' ')}.</p></div>`)
    .join('')

const runStatusList = () => `<section class="group"><div class="group-h"><h2>${esc(N('status'))}</h2><a href="#/runs" class="more">Open ${esc(N('runs'))} ›</a></div>
  ${state.updates
    .map(u => {
      const s = sessions[u.session]
      const waiting = open().filter(a => a.session === u.session).length
      return `<a class="runline ${u.stale ? 'is-stale' : ''}" href="#/runs/${u.session}"><b>${esc(u.session)}</b> <span>${esc(u.run)}</span> <span class="meta">${u.stale ? 'stale · session ended' : `${waiting ? `waiting on you (${waiting})` : 'not waiting on you'} · ${esc(u.lines[0][0].toLowerCase())}`} · ${ago(u.at)}</span></a>`
    })
    .join('')}</section>`

const groupControl = () => {
  const all = active()
  const kinds = KINDS()
  return `<div class="viewbar">
    <span class="vb-k">${esc(N('groupby'))}</span>
    <div class="seg">${[['urgency', 'Urgency'], ['place', 'Where'], ['kind', 'Kind'], ['run', 'Run']].map(([k, l]) => `<button type="button" data-ui="groupby" data-v="${k}" class="${groupBy === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <span class="vb-k">Show</span>
    <div class="seg">${[['all', 'All'], ...Object.entries(kinds)].map(([k, l]) => `<button type="button" data-ui="kind" data-v="${k}" class="${kindFilter === k ? 'on' : ''}">${esc(l)}${k === 'all' ? '' : ` ${all.filter(a => kindOf(a) === k).length}`}</button>`).join('')}</div>
  </div>`
}

const batchCards = () => {
  const o = open()
  const cards = [
    ...Object.entries(PLACES)
      .filter(([k]) => k.startsWith('terminal'))
      .map(([k, p]) => ({ key: `place:${k}`, n: o.filter(a => placeKey(a) === k).length, label: `${N('kindType')} ${p.label.toLowerCase()}`, sub: p.sub })),
    { key: 'kind:merge', n: o.filter(a => kindOf(a) === 'merge').length, label: 'Merges on GitHub', sub: 'merge, then any follow-up command' },
    { key: 'kind:edit', n: o.filter(a => kindOf(a) === 'edit').length, label: 'Edits in Linear', sub: 'in your name' },
  ].filter(c => c.n)
  return `<section class="batches"><h2>${esc(N('batch'))}</h2><div class="bcards">${cards
    .map(c => `<a class="bcard" href="#/batch/${encodeURIComponent(c.key)}"><b>${c.n}</b><span>${esc(c.label)}</span><span class="meta">${esc(c.sub)}</span><span class="go">Start ›</span></a>`)
    .join('')}</div></section>`
}

// ---------- Pages ----------
const inboxPage = () => {
  const items = active().filter(a => kindFilter === 'all' || kindOf(a) === kindFilter)
  const openItems = items.filter(a => a.progress.state === 'open')
  const grouped = () => {
    if (groupBy === 'urgency' || variant === 'E')
      return [
        section(esc(N('now')), openItems.filter(a => bucket(a) === 'now')),
        section(esc(N('next')), openItems.filter(a => bucket(a) === 'next')),
        `<section class="group"><div class="group-h"><h2>${esc(N('questions'))} to answer <span class="n">${state.questions.length}</span></h2><a href="#/questions" class="more">Open ›</a></div>${state.questions.map(q => `<a href="#/questions" class="qrow">${uChip(q.urgency)} <span class="qref">${q.id}</span> ${esc(q.title)}</a>`).join('')}</section>`,
        section(esc(N('later')), openItems.filter(a => bucket(a) === 'later')),
      ].join('')
    if (groupBy === 'place')
      return Object.entries(PLACES)
        .map(([k, p]) =>
          section(
            `${p.label} <span class="sub">${esc(p.sub)}</span>`,
            openItems.filter(a => placeKey(a) === k),
            p.address ? '<p class="hint small">Type each line as its own message: one line answers one card.</p>' : '',
            p.address ? `<button type="button" class="b" data-op="focus" data-id="group:${p.address}" data-address="${p.address}">Focus ${p.address}</button>` : '',
          ),
        )
        .join('')
    if (groupBy === 'kind') return Object.entries(KINDS()).map(([k, l]) => section(esc(l), openItems.filter(a => kindOf(a) === k))).join('')
    return Object.keys(sessions)
      .map(s => section(`${s} <span class="sub">${esc(sessions[s].label)}</span>`, openItems.filter(a => a.session === s), '', `<a class="more" href="#/runs/${s}">${esc(N('runs'))} ›</a>`))
      .join('')
  }
  return `<main class="page">
    <h1>${esc(N('inbox'))}</h1>
    <p class="lead">Everything the squad needs from you, most urgent first. Come back here after time away to unblock runs quickly.</p>
    ${freezeBanner()}
    ${variant === 'E' ? batchCards() : groupControl()}
    ${grouped()}
    ${section(esc(N('promised')), items.filter(a => a.progress.state === 'promised'), '<p class="hint small">An agent owes you these and fills them in when its condition is met. Not counted yet.</p>')}
    ${section(esc(N('checking')), items.filter(a => a.progress.state === 'reported'), '<p class="hint small">You said done; the agent confirms with proof.</p>')}
    ${runStatusList()}
    ${section(esc(N('done')), state.actions.filter(a => ['completed', 'withdrawn'].includes(a.progress.state)))}
  </main>`
}

const runsPage = focus => {
  const lanes = focus ? [focus] : Object.keys(sessions)
  const laneHtml = s => {
    const info = sessions[s]
    const status = state.updates.find(u => u.session === s)
    const mine = state.actions.filter(a => a.session === s)
    const items = mine.filter(a => ['open', 'reported', 'promised'].includes(a.progress.state)).sort((x, y) => (y.origin?.kind === 'answer') - (x.origin?.kind === 'answer'))
    const done = mine.filter(a => ['completed', 'withdrawn'].includes(a.progress.state))
    const onYou = items.filter(a => a.progress.state === 'open').length
    const promises = [...new Set(items.filter(a => a.progress.state === 'promised').map(a => a.progress.until))]
    const log = state.log.filter(l => mine.some(a => a.id === l.id))
    return `<section class="lane ${info.alive ? '' : 'is-ended'} ${focus ? 'is-focus' : ''}">
      <header class="lane-h"><div>
        <h2><a href="#/runs/${s}">${esc(s)}</a> <span class="meta">${esc(info.label)}</span></h2>
        <p class="waiting">${info.alive ? `Waiting on ${[onYou ? `<b>you (${onYou})</b>` : '', ...promises.map(esc)].filter(Boolean).join(' · ') || 'nothing from you'}` : 'Session ended · last status is stale'}</p></div>
        ${info.alive ? `<button type="button" class="b" data-op="focus" data-id="lane:${s}" data-address="${s}">Focus</button>` : ''}
      </header>
      ${state.holds.filter(h => h.session === s && h.state === 'active').map(h => `<div class="hold small-hold">⏸ ${esc(N('hold'))}: ${esc(h.title)}</div>`).join('')}
      ${status ? `<details class="lane-status ${status.stale ? 'is-stale' : ''}" ${focus ? 'open' : ''}><summary>${status.stale ? '<span class="st st-skip">stale</span> ' : ''}${esc(N('status'))} · ${ago(status.at)}</summary>${status.stale ? `<p class="stale-note">${esc(status.stale)}</p>` : ''}<dl>${status.lines.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${md(v)}</dd>`).join('')}</dl></details>` : ''}
      ${items
        .map(
          a => `<div class="thread-node">
          ${a.origin ? `<div class="node n-q">${originLine(a)}</div><div class="arrow">↓</div>` : ''}
          <a class="node n-act p-${a.progress.state}" href="#/item/${a.id}">${a.progress.state === 'open' ? uChip(a.urgency) : chip(a)} <b>${md(a.title)}</b> ${heldBadge(a)}${a.progress.state === 'promised' ? `<span class="promise">⧗ when ${esc(a.progress.until)}</span>` : ''}</a>
        </div>`,
        )
        .join('') || '<p class="hint">Nothing on you here.</p>'}
      ${focus ? `<h3 class="sub-h">What happened</h3><ol class="tl">${[...done.map(a => `<li>✓ <b>${md(a.title)}</b> · ${esc(a.progress.proof ?? a.progress.reason ?? '')}</li>`), ...log.map(l => `<li>${esc(l.event)} · ${esc(l.id)} · ${ago(l.at)}</li>`)].join('') || '<li class="hint">Nothing recorded on this page yet.</li>'}</ol>` : done.length ? `<p class="meta">${done.length} ${esc(N('done').toLowerCase())}</p>` : ''}
    </section>`
  }
  return `<main class="${focus ? 'page' : 'board-wrap'}">
    <div class="runs-h"><h1>${esc(N('runs'))}${focus ? ` › ${esc(focus)}` : ''}</h1>
    <div class="seg">${['all', ...Object.keys(sessions)].map(s => `<a href="#/runs${s === 'all' ? '' : `/${s}`}" class="${(focus ?? 'all') === s ? 'on' : ''}">${s === 'all' ? 'All' : s}</a>`).join('')}</div></div>
    <p class="lead">Where every session is, what it is waiting on, and what each of your answers turned into. Pick one run to unblock it first.</p>
    <div class="${focus ? '' : 'board'}">${lanes.map(laneHtml).join('')}</div>
  </main>`
}

const itemPage = id => {
  const a = state.actions.find(x => x.id === id)
  if (!a) return '<main class="page"><p>Not found.</p></main>'
  const w = where(a)
  const ex = EXTRA[a.id] ?? {}
  const msgs = threads[a.id] ?? []
  const events = state.log.filter(l => l.id === a.id).reverse()
  return `<main class="item-page">
    <nav class="crumbs"><a href="#/inbox">${esc(N('inbox'))}</a> › <a href="#/runs/${a.session}">${esc(a.session)}</a> › ${esc(N('item'))}</nav>
    <div class="ip-grid">
    <article class="sheet">
      <p class="meta">${chip(a)} ${a.progress.state === 'open' ? uChip(a.urgency) : ''} · ${esc(KINDS()[kindOf(a)])} · from ${esc(a.session)} (${esc(sessions[a.session]?.label ?? '')}) · ${ago(a.at)}</p>
      <h1>${md(a.title)}</h1>
      <dl class="facts">
        <dt>Where</dt><dd>${esc(a.host)}${w.kind === 'link' ? ` · <a href="${esc(w.url)}" target="_blank" rel="noreferrer">${esc(w.url.replace('https://', ''))}</a>` : ''}</dd>
        <dt>What</dt><dd>${md(a.action)}</dd>
        ${a.unblocks ? `<dt>Unblocks</dt><dd>${a.unblocks.map(esc).join(' · ')}</dd>` : ''}
        ${ex.ifWait ? `<dt>If you wait</dt><dd>${md(ex.ifWait)}</dd>` : ''}
        ${ex.related ? `<dt>Related</dt><dd>${ex.related.map(r => `<span class="qref">${esc(r)}</span>`).join(' ')}</dd>` : ''}
      </dl>
      ${originLine(a)}
      <div class="prose">${md(a.body)}</div>
      ${stepsList(a)}
      ${routeLine(a)}
      ${buttons(a)}${a.progress.state === 'open' && w.kind === 'terminal' && a.copy ? `<div class="btns"><button type="button" class="b b-primary" data-ui="copyFocus" data-id="${a.id}">Copy &amp; focus ${w.address}</button></div>` : ''}
      ${doneLine(a)}
      <h3>History</h3>
      <ol class="tl"><li><b>Published</b> by ${esc(a.session)} · ${ago(a.at)}</li>${events.map(e => `<li><b>${esc(e.event)}</b>${e.outcome ? ` · ${esc(e.outcome)}` : ''} · ${ago(e.at)}</li>`).join('')}</ol>
    </article>
    <aside class="threadbox" aria-label="${esc(N('thread'))}">
      <h2>${esc(N('thread'))} with ${esc(a.session)}</h2>
      <p class="hint small">Goes to ${esc(a.session)} the way page asks do; its reply lands here, on this ${esc(N('item').toLowerCase())}, not in the discussion panel.</p>
      <ol class="msgs">${msgs.map(m => `<li class="msg ${m.from === 'rob' ? 'me' : 'agent'}"><span class="who">${m.from === 'rob' ? 'You' : esc(m.from)} · ${ago(m.at)}</span>${md(m.text)}</li>`).join('') || '<li class="hint">No messages yet.</li>'}</ol>
      <div class="quickasks">${QUICK.map(q => `<button type="button" class="chip" data-ui="ask" data-id="${a.id}" data-intent="${q.key}">${esc(q.label)}</button>`).join('')}</div>
      <form class="composer" data-id="${a.id}"><textarea name="msg" rows="3" placeholder="Message ${esc(a.session)}…">${esc(draft)}</textarea><button type="submit" class="b b-primary">Send</button></form>
    </aside>
    </div>
  </main>`
}

const batchPage = (key, index) => {
  const raw = decodeURIComponent(key)
  const by = raw.split(':')[0]
  const value = raw.slice(by.length + 1)
  const list = state.actions.filter(
    a => (by === 'place' ? placeKey(a) === value : kindOf(a) === value) && (a.progress.state === 'open' || batchDone.has(a.id)),
  )
  const first = Math.max(list.findIndex(a => a.progress.state === 'open'), 0)
  const i = index === undefined ? first : Number(index)
  const a = list[i]
  const title = by === 'place' ? `${N('kindType')} ${PLACES[value].label.toLowerCase()}` : value === 'merge' ? 'Merges on GitHub' : 'Edits in Linear'
  const left = list.filter(x => x.progress.state === 'open').length
  return `<main class="batch">
    <nav class="crumbs"><a href="#/inbox">${esc(N('inbox'))}</a> › ${esc(N('batch'))}</nav>
    <div class="batch-h"><h1>${esc(N('batch'))}: ${esc(title)}</h1><span class="meta">${list.length - left} of ${list.length} done</span></div>
    <div class="batch-grid">
      <ol class="batch-list">${list.map((x, n) => `<li class="${n === i ? 'cur' : ''} p-${x.progress.state}"><a href="#/batch/${key}/${n}">${x.progress.state === 'open' ? '○' : '●'} ${md(x.title)}</a></li>`).join('')}</ol>
      ${a ? `<article class="batch-card">
        <p class="meta">${uChip(a.urgency)} ${chip(a)} · ${esc(a.session)}</p>
        <h2>${md(a.title)}</h2>
        ${originLine(a)}
        <div class="prose">${md(a.body)}</div>
        ${a.steps ? stepsList(a) : a.copy ? `<div class="bigcopy">${copyBox(a.id, a.copy, 'Copy')}</div>` : ''}
        ${routeLine(a)}
        ${a.progress.state === 'open'
          ? `<div class="btns">
          ${where(a).kind === 'terminal' && a.copy ? `<button type="button" class="b b-primary" data-ui="copyFocus" data-id="${a.id}">1 · Copy &amp; focus ${where(a).address}</button>` : where(a).kind === 'link' ? `<button type="button" class="b b-primary" data-op="open" data-id="${a.id}" data-url="${esc(where(a).url)}">1 · Open ${esc(where(a).url.replace('https://github.com/', '').replace('https://linear.app/rbrtbn/issue/', ''))} ↗</button>` : ''}
          <button type="button" class="b" data-ui="batchDone" data-id="${a.id}" data-key="${key}" data-i="${i}">2 · I did it, next ›</button>
          <button type="button" class="b b-ghost" data-ui="batchSkip" data-key="${key}" data-i="${i}">Skip ›</button>
          <a class="more" href="#/item/${a.id}">${esc(N('thread'))} ›</a></div>`
          : doneLine(a)}
      </article>` : `<article class="batch-card"><h2>${esc(N('batch'))} finished</h2><p>Each one you marked waits for its agent’s proof under ${esc(N('checking'))}.</p><a class="b" href="#/inbox">Back to ${esc(N('inbox'))}</a></article>`}
    </div>
  </main>`
}

const questionsPage = () => `<main class="qpage">
  <aside class="qlist">${state.questions.map((q, n) => `<a href="#/questions" class="qrow ${n === 0 ? 'on' : ''}">${uChip(q.urgency)} <span class="qref">${q.id}</span> ${esc(q.title)}</a>`).join('')}</aside>
  <article class="qbody">
    <p class="meta">${esc(N('questions'))} · squad-eff-clp-lead · cache-key</p>
    <h1>LAB-1452 gate · cache-key: key the run cache by head commit?</h1>
    <p class="hint">(Illustrative stand-in for the real question page. Open the quick look from the header: it overlays this page, so you check what is on you without leaving the question.)</p>
    <div class="qcard"><p><b>Should the run cache be keyed by the PR’s head commit?</b></p><p>a · Head commit (recommended)</p><p>b · Branch name</p></div>
  </article>
</main>`

const namesPanel = () => `<aside class="names" aria-label="Names">
  <div class="names-h"><h2>Names</h2><button type="button" class="b b-ghost" data-ui="names">Close</button></div>
  <p class="hint small">Every label on the page follows these. Pick a set, then change single words. ★ marks my pick.</p>
  <div class="sets">${SETS.map(s => `<button type="button" class="set ${SLOTS.every(sl => names[sl.key] === s.values[sl.key]) ? 'on' : ''}" data-ui="set" data-v="${esc(s.name)}"><b>${esc(s.name)}${s.rec ? ' ★' : ''}</b><span>${esc(s.note)}</span></button>`).join('')}</div>
  ${SLOTS.map(sl => `<div class="slot"><span class="slot-k">${esc(sl.label)}</span><div class="opts">${sl.options.map(o => `<button type="button" class="opt ${names[sl.key] === o ? 'on' : ''}" data-ui="name" data-k="${sl.key}" data-v="${esc(o)}">${esc(o)}${RECOMMENDED[sl.key] === o ? ' ★' : ''}</button>`).join('')}</div></div>`).join('')}
  <button type="button" class="b b-primary" data-ui="copyNames">Copy my picks</button>
  <p class="hint small">Paste them into your answer on the squad page.</p>
</aside>`

const render = () => {
  const r = route()
  const page =
    r.page === 'runs' ? runsPage(r.a) : r.page === 'item' ? itemPage(r.a) : r.page === 'batch' ? batchPage(r.a, r.b) : r.page === 'questions' ? questionsPage() : inboxPage()
  return `${header(r)}${page}${namesOpen ? namesPanel() : ''}`
}

setExtraBar('<button type="button" data-ui="names">Names</button>')

const sendMessage = (id, text, intent = 'free') => {
  const a = state.actions.find(x => x.id === id)
  if (!text.trim()) return
  ;(threads[id] ??= []).push({ from: 'rob', text, at: state.now })
  state.log.unshift({ at: state.now, event: 'thread-message', id, to: a.session })
  draft = ''
  refresh()
  setTimeout(() => {
    threads[id].push({ from: a.session, text: replyTo(a, intent), at: state.now + 60_000 })
    if (intent === 'later') a.urgency = 'fyi'
    if (intent === 'update') state.log.unshift({ at: state.now, event: 'item-published', id, revision: 2 })
    refresh()
  }, 1200)
}

mount(variant, render, (el, e) => {
  const ui = el.dataset.ui
  const id = el.dataset.id
  if (!ui) return false
  e.preventDefault?.()
  const act = {
    tray: () => (trayOpen = !trayOpen),
    names: () => {
      namesOpen = !namesOpen
      try {
        sessionStorage.setItem('names-seen', '1')
      } catch {}
    },
    toggle: () => (expanded.has(id) ? expanded.delete(id) : expanded.add(id)),
    groupby: () => (groupBy = el.dataset.v),
    kind: () => (kindFilter = el.dataset.v),
    set: () => (names = { ...SETS.find(s => s.name === el.dataset.v).values }),
    name: () => (names[el.dataset.k] = el.dataset.v),
    copyNames: () => {
      const text = `names: ${SLOTS.map(s => `${s.key}=${names[s.key]}`).join(', ')}`
      navigator.clipboard?.writeText(text).catch(() => {})
      toastBus.show('Copied your picks.')
    },
    copyFocus: () => {
      const a = state.actions.find(x => x.id === id)
      ops.copy(id, a.copy)
      ops.focus(id, where(a).address)
      toastBus.show(`Copied and focused ${where(a).address}: paste, press Enter, then mark it done.`)
    },
    ask: () => sendMessage(id, QUICK.find(q => q.key === el.dataset.intent).label, el.dataset.intent),
    batchDone: () => {
      batchDone.add(id)
      ops.report(id)
      location.hash = `#/batch/${el.dataset.key}/${Number(el.dataset.i) + 1}`
    },
    batchSkip: () => (location.hash = `#/batch/${el.dataset.key}/${Number(el.dataset.i) + 1}`),
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
  sendMessage(form.dataset.id, form.msg.value)
})
document.addEventListener('input', e => {
  if (e.target.name === 'msg') draft = e.target.value
})
document.addEventListener('keydown', e => {
  if (e.target.closest('input,textarea,select')) return
  if (e.key === '.') {
    trayOpen = !trayOpen
    refresh()
  }
  if (e.key === 'Escape' && trayOpen) {
    trayOpen = false
    refresh()
  }
})
