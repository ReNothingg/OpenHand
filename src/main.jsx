import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import FontStudio from './font-builder/FontStudio.jsx'
import GCodeViewer from './gcode/GCodeViewer.jsx'
import 'katex/dist/katex.min.css'
import './styles/index.css'

const path = window.location.pathname.replace(/\/+$/, '') || '/'
const searchParams = new URLSearchParams(window.location.search)
const isMacOSNative = Boolean(window.webkit?.messageHandlers?.serialBridge)
  || searchParams.get('platform') === 'macos'
const view = searchParams.get('view')

document.documentElement.classList.toggle('macos-native', isMacOSNative)

window.__openhandReceiveFile = (payload) => {
  window.__openhandPendingFile = payload
  window.dispatchEvent(new CustomEvent('openhand:open-file', { detail: payload }))
}

function Root() {
  const [activeView, setActiveView] = useState(path === '/font' || view === 'font'
    ? 'font'
    : path === '/gcode' || view === 'gcode' ? 'gcode' : 'document')
  const [filePayload, setFilePayload] = useState(() => window.__openhandPendingFile || null)

  useEffect(() => {
    const openFile = (event) => {
      setFilePayload(event.detail)
      setActiveView('gcode')
    }
    window.addEventListener('openhand:open-file', openFile)
    return () => window.removeEventListener('openhand:open-file', openFile)
  }, [])

  if (activeView === 'font') return <FontStudio />
  if (activeView === 'gcode') {
    return <GCodeViewer payload={filePayload} onClose={() => {
      const url = new URL(window.location.href)
      if (url.pathname.replace(/\/+$/, '') === '/gcode') url.pathname = '/'
      url.searchParams.delete('view')
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
      setActiveView('document')
      setFilePayload(null)
      window.__openhandPendingFile = null
    }} />
  }
  return <App />
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
