// Three structural navigation studies; all questions and actions are local sample data.
const variants = ['A', 'B', 'C']
const studies = {
  A: [
    'One work queue',
    'Remove both rails. Choose a round only when it helps.',
  ],
  B: [
    'Small rail, round drill-down',
    'Keep four destinations. Browse rounds instead of repeating them.',
  ],
  C: [
    'Reading first',
    'Navigation on demand. Spend the width on the current decision.',
  ],
}
const openQuestions = [
  {
    id: 'Q194',
    title: 'Keep the checked launcher, in stages',
    source: 'Grants & dashboard',
    round: 'Codex launcher policy',
    urgency: 'soon',
    detail:
      'Choose a staged rollout so each step has a clear verification point.',
  },
  {
    id: 'Q195',
    title: 'Keep rob-mbp working without an exception',
    source: 'Grants & dashboard',
    round: 'Codex launcher policy',
    urgency: 'soon',
    detail: 'Keep the working setup available while the new path is checked.',
  },
  {
    id: 'Q196',
    title: 'Open for you',
    source: 'squad-eff lead',
    round: 'Lead asks',
    urgency: 'fyi',
    detail:
      'Review the list and say whether anything should be handled differently.',
  },
  {
    id: 'Q199',
    title: 'Choose the next orchestrator',
    source: 'squad-eff lead',
    round: 'Lead asks',
    urgency: 'soon',
    detail: 'Choose who should own the next coordination cycle.',
  },
].map(q => ({ ...q, status: 'open' }))
const oldRounds = [
  'Stages',
  'Tonight',
  'Wiki',
  'Retire',
  'After round 1',
  'Lead',
  'Choose the next features',
  'Notification placement',
  'Earlier decisions',
]
const questions = [
  ...openQuestions,
  ...Array.from({ length: 87 }, (_, i) => ({
    id: `Q${i + 1}`,
    title: `Earlier decision ${i + 1}`,
    source: i < 60 ? 'Squad lead' : 'grill-flow',
    round: oldRounds[i % oldRounds.length],
    urgency: 'wait',
    status: 'sent',
    detail:
      'This illustrative decision has already been sent. It stays available in All questions.',
  })),
]
let variant = variants.includes(
  new URLSearchParams(location.search).get('variant'),
)
  ? new URLSearchParams(location.search).get('variant')
  : 'A'
let page = 'questions'
let utilityTitle = ''
let selected = 'Q194'
let filter = 'open'
let search = ''
let round = ''
let mode = 'questions'
let browse = false
let discussion = true
let mobileConversation = false
let expandedConversation = false
let threadScope = 'question'
let urgency = 'all'
let noteOpen = false
let drawingOpen = false
const conversationDrafts = {}
const notes = {}
const ownAnswers = {}
const roundNames = {}
function threadKey() {
  return threadScope === 'question' ? selected : threadScope
}
function roundLabel(name) {
  return roundNames[name] || name
}
function moreMenu() {
  return `<details class="more"><summary>More · 12 new</summary><div>${action('page-activity', 'What changed · 12')}${action('page-replies', `Replies · ${unread} unread`)}${['Updates', 'Answer history', 'Squad overview', 'Run overview', 'All grills', 'Settings', 'Delivery states'].map(text => action('utility', text)).join('')}</div></details>`
}
function questionTools(q) {
  return `${answers[q.id] === '2' ? `<label class="question-editor">Your own answer<textarea data-own-answer="${q.id}" placeholder="Describe your choice…">${escapeHtml(ownAnswers[q.id] || '')}</textarea></label>` : ''}<div class="question-tools">${action('note', noteOpen ? 'Close note' : 'Add a note')}${action('discussion', 'Discuss')}${action('drawing', drawingOpen ? 'Close comparison' : 'Draw this')}${action('skip', 'Skip for now')}<small>Example issue · LAB-1341</small></div>${noteOpen ? `<label class="question-editor">Note on ${q.id}<textarea data-note="${q.id}">${escapeHtml(notes[q.id] || '')}</textarea></label>` : ''}${drawingOpen ? '<section class="sample-drawing"><h2>Example comparison</h2><table><thead><tr><th></th><th>Staged approach</th><th>Different route</th></tr></thead><tbody><tr><th>Verification</th><td>Between each step</td><td>Discuss a new check</td></tr><tr><th>Next action</th><td>Review the next stage</td><td>Revise the proposal</td></tr></tbody></table><small>Local illustration; no agent request was sent.</small></section>' : ''}`
}

let draft = ''
let unread = 6
let inboxOpen = false
let preview = false
let timer
const answers = { Q22: '0', Q23: '1' }
const pending = new Set(['Q22', 'Q23'])
const excluded = new Set()
let sendMessage = ''
let sendResult = ''
questions.find(q => q.id === 'Q22').title = 'Choose the review window'
questions.find(q => q.id === 'Q23').title = 'Keep the fallback available'
function questionStatus(q) {
  return pending.has(q.id) ? 'draft' : q.status
}
function openCount() {
  return questions.filter(q => questionStatus(q) === 'open').length
}
function answerText(id) {
  return answers[id] === '2'
    ? ownAnswers[id] || 'My own answer'
    : ['Keep the staged approach', 'Take a different route'][
        Number(answers[id])
      ] || 'Note only'
}
function selectedDrafts() {
  return [...pending].filter(id => !excluded.has(id))
}
function reviewContent() {
  return `<h1>Review & send</h1><p class="intro">${pending.size} drafts · ${selectedDrafts().length} selected. This is a local demonstration: no message or answer is delivered.</p>${sendResult ? `<p class="demo-result" role="status">${escapeHtml(sendResult)}</p>` : ''}<section class="review-list">${pending.size ? action('select-all-drafts', selectedDrafts().length === pending.size ? 'Deselect all' : 'Select all') : '<p>No draft answers. You can still add a message to the demonstration.</p>'}${[
    ...pending,
  ]
    .map(id => {
      const q = questions.find(q => q.id === id)
      return `<div class="review-row"><label><input type="checkbox" data-review-id="${id}" ${excluded.has(id) ? '' : 'checked'} aria-label="Include ${id}"><span><b>${id} · ${escapeHtml(q.title)}</b><small>${escapeHtml(q.source)} · ${escapeHtml(roundLabel(q.round))}</small><p>${escapeHtml(answerText(id))}</p>${notes[id] ? `<small>Note: ${escapeHtml(notes[id])}</small>` : id === 'Q23' ? '<small>Note: Please keep the fallback open.</small>' : ''}</span></label>${action('question', 'Edit answer', `data-id="${id}"`)}</div>`
    })
    .join(
      '',
    )}</section><section class="review-compose"><label for="send-message">Message to include</label><textarea id="send-message" placeholder="Optional message…">${escapeHtml(sendMessage)}</textarea><div class="review-send">${action('simulate-send', `Send in prototype · ${selectedDrafts().length}`, `class="send-action" ${selectedDrafts().length === 0 && !sendMessage.trim() ? 'disabled' : ''}`)}<small>Demo only · no API or real recipient</small></div></section>`
}

const $ = s => document.querySelector(s)
const $$ = s => document.querySelectorAll(s)
const escapeHtml = s =>
  String(s).replace(
    /[&<>"']/g,
    c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  )
const action = (name, text, extra = '') =>
  `<button data-action="${name}" ${extra}>${text}</button>`
function icon(name) {
  const paths = {
    work: '<path d="M4 4h16v16H4zM8 11l3 3 5-6"/>',
    questions: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
    conversations: '<path d="M4 4h16v12H9l-5 4z"/>',
    activity: '<path d="M3 12h4l3-7 4 14 3-7h4"/>',
    more: '<circle cx="12" cy="12" r="9"/><path d="M8 12h.01M12 12h.01M16 12h.01"/>',
  }
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name]}</svg>`
}
function matched(includeRound = true) {
  return questions.filter(
    q =>
      (filter === 'all' || questionStatus(q) === filter) &&
      (urgency === 'all' ||
        (urgency === 'urgent'
          ? ['soon', 'blocking'].includes(q.urgency)
          : q.urgency === urgency)) &&
      (!includeRound || !round || q.round === round) &&
      `${q.id} ${q.title} ${q.source} ${q.round}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  )
}
function roundOptions() {
  const names = [...new Set(matched(false).map(q => q.round))]
  return names.map(name => ({
    name,
    count: matched(false).filter(q => q.round === name).length,
  }))
}
function current() {
  return questions.find(q => q.id === selected)
}
function destinations() {
  return `<nav class="destinations" aria-label="App destinations">${['work', 'questions', 'conversations'].map(name => action(`page-${name}`, { work: `Needs you · ${openCount()}`, questions: 'Questions', conversations: 'Conversations' }[name], `class="${page === name ? 'active' : ''}" aria-current="${page === name ? 'page' : 'false'}"`)).join('')}</nav>`
}
function rail() {
  return `<nav class="rail" aria-label="App rail">${['work', 'questions', 'conversations'].map(name => action(`page-${name}`, `${icon(name)}<span>${{ work: 'For you', questions: 'Questions', conversations: 'Talk' }[name]}</span>`, `class="${page === name ? 'active' : ''}" title="${name}"`)).join('')}${action('more', `${icon('more')}<span>More</span>`, 'class="rail-bottom"')}</nav>`
}
function inbox() {
  return `<section class="inbox" aria-label="Notifications">${action('inbox', `<span>${inboxOpen ? 'Close inbox' : 'Inbox'}</span><span><span class="unread">${unread}</span> unread</span>`, 'class="inbox-toggle"')}<div class="preview">${inboxOpen || preview ? previewMarkup() : ''}</div>${action('page-replies', 'All replies', 'class="inbox-history"')}</section>`
}
function previewMarkup() {
  return `<p><b>Grill-flow · example reply</b></p><p>The requested change is ready for review.</p>${action('read-reply', 'Read reply')}${preview ? '<div class="progress"></div>' : ''}`
}
function sidebar() {
  return `<aside class="navigator" aria-label="Question browser"><div class="nav-head"><div class="nav-title"><h2>${variant === 'A' ? 'Question queue' : 'Questions'}</h2>${variant === 'C' ? action('browse', 'Close', 'aria-label="Close question browser"') : `<small>${openCount()} open</small>`}</div>${variant === 'B' ? `<div class="mode-switch">${action('mode-questions', 'Questions', `class="${mode === 'questions' ? 'active' : ''}"`)}${action('mode-rounds', 'Browse rounds', `class="${mode === 'rounds' ? 'active' : ''}"`)}</div>` : ''}<input class="search" type="search" placeholder="Find a question…" aria-label="Find question" value="${escapeHtml(search)}"><div class="scope-row">${action('filter-open', `Open · ${openCount()}`, `class="${filter === 'open' ? 'active' : ''}"`)}${pending.size ? action('filter-draft', `Drafts · ${pending.size}`, `class="${filter === 'draft' ? 'active' : ''}"`) : ''}${action('attention', 'Needs attention', `class="${urgency === 'urgent' ? 'active' : ''}"`)}${action('filter-all', 'All · 91', `class="${filter === 'all' ? 'active' : ''}"`)}</div>${variant === 'B' && round ? action('back-rounds', `← ${escapeHtml(round)}`, 'class="back-rounds"') : variant !== 'B' ? '<select class="round-select" aria-label="Round scope"></select>' : ''}<details class="filter-menu"><summary>Filters</summary>${action('filter-sent', `Sent · ${questions.filter(q => questionStatus(q) === 'sent').length}`)}<label>Urgency<select class="urgency-select"><option value="all">All urgencies</option>${['urgent', 'blocking', 'soon', 'wait', 'fyi'].map(value => `<option value="${value}" ${urgency === value ? 'selected' : ''}>${{ urgent: 'Blocking or Soon', blocking: 'Blocking', soon: 'Soon', wait: 'Can wait', fyi: 'FYI' }[value]}</option>`).join('')}</select></label></details><details class="round-actions"><summary>Round actions</summary><p>${escapeHtml(roundLabel(round || current().round))} · ${questions.filter(q => q.round === (round || current().round) && questionStatus(q) === 'sent').length} sent</p><label>Round name<input class="round-name" value="${escapeHtml(roundLabel(round || current().round))}"></label>${action('rename-round', 'Rename')}</details></div><div class="question-list"></div>${inbox()}</aside>`
}
function renderList() {
  const list = $('.question-list')
  if (!list) return
  if (variant === 'B' && mode === 'rounds') {
    list.innerHTML =
      roundOptions()
        .map(({ name, count }) =>
          action(
            'round',
            `<span>${escapeHtml(roundLabel(name))}<small>${escapeHtml(questions.find(q => q.round === name).source)}</small></span><small>${count} match →</small>`,
            `class="round-row" data-round="${escapeHtml(name)}"`,
          ),
        )
        .join('') || '<p class="empty">No rounds match this search.</p>'
  } else {
    let previous = ''
    list.innerHTML =
      matched()
        .map(q => {
          const heading =
            q.source !== previous
              ? `<h3 class="group-label">${escapeHtml(q.source)}</h3>`
              : ''
          previous = q.source
          return (
            heading +
            action(
              'question',
              `${questionStatus(q) === 'sent' ? '<span class="sent" aria-label="Sent">✓</span>' : questionStatus(q) === 'draft' ? '<span class="draft-mark" aria-label="Draft">✓</span>' : `<span class="dot ${q.urgency}" aria-label="${q.urgency}"></span>`}<span class="question-copy"><b>${escapeHtml(q.title)}</b><small>${q.id} · ${escapeHtml(roundLabel(q.round))}${questionStatus(q) === 'open' ? '' : ` · ${questionStatus(q) === 'draft' ? 'Draft' : 'Sent'}`}</small></span>`,
              `class="question${selected === q.id ? ' active' : ''}" data-id="${q.id}" aria-current="${selected === q.id ? 'page' : 'false'}"`,
            )
          )
        })
        .join('') ||
      '<p class="empty">No questions match. Clear the search or choose All.</p>'
    if (filter === 'open' && !search && !round)
      list.innerHTML += action(
        'filter-all',
        `${questions.filter(q => questionStatus(q) === 'sent').length} sent questions · browse when needed`,
        'class="sent-link"',
      )
  }
  const select = $('.round-select')
  if (select)
    select.innerHTML = `<option value="">All matching rounds</option>${roundOptions()
      .map(
        ({ name, count }) =>
          `<option value="${escapeHtml(name)}" ${round === name ? 'selected' : ''}>${escapeHtml(questions.find(q => q.round === name).source)} / ${escapeHtml(roundLabel(name))} · ${count}</option>`,
      )
      .join('')}`
}
function mainContent() {
  if (page === 'review') return reviewContent()
  if (page === 'summary')
    return `<h1>Open for you</h1><p class="intro">The lead’s pinned brief stays one click away through the Squad title.</p><section class="reason"><h2>Example brief</h2><p>Four decisions and three owner steps are waiting. This is sample content; the production view keeps the existing source-owned summary.</p>${action('page-work', 'Open Needs you')}</section>`
  if (page === 'conversations')
    return `<h1>Conversations</h1><p class="intro">Use question, whole-run or Grill-flow scope; moving here preserves the same conversation draft.</p>${discussionContent()}`
  if (page === 'replies')
    return `<h1>Replies & decisions</h1><p class="intro">Full reply history remains available from the inbox and More.</p>${[1, 2, 3].map(i => `<section class="activity-entry"><small>Example reply ${i} · unread</small><p>The requested change is ready to review.</p>${action('question', 'Open question', `data-id="Q194"`)}</section>`).join('')}`

  if (page === 'utility' && utilityTitle === 'Delivery states')
    return `<h1>Delivery states</h1><p class="intro">Example failure states remain visible independently of navigation.</p><div class="sample-alert">Save failed. Your draft is retained. ${action('review', 'Review drafts')}</div><div class="sample-alert">Delivery unconfirmed. Review before sending again. ${action('review', 'Review saved send')}</div><p class="study-note">Static examples; no save or delivery failed in a real page.</p>`
  if (page === 'utility')
    return `<h1>${escapeHtml(utilityTitle)}</h1><p class="intro">This destination is a placeholder in the navigation study. The prototype concentrates on questions, rounds and the reading/discussion layout.</p><p class="study-note">Choose Questions or Needs you to continue comparing the structures. Nothing is sent or saved.</p>`
  if (page === 'work') {
    return `<h1>Needs you</h1><p class="intro">Decisions and owner steps, without a second question list beside them.</p><div class="work-intro"><span><b>${openCount()}</b>open decisions</span><span>${action('review', `${pending.size} drafts ready to send`)}</span><span><b>3</b>owner steps</span></div><section class="work-list"><h2>Decisions</h2>${openQuestions
      .filter(q => questionStatus(q) === 'open')
      .map(q =>
        action(
          'question',
          `<span class="work-id">${q.id}</span><span><b>${escapeHtml(q.title)}</b><small>${escapeHtml(q.source)} · ${escapeHtml(roundLabel(q.round))}</small></span>`,
          `class="work-row" data-id="${q.id}"`,
        ),
      )
      .join(
        '',
      )}</section><section class="work-list"><h2>Owner steps</h2>${['Review the notification placement PR', 'Choose the account for the page guard', 'Enable browser notifications'].map((text, i) => `<div class="work-row"><span class="work-id">${i + 1}</span><span><b>${text}</b><small>Sample step · waiting on the owner</small></span></div>`).join('')}</section><p class="study-note">Sample data. This view hides the question browser because the decision list is already here. Choose a decision to return to its question.</p>`
  }
  if (page === 'activity')
    return `<h1>What changed</h1><p class="intro">A separate destination for updates and history, without a persistent round list.</p>${['The notification prototype is ready to compare.', 'An agent replied to the launcher question.', 'The next round has two open decisions.'].map((t, i) => `<section class="activity-entry"><small>${i + 1} minute${i ? 's' : ''} ago · example activity</small><p>${t}</p></section>`).join('')}`
  const q = current()
  const visible = matched()
  const position = visible.findIndex(item => item.id === q.id)
  const counter =
    position < 0
      ? 'Outside this filter'
      : `${position + 1} of ${visible.length}`
  return `<div class="question-position"><div class="context">${variant === 'C' ? action('browse', `${browse ? 'Close browser' : 'Browse questions'} · ${matched().length}`, 'aria-label="Toggle question browser"') : `<span>${counter}</span>`}<span>${escapeHtml(q.source)}</span><span> / ${escapeHtml(roundLabel(q.round))}</span></div><div>${action('previous', '←', `aria-label="Previous question" ${position <= 0 ? 'disabled' : ''}`)} ${action('next', '→', `aria-label="Next question" ${position < 0 || position === visible.length - 1 ? 'disabled' : ''}`)}</div></div><small>${q.id} · ${{ open: 'Open decision', draft: 'Draft answer', sent: 'Sent' }[questionStatus(q)]}</small><h1 tabindex="-1">${escapeHtml(q.title)}</h1><p class="intro">${escapeHtml(q.detail)} These are illustrative options for testing navigation.</p><div class="answer-options">${['Keep the staged approach', 'Take a different route', 'My own answer'].map((text, i) => `<label class="answer-option"><input type="radio" name="answer" value="${i}" ${answers[q.id] === String(i) ? 'checked' : ''}><span><strong>${text}${i === 0 ? '<small class="recommended">Recommended</small>' : ''}</strong><small>${['Keep a clear check between each step.', 'Discuss the tradeoff before changing the plan.', 'Describe what should change in your words.'][i]}</small></span></label>`).join('')}</div>${questionTools(q)}<section class="reason"><h2>Why this question</h2><p>The work has an explicit decision point. Keep the question, its consequences and its discussion together; use navigation to move between them.</p></section><p class="study-note">${variant === 'A' ? 'A removes the app and round rails. Open questions lead; completed rounds stay behind All. Round scope is one selector, with no zero-match entries.' : variant === 'B' ? 'B keeps a small rail for three frequent destinations and More. Browse rounds replaces the list temporarily, then drills into the selected round.' : 'C keeps the reading area wide. Browse questions opens the navigator only when needed; Inbox opens the same browser with its inbox. This trades the always-visible sidebar inbox for header access.'}</p>`
}
function discussionContent() {
  const scopeTitle = {
    question: `${selected} · ${current().title}`,
    run: 'Whole run · Squad',
    maintainer: 'Grill-flow · Interface & improvements',
  }[threadScope]
  return `<aside class="discussion"><div class="discussion-head"><h2>Discussion</h2><div>${page === 'questions' ? action('expand-discussion', expandedConversation ? 'Back' : 'Expand') : ''}${action('discussion', 'Close')}</div></div><div class="tabs">${['question', 'run', 'maintainer'].map(scope => action('thread-scope', { question: 'This question', run: 'Whole run', maintainer: 'Grill-flow' }[scope], `data-scope="${scope}" class="${threadScope === scope ? 'active' : ''}"`)).join('')}</div><div class="context-card"><small>${escapeHtml(scopeTitle)}</small>Each scope keeps its own draft.</div><div class="thread"><p><b>You</b><br>The rails repeat information and leave too little room for the work.</p><p><b>Maintainer</b><br>Existing conversation, question and review tools remain available in both studies.</p></div><div class="composer"><label for="draft">Ask about ${threadScope === 'question' ? selected : threadScope === 'run' ? 'the run' : 'Grill-flow'}</label><textarea id="draft" placeholder="Your conversation draft…">${escapeHtml(draft)}</textarea><small>Local prototype · no message is sent</small></div></aside>`
}

function render() {
  document.body.className = `variant-${variant} page-${page}${browse ? ' browse-open' : ''}${discussion ? '' : ' no-discussion'}${mobileConversation ? ' mobile-conversation' : ''}${expandedConversation ? ' expanded-conversation' : ''}`
  $('#app').innerHTML =
    `<div class="shell"><header class="top"><div class="brand">${action('page-summary', 'grill-flow', 'class="brand-home" aria-label="Open for you · Squad"')}${action('page-summary', 'Squad · Open for you', 'class="pinned-summary"')}</div>${destinations()}<div class="top-end">${action('review', `Review & send${pending.size ? ` · ${pending.size}` : ''}`, 'class="send-action"')}${page === 'questions' ? action('mobile-discussion', mobileConversation ? 'Question' : 'Discuss', 'class="mobile-discussion-trigger"') : ''}${variant === 'C' ? action('inbox', `Inbox · <span class="unread">${unread}</span>`) : ''}${page === 'questions' && !discussion ? action('discussion', 'Discuss') : ''}${moreMenu()}<small>Prototype · sample data<br>Nothing is sent or saved</small></div></header><div class="workspace">${rail()}${sidebar()}<main class="main">${mainContent()}</main>${page === 'questions' ? discussionContent() : ''}</div></div>`
  $('#study-title').textContent = `${variant} · ${studies[variant][0]}`
  $('#study-thesis').textContent = studies[variant][1]
  renderList()
}
function selectQuestion(id) {
  const target = questions.find(q => q.id === id)
  if (round && target.round !== round) round = ''
  if (filter !== 'all' && questionStatus(target) !== filter)
    filter = questionStatus(target) === 'draft' ? 'draft' : 'all'
  if (
    search &&
    !`${target.id} ${target.title} ${target.source} ${target.round}`
      .toLowerCase()
      .includes(search.toLowerCase())
  )
    search = ''
  selected = id
  draft = conversationDrafts[threadKey()] || ''
  expandedConversation = false
  page = 'questions'
  if (variant === 'C') browse = false
  render()
}
function changeVariant(delta) {
  clearTimeout(timer)
  preview = false
  variant =
    variants[
      (variants.indexOf(variant) + delta + variants.length) % variants.length
    ]
  mode = 'questions'
  browse = false
  const url = new URL(location)
  url.searchParams.set('variant', variant)
  history.replaceState(null, '', url)
  render()
}
function expirePreview() {
  const panel = $('.preview')
  if (panel && panel.contains(document.activeElement)) {
    timer = setTimeout(expirePreview, 250)
    return
  }
  preview = false
  if (panel && !inboxOpen) panel.replaceChildren()
  if (panel) panel.querySelector('.progress')?.remove()
}
document.addEventListener('click', event => {
  const el = event.target.closest('[data-action]')
  if (!el) return
  const act = el.dataset.action
  if (act === 'variant-prev') return changeVariant(-1)
  if (act === 'variant-next') return changeVariant(1)
  if (act === 'review') {
    page = 'review'
    render()
    return
  }
  if (act === 'select-all-drafts') {
    if (selectedDrafts().length === pending.size)
      [...pending].forEach(id => excluded.add(id))
    else excluded.clear()
    render()
    return
  }
  if (act === 'simulate-send') {
    const chosen = selectedDrafts()
    chosen.forEach(id => {
      questions.find(q => q.id === id).status = 'sent'
      pending.delete(id)
      excluded.delete(id)
    })
    sendMessage = ''
    sendResult = `Demo completed for ${chosen.length} answer${chosen.length === 1 ? '' : 's'}. Nothing was delivered.`
    render()
    return
  }
  if (act === 'thread-scope') {
    conversationDrafts[threadKey()] = draft
    threadScope = el.dataset.scope
    draft = conversationDrafts[threadKey()] || ''
    render()
    return
  }
  if (act === 'expand-discussion') {
    expandedConversation = !expandedConversation
    render()
    return
  }
  if (act === 'attention') {
    filter = 'open'
    urgency = 'urgent'
    round = ''
    render()
    return
  }
  if (act === 'rename-round') {
    const key = round || current().round
    const value = $('.round-name').value.trim()
    if (value) roundNames[key] = value
    render()
    return
  }
  if (act === 'note') {
    noteOpen = !noteOpen
    render()
    return
  }
  if (act === 'drawing') {
    drawingOpen = !drawingOpen
    render()
    return
  }
  if (act === 'skip') {
    const list = matched()
    const i = list.findIndex(q => q.id === selected)
    if (list.length) selectQuestion(list[(i + 1) % list.length].id)
    return
  }
  if (act === 'question') return selectQuestion(el.dataset.id)
  if (act.startsWith('page-')) {
    page = act.slice(5)
    mobileConversation = false
    expandedConversation = false
    if (page === 'conversations') discussion = true
    render()
    return
  }
  if (act.startsWith('filter-')) {
    filter = act.slice(7)
    urgency = 'all'
    round = ''
    render()
    return
  }
  if (act.startsWith('mode-')) {
    mode = act.slice(5)
    render()
    return
  }
  if (act === 'round') {
    round = el.dataset.round
    mode = 'questions'
    render()
    return
  }
  if (act === 'back-rounds') {
    round = ''
    mode = 'rounds'
    render()
    return
  }
  if (act === 'browse') {
    browse = !browse
    render()
    return
  }
  if (act === 'mobile-discussion') {
    mobileConversation = !mobileConversation
    render()
    return
  }
  if (act === 'discussion') {
    if (page === 'conversations') {
      page = 'questions'
      discussion = true
      render()
      return
    }
    expandedConversation = false
    if (mobileConversation) {
      mobileConversation = false
      render()
      return
    }
    discussion = !discussion
    render()
    return
  }
  if (act === 'inbox') {
    inboxOpen = !inboxOpen
    if (variant === 'C') {
      browse = true
      page = 'questions'
    }
    render()
    return
  }
  if (act === 'read-reply') {
    unread = Math.max(0, unread - 1)
    preview = false
    inboxOpen = true
    render()
    return
  }
  if (act === 'simulate') {
    clearTimeout(timer)
    unread++
    preview = true
    $$('.unread').forEach(node => (node.textContent = unread))
    const panel = $('.preview')
    if (panel) panel.innerHTML = previewMarkup()
    timer = setTimeout(expirePreview, 4000)
    return
  }
  if (act === 'next' || act === 'previous') {
    const list = matched()
    const index = list.findIndex(q => q.id === selected)
    const q = list[index + (act === 'next' ? 1 : -1)]
    if (q) selectQuestion(q.id)
    return
  }
  if (act === 'more') {
    $('.more').open = !$('.more').open
    return
  }
  if (act === 'utility') {
    utilityTitle = el.textContent
    page = 'utility'
    render()
  }
})
document.addEventListener('input', event => {
  if (event.target.matches('.search')) {
    search = event.target.value
    renderList()
  }
  if (event.target.id === 'draft') {
    draft = event.target.value
    conversationDrafts[threadKey()] = draft
  }
  if (event.target.dataset.note)
    notes[event.target.dataset.note] = event.target.value
  if (event.target.dataset.ownAnswer)
    ownAnswers[event.target.dataset.ownAnswer] = event.target.value
  if (event.target.id === 'send-message') {
    sendMessage = event.target.value
    $('[data-action="simulate-send"]').disabled =
      selectedDrafts().length === 0 && !sendMessage.trim()
  }
})
document.addEventListener('change', event => {
  if (event.target.dataset.note) {
    pending.add(event.target.dataset.note)
    render()
    return
  }
  if (event.target.matches('.urgency-select')) {
    urgency = event.target.value
    render()
    return
  }
  if (event.target.matches('.round-select')) {
    round = event.target.value
    render()
  }
  if (event.target.dataset.reviewId) {
    const id = event.target.dataset.reviewId
    if (event.target.checked) excluded.delete(id)
    else excluded.add(id)
    render()
    $(`[data-review-id="${id}"]`)?.focus()
  }
  if (event.target.name === 'answer') {
    const value = event.target.value
    answers[selected] = value
    pending.add(selected)
    sendResult = ''
    render()
    $(`input[name="answer"][value="${value}"]`)?.focus()
  }
})
document.addEventListener('keydown', event => {
  if (event.target.closest('input,textarea,select,[contenteditable]')) return
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault()
    changeVariant(event.key === 'ArrowLeft' ? -1 : 1)
  }
  if (event.key === '/') {
    event.preventDefault()
    page = 'questions'
    browse = true
    render()
    $('.search')?.focus()
  }
  if (event.key === 'Escape' && variant === 'C') {
    browse = false
    render()
  }
})
render()
