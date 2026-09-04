import { html } from '../html.js'
import ModeToggle from './ModeToggle.js'

export default function Header({ mode, onModeChange, showModeToggle }) {
  return html`
    <header className="header">
      ${showModeToggle &&
      html`<${ModeToggle} value=${mode} onChange=${onModeChange} />`}
    </header>
  `
}
