import { defineConfig } from 'vite'

import { foldkit } from '@foldkit/vite-plugin'

// PROTOTYPE discussion-threads-timeline (ask 9656); run from the repo root.
export default defineConfig({
  cacheDir: '/private/tmp/grill-flow-discussion-threads-timeline-vite-cache',
  plugins: [foldkit({ devToolsMcpPort: false })],
  server: { host: '127.0.0.1', port: 4362, strictPort: true },
})
