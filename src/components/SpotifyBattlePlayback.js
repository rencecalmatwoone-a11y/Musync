import { useEffect } from 'https://esm.sh/react@19'
import { html } from '../html.js'
import { useSpotifyPlayback } from '../hooks/useTrackAudio.js'

// Mounted only for Spotify SDK tracks. VS AI never initializes this player.
export default function SpotifyBattlePlayback({ trackId, playing, onPlaybackFailed }) {
  const spotify = useSpotifyPlayback(false)

  useEffect(() => {
    if (!playing || !trackId) return undefined
    let active = true
    spotify.playTrack(trackId).then((started) => {
      if (!active) {
        if (started) spotify.pause()
      } else if (!started) onPlaybackFailed()
    })
    return () => {
      active = false
      spotify.pause()
    }
  }, [trackId, playing, spotify.playTrack, spotify.pause, onPlaybackFailed])

  return spotify.error
    ? html`<p className="audio-status audio-status--battle">${spotify.error}</p>`
    : null
}
