import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs/promises'
import path from 'node:path'

const GFONT_QUERY = '?base64'
const GFONT_MODULE_PREFIX = '\0openhand-gfont:'

function embeddedGFontPlugin() {
  return {
    name: 'openhand-embedded-gfont',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer || !source.endsWith(GFONT_QUERY)) return null
      const relativePath = source.slice(0, -GFONT_QUERY.length)
      return `${GFONT_MODULE_PREFIX}${path.resolve(path.dirname(importer), relativePath)}`
    },
    async load(id) {
      if (!id.startsWith(GFONT_MODULE_PREFIX)) return null
      const filename = id.slice(GFONT_MODULE_PREFIX.length)
      const contents = await fs.readFile(filename)
      return `export default ${JSON.stringify(contents.toString('base64'))}`
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [embeddedGFontPlugin(), react()],
  optimizeDeps: {
    exclude: ['latex.js'],
  },
})
