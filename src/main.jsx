import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import FontStudio from './font-builder/FontStudio.jsx'
import 'katex/dist/katex.min.css'
import './styles/index.css'

const path = window.location.pathname.replace(/\/+$/, '') || '/'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {path === '/font' ? <FontStudio /> : <App />}
  </StrictMode>,
)
