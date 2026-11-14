// PROTOTYPE static server: `bun prototypes/work-flow-serve.ts` serves the work-flow home page
// prototype on 127.0.0.1:4356. No live server, database or agent is touched.
import { join, normalize } from 'node:path'

const root = join(import.meta.dir, 'work-flow')
const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
}

Bun.serve({
  hostname: '127.0.0.1',
  port: 4356,
  async fetch(request) {
    const path = new URL(request.url).pathname
    const file = normalize(join(root, path.endsWith('/') ? `${path}index.html` : path))
    if (!file.startsWith(root)) return new Response('not found', { status: 404 })
    const body = Bun.file(file)
    if (!(await body.exists())) return new Response('not found', { status: 404 })
    const ext = file.slice(file.lastIndexOf('.'))
    return new Response(body, {
      headers: { 'content-type': types[ext] ?? 'application/octet-stream', 'cache-control': 'no-store' },
    })
  },
})
console.log('Work flow: http://127.0.0.1:4356/')
