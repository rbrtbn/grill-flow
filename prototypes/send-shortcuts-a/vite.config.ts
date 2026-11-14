import { defineConfig } from 'vite'

export default defineConfig({
  cacheDir: '/private/tmp/grill-flow-send-shortcuts-a-vite-cache',
  server: { host: '127.0.0.1', port: 4371, strictPort: true },
})
