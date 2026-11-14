// PROTOTYPE store: in memory only, nothing reaches the live server or an agent.
import * as data from './data.js'

const clone = value => JSON.parse(JSON.stringify(value))

export const state = {
  actions: clone(data.actions),
  holds: clone(data.holds),
  updates: clone(data.updates),
  questions: clone(data.openQuestions),
  // Mirrors the squad profile's grant_sources. Today it is `desktop+cli`, so page answers are
  // answers, never grants (squad ADR 0042, 0053). The floating bar flips it to show both worlds.
  pageGrants: false,
  log: [],
  now: data.NOW,
}

const listeners = new Set()
export const subscribe = fn => listeners.add(fn)
const emit = () => listeners.forEach(fn => fn(state))

const record = (event, detail) => {
  state.now += 60_000
  state.log.unshift({ at: state.now, event, ...detail })
  state.log = state.log.slice(0, 40)
}

export const byId = id => state.actions.find(a => a.id === id)
export const holdOf = id => state.holds.find(h => h.id === id)
export const isHeld = a =>
  (a.heldBy ?? []).some(id => holdOf(id)?.state === 'active')

export const openActions = () =>
  state.actions.filter(a => a.progress.state === 'open')
export const counts = () => {
  const open = openActions()
  return {
    waiting: open.filter(a => a.urgency !== 'fyi' && !a.optional).length,
    whenever: open.filter(a => a.urgency === 'fyi' || a.optional).length,
    open: open.length,
    promised: state.actions.filter(a => a.progress.state === 'promised').length,
    checking: state.actions.filter(a => a.progress.state === 'reported').length,
    holds: state.holds.filter(h => h.state === 'active').length,
    questions: state.questions.length,
    stale: state.updates.filter(u => u.stale).length,
  }
}

export const toastBus = { show: () => {} }

export const ops = {
  copy(id, text) {
    navigator.clipboard?.writeText(text).catch(() => {})
    record('copied', { id, text })
    toastBus.show('Copied. Copying is not doing: the step stays open until it is done.')
    emit()
  },
  focus(id, address) {
    // Live page: POST owner-focused → `herdr-app do agent.focus <address>` (fixed argv, ADR 0014).
    record('owner-focused', { id, address })
    toastBus.show(`Focused ${address} in Herdr (simulated). Paste and press Enter there yourself.`)
    emit()
  },
  open(id, url) {
    record('opened', { id, url })
    toastBus.show(`Would open ${url}`)
    emit()
  },
  report(id) {
    const a = byId(id)
    if (a.done === 'mark') {
      a.progress = { state: 'completed', proof: 'Marked done by you on the page', checkedAt: state.now, by: 'rob' }
      record('owner-reported', { id, outcome: 'done', completes: true })
      toastBus.show('Marked done. This one needs no agent proof.')
    } else {
      a.progress = { state: 'reported', at: state.now, via: 'you said done on the page' }
      record('owner-reported', { id, outcome: 'done', completes: false })
      toastBus.show(`Noted. ${a.session} confirms with proof before it counts as done.`)
    }
    emit()
  },
  pageAnswer(id) {
    const a = byId(id)
    if (!state.pageGrants) {
      record('page-answer-refused', { id, reason: 'grant_sources lacks page' })
      toastBus.show('Not available: grant_sources is desktop+cli, so a page answer is not a grant. Copy the line and type it in the session.')
      emit()
      return
    }
    a.progress = { state: 'reported', at: state.now, via: `page answer → PAGE citation, read by ${a.session} with gf grant` }
    record('page-answer', { id, session: a.session, kind: 'PAGE' })
    toastBus.show(`Sent as a page answer. ${a.session} cites it as PAGE and posts proof.`)
    emit()
  },
  pageDo(id) {
    const a = byId(id)
    a.progress = { state: 'completed', proof: 'Done on this page (browser permission granted)', checkedAt: state.now, by: 'page' }
    record('page-did', { id })
    toastBus.show('Done here. The page could do this one itself.')
    emit()
  },
  proof(id) {
    const a = byId(id)
    const proofs = {
      'merge-157': 'evidence merge-157: github rbrtbn/squad#157 merged at fcee236e',
      'merge-grill-mod': 'evidence: github rbrtbn/dotfiles#432 merged; chezmoi apply reported',
      'merge-gf-19': 'evidence: github rbrtbn/grill-flow#19 merged; server answers on 4317',
    }
    a.progress = {
      state: 'completed',
      proof: proofs[id] ?? `grant log gl-${Math.random().toString(16).slice(2, 18)} cited in Grants row`,
      checkedAt: state.now,
      by: a.session,
    }
    record('item-published', { id, revision: 'next', progress: 'completed' })
    emit()
  },
  skip(id) {
    const a = byId(id)
    a.progress = { state: 'withdrawn', reason: 'You skipped it on the page' }
    record('owner-reported', { id, outcome: 'skipped' })
    emit()
  },
  togglePageGrants() {
    state.pageGrants = !state.pageGrants
    record('setting', { grant_sources: state.pageGrants ? 'desktop cli page' : 'desktop+cli' })
    emit()
  },
}

export const simulate = {
  merge157() {
    const m = byId('merge-157')
    if (m.progress.state !== 'completed') ops.proof('merge-157')
    const f = byId('q380-grant-followup')
    if (f.progress.state === 'promised') {
      Object.assign(f, f.fill)
      f.progress = { state: 'open' }
      f.at = state.now
      record('item-published', { id: f.id, revision: 2, progress: 'open', note: 'promise filled' })
      toastBus.show('squad#157 merged → t2hq filled in the Q380 follow-up. It is now on you.')
    }
    emit()
  },
  clearHold() {
    const h = holdOf('hold-plugin-reload')
    h.state = 'cleared'
    h.clearedAt = state.now
    record('item-published', { id: h.id, state: 'cleared' })
    toastBus.show('Hold cleared: squad 25.8.1 released.')
    emit()
  },
  proofs() {
    state.actions.filter(a => a.progress.state === 'reported').forEach(a => ops.proof(a.id))
    emit()
  },
  reset() {
    state.actions = clone(data.actions)
    state.holds = clone(data.holds)
    state.updates = clone(data.updates)
    state.pageGrants = false
    state.log = []
    state.now = data.NOW
    emit()
  },
}

export const refresh = emit
