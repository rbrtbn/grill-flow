// PROTOTYPE C · By conversation. Each run or session gets a lane that says what it is waiting
// on; every owner action sits under the question, card or answer that produced it, so Q380's
// note visibly turns into a promise and then a step. The header tray is the always-on count.
import {
  mount, header, state, counts, esc, md, ago, urgencyChip, stateChip, where, routeLine,
  doneLine, buttons, stepsList, heldBadge, refresh, sessions, copyBox,
} from '../owner-actions-shared/chrome.js'

let trayOpen = false
const expanded = new Set(['q380-grant-followup'])

const lanes = ['t2hq', 't2cr', 't18v', 't1mn']

const originNode = a => {
  const o = a.origin
  if (!o) return `<div class="node n-agent"><span class="nk">${esc(a.session)} raised</span> ${esc(a.unblocks ? `unblocks ${a.unblocks.join(', ')}` : a.body.split('. ')[0] + '.')}</div>`
  if (o.kind === 'answer')
    return `<div class="node n-q"><span class="nk">You answered</span> <a href="#" class="qref">${esc(o.question)}</a> ${esc(o.title)} → <b>${esc(o.answer)}</b><blockquote>${esc(o.note)}</blockquote></div>`
  if (o.kind === 'card') return `<div class="node n-q"><span class="nk">You picked on the page</span> card <code>${esc(o.card)}</code> → <b>${esc(o.pagePick)}</b></div>`
  return `<div class="node n-q"><span class="nk">You picked on the page</span> ${esc(o.label)} ${o.questions.map(q => `<a href="#" class="qref">${q}</a>`).join(' ')}</div>`
}

const card = a => {
  const open = expanded.has(a.id)
  return `<div class="thread p-${a.progress.state}">
    ${originNode(a)}
    <div class="arrow" aria-hidden="true">↓</div>
    <article class="node n-act">
      <button type="button" class="act-h" data-ui="toggle" data-id="${esc(a.id)}" aria-expanded="${open}">
        ${a.progress.state === 'open' ? urgencyChip(a.urgency) : stateChip(a)} <b>${md(a.title)}</b> ${heldBadge(a)}
      </button>
      ${a.progress.state === 'promised' ? `<p class="promise">⧗ ${esc(a.session)} will fill this in when ${esc(a.progress.until)}.</p>` : ''}
      ${!open && a.progress.state === 'open' && a.copy && !a.steps ? copyBox(a.id, a.copy, 'Copy') : ''}
      ${open ? `<div class="prose">${md(a.body)}</div>${stepsList(a)}${routeLine(a)}${buttons(a)}${doneLine(a)}` : ''}
    </article>
  </div>`
}

const waitingOn = address => {
  const mine = state.actions.filter(a => a.session === address)
  const onYou = mine.filter(a => a.progress.state === 'open').length
  const other = [...new Set(mine.filter(a => a.progress.state === 'promised').map(a => a.progress.until))]
  const parts = []
  if (onYou) parts.push(`<b>you</b> (${onYou})`)
  other.forEach(o => parts.push(esc(o)))
  return parts.length ? `Waiting on ${parts.join(' · ')}` : 'Not waiting on you'
}

const lane = address => {
  const s = sessions[address]
  const status = state.updates.find(u => u.session === address)
  const holds = state.holds.filter(h => h.session === address && h.state === 'active')
  const items = state.actions
    .filter(a => a.session === address && !['completed', 'withdrawn'].includes(a.progress.state))
    .sort((x, y) => (y.origin?.kind === 'answer') - (x.origin?.kind === 'answer'))
  const done = state.actions.filter(a => a.session === address && ['completed', 'withdrawn'].includes(a.progress.state))
  return `<section class="lane ${s.alive ? '' : 'is-ended'}">
    <header class="lane-h">
      <div><h2>${esc(address)} <span class="meta">${esc(s.label)}</span></h2>
      <p class="waiting">${s.alive ? waitingOn(address) : 'Session ended · its last status is stale'}</p></div>
      ${s.alive ? `<button type="button" class="b" data-op="focus" data-id="lane:${address}" data-address="${address}">Focus</button>` : ''}
    </header>
    ${holds.map(h => `<div class="hold">⏸ <b>${esc(h.title)}</b> until ${esc(h.clearsWhen)}</div>`).join('')}
    ${status ? `<details class="lane-status ${status.stale ? 'is-stale' : ''}"><summary>${status.stale ? '<span class="st st-skip">stale</span> ' : ''}${esc(status.title)} · ${ago(status.at)}</summary>${status.stale ? `<p class="stale-note">${esc(status.stale)}</p>` : ''}<dl>${status.lines.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${md(v)}</dd>`).join('')}</dl></details>` : ''}
    ${items.map(card).join('') || '<p class="hint">Nothing on you here.</p>'}
    ${done.length ? `<details class="lane-done"><summary>Done · ${done.length}</summary>${done.map(card).join('')}</details>` : ''}
  </section>`
}

const tray = () => {
  const open = state.actions.filter(a => a.progress.state === 'open')
  const groups = [
    ['Soon', open.filter(a => ['blocking', 'soon'].includes(a.urgency))],
    ['When ready', open.filter(a => a.urgency === 'wait')],
    ['Whenever', open.filter(a => a.urgency === 'fyi')],
  ]
  return `<div class="tray" role="dialog" aria-label="Waiting on you">
    ${state.holds.filter(h => h.state === 'active').map(h => `<p class="tray-hold">⏸ ${esc(h.title)}</p>`).join('')}
    ${groups
      .filter(([, l]) => l.length)
      .map(([k, l]) => `<h3>${k} · ${l.length}</h3>${l.map(a => `<a href="#act-${a.id}" class="tray-row" data-ui="jump" data-id="${esc(a.id)}"><span>${md(a.title)}</span><span class="meta">${esc(where(a).kind === 'terminal' ? where(a).address : where(a).label)}</span></a>`).join('')}`)
      .join('')}
    <p class="meta">${counts().promised} promised · ${counts().checking} checking · ${counts().questions} questions</p>
  </div>`
}

const render = () => {
  const c = counts()
  const nav = `<button type="button" class="tb tray-btn ${trayOpen ? 'is-active' : ''}" data-ui="tray" aria-expanded="${trayOpen}" title="Actions waiting on you">
      On you <span class="count ${c.waiting ? 'c-hot' : ''}">${c.waiting}</span>${c.whenever ? `<span class="plus">+${c.whenever}</span>` : ''}${c.holds ? ' <span class="count c-hold" title="active holds">⏸ ' + c.holds + '</span>' : ''}
    </button>
    <button type="button" class="tb">Questions <span class="count">${c.questions}</span></button>
    <button type="button" class="tb is-active">Runs</button>`
  return `${header(nav)}${trayOpen ? tray() : ''}
  <main class="board">${lanes.map(lane).join('')}</main>`
}

mount('C', render, el => {
  const ui = el.dataset.ui
  if (ui === 'toggle' || ui === 'jump') {
    const id = el.dataset.id
    if (ui === 'jump') {
      expanded.add(id)
      trayOpen = false
    } else expanded.has(id) ? expanded.delete(id) : expanded.add(id)
    refresh()
    return true
  }
  if (ui === 'tray') {
    trayOpen = !trayOpen
    refresh()
    return true
  }
  return false
})
