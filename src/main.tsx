import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as pdfjs from 'pdfjs-dist'
import './index.css'
import App from './App'

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  './pdf-worker-entry.js',
  import.meta.url,
).toString()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
