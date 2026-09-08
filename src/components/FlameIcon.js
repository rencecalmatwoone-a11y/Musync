import { html } from '../html.js'

export default function FlameIcon({ size = 14, strokeWidth = 2, className = '' }) {
  return html`
    <svg className=${className} width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width=${strokeWidth} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 2.5c.6 3.5-2.7 5.1-2.7 8.2 0 1.5 1 2.6 2.4 2.6 1.6 0 2.6-1.3 2.6-3.1 2.2 1.7 3.3 3.7 3.3 5.7 0 3.7-2.9 6.1-6.5 6.1S4.5 19.6 4.5 16c0-3.2 2.1-5.9 5.2-8.2-.1 1.4.2 2.3.8 3 .3-2.8 2.3-4.8 1.5-8.3Z" />
    </svg>
  `
}
