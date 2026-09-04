import { html } from '../html.js'

const ICONS = {
  game: html`
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <polygon points="10,8 17,12 10,16" fill="currentColor" stroke="none" />
    </svg>
  `,
  statistics: html`
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <polyline points="4,16 9,11 13,14 20,7" />
      <polyline points="16,7 20,7 20,11" />
    </svg>
  `,
  profile: html`
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5.5 19c1.4-3.2 3.6-4.8 6.5-4.8S16.6 15.8 18.5 19" />
    </svg>
  `,
  settings: html`
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 13a7.8 7.8 0 0 0 .1-2l2-1.5-2-3.4-2.4 1a7.6 7.6 0 0 0-1.7-1L15 3h-6l-.4 2.1a7.6 7.6 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.5a7.8 7.8 0 0 0 .1 2l-2 1.5 2 3.4 2.4-1a7.6 7.6 0 0 0 1.7 1L9 21h6l.4-2.1a7.6 7.6 0 0 0 1.7-1l2.4 1 2-3.4z" />
    </svg>
  `,
}

const ITEMS = [
  { id: 'game', label: 'Game' },
  { id: 'statistics', label: 'Statistics' },
  { id: 'profile', label: 'Profile' },
  { id: 'settings', label: 'Settings' },
]

export default function Sidebar({ activePage, onNavigate }) {
  return html`
    <aside className="sidebar">
      <div className="brand">
        <h1 className="brand__name">MUSYNC</h1>
      </div>

      <nav className="nav" aria-label="Main">
        ${ITEMS.map(
          (item) => html`
            <button
              key=${item.id}
              type="button"
              className=${`nav-item${activePage === item.id ? ' is-active' : ''}`}
              onClick=${() => onNavigate(item.id)}
            >
              ${ICONS[item.id]}
              ${item.label}
            </button>
          `,
        )}
      </nav>
    </aside>
  `
}
