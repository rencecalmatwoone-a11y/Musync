export function spotifyPreviewWindow(trackDurationMs, clipDuration = 15) {
  const seconds = Number(trackDurationMs) / 1000
  const knownDuration = Number.isFinite(seconds) && seconds > 0
  const start = knownDuration ? Math.min(30, Math.max(0, seconds - clipDuration)) : 30
  return { start, duration: knownDuration ? Math.min(30, seconds - start) : 30 }
}
