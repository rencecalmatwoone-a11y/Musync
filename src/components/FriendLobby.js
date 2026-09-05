import { useState } from 'https://esm.sh/react@19'
import { html } from '../html.js'

function PlayerRow({ player, isHost, onToggleReady }) {
  const ready = player.ready
  const isYou = player.isYou ?? isHost
  return html`
    <div className=${`fl-row${ready ? ' is-ready' : ''}${isHost ? ' is-host' : ''}`}>
      <div className="fl-row__avatar" aria-hidden="true">
        ${(player.name || '?').charAt(0).toUpperCase()}
      </div>
      <div className="fl-row__meta">
        <strong>${player.name}${isYou ? ' (You)' : ''}</strong>
        <span className=${`fl-row__status is-${ready ? 'ready' : 'waiting'}`}>
          ${ready ? '✓ Ready' : (player.joined ? 'Joining...' : 'Waiting')}
        </span>
      </div>
      ${isYou
        ? html`
            <button
              type="button"
              className=${`fl-ready-btn${ready ? ' is-on' : ''}`}
              onClick=${onToggleReady}
            >
              ${ready ? 'READY' : 'MARK READY'}
            </button>
          `
        : html`
            <span className="fl-row__guest-badge">PLAYER</span>
          `}
    </div>
  `
}

export default function FriendLobby({ lobby, onStart, joinCode, onJoin, onBack }) {
  const [joinInput, setJoinInput] = useState(joinCode || '')

  const {
    code,
    inviteLink,
    host,
    guest,
    copied,
    bothReady,
    started,
    inviteFriend,
    toggleHostReady,
    copyLink,
  } = lobby

  const canStart = bothReady && !started && (host.isYou ?? true)
  const isOnline = Boolean(onJoin)

  return html`
    <div className="friend-lobby">
      ${onBack && html`
        <button type="button" className="mp-back" onClick=${onBack}>← BACK</button>
      `}
      <div className="friend-lobby__head">
        <span className="friend-lobby__eyebrow">PRIVATE MATCH</span>
        <h2>Friend Lobby</h2>
        <p className="friend-lobby__desc">
          Invite a friend and start a private 10-round battle. Same songs, same
          timer — independent scores.
        </p>
      </div>

      ${isOnline && !code
        ? html`
            <div className="friend-lobby__join">
              <label className="friend-lobby__join-label">JOIN BY CODE</label>
              <div className="friend-lobby__invite-row">
                <input
                  className="friend-lobby__link"
                  value=${joinInput}
                  onInput=${(e) => setJoinInput(e.target.value.toUpperCase())}
                  placeholder="ENTER 6-CHAR CODE"
                  maxlength=${6}
                />
                <button
                  type="button"
                  className="fl-copy-btn"
                  onClick=${() => onJoin(joinInput)}
                >
                  JOIN
                </button>
              </div>
              <button type="button" className="fl-invite-btn" onClick=${inviteFriend}>
                ＋ CREATE A NEW LOBBY
              </button>
            </div>
          `
        : html`
            <div className="friend-lobby__code">
              <span className="friend-lobby__code-label">ROOM CODE</span>
              <div className="friend-lobby__code-value">${code}</div>
            </div>

            <div className="friend-lobby__invite">
              <span className="friend-lobby__invite-label">INVITE LINK</span>
              <div className="friend-lobby__invite-row">
                <code className="friend-lobby__link">${inviteLink}</code>
                ${copyLink && html`
                  <button type="button" className="fl-copy-btn" onClick=${copyLink}>
                    ${copied ? 'COPIED ✓' : 'COPY'}
                  </button>
                `}
              </div>
            </div>

            <div className="friend-lobby__players">
              <${PlayerRow}
                player=${{ ...host, ready: host.ready, joined: true }}
                isHost=${true}
                onToggleReady=${toggleHostReady}
              />
              ${guest
                ? html`
                    <${PlayerRow}
                      player=${guest}
                      isHost=${false}
                      onToggleReady=${guest.isYou ? toggleHostReady : null}
                    />
                  `
                : html`
                    ${!isOnline && html`
                      <button
                        type="button"
                        className="fl-invite-btn"
                        onClick=${inviteFriend}
                      >
                        ＋ INVITE FRIEND
                      </button>
                    `}
                  `}
            </div>
          `}

      <button
        type="button"
        className=${`fl-start-btn${canStart ? ' is-live' : ''}`}
        onClick=${() => canStart && onStart()}
        disabled=${!canStart}
      >
        ${bothReady ? 'START MATCH ▶' : 'WAITING FOR READY...'}
      </button>
    </div>
  `
}

