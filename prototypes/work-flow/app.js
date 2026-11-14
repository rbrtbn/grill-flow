// PROTOTYPE: the Squad Board home as a work flow. Three variants on one page (?variant=A|B|C):
// A Track (each issue a line through the states), B Timeline (bars over time), C Stages (cards
// in their current state). Done issues fold at the top, planned ones at the bottom.
import { DATA } from './data.js'

// ---------- model ----------
const FLOW = ['planned', 'design-gate', 'building', 'review', 'fixing', 'merge-ready', 'merged', 'released']
const LABEL = {
  planned: 'Planned', 'design-gate': 'Design gate', building: 'Building', review: 'Review',
  fixing: 'Fixing', 'merge-ready': 'Merge-ready', merged: 'Merged', released: 'Released',
  blocked: 'Blocked', parked: 'Parked',
}
const DONE = new Set(['merged', 'released'])
const LATER = new Set(['planned', 'parked'])
const HUES = 8
const hueOf = a => [...a].reduce((s, c) => (s * 31 + c.charCodeAt(0)) >>> 0, 7) % HUES
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const t = iso => Date.parse(iso)

const allTimes = DATA.issues.flatMap(i => i.transitions.map(x => t(x.at))).filter(Number.isFinite)
const NOW = DATA.now ? t(DATA.now) : Math.max(...allTimes)
const START = Math.min(...allTimes)

const dur = ms => {
  if (!Number.isFinite(ms) || ms <= 0) return '—'
  const m = Math.round(ms / 60000)
  if (m < 60) return `${m}m`
  const h = m / 60
  if (h < 23.95) return `${h < 10 ? h.toFixed(1).replace(/\.0$/, '') : Math.round(h)}h`
  const totalH = Math.round(h)
  const d = Math.floor(totalH / 24)
  const rh = totalH - d * 24
  return rh ? `${d}d ${rh}h` : `${d}d`
}
const ago = ms => (ms < 60000 ? 'now' : `${dur(ms)} ago`)

// The flow position a state sits at; blocked and parked keep the position they were reached from.
const posOf = state => FLOW.indexOf(state)

const issues = DATA.issues.map(raw => {
  const tr = [...raw.transitions].filter(x => Number.isFinite(t(x.at))).sort((a, b) => t(a.at) - t(b.at))
  const segs = tr.map((x, k) => ({
    state: x.state, agent: x.agent || '', note: x.note || '',
    from: t(x.at), to: k + 1 < tr.length ? t(tr[k + 1].at) : (DONE.has(x.state) || LATER.has(x.state) ? t(x.at) : NOW),
    inferred: /mtime/.test(x.note || ''),
  }))
  let lastFlow = 'planned'
  for (const s of segs) {
    if (posOf(s.state) >= 0) lastFlow = s.state
    s.flow = posOf(s.state) >= 0 ? s.state : lastFlow
  }
  const state = raw.state
  const blocked = state === 'blocked' || (!DONE.has(state) && !LATER.has(state) && !!raw.blockedBy)
  const at = posOf(state) >= 0 ? state : lastFlow
  const working = segs.filter(s => !LATER.has(s.state))
  const spent = working.reduce((n, s) => n + (s.to - s.from), 0)
  const perState = {}
  for (const s of working) perState[s.flow] = (perState[s.flow] || 0) + (s.to - s.from)
  const agents = []
  for (const s of segs) if (s.agent && agents[agents.length - 1] !== s.agent) agents.push(s.agent)
  const reviewLoops = segs.filter(s => s.state === 'fixing').length
  const group = DONE.has(state) ? 'done' : LATER.has(state) ? 'later' : 'active'
  const sinceLast = segs.length ? NOW - segs[segs.length - 1].from : 0
  const stepsLeft = DONE.has(state) ? 0 : Math.max(0, posOf('merged') - Math.max(posOf(at), 0))
  return {
    ...raw, segs, blocked, at, spent, perState, agents, reviewLoops, group, sinceLast, stepsLeft,
    first: segs.find(s => !LATER.has(s.state))?.from, last: segs[segs.length - 1]?.to,
  }
})

const byGroup = g => issues.filter(i => i.group === g)
const active = byGroup('active').sort((a, b) => (b.blocked - a.blocked) || posOf(b.at) - posOf(a.at))
const done = byGroup('done').sort((a, b) => (a.last ?? 0) - (b.last ?? 0))
const later = byGroup('later')
const median = xs => {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b)
  return v.length ? v[Math.floor(v.length / 2)] : NaN
}

// ---------- ui state ----------
const params = new URLSearchParams(location.search)
const ui = {
  variant: ['A', 'B', 'C'].includes(params.get('variant')) ? params.get('variant') : 'A',
  showDone: params.get('done') === '1',
  showLater: params.get('later') === '1',
  open: params.get('issue'),
}
const sync = () => {
  const p = new URLSearchParams()
  p.set('variant', ui.variant)
  if (ui.showDone) p.set('done', '1')
  if (ui.showLater) p.set('later', '1')
  if (ui.open) p.set('issue', ui.open)
  history.replaceState(null, '', `?${p}`)
}

// ---------- pieces ----------
// Builders show their issue's last two digits; Herdr sessions their address tail; roles a letter.
const initials = a =>
  /^b\d+$/.test(a) ? a.slice(-2) : /^t2/.test(a) ? a.slice(2).toUpperCase() : a === 'earlier run' ? '…' : a.slice(0, 1).toUpperCase()
const avatar = (a, cls = '') =>
  a ? `<span class="av h${hueOf(a)} ${cls}" title="${esc(a)}">${esc(initials(a))}</span>` : ''
const stateChip = i =>
  i.blocked ? `<span class="st st-blocked">Blocked · ${esc(LABEL[i.at])}</span>` : `<span class="st st-${i.state}">${esc(LABEL[i.state] ?? i.state)}</span>`
const linear = id => `<a class="ref" href="https://linear.app/rbrtbn/issue/${esc(id)}" target="_blank" rel="noreferrer">${esc(id)}</a>`
const prRef = i => (i.pr ? `<a class="ref" href="https://github.com/rbrtbn/squad/pull/${i.pr}" target="_blank" rel="noreferrer">#${i.pr}${i.prState === 'merged' ? ' · merged' : ''}</a>` : '')
const deps = i => ((i.dependsOn || []).length ? `<span class="deps">after ${i.dependsOn.map(d => `<button class="dep" data-open="${esc(d)}">${esc(d)}</button>`).join(', ')}</span>` : '')
// Each agent once, in the order it first held the issue; the move count says how often it changed hands.
const handover = i => {
  const seen = [...new Set(i.agents)]
  if (!seen.length) return ''
  const moves = i.agents.length - 1
  return `<span class="hand" title="${esc(i.agents.join(' → '))}">${seen.map(a => avatar(a)).join('<span class="arr">→</span>')}${moves > seen.length - 1 ? `<span class="moves">${moves} handovers</span>` : ''}</span>`
}
const leftLine = i =>
  i.group === 'done' ? 'Done' : `${i.stepsLeft} step${i.stepsLeft === 1 ? '' : 's'} to merge${i.estimateLeft ? ` · ${esc(i.estimateLeft)}` : ''}`

const stats = () => {
  const cycle = done.map(i => (i.first && i.last ? i.last - i.first : NaN))
  const blocked = active.filter(i => i.blocked).length
  const handovers = issues.reduce((n, i) => n + Math.max(0, i.agents.length - 1), 0)
  const rounds = active.concat(done).map(i => i.rounds?.review ?? 0)
  return `<section class="stats" aria-label="Squad at a glance">
    <div><b>${active.length}</b><span>in progress</span></div>
    <div class="${blocked ? 'is-hot' : ''}"><b>${blocked}</b><span>blocked</span></div>
    <div><b>${done.length}</b><span>done</span></div>
    <div><b>${later.length}</b><span>planned</span></div>
    <div><b>${dur(median(cycle))}</b><span>median start → merge</span></div>
    <div><b>${dur(active.reduce((n, i) => n + i.spent, 0))}</b><span>spent on open work</span></div>
    <div><b>${handovers}</b><span>handovers between agents</span></div>
    <div><b>${(rounds.reduce((a, b) => a + b, 0) / Math.max(1, rounds.length)).toFixed(1)}</b><span>review rounds per issue</span></div>
  </section>`
}

const fold = (key, title, list, body) => `
  <section class="fold fold-${key} ${ui[key === 'done' ? 'showDone' : 'showLater'] ? 'is-open' : ''}">
    <button class="fold-head" data-fold="${key}">
      <span class="caret">${ui[key === 'done' ? 'showDone' : 'showLater'] ? '▾' : '▸'}</span>
      <b>${title} · ${list.length}</b>
      <span class="hint">${key === 'done'
        ? `${list.map(i => i.id).slice(-6).join(', ')}${list.length > 6 ? ', …' : ''} · median ${dur(median(list.map(i => (i.first && i.last ? i.last - i.first : NaN))))} start → merge`
        : `${list.filter(i => (i.dependsOn || []).length).length} wait on other work`}</span>
    </button>
    ${ui[key === 'done' ? 'showDone' : 'showLater'] ? `<div class="fold-body">${body}</div>` : ''}
  </section>`

// ---------- A: Track ----------
const COLS = ['design-gate', 'building', 'review', 'fixing', 'merge-ready', 'merged']
const trackRow = (i, dim = false) => {
  const cur = posOf(i.at)
  const cells = COLS.map(c => {
    const p = posOf(c)
    const spent = i.perState[c]
    const visited = spent !== undefined || (p < cur && i.group !== 'later')
    const here = c === i.at && i.group === 'active'
    const seg = i.segs.filter(s => s.flow === c)
    const agent = seg[seg.length - 1]?.agent
    const cls = here ? (i.blocked ? 'is-here is-blocked' : 'is-here') : visited ? 'is-past' : p < cur ? 'is-skipped' : 'is-future'
    const loops = c === 'fixing' && i.reviewLoops > 1 ? `<span class="loops">×${i.reviewLoops}</span>` : ''
    return `<div class="cell ${cls} ${agent ? `h${hueOf(agent)}` : ''}">
      <span class="line"></span><span class="node">${here ? avatar(agent || i.agents.at(-1) || '') : ''}</span>
      <span class="dur">${spent !== undefined ? dur(spent) : ''}${loops}</span>
    </div>`
  }).join('')
  return `<div class="trow ${dim ? 'is-dim' : ''} ${i.blocked ? 'has-block' : ''}" data-open="${esc(i.id)}">
    <div class="who">
      <div class="ttl">${linear(i.id)} <b>${esc(i.title)}</b></div>
      <div class="meta">${stateChip(i)} ${handover(i)} ${prRef(i)} ${deps(i)}</div>
      ${i.group === 'active' && i.doing ? `<div class="doing">${esc(i.doing)}</div>` : ''}
      ${i.blocked ? `<div class="blocker">⛔ ${esc(i.blockedBy || 'Blocked')}</div>` : ''}
    </div>
    <div class="cells">${cells}</div>
    <div class="nums"><b>${dur(i.spent)}</b><span>${leftLine(i)}</span>${i.group === 'active' ? `<span class="hint">last move ${ago(i.sinceLast)}</span>` : ''}</div>
  </div>`
}
const trackHead = () => `<div class="thead"><div></div><div class="cells">${COLS.map(c => `<div class="ch">${LABEL[c]}</div>`).join('')}</div><div class="ch r">Spent · left</div></div>`
const variantA = () => `
  ${fold('done', 'Done earlier', done, trackHead() + done.map(i => trackRow(i, true)).join(''))}
  <section class="track">${trackHead()}${active.map(i => trackRow(i)).join('') || '<p class="hint">Nothing in progress.</p>'}</section>
  ${fold('later', 'Planned next', later, later.map(i => trackRow(i, true)).join(''))}`

// ---------- B: Timeline ----------
const variantB = () => {
  const rows = [...(ui.showDone ? done : []), ...active, ...(ui.showLater ? later : [])]
  const end = NOW + (NOW - START) * 0.18
  const W = 1000
  const x = ms => ((ms - START) / (end - START)) * W
  const RH = 46
  const ticks = []
  const day = 86400000
  for (let d = Math.ceil(START / day) * day; d < end; d += day) ticks.push(d)
  const idx = Object.fromEntries(rows.map((i, k) => [i.id, k]))
  const arrows = rows.flatMap(i => (i.dependsOn || []).filter(d => d in idx).map(d => {
    const from = rows[idx[d]]
    const x1 = x(from.last ?? NOW), y1 = idx[d] * RH + RH / 2
    const x2 = x(i.first ?? NOW), y2 = idx[i.id] * RH + RH / 2
    return `<path class="deparrow" d="M${x1},${y1} C${x1 + 30},${y1} ${x2 - 30},${y2} ${x2},${y2}" marker-end="url(#ah)"/>`
  }))
  const bars = rows.map((i, k) => {
    const y = k * RH + 12
    const segs = i.segs.filter(s => !LATER.has(s.state)).map(s => {
      const w = Math.max(3, x(s.to) - x(s.from))
      return `<rect class="seg s-${s.state}${s.inferred ? ' is-inferred' : ''}" x="${x(s.from)}" y="${y}" width="${w}" height="22" rx="3"><title>${esc(LABEL[s.state] ?? s.state)} · ${dur(s.to - s.from)}${s.agent ? ` · ${s.agent}` : ''}${s.note ? ` · ${s.note}` : ''}</title></rect>`
    }).join('')
    const hands = i.segs.filter((s, n) => s.agent && (n === 0 || i.segs[n - 1].agent !== s.agent) && !LATER.has(s.state))
      .map(s => `<g class="hand-mark"><circle class="h${hueOf(s.agent)}" cx="${x(s.from)}" cy="${y + 11}" r="9"/><text x="${x(s.from)}" y="${y + 15}">${esc(initials(s.agent))}</text></g>`).join('')
    const proj = i.group === 'active' ? `<rect class="proj" x="${x(NOW)}" y="${y + 6}" width="${Math.max(8, i.stepsLeft * 22)}" height="10" rx="5"/>` : ''
    const later_ = i.group === 'later' ? `<text class="later-lbl" x="${x(NOW) + 6}" y="${y + 16}">planned${(i.dependsOn || []).length ? ` · after ${i.dependsOn.join(', ')}` : ''}</text>` : ''
    return `<g class="brow ${i.group !== 'active' ? 'is-dim' : ''}" data-open="${esc(i.id)}">${segs}${proj}${hands}${later_}${i.blocked ? `<text class="blk" x="${x(NOW) - 6}" y="${y + 36}" text-anchor="end">⛔ ${esc((i.blockedBy || '').slice(0, 80))}</text>` : ''}</g>`
  }).join('')
  const H = rows.length * RH + 10
  return `
  ${fold('done', 'Done earlier', done, '<p class="hint">Shown as dimmed bars above the current work.</p>')}
  <section class="timeline">
    <div class="tl-names">${rows.map(i => `<div class="tl-name ${i.group !== 'active' ? 'is-dim' : ''}" data-open="${esc(i.id)}" style="height:${RH}px">${linear(i.id)} <span>${esc(i.title)}</span> ${stateChip(i)}</div>`).join('')}</div>
    <div class="tl-plot">
      <svg viewBox="0 -24 ${W} ${H + 24}" preserveAspectRatio="none" style="height:${H + 24}px">
        <defs><marker id="ah" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" class="ah"/></marker>
        <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="3" height="6" class="hatch"/></pattern></defs>
        ${ticks.map(d => `<line class="tick" x1="${x(d)}" x2="${x(d)}" y1="-24" y2="${H}"/><text class="tick-lbl" x="${x(d) + 4}" y="-8">${new Date(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })}</text>`).join('')}
        <line class="now" x1="${x(NOW)}" x2="${x(NOW)}" y1="-24" y2="${H}"/><text class="now-lbl" x="${x(NOW) + 4}" y="-8">now</text>
        ${arrows.join('')}${bars}
      </svg>
    </div>
  </section>
  <div class="legend">${['design-gate', 'building', 'review', 'fixing', 'merge-ready', 'merged', 'blocked'].map(s => `<span><i class="sw s-${s}"></i>${LABEL[s]}</span>`).join('')}<span><i class="sw proj"></i>Left to merge</span><span>● agent picks it up</span><span>→ depends on</span></div>
  ${fold('later', 'Planned next', later, '<p class="hint">Shown after now, with what each waits on.</p>')}`
}

// ---------- C: Stages ----------
const card = i => {
  const inState = i.segs.length ? NOW - i.segs[i.segs.length - 1].from : 0
  return `<article class="card ${i.blocked ? 'is-blocked' : ''}" data-open="${esc(i.id)}">
    <header>${linear(i.id)} ${prRef(i)}</header>
    <b>${esc(i.title)}</b>
    ${i.doing ? `<p class="doing">${esc(i.doing)}</p>` : ''}
    ${i.blocked ? `<p class="blocker">⛔ ${esc(i.blockedBy || 'Blocked')}</p>` : ''}
    <footer>${handover(i)}<span class="hint">${dur(inState)} here · ${dur(i.spent)} total${i.rounds?.review ? ` · R${i.rounds.review}` : ''}</span></footer>
    ${deps(i)}
  </article>`
}
const variantC = () => {
  const stages = ['design-gate', 'building', 'review', 'fixing', 'merge-ready']
  const dwell = s => median(issues.flatMap(i => i.segs.filter(x => x.state === s && x.to > x.from).map(x => x.to - x.from)))
  return `
  ${fold('done', 'Done earlier', done, `<div class="done-strip">${done.map(i => `<button class="mini" data-open="${esc(i.id)}">${esc(i.id)} <span class="hint">${dur(i.first && i.last ? i.last - i.first : NaN)}</span></button>`).join('')}</div>`)}
  <section class="stages">
    ${stages.map(s => {
      const here = active.filter(i => i.at === s)
      return `<div class="stage ${here.length ? '' : 'is-empty'}">
        <div class="stage-h"><b>${LABEL[s]}</b><span class="count">${here.length}</span><span class="hint">median stay ${dur(dwell(s))}</span></div>
        ${here.map(card).join('') || '<p class="hint empty">—</p>'}
      </div>`
    }).join('<div class="flow-arrow" aria-hidden="true">→</div>')}
  </section>
  ${fold('later', 'Planned next', later, `<div class="done-strip">${later.map(i => `<button class="mini" data-open="${esc(i.id)}">${esc(i.id)} <span class="hint">${(i.dependsOn || []).length ? `after ${i.dependsOn.join(', ')}` : esc(i.title).slice(0, 40)}</span></button>`).join('')}</div>`)}`
}

// ---------- drawer ----------
const drawer = () => {
  const i = issues.find(x => x.id === ui.open)
  if (!i) return ''
  return `<aside class="drawer" aria-label="${esc(i.id)}">
    <button class="x" data-close>×</button>
    <h2>${linear(i.id)} ${esc(i.title)}</h2>
    <p>${stateChip(i)} ${prRef(i)} <span class="hint">Linear: ${esc(i.linearStatus || '—')}</span></p>
    ${i.doing ? `<p><b>Doing:</b> ${esc(i.doing)}</p>` : ''}
    ${i.blockedBy ? `<p class="blocker">⛔ ${esc(i.blockedBy)}</p>` : ''}
    ${(i.dependsOn || []).length ? `<p><b>After:</b> ${deps(i)}</p>` : ''}
    <p><b>Spent</b> ${dur(i.spent)} · <b>Left</b> ${leftLine(i)}${i.rounds ? ` · review rounds ${i.rounds.review ?? 0}, fix rounds ${i.rounds.fix ?? 0}` : ''}</p>
    <h3>Time per state</h3>
    <ul class="per">${COLS.filter(c => i.perState[c]).map(c => `<li><i class="sw s-${c}"></i>${LABEL[c]} <b>${dur(i.perState[c])}</b></li>`).join('') || '<li class="hint">No timed states.</li>'}</ul>
    <h3>Moves</h3>
    <ol class="log">${i.segs.map(s => `<li><time>${new Date(s.from).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</time> ${avatar(s.agent)} <b>${esc(LABEL[s.state] ?? s.state)}</b> <span class="hint">${esc(s.note)}</span></li>`).join('')}</ol>
  </aside>`
}

// ---------- shell ----------
const VARIANTS = { A: 'Track', B: 'Timeline', C: 'Stages' }
const render = () => {
  sync()
  const body = ui.variant === 'B' ? variantB() : ui.variant === 'C' ? variantC() : variantA()
  document.getElementById('app').innerHTML = `
  <header class="bar">
    <span class="brand"><span class="mark">Board</span></span>
    <nav class="nav"><button class="tb is-active">Home</button><button class="tb">Inbox</button><button class="tb">Questions</button><button class="tb">Runs</button><button class="tb">More ▾</button></nav>
    <span class="squad">${esc(DATA.run?.id ?? 'squad')}</span>
  </header>
  <main class="page">
    <h1>Where the work stands</h1>
    <p class="lead">Every Linear issue the squad is working on, as a flow through its states. In progress and blocked work shows in full. Done work folds above it and planned work below.</p>
    ${stats()}
    ${body}
    <p class="src hint">Prototype data: ${esc(DATA.issues.length)} issues from ${esc(DATA.run?.id ?? 'one squad run')}'s logs. Times marked (mtime) are inferred from file times. ${(DATA.gaps || []).length ? `Gaps: ${esc(DATA.gaps.slice(0, 3).join('; '))}.` : ''}</p>
  </main>
  ${drawer()}
  <nav class="proto-bar" aria-label="Prototype variants">
    <span class="hint">Prototype</span>
    ${Object.entries(VARIANTS).map(([k, v]) => `<button class="${ui.variant === k ? 'is-on' : ''}" data-variant="${k}">${k} · ${v}</button>`).join('')}
    <span class="hint">← → to switch</span>
  </nav>`
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-variant],[data-fold],[data-open],[data-close]')
  if (!el || e.target.closest('a')) return
  if (el.dataset.variant) ui.variant = el.dataset.variant
  else if (el.dataset.fold === 'done') ui.showDone = !ui.showDone
  else if (el.dataset.fold === 'later') ui.showLater = !ui.showLater
  else if (el.dataset.open) ui.open = el.dataset.open
  else if (el.hasAttribute('data-close')) ui.open = null
  render()
})
document.addEventListener('keydown', e => {
  if (e.target.closest('input,textarea')) return
  const keys = Object.keys(VARIANTS)
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    ui.variant = keys[(keys.indexOf(ui.variant) + (e.key === 'ArrowRight' ? 1 : keys.length - 1)) % keys.length]
    render()
  }
  if (e.key === 'Escape' && ui.open) { ui.open = null; render() }
})
render()
