// PROTOTYPE static server: `bun prototypes/owner-actions-serve.ts` serves variants A, B and C on
// 127.0.0.1:4351-4353. No live server, database or agent is touched.
import { join, normalize } from 'node:path'

const root = import.meta.dir
const variants = { a: 4351, b: 4352, c: 4353 } as const
const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
}

for (const [variant, port] of Object.entries(variants)) {
  Bun.serve({
    hostname: '127.0.0.1',
    port,
    async fetch(request) {
      const path = new URL(request.url).pathname
      if (path === '/') return Response.redirect(`/owner-actions-${variant}/`, 302)
      const file = normalize(join(root, path.endsWith('/') ? `${path}index.html` : path))
      if (!file.startsWith(root) || !file.includes('owner-actions-')) return new Response('not found', { status: 404 })
      const body = Bun.file(file)
      if (!(await body.exists())) return new Response('not found', { status: 404 })
      const ext = file.slice(file.lastIndexOf('.'))
      return new Response(body, { headers: { 'content-type': types[ext] ?? 'application/octet-stream', 'cache-control': 'no-store' } })
    },
  })
  console.log(`${variant.toUpperCase()}: http://127.0.0.1:${port}/`)
}
