// PROTOTYPE (ask 9673) · C · Unsent tray and nudge.
// The header's Review & send becomes a live "N unsent" counter that opens a tray: drafts by
// round, recipients on every row, Send per round or for the selection, and "Keep back" to
// mark a draft you are deliberately holding. Leaving the page with ready drafts asks first;
// a quiet minute after answering turns the counter into a nudge. Keyboard-first: u, ↑↓,
// space, k, ⌘↵.
import '../send-shortcuts-shared/base.css'
import './styles.css'
import {
  S,
  byId,
  drafts,
  esc,
  go,
  groupBySession,
  isReady,
  mount,
  plural,
  recipientsLine,
  render,
  roundOf,
  sendAnswers,
  answerText,
  to,
  typing,
  type Question,
} from '../send-shortcuts-shared/shared'

const IDLE_MS = 60_000
const ui = S.ui as {
  tray?: boolean
  off?: Array<number>
  cursor?: number
  leaving?: string | undefined
  nudge?: boolean
  idleTimer?: number
}
ui.off = []
ui.cursor = 0

const held = (q: Question) => q.answer.state === 'draft' && q.answer.held === true
const ready = (round?: number) => drafts(round).filter(q => isReady(q) && !held(q))
const keptBack = () => drafts().filter(held)
const selected = () => ready().filter(q => !ui.off!.includes(q.id))
const trayRows = () => [...S.rounds].reverse().flatMap(r => ready(r.n))

const oldestLabel = () => {
  const r = ready()
  if (r.length === 0) return ''
  return r.some(q => q.answer.state === 'draft' && q.answer.at.startsWith('Yesterday')) ? 'oldest from yesterday' : 'from today'
}

const armIdle = () => {
  clearTimeout(ui.idleTimer)
  ui.nudge = false
  ui.idleTimer = window.setTimeout(() => {
    if (ready().length > 0 && !ui.tray) {
      ui.nudge = true
      render()
    }
  }, IDLE_MS)
}

const headerActions = () => {
  const n = ready().length
  const k = keptBack().length
  const nudgeRound = [...S.rounds].reverse().find(r => ready(r.n).length > 0)
  return `<button>Conversations</button><button>Replies</button>
    ${ui.nudge && nudgeRound
      ? `<div class="nudge" role="status">${plural(ready(nudgeRound.n).length, 'answer')} in ${esc(nudgeRound.name)} ${ready(nudgeRound.n).length === 1 ? 'is' : 'are'} ready to send.
          <button data-act="send-round" data-round="${nudgeRound.n}">Send</button><button data-act="tray">Choose</button><button data-act="not-yet">Not yet</button></div>`
      : ''}
    <button class="unsent-counter${n ? ' has' : ''}" data-act="tray" aria-expanded="${!!ui.tray}" title="Unsent answers (u)">
      <span class="dot"></span>${n ? `${n} unsent` : 'All sent'}${k ? ` <small>+${k} kept back</small>` : ''}${n ? ` <small>${oldestLabel()}</small>` : ''}
      <span class="chevron${ui.tray ? '' : ' down'}"></span>
    </button>`
}

const row = (q: Question, i: number) => {
  const on = !ui.off!.includes(q.id)
  return `<li class="tray-row${i === ui.cursor ? ' cursor' : ''}" data-row="${i}">
    <input type="checkbox" data-act="pick" data-id="${q.id}" ${on ? 'checked' : ''} aria-label="Include ${esc(q.short)}">
    <button class="tray-q" data-act="select" data-id="${q.id}"><strong>${esc(q.short)}</strong><span class="muted">${esc(answerText(q))}</span></button>
    <span class="to">→ ${esc(to(q.session))}</span>
    ${q.answer.state === 'draft' && q.answer.failure ? '<span class="failed-tag">not delivered</span>' : ''}
    <button class="keep" data-act="keep" data-id="${q.id}" title="Keep back (k)">Keep back</button>
  </li>`
}

const tray = () => {
  let i = 0
  const pick = selected()
  const withoutText = drafts().filter(q => !isReady(q))
  return `<div class="scrim clear" data-act="tray"></div>
  <div class="tray" role="dialog" aria-label="Unsent answers">
    <div class="tray-head"><strong>Unsent answers</strong><small><kbd>↑↓</kbd> move <kbd>space</kbd> include <kbd>k</kbd> keep back <kbd>⌘↵</kbd> send <kbd>esc</kbd> close</small></div>
    ${[...S.rounds]
      .reverse()
      .map(r => {
        const rs = ready(r.n)
        if (rs.length === 0) return ''
        return `<section><div class="tray-round"><span>${esc(r.name)} <small>posted ${r.posted}</small></span>
          <button class="ghost" data-act="send-round" data-round="${r.n}" title="${esc(recipientsLine(rs.map(q => q.id)))}">Send ${rs.length}</button></div>
          <ul>${rs.map(q => row(q, i++)).join('')}</ul></section>`
      })
      .join('')}
    ${ready().length === 0 ? '<p class="muted">Nothing ready to send.</p>' : ''}
    ${keptBack().length
      ? `<details class="kept" open><summary>Kept back (${keptBack().length}) · not counted, no reminders</summary><ul>${keptBack()
          .map(q => `<li><span>${esc(q.short)}</span> <span class="to">→ ${esc(to(q.session))}</span><button class="link" data-act="unkeep" data-id="${q.id}">Return</button></li>`)
          .join('')}</ul></details>`
      : ''}
    ${withoutText.length ? `<p class="muted small">${plural(withoutText.length, 'draft')} without text yet: ${esc(withoutText.map(q => q.short).join(', '))}.</p>` : ''}
    <div class="tray-foot">
      <span>${pick.length ? esc(recipientsLine(pick.map(q => q.id))) : 'Nothing selected'}</span>
      <button class="link" data-act="review">Review & send with a message</button>
      <button class="primary" data-act="send-picked" ${pick.length ? '' : 'disabled'}>Send ${pick.length} <kbd>⌘↵</kbd></button>
    </div>
  </div>`
}

const leaveModal = () => {
  const r = ready()
  return `<div class="scrim" data-act="stay"></div>
  <div class="modal" role="alertdialog" aria-label="Unsent answers">
    <h2>${plural(r.length, 'answer')} ${r.length === 1 ? "isn't" : "aren't"} sent yet</h2>
    <p class="muted">They stay saved as drafts on this page if you leave; the asking sessions just won't have them.</p>
    ${groupBySession(r.map(q => q.id))
      .map(g => `<p><span class="recipient">→ ${esc(to(g.session))}</span><br>${esc(g.ids.map(id => `${byId(id).short} (${roundOf(byId(id).round).name})`).join(', '))}</p>`)
      .join('')}
    <div class="actions">
      <button class="ghost" data-act="stay">Stay</button>
      <button class="ghost" data-act="leave">Leave, keep as drafts</button>
      <button class="primary" data-act="send-leave">Send ${r.length} and leave</button>
    </div>
  </div>`
}

const overlay = () => (ui.leaving ? leaveModal() : ui.tray ? tray() : '')

const toggleTray = () => {
  ui.tray = !ui.tray
  ui.nudge = false
  ui.cursor = 0
  render()
}
const sendPicked = () => {
  const ids = selected().map(q => q.id)
  if (ids.length === 0) return
  ui.tray = false
  sendAnswers(ids)
}
const keep = (id: number, on: boolean) => {
  const q = byId(id)
  if (q.answer.state === 'draft') q.answer.held = on
  render()
}

addEventListener('beforeunload', ev => {
  if (ready().length > 0) ev.preventDefault()
})
// Any answer edit re-arms the quiet-minute nudge.
document.addEventListener('click', ev => {
  if ((ev.target as Element).closest('[data-act="choose"]')) armIdle()
})
document.addEventListener('input', armIdle)

mount({
  id: 'C',
  name: 'Unsent tray and nudge',
  blurb: 'Review & send becomes a live "N unsent" counter with a tray. Keep back marks drafts you are holding. Leaving or a quiet minute nudges.',
  headerActions,
  overlay,
  leave: where => {
    if (ready().length === 0) return false
    ui.leaving = where
    ui.tray = false
    render()
    return true
  },
  actions: {
    tray: toggleTray,
    'not-yet': () => {
      ui.nudge = false
      render()
    },
    pick: el => {
      const id = Number(el.dataset.id)
      ui.off = ui.off!.includes(id) ? ui.off!.filter(x => x !== id) : [...ui.off!, id]
      render()
    },
    keep: el => keep(Number(el.dataset.id), true),
    unkeep: el => keep(Number(el.dataset.id), false),
    'send-round': el => {
      ui.tray = false
      ui.nudge = false
      sendAnswers(ready(Number(el.dataset.round)).map(q => q.id))
    },
    'send-picked': sendPicked,
    review: () => {
      ui.tray = false
      go('review')
    },
    stay: () => {
      ui.leaving = undefined
      render()
    },
    leave: () => {
      const where = ui.leaving!
      ui.leaving = undefined
      S.page = 'elsewhere'
      render()
      void where
    },
    'send-leave': () => {
      sendAnswers(ready().map(q => q.id))
      ui.leaving = undefined
      S.page = 'elsewhere'
      render()
    },
    'simulate-idle': () => {
      ui.nudge = ready().length > 0
      render()
    },
  },
  barExtra: () => `<button data-act="simulate-idle" title="Skip the quiet minute">Idle nudge</button>`,
  keydown: ev => {
    if (ui.leaving) {
      if (ev.key === 'Escape') {
        ui.leaving = undefined
        render()
        return true
      }
      return false
    }
    if (!ui.tray) {
      if (ev.key === 'u' && !typing(ev.target) && !ev.metaKey && !ev.ctrlKey) {
        toggleTray()
        return true
      }
      return false
    }
    const rows = trayRows()
    const cur = rows[ui.cursor!]
    if (ev.key === 'Escape' || (ev.key === 'u' && !typing(ev.target))) toggleTray()
    else if (ev.key === 'ArrowDown') ui.cursor = Math.min(rows.length - 1, ui.cursor! + 1)
    else if (ev.key === 'ArrowUp') ui.cursor = Math.max(0, ui.cursor! - 1)
    else if (ev.key === ' ' && cur) ui.off = ui.off!.includes(cur.id) ? ui.off!.filter(x => x !== cur.id) : [...ui.off!, cur.id]
    else if (ev.key === 'k' && cur) {
      keep(cur.id, true)
      ui.cursor = Math.max(0, Math.min(ui.cursor!, trayRows().length - 1))
    } else if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) sendPicked()
    else return true
    ev.preventDefault()
    render()
    return true
  },
  stateExtra: () =>
    `<p>Tray ${ui.tray ? 'open' : 'closed'} · excluded: ${ui.off!.map(id => byId(id).key).join(', ') || 'none'} · kept back: ${keptBack().map(q => q.key).join(', ') || 'none'} · nudge ${ui.nudge ? 'showing' : 'off'}</p>`,
})
armIdle()
