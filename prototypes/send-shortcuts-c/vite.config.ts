import { defineConfig } from 'vite'

export default defineConfig({
  cacheDir: '/private/tmp/grill-flow-send-shortcuts-c-vite-cache',
  server: { host: '127.0.0.1', port: 4373, strictPort: true },
})
