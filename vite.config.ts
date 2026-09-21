import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { buildMetadata } from './scripts/build-metadata.mjs'

export default defineConfig({
  base: './',
  define: { __OPENHAND_BUILD__: JSON.stringify(buildMetadata) },
  plugins: [react()],
  optimizeDeps: {
    // Keep dependency discovery scoped to the source app. Packaged macOS and
    // Windows copies contain generated bundles with dynamic latex.js requires.
    entries: ['index.html'],
    exclude: ['latex.js'],
  },
  build: {
    outDir: 'docs'
  }
})
