// PROTOTYPE (ask 9673) · B · Send where you answer.
// Once a question has a ready draft, a strip under the answer offers "Send this answer" and
// "Send <round>'s N drafts", both naming recipients. Sends wait 5 s with Undo before the
// page freezes them; Undo is only offered while nothing has left the page.
import '../send-shortcuts-shared/base.css'
import './styles.css'
import {
  S,
  byId,
  drafts,
  esc,
  isReady,
  mount,
  plural,
  recipientsLine,
  render,
  roundOf,
  sendAnswers,
  to,
  type Question,
  typing,
} from '../send-shortcuts-shared/shared'

const HOLD = 5
type Pending = { ids: Array<number>; label: string; left: number; timer: number }
const pending = () => S.ui.pending as Pending | undefined

const flush = () => {
  const p = pending()
  if (!p) return
  clearInterval(p.timer)
  S.ui.pending = undefined
  sendAnswers(p.ids)
}
const hold = (ids: Array<number>, label: string) => {
  if (ids.length === 0) return
  flush()
  const p: Pending = {
    ids,
    label,
    left: HOLD,
    timer: window.setInterval(() => {
      p.left -= 1
      p.left <= 0 ? flush() : render()
    }, 1000),
  }
  S.ui.pending = p
  render()
}
const undo = () => {
  const p = pending()
  if (!p) return
  clearInterval(p.timer)
  S.ui.pending = undefined
  render()
}
const isHeld = (id: number) => pending()?.ids.includes(id) ?? false

const readyIn = (round: number, except?: number) =>
  drafts(round).filter(q => isReady(q) && q.id !== except && !isHeld(q.id))
const otherRounds = (round: number) =>
  S.rounds.filter(r => r.n !== round && readyIn(r.n).length > 0)

const roundButton = (round: number, label: string, primary = false) => {
  const ready = readyIn(round)
  return ready.length === 0
    ? ''
    : `<button class="${primary ? 'primary' : 'ghost'}" data-act="send-round" data-round="${round}">${esc(label)}</button>
       <small>${esc(recipientsLine(ready.map(q => q.id)))}</small>`
}

const elsewhereNote = (q: Question) =>
  otherRounds(q.round)
    .map(r => {
      const ready = readyIn(r.n)
      return `<p class="also">${esc(r.name)} also has ${plural(ready.length, 'unsent draft')} (${esc(ready.map(x => x.short).join(', '))}).
        <button class="link" data-act="select" data-id="${ready[0]!.id}">Open</button> ·
        <button class="link" data-act="send-round" data-round="${r.n}">Send ${ready.length === 1 ? 'it' : `all ${ready.length}`}</button></p>`
    })
    .join('')

const afterAnswer = (q: Question) => {
  const a = q.answer
  const round = roundOf(q.round)
  const p = pending()
  if (p && p.ids.includes(q.id)) {
    return `<div class="send-strip holding" role="status">
      <div class="strip-line">Sending ${esc(p.label)} in <strong>${p.left} s</strong>. Nothing has left the page yet.</div>
      <div class="strip-actions"><button class="primary" data-act="undo">Undo <kbd>⌘Z</kbd></button><button class="ghost" data-act="now">Send now</button></div>
    </div>`
  }
  if (a.state === 'sent' || a.state === 'sending') {
    const next = S.questions.find(x => x.answer.state === 'open' && x.round === q.round)
    const more = readyIn(q.round)
    return `<div class="send-strip done">
      <div class="strip-line">${a.state === 'sent' ? `Sent to <strong>${esc(to(q.session))}</strong> in send #${a.send} at ${a.sentAt}.` : `Send #${a.send} is frozen and on its way to <strong>${esc(to(q.session))}</strong>.`}</div>
      <div class="strip-actions">${next ? `<button class="ghost" data-act="select" data-id="${next.id}">Next open question: ${esc(next.short)} →</button>` : ''}
      ${more.length ? roundButton(q.round, `Send ${round.name}'s other ${plural(more.length, 'draft')}`) : ''}</div>
      ${elsewhereNote(q)}
    </div>`
  }
  if (a.state === 'draft' && isReady(q)) {
    const others = readyIn(q.round, q.id)
    return `<div class="send-strip">
      <div class="strip-line"><span class="state-mark draft"></span>${a.failure ? 'Not delivered, still a draft.' : 'Draft · not sent.'} Goes to <strong>${esc(to(q.session))}</strong>.</div>
      <div class="strip-actions">
        <button class="primary" data-act="send-this" data-id="${q.id}">Send this answer <kbd>⌘↵</kbd></button>
        ${others.length ? `${roundButton(q.round, `Send all ${others.length + 1} in ${round.name}`)} <kbd>⇧⌘↵</kbd>` : ''}
      </div>
      ${elsewhereNote(q)}
    </div>`
  }
  const ready = readyIn(q.round)
  if (a.state === 'open' && ready.length) {
    return `<div class="send-strip quiet">
      <div class="strip-line">Not ready to answer this one? ${esc(round.name)} has ${plural(ready.length, 'draft')} you can send now.</div>
      <div class="strip-actions">${roundButton(q.round, `Send ${round.name}'s ${plural(ready.length, 'draft')}`)} <kbd>⇧⌘↵</kbd></div>
      ${elsewhereNote(q)}
    </div>`
  }
  return ''
}

const sendThis = (id: number) => {
  const q = byId(id)
  if (isReady(q)) hold([id], `"${q.short}" to ${to(q.session)}`)
}
const sendRound = (round: number) => {
  const ready = readyIn(round)
  hold(
    ready.map(q => q.id),
    `${roundOf(round).name}'s ${plural(ready.length, 'draft')} (${recipientsLine(ready.map(q => q.id))})`,
  )
}

const overlay = () => {
  const p = pending()
  if (!p) return ''
  const onScreen = S.page === 'question' && p.ids.includes(S.selected)
  return onScreen
    ? ''
    : `<div class="hold-toast" role="status">Sending ${esc(p.label)} in ${p.left} s
        <button data-act="undo">Undo</button><button data-act="now">Send now</button></div>`
}

addEventListener('beforeunload', ev => {
  if (pending()) ev.preventDefault()
})

mount({
  id: 'B',
  name: 'Send where you answer',
  blurb: 'A send strip under the answer: this answer, or the whole round, with 5 s to undo. Open questions offer the round’s ready drafts.',
  afterAnswer,
  overlay,
  rowExtra: q => (isHeld(q.id) ? '<span class="clock" title="Sending in a moment">◷</span>' : ''),
  actions: {
    'send-this': el => sendThis(Number(el.dataset.id)),
    'send-round': el => sendRound(Number(el.dataset.round)),
    undo,
    now: flush,
  },
  keydown: ev => {
    if (pending() && !typing(ev.target) && (ev.metaKey || ev.ctrlKey) && ev.key === 'z') {
      ev.preventDefault()
      undo()
      return true
    }
    if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey) && S.page === 'question') {
      ev.preventDefault()
      const q = byId(S.selected)
      if (ev.shiftKey) sendRound(q.round)
      else if (isReady(q) && !isHeld(q.id)) sendThis(q.id)
      // Without a ready draft here, ⌘↵ keeps today's meaning: open Review & send.
      else {
        S.page = 'review'
        render()
      }
      return true
    }
    return false
  },
  stateExtra: () => {
    const p = pending()
    return `<p>Held for undo: ${p ? `${p.ids.map(id => byId(id).key).join(', ')} · ${p.left} s left` : 'nothing'}</p>`
  },
})
