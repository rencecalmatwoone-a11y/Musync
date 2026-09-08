import { GUEST_TRACKS } from './guestTrackList.js'
import { CLASSIC_GUEST_TRACKS } from './classicGuestTrackList.js'

const key = (song) => `${song.artist.split(/ & /)[0]}|${song.title}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9|]/g, '')
const catalog = [...new Map([...GUEST_TRACKS, ...CLASSIC_GUEST_TRACKS].map((song) => [key(song), song])).values()]
export const CLASSIC_GUEST_BATCH_SIZE = 24

// A client-owned seed/cursor also works when requests reach different server instances.
export function classicGuestCatalogPage(seed = 1, offset = 0) {
  let state = (Number(seed) >>> 0) || 1
  const shuffled = [...catalog]
  for (let i = shuffled.length - 1; i > 0; i--) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    const j = Math.floor(state / 4294967296 * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  const start = Math.min(catalog.length, Math.max(0, Math.floor(Number(offset) || 0)))
  const end = Math.min(catalog.length, start + CLASSIC_GUEST_BATCH_SIZE)
  return { songs: shuffled.slice(start, end), nextOffset: end < catalog.length ? end : null, total: catalog.length }
}
