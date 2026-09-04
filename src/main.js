import { createRoot } from 'https://esm.sh/react-dom@19/client'
import { html } from './html.js'
import App from './App.js'

createRoot(document.getElementById('root')).render(html`<${App} />`)
