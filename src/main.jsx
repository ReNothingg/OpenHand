import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import FontStudio from './font-builder/FontStudio.jsx'
import 'katex/dist/katex.min.css'
import './styles/index.css'

const path = window.location.pathname.replace(/\/+$/, '') || '/'
const searchParams = new URLSearchParams(window.location.search)
const isMacOSNative = Boolean(window.webkit?.messageHandlers?.serialBridge)
  || searchParams.get('platform') === 'macos'
const view = searchParams.get('view')

document.documentElement.classList.toggle('macos-native', isMacOSNative)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {path === '/font' || view === 'font' ? <FontStudio /> : <App />}
  </StrictMode>,
)
