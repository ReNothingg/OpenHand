import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
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
