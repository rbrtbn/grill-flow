// PROTOTYPE (ask 9673) · A · Send from the queue.
// Each ready draft in the sidebar gets a Send button and each round a "Send N"; a popover
// names every recipient before anything leaves. Confirm-before, never undo-after: a delivered
// answer can't be recalled, so A asks first and keeps the click count at two.
import '../send-shortcuts-shared/base.css'
import './styles.css'
import {
  S,
  byId,
  drafts,
  esc,
  groupBySession,
  isReady,
  mount,
  plural,
  render,
  roundOf,
  sendAnswers,
  answerText,
  to,
  type Question,
} from '../send-shortcuts-shared/shared'

type Confirm = { ids: Array<number>; skipped: number; title: string; x: number; y: number }
const confirm = () => S.ui.confirm as Confirm | undefined

const open = (el: HTMLElement, ids: Array<number>, skipped: number, title: string) => {
  const r = el.getBoundingClientRect()
  S.ui.confirm = { ids, skipped, title, x: Math.min(r.right + 10, innerWidth - 360), y: Math.min(r.top - 8, innerHeight - 320) }
  render()
  document.getElementById('confirm-send')?.focus()
}
const close = () => {
  S.ui.confirm = undefined
  render()
}
const commit = () => {
  const c = confirm()
  if (!c) return
  S.ui.confirm = undefined
  sendAnswers(c.ids)
}

const rowExtra = (q: Question) => {
  if (q.answer.state !== 'draft') return ''
  if (!isReady(q)) return `<span class="row-note" title="Own answer has no text yet">no text</span>`
  const failed = q.answer.failure !== undefined
  return `<button class="row-send${failed ? ' retry' : ''}" data-act="ask-one" data-id="${q.id}"
    title="${failed ? 'Retry' : 'Send'} this answer to ${esc(to(q.session))}" aria-label="${failed ? 'Retry' : 'Send'} ${esc(q.short)} to ${esc(to(q.session))}">${failed ? 'Retry' : 'Send'}</button>`
}

const roundExtra = (r: { n: number; name: string }) => {
  const ready = drafts(r.n).filter(isReady)
  if (ready.length === 0) return ''
  const sessionsInRound = groupBySession(ready.map(q => q.id)).length
  return `<button class="round-send" data-act="ask-round" data-round="${r.n}"
    title="Send ${plural(ready.length, 'draft')} in ${esc(r.name)} to ${plural(sessionsInRound, 'session')}">Send ${ready.length}</button>`
}

const overlay = () => {
  const c = confirm()
  if (!c) return ''
  const groups = groupBySession(c.ids)
  return `<div class="scrim clear" data-act="cancel"></div>
  <div class="popover" role="dialog" aria-label="${esc(c.title)}" style="left:${c.x}px;top:${Math.max(c.y, 60)}px">
    <h3>${esc(c.title)}</h3>
    ${groups
      .map(
        g => `<div class="to-group"><span class="recipient">→ ${esc(to(g.session))}</span>
        <ul>${g.ids.map(id => `<li><strong>${esc(byId(id).short)}</strong><br><span class="muted">${esc(answerText(byId(id)))}</span></li>`).join('')}</ul></div>`,
      )
      .join('')}
    ${c.skipped ? `<p class="muted">${plural(c.skipped, 'draft')} without text stay${c.skipped === 1 ? 's' : ''} as draft.</p>` : ''}
    <p class="muted small-print">${groups.length > 1 ? `One send, ${groups.length} messages: each session gets only its own answers.` : 'Goes straight to the asking session.'} Sent answers can't be recalled; you can still add to them in Discussion.</p>
    <div class="actions"><button class="ghost" data-act="cancel">Cancel <kbd>esc</kbd></button>
      <button id="confirm-send" class="primary" data-act="commit">Send ${plural(c.ids.length, 'answer')} <kbd>↵</kbd></button></div>
  </div>`
}

mount({
  id: 'A',
  name: 'Send from the queue',
  blurb: 'A Send button on every ready draft in the sidebar, Send N on each round. A popover names recipients before it sends.',
  rowExtra,
  roundExtra,
  overlay,
  actions: {
    'ask-one': el => {
      const q = byId(Number(el.dataset.id))
      open(el, [q.id], 0, `Send "${q.short}"`)
    },
    'ask-round': el => {
      const n = Number(el.dataset.round)
      const all = drafts(n)
      const ready = all.filter(isReady)
      open(el, ready.map(q => q.id), all.length - ready.length, `Send ${roundOf(n).name}'s ${plural(ready.length, 'draft')}`)
    },
    cancel: close,
    commit,
  },
  keydown: ev => {
    if (!confirm()) return false
    if (ev.key === 'Escape') {
      close()
      return true
    }
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault()
      commit()
      return true
    }
    return false
  },
  stateExtra: () => `<p>Popover: ${confirm() ? confirm()!.ids.map(id => byId(id).key).join(', ') : 'closed'}</p>`,
})
