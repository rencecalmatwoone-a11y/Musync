import { useEffect, useState } from 'https://esm.sh/react@19'

export default function useTrackAudio(songId, knownPlaybackUrl = null, knownPlaybackType = 'unavailable') {
  const [state, setState] = useState({
    playbackUrl: knownPlaybackUrl || null,
    playbackType: knownPlaybackType,
    loading: false,
    error: null,
  })

  useEffect(() => {
    setState({
      playbackUrl: knownPlaybackUrl || null,
      playbackType: knownPlaybackType,
      loading: false,
      error: null,
    })
  }, [songId, knownPlaybackUrl, knownPlaybackType])

  return state
}
