import { defineConfig } from 'vite'

import { foldkit } from '@foldkit/vite-plugin'

export default defineConfig({
  cacheDir: '/private/tmp/grill-flow-sidebar-2070-vite-cache',
  plugins: [foldkit({ devToolsMcpPort: false })],
  server: { host: '127.0.0.1', port: 4344, strictPort: true },
})
