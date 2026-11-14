// PROTOTYPE chrome shared by the three variants: header shell, action anatomy helpers,
// floating variant bar with simulations, state drawer, toast and click delegation.
import { state, subscribe, ops, simulate, counts, byId, holdOf, isHeld, toastBus, refresh } from './store.js'
import { sessions } from './data.js'

export const VARIANTS = [
  { key: 'A', name: 'One list', port: 4351 },
  { key: 'B', name: 'By place', port: 4352 },
  { key: 'C', name: 'By conversation', port: 4353 },
  { key: 'D', name: 'Combined · views', port: 4354, path: '/owner-actions-combined/?variant=D' },
  { key: 'E', name: 'Combined · batches', port: 4354, path: '/owner-actions-combined/?variant=E' },
  { key: 'F', name: 'Inbox (D revised)', port: 4355, path: '/owner-actions-inbox/' },
]
const variantUrl = v => `${location.protocol}//${location.hostname}:${v.port}${v.path ?? '/'}`

export const esc = s =>
  String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
export const md = s =>
  esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\[\[([^\]]+)\]\]/g, '<span class="ref">$1</span>')

export const ago = t => {
  const m = Math.round((state.now - t) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 36) return `${h} h ago`
  return `${Math.round(h / 24)} days ago`
}

export const urgencyChip = u => `<span class="u u-${u}">${{ blocking: 'Blocking', soon: 'Soon', wait: 'When ready', fyi: 'Whenever' }[u]}</span>`

export const stateChip = a =>
  ({
    promised: '<span class="st st-promised">Coming back to you</span>',
    open: '<span class="st st-open">On you</span>',
    reported: '<span class="st st-reported">Checking</span>',
    completed: '<span class="st st-done">Done</span>',
    withdrawn: '<span class="st st-skip">Skipped</span>',
  })[a.progress.state]

export const where = a =>
  typeof a.destination === 'string'
    ? { kind: 'link', label: a.host, url: a.destination }
    : { kind: 'terminal', label: `${a.destination.address} · ${sessions[a.destination.address]?.label ?? 'session'}`, address: a.destination.address }

export const placeKey = a => {
  const w = where(a)
  if (w.kind === 'terminal') return `terminal:${w.address}`
  if (w.url.includes('github.com')) return 'github'
  if (w.url.includes('linear.app')) return 'linear'
  return 'here'
}

export const routeLine = a => {
  if (a.progress.state === 'promised') return `<p class="route r-wait">${esc(a.session)} fills this in when ${esc(a.progress.until)}.</p>`
  const why = a.routeWhy ? ` ${md(a.routeWhy)}` : ''
  switch (a.route) {
    case 'page':
      return `<p class="route r-page"><b>The page can do this.</b>${why}</p>`
    case 'page-answer':
      return state.pageGrants
        ? `<p class="route r-grant"><b>One click counts:</b> a page answer is a PAGE grant ${esc(a.session)} cites.${why}</p>`
        : `<p class="route r-type"><b>Type it in ${esc(where(a).kind === 'terminal' ? where(a).address : a.session)}.</b> A page answer isn't a grant while grant_sources is desktop+cli.${why}</p>`
    case 'type':
      return `<p class="route r-type"><b>Type it yourself.</b>${why}</p>`
    default:
      return `<p class="route r-you"><b>Only you.</b>${why}</p>`
  }
}

export const doneLine = a =>
  a.progress.state === 'completed'
    ? `<p class="done-line">✓ ${esc(a.progress.proof)} · ${ago(a.progress.checkedAt)}</p>`
    : a.progress.state === 'reported'
      ? `<p class="done-line pending">You said done (${esc(a.progress.via)}). Waiting for ${esc(a.session)}'s proof.</p>`
      : `<p class="done-line hint">${{ proof: `Done when ${esc(a.session)} posts proof.`, mark: 'Done when you mark it.', page: 'Done when the page records it.' }[a.done]}</p>`

const btn = (op, id, label, { kind = '', extra = '', disabled = false, title = '' } = {}) =>
  `<button type="button" class="b ${kind}" data-op="${op}" data-id="${esc(id)}" ${extra} ${disabled ? 'aria-disabled="true"' : ''} title="${esc(title)}">${label}</button>`

export const copyBox = (id, text, label = 'Copy') =>
  `<div class="copybox"><code>${esc(text)}</code>${btn('copy', id, label, { kind: 'b-ghost', extra: `data-text="${esc(text)}"`, title: 'The page does this: copies to your clipboard' })}</div>`

export const buttons = a => {
  if (!['open'].includes(a.progress.state)) {
    if (a.progress.state === 'reported') return `<div class="btns">${btn('proof', a.id, `Simulate ${esc(a.session)}'s proof`, { kind: 'b-sim' })}</div>`
    return ''
  }
  const w = where(a)
  const out = []
  if (a.route === 'page') out.push(btn('pageDo', a.id, 'Turn on here', { kind: 'b-primary', title: 'The page acts: browser permission prompt' }))
  if (a.route === 'page-answer')
    out.push(
      btn('pageAnswer', a.id, state.pageGrants ? 'Send as page answer' : 'Send as page answer', {
        kind: state.pageGrants ? 'b-primary' : 'b-off',
        title: state.pageGrants ? 'Counts as a PAGE grant (grant_sources lists page)' : 'Off: grant_sources is desktop+cli',
      }),
    )
  if (w.kind === 'terminal') out.push(btn('focus', a.id, `Focus ${esc(w.address)}`, { extra: `data-address="${esc(w.address)}"`, title: 'The page does this: herdr-app do agent.focus' }))
  if (w.kind === 'link' && a.route !== 'page') out.push(btn('open', a.id, `Open ${esc(w.label.replace(/^GitHub · |^Linear · /, ''))} ↗`, { extra: `data-url="${esc(w.url)}"` }))
  if (a.route !== 'page') out.push(btn('report', a.id, a.done === 'mark' ? 'Mark done' : 'I did it', { kind: 'b-ghost', title: 'Records your report; agent proof still decides done' }))
  if (a.optional) out.push(btn('skip', a.id, 'Skip', { kind: 'b-ghost' }))
  return `<div class="btns">${out.join('')}</div>`
}

export const stepsList = a =>
  a.steps
    ? `<ol class="steps">${a.steps
        .map((s, i) => {
          const held = s.heldBy && holdOf(s.heldBy)?.state === 'active'
          return `<li class="${held ? 'held' : ''}"><span>${md(s.text)}</span>${s.copy ? copyBox(`${a.id}#${i}`, s.copy) : ''}${s.link ? ` <a href="${esc(s.link)}" target="_blank" rel="noreferrer">${esc(s.link.replace('https://github.com/', ''))} ↗</a>` : ''}${held ? `<p class="held-note">⏸ Held: ${esc(holdOf(s.heldBy).title)} until ${esc(holdOf(s.heldBy).clearsWhen)}.</p>` : ''}</li>`
        })
        .join('')}</ol>`
    : a.copy && a.progress.state !== 'promised'
      ? copyBox(a.id, a.copy, 'Copy line')
      : ''

export const originLine = a => {
  const o = a.origin
  if (!o) return ''
  if (o.kind === 'answer')
    return `<div class="origin"><span class="o-k">From your answer</span> <a href="#" class="qref">${esc(o.question)}</a> ${esc(o.title)} · <b>${esc(o.answer)}</b><blockquote>${esc(o.note)}</blockquote></div>`
  if (o.kind === 'card') return `<div class="origin"><span class="o-k">Your page pick</span> card <code>${esc(o.card)}</code>: <b>${esc(o.pagePick)}</b></div>`
  if (o.kind === 'questions')
    return `<div class="origin"><span class="o-k">Your page picks</span> ${esc(o.label)}: ${o.questions.map(q => `<a href="#" class="qref">${q}</a>`).join(' ')}</div>`
  return ''
}

export const heldBadge = a => (isHeld(a) ? '<span class="st st-held" title="A hold blocks one of its steps">⏸ part held</span>' : '')

// Header shell; variants supply the nav.
export const header = nav => `
  <header class="bar">
    <div class="brand"><span class="mark">gf</span><b>Squad</b><span class="hint">squad-eff · Open for you</span></div>
    <nav class="nav">${nav}</nav>
    <nav class="nav-r"><button class="tb" type="button">More</button></nav>
  </header>`

export const headerCount = (label, n, active, extra = '') =>
  `<button type="button" class="tb ${active ? 'is-active' : ''}" ${extra}>${label}${n > 0 ? ` <span class="count">${n}</span>` : ''}</button>`

let extraBar = ''
export const setExtraBar = html => (extraBar = html)
const floatingBar = current => {
  const i = VARIANTS.findIndex(v => v.key === current)
  const prev = VARIANTS[(i + VARIANTS.length - 1) % VARIANTS.length]
  const next = VARIANTS[(i + 1) % VARIANTS.length]
  const url = variantUrl
  return `
  <div class="proto-bar" role="toolbar" aria-label="Prototype controls">
    <a class="pb-arrow" href="${url(prev)}" title="${prev.key} · ${prev.name} (←)">‹</a>
    <span class="pb-label">${current} · ${VARIANTS[i].name}</span>
    <a class="pb-arrow" href="${url(next)}" title="${next.key} · ${next.name} (→)">›</a>
    <span class="pb-sep"></span>
    <span class="pb-k">Simulate</span>
    <button type="button" data-sim="merge157" title="Marks merge-157 done with proof and fills Q380's promised follow-up">squad#157 merges</button>
    <button type="button" data-sim="proofs" title="Every reported step gets its agent proof">agents post proof</button>
    <button type="button" data-sim="clearHold">hold clears</button>
    <button type="button" data-sim="togglePageGrants" class="${state.pageGrants ? 'on' : ''}" title="squad profile grant_sources">grant_sources: ${state.pageGrants ? 'desktop cli page' : 'desktop+cli'}</button>
    <span class="pb-sep"></span>
    ${extraBar}
    <button type="button" data-sim="state">State</button>
    <button type="button" data-sim="reset">Reset</button>
  </div>`
}

const stateDrawer = () => {
  const c = counts()
  const rows = state.actions
    .map(a => `<tr><td>${esc(a.id)}</td><td>${a.progress.state}</td><td>${a.route}</td><td>${a.urgency}</td><td>${isHeld(a) ? 'held' : ''}</td></tr>`)
    .join('')
  return `<aside class="drawer" id="state-drawer" hidden>
    <h3>State</h3>
    <p><code>${esc(JSON.stringify(c))}</code></p>
    <p>grant_sources: <code>${state.pageGrants ? 'desktop cli page' : 'desktop+cli'}</code> · holds: ${state.holds.map(h => `${h.id}=${h.state}`).join(', ')}</p>
    <table><thead><tr><th>item</th><th>progress</th><th>route</th><th>urgency</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    <h3>Events (newest first)</h3>
    <ol class="log">${state.log.map(l => `<li><code>${esc(JSON.stringify(l))}</code></li>`).join('') || '<li class="hint">No events yet.</li>'}</ol>
  </aside>`
}

let drawerOpen = false

export const mount = (variant, render, onClick = () => false) => {
  const root = document.getElementById('app')
  const toast = document.createElement('div')
  toast.className = 'toast'
  document.body.append(toast)
  let timer
  toastBus.show = text => {
    toast.textContent = text
    toast.classList.add('show')
    clearTimeout(timer)
    timer = setTimeout(() => toast.classList.remove('show'), 3800)
  }
  const draw = () => {
    const scroll = window.scrollY
    root.innerHTML = render() + floatingBar(variant) + stateDrawer()
    document.getElementById('state-drawer').hidden = !drawerOpen
    window.scrollTo(0, scroll)
  }
  subscribe(draw)
  root.addEventListener('click', e => {
    const el = e.target.closest('[data-op],[data-sim],[data-ui]')
    if (!el) return
    if (el.tagName === 'A' && el.getAttribute('href') === '#') e.preventDefault()
    if (onClick(el, e)) return
    const id = el.dataset.id
    switch (el.dataset.op) {
      case 'copy':
        return ops.copy(id, el.dataset.text)
      case 'focus':
        return ops.focus(id, el.dataset.address)
      case 'open':
        return ops.open(id, el.dataset.url)
      case 'report':
        return ops.report(id)
      case 'pageAnswer':
        return ops.pageAnswer(id)
      case 'pageDo':
        return ops.pageDo(id)
      case 'proof':
        return ops.proof(id)
      case 'skip':
        return ops.skip(id)
    }
    const sim = el.dataset.sim
    if (sim === 'state') {
      drawerOpen = !drawerOpen
      return draw()
    }
    if (sim === 'togglePageGrants') return ops.togglePageGrants()
    if (sim && simulate[sim]) simulate[sim]()
  })
  document.addEventListener('keydown', e => {
    if (e.target.closest('input,textarea,select,[contenteditable]')) return
    const i = VARIANTS.findIndex(v => v.key === variant)
    const go = d => (location.href = variantUrl(VARIANTS[(i + d + VARIANTS.length) % VARIANTS.length]))
    if (e.key === 'ArrowLeft') go(-1)
    if (e.key === 'ArrowRight') go(1)
  })
  draw()
  // ?sim=merge157,togglePageGrants replays simulations on load, for sharing a state by link.
  for (const sim of new URLSearchParams(location.search).get('sim')?.split(',') ?? []) {
    if (sim === 'togglePageGrants') ops.togglePageGrants()
    else simulate[sim]?.()
  }
  return { redraw: draw }
}

export { state, counts, byId, holdOf, isHeld, refresh, sessions }
