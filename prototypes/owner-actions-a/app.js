// PROTOTYPE A · One list. Updates and Needs you merge into one "Waiting on you" page, ordered by
// when Rob should act. Questions stay their own page but are counted and linked here.
import {
  mount, header, headerCount, state, counts, esc, md, ago, urgencyChip, stateChip, where, routeLine,
  doneLine, buttons, stepsList, originLine, heldBadge, copyBox, refresh,
} from '../owner-actions-shared/chrome.js'

const expanded = new Set(['type-card-16'])

const row = a => {
  const open = expanded.has(a.id)
  const w = where(a)
  const quick = !open && a.progress.state === 'open' && a.copy && !a.steps ? copyBox(a.id, a.copy, 'Copy') : ''
  return `<article class="item ${open ? 'is-open' : ''} p-${a.progress.state}">
    <button type="button" class="item-head" data-ui="toggle" data-id="${esc(a.id)}" aria-expanded="${open}">
      <span class="caret">${open ? '▾' : '▸'}</span>
      ${a.progress.state === 'open' ? urgencyChip(a.urgency) : stateChip(a)}
      <span class="t">${md(a.title)}</span>
      ${heldBadge(a)}
      <span class="place">${esc(w.kind === 'terminal' ? w.address : w.label)}</span>
    </button>
    ${quick}
    ${open ? `<div class="item-body">
      <p class="meta">${esc(a.session)} · ${ago(a.at)} · ${esc(a.host)}</p>
      ${originLine(a)}
      <div class="prose">${md(a.body)}</div>
      ${stepsList(a)}
      ${routeLine(a)}
      ${buttons(a)}
      ${doneLine(a)}
    </div>` : ''}
  </article>`
}

const section = (title, items, note = '') =>
  items.length === 0 ? '' : `<section class="group"><h2>${title} <span class="n">${items.length}</span></h2>${note}${items.map(row).join('')}</section>`

const render = () => {
  const c = counts()
  const open = state.actions.filter(a => a.progress.state === 'open')
  const by = u => open.filter(a => (u === 'fyi' ? a.urgency === 'fyi' || a.optional : a.urgency === u && !a.optional))
  const hold = state.holds.filter(h => h.state === 'active')
  const nav =
    headerCount('Waiting on you', c.waiting, true, `title="${c.waiting} actions on you · ${c.whenever} whenever · ${c.holds} hold"`) +
    headerCount('Questions', c.questions, false) +
    headerCount('Conversations', 0, false)
  return `${header(nav)}
  <main class="page">
    <h1>Waiting on you</h1>
    <p class="lead">Everything an agent needs from you: things to do, holds to respect, questions to answer, and where each run stands. One page instead of Needs you and Updates.</p>
    ${hold
      .map(h => `<div class="hold"><b>⏸ ${esc(h.title)}</b> until ${esc(h.clearsWhen)}. <span class="meta">${esc(h.session)} · ${ago(h.at)}</span><p>${md(h.body)} Blocks: ${h.blocks.map(b => `<code>${esc(b)}</code>`).join(' ')}</p></div>`)
      .join('')}
    ${section('Do now', [...by('blocking'), ...by('soon')])}
    ${section('When you’re ready', by('wait'))}
    <section class="group"><h2>Questions to answer <span class="n">${state.questions.length}</span></h2>
      ${state.questions.map(q => `<a href="#" class="qrow">${urgencyChip(q.urgency)} <span class="qref">${q.id}</span> ${esc(q.title)}</a>`).join('')}
    </section>
    ${section('Whenever', by('fyi'))}
    ${section('Coming back to you', state.actions.filter(a => a.progress.state === 'promised'), '<p class="hint small">Promised by an agent, filled in when its condition is met. Not counted until then.</p>')}
    ${section('Checking', state.actions.filter(a => a.progress.state === 'reported'), '<p class="hint small">You said done; the agent confirms with proof.</p>')}
    <section class="group"><h2>Where runs stand</h2>
      ${state.updates
        .map(
          u => `<details class="status ${u.stale ? 'is-stale' : ''}" ${u.stale ? '' : ''}>
        <summary><b>${esc(u.run)}</b> <span class="meta">${esc(u.session)} · ${ago(u.at)}</span> ${u.stale ? '<span class="st st-skip">stale</span>' : ''}<span class="first">${esc(u.lines[0][0])}: ${esc(u.lines[0][1])}</span></summary>
        ${u.stale ? `<p class="stale-note">${esc(u.stale)}</p>` : ''}
        <dl>${u.lines.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${md(v)}</dd>`).join('')}</dl></details>`,
        )
        .join('')}
    </section>
    ${section('Done', state.actions.filter(a => ['completed', 'withdrawn'].includes(a.progress.state)))}
  </main>`
}

mount('A', render, el => {
  if (el.dataset.ui === 'toggle') {
    const id = el.dataset.id
    expanded.has(id) ? expanded.delete(id) : expanded.add(id)
    refresh()
    return true
  }
  return false
})
