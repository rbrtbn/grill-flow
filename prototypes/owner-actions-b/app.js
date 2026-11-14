// PROTOTYPE B · By place. "To do" groups owner actions by where Rob carries them out, so one trip
// to t2hq clears every line typed there. Status stays a separate page (the case for keeping
// Updates apart), reduced to one current card per run, with holds pinned on top.
import {
  mount, header, headerCount, state, counts, esc, md, ago, urgencyChip, stateChip, where, placeKey, routeLine,
  doneLine, buttons, stepsList, originLine, heldBadge, refresh, sessions,
} from '../owner-actions-shared/chrome.js'

let tab = 'todo'
let selected = 'type-card-16'

const places = [
  { key: 'terminal:t2hq', label: 'In t2hq', sub: sessions.t2hq.label, address: 't2hq' },
  { key: 'terminal:t2cr', label: 'In t2cr', sub: sessions.t2cr.label, address: 't2cr' },
  { key: 'github', label: 'On GitHub', sub: 'merges only you can do or go' },
  { key: 'linear', label: 'In Linear', sub: 'edits in your name' },
  { key: 'here', label: 'On this page', sub: 'the page can do these' },
]

const mark = a =>
  `<span class="mk mk-${a.progress.state}" aria-hidden="true">${a.progress.state === 'completed' ? '✓' : a.progress.state === 'reported' ? '…' : ''}</span>`

const listRow = a => `<button type="button" class="lr ${selected === a.id ? 'is-sel' : ''} p-${a.progress.state}" data-ui="select" data-id="${esc(a.id)}">
    ${mark(a)}
    <span class="lr-t">${md(a.title)}${a.progress.state === 'open' && a.copy && !a.steps ? `<code class="lr-line">${esc(a.copy)}</code>` : ''}</span>
    <span class="lr-r">${a.progress.state === 'open' ? urgencyChip(a.urgency) : stateChip(a)}${heldBadge(a)}</span>
  </button>`

const timeline = a => {
  const events = state.log.filter(l => l.id === a.id).reverse()
  const items = [
    `<li><b>Published</b> by ${esc(a.session)} · ${ago(a.at)}</li>`,
    ...(a.origin?.kind === 'answer' ? [`<li><b>Promised</b> when you answered ${esc(a.origin.question)}</li>`] : []),
    ...events.map(e => `<li><b>${esc(e.event)}</b>${e.outcome ? ` · ${esc(e.outcome)}` : ''}${e.address ? ` · ${esc(e.address)}` : ''}${e.reason ? ` · ${esc(e.reason)}` : ''} · ${ago(e.at)}</li>`),
  ]
  return `<ol class="tl">${items.join('')}</ol>`
}

const detail = a => {
  if (!a) return '<p class="hint">Pick a step.</p>'
  const w = where(a)
  return `<article class="sheet">
    <p class="meta">${stateChip(a)} ${a.progress.state === 'open' ? urgencyChip(a.urgency) : ''} · from ${esc(a.session)} (${esc(sessions[a.session]?.label ?? '')}) · ${ago(a.at)}</p>
    <h2>${md(a.title)}</h2>
    <dl class="facts">
      <dt>Where</dt><dd>${esc(a.host)}${w.kind === 'link' ? ` · <a href="${esc(w.url)}" target="_blank" rel="noreferrer">${esc(w.url.replace('https://', ''))}</a>` : ''}</dd>
      <dt>What</dt><dd>${md(a.action)}</dd>
      ${a.unblocks ? `<dt>Unblocks</dt><dd>${a.unblocks.map(esc).join(' · ')}</dd>` : ''}
    </dl>
    ${originLine(a)}
    <div class="prose">${md(a.body)}</div>
    ${stepsList(a)}
    ${routeLine(a)}
    ${buttons(a)}
    ${doneLine(a)}
    <h3>History</h3>
    ${timeline(a)}
  </article>`
}

const todo = () => {
  const visible = state.actions.filter(a => ['open', 'reported', 'promised'].includes(a.progress.state))
  const done = state.actions.filter(a => ['completed', 'withdrawn'].includes(a.progress.state))
  const groups = places
    .map(p => ({ ...p, items: visible.filter(a => placeKey(a) === p.key) }))
    .filter(g => g.items.length > 0)
  const sel = state.actions.find(a => a.id === selected)
  return `<div class="split">
    <section class="list" aria-label="Your steps by place">
      ${state.holds.filter(h => h.state === 'active').map(h => `<p class="hold-strip">⏸ <b>${esc(h.title)}</b> until ${esc(h.clearsWhen)}</p>`).join('')}
      ${groups
        .map(
          g => `<div class="place">
        <div class="place-h"><div><h2>${g.label}</h2><span class="meta">${esc(g.sub)} · ${g.items.filter(a => a.progress.state === 'open').length} open</span></div>
        ${g.address ? `<button type="button" class="b" data-op="focus" data-id="group:${g.address}" data-address="${g.address}" title="The page does this">Focus ${g.address}</button>` : ''}</div>
        ${g.address ? '<p class="hint tiny">Type each line as its own message: one line answers one card.</p>' : ''}
        ${g.items.map(listRow).join('')}
      </div>`,
        )
        .join('')}
      <details class="place done"><summary>Done · ${done.length}</summary>${done.map(listRow).join('')}</details>
    </section>
    <section class="detail" aria-label="Step detail">${detail(sel)}</section>
  </div>`
}

const status = () => `<section class="status-page">
    <h1>Status</h1>
    <p class="lead">One current card per run. Holds first; a card from a session that has ended is marked stale rather than left looking current.</p>
    ${state.holds
      .map(h => `<div class="hold-card ${h.state}"><b>⏸ ${esc(h.title)}</b> <span class="meta">${esc(h.session)} · ${ago(h.at)}${h.state === 'cleared' ? ' · cleared' : ''}</span><p>${md(h.body)}</p><p class="meta">Blocks ${h.blocks.map(b => `<code>${esc(b)}</code>`).join(' ')} · until ${esc(h.clearsWhen)}</p></div>`)
      .join('')}
    <div class="cards">
    ${state.updates
      .map(
        u => `<article class="scard ${u.stale ? 'is-stale' : ''}"><h2>${esc(u.run)}</h2><p class="meta">${esc(u.session)} · ${ago(u.at)}</p>
      ${u.stale ? `<p class="stale-note">Stale: ${esc(u.stale)}</p>` : ''}
      <dl>${u.lines.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${md(v)}</dd>`).join('')}</dl></article>`,
      )
      .join('')}
    </div>
  </section>`

const render = () => {
  const c = counts()
  const nav =
    headerCount('To do', c.waiting + c.whenever, tab === 'todo', `data-ui="tab" data-tab="todo" title="${c.waiting} when ready or sooner · ${c.whenever} whenever"`) +
    headerCount('Questions', c.questions, false) +
    headerCount('Status', c.stale, tab === 'status', `data-ui="tab" data-tab="status" title="${c.stale} stale"`)
  return `${header(nav)}<main>${tab === 'todo' ? todo() : status()}</main>`
}

mount('B', render, el => {
  if (el.dataset.ui === 'select') {
    selected = el.dataset.id
    refresh()
    return true
  }
  if (el.dataset.ui === 'tab') {
    tab = el.dataset.tab
    refresh()
    return true
  }
  return false
})
