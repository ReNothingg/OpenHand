import { useEffect } from 'react'
import { STORAGE_KEYS } from '../app/config'

export function useDocumentPersistence({ markdown, texSource, sourceMode, settings }) {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      localStorage.setItem(STORAGE_KEYS.markdown, markdown)
      localStorage.setItem(STORAGE_KEYS.tex, texSource)
      localStorage.setItem(STORAGE_KEYS.sourceMode, sourceMode)
      localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings))
    }, 350)
    return () => window.clearTimeout(timer)
  }, [markdown, texSource, sourceMode, settings])
}
