import type { Database } from 'bun:sqlite'

import { tally } from '../src/domain'
import { getGrill, lastActivity, listGrills, snapshot } from './store'

const escape = (text: string): string =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

const ago = (at: number, now: number): string => {
  const minutes = Math.round((now - at) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return new Date(at).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  })
}

type Row = Readonly<{
  id: string
  title: string
  kind: string
  round: number
  answered: number
  needed: number
  pendingAsks: number
  at: number
}>

const rows = (db: Database): ReadonlyArray<Row> =>
  listGrills(db)
    .flatMap(({ id }) => {
      const grill = getGrill(db, id)
      if (!grill) return []
      const state = snapshot(db, grill)
      // Counted as the page's top bar counts them, so the two agree.
      const counts = tally(grill, state.answers)
      return [
        {
          id,
          title: grill.title,
          kind: grill.kind ?? 'decision',
          round: grill.round,
          answered: counts.answered,
          needed: counts.total - counts.notNeeded,
          pendingAsks: state.asks.filter(ask => !ask.answered).length,
          at: lastActivity(db, id),
        },
      ]
    })
    .sort((a, b) => b.at - a.at)

const rowHtml = (row: Row, now: number): string => {
  const done = row.needed > 0 && row.answered === row.needed
  const asks =
    row.pendingAsks > 0
      ? ` · ${row.pendingAsks} ask${row.pendingAsks === 1 ? '' : 's'} waiting`
      : ''
  return `<li>
  <a href="/g/${encodeURIComponent(row.id)}">
    <span class="title">${escape(row.title)}</span>
    <span class="meta">${row.kind} · round ${row.round}${asks} · ${ago(row.at, now)}</span>
    <span class="count${done ? ' done' : ''}">${row.answered}/${row.needed}</span>
  </a>
</li>`
}

// The tokens and fonts mirror src/styles.css; this page is served without the app bundle.
export const dashboard = (db: Database): Response => {
  const now = Date.now()
  const list = rows(db)
  const body =
    list.length === 0
      ? '<p class="empty">No grills loaded yet. Load one with <code>bun run gf load &lt;file&gt;</code>.</p>'
      : `<ul>${list.map(row => rowHtml(row, now)).join('\n')}</ul>`
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Grills</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Archivo+Narrow:wght@500;600;700&family=Literata:opsz,wght@7..72,400;7..72,700&display=swap" rel="stylesheet" />
<style>
:root {
  --paper: #f5f6f3; --panel: #eceee9; --ink: #1c1e1d; --muted: #585e5a;
  --rule: #d3d7d1; --link: #2c4c9c;
  --read: 'Literata', Georgia, serif;
  --label: 'Archivo Narrow', 'Arial Narrow', sans-serif;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root {
    --paper: #141618; --panel: #1c1f22; --ink: #e3e4df; --muted: #a2a8a3;
    --rule: #2e3236; --link: #9cb4f2;
    color-scheme: dark;
  }
}
* { box-sizing: border-box; }
html { background: var(--paper); }
body { margin: 0; color: var(--ink); font: 400 1rem/1.5 var(--read); }
main { max-width: 44rem; margin: 0 auto; padding: 48px 16px; }
h1 { font: 700 1.6rem var(--read); margin: 0 0 4px; }
.sub { font: 500 0.92rem var(--label); color: var(--muted); margin: 0 0 28px; }
ul { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--rule); }
li { border-bottom: 1px solid var(--rule); }
a {
  display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 16px;
  padding: 14px 8px; color: inherit; text-decoration: none;
}
a:hover, a:focus-visible { background: var(--panel); }
a:focus-visible { outline: 2px solid var(--link); outline-offset: -2px; }
.title { font-weight: 700; color: var(--link); overflow-wrap: anywhere; }
.meta { grid-row: 2; font: 500 0.88rem var(--label); color: var(--muted); }
.count {
  grid-row: 1 / 3; grid-column: 2; align-self: center;
  font: 600 0.95rem var(--label); color: var(--muted);
  border: 1.5px solid var(--rule); border-radius: 999px; padding: 2px 10px;
}
.count.done { color: var(--paper); background: var(--link); border-color: var(--link); }
.empty { color: var(--muted); }
code { font-size: 0.9em; }
</style>
</head>
<body>
<main>
<h1>Grills</h1>
<p class="sub">${list.length} on this server · most recently active first</p>
${body}
</main>
</body>
</html>`
  return new Response(html, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })
}
