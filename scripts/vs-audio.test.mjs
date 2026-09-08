import assert from 'node:assert/strict'
import { test, after } from 'node:test'
import { GUEST_TRACKS } from '../server/services/guestTrackList.js'
import { CLASSIC_GUEST_TRACKS } from '../server/services/classicGuestTrackList.js'
import { classicGuestCatalogPage } from '../server/services/classicGuestCatalog.js'

const originalFetch = globalThis.fetch
after(() => { globalThis.fetch = originalFetch })
let revision = 0
const service = () => import(`../server/services/vsAudio.js?test=${++revision}`)
const track = { trackId: 'spotify-id', title: 'One More Time', artist: 'Daft Punk', spotifyPreviewUrl: 'https://p.scdn.co/spotify.mp3' }
const recording = { id: 1, title: track.title, artist: { name: track.artist }, preview: 'https://cdn.dzcdn.net/preview.mp3' }

test('Classic catalog pages cover the full shuffled list once and survive fresh server instances', () => {
  const songs = []
  let offset = 0
  do {
    const page = classicGuestCatalogPage(98765, offset)
    assert.deepEqual(page, classicGuestCatalogPage(98765, offset))
    songs.push(...page.songs)
    offset = page.nextOffset
  } while (offset !== null)
  assert.equal(songs.length, classicGuestCatalogPage(98765).total)
  assert.equal(new Set(songs.map((song) => `${song.artist}|${song.title}`)).size, songs.length)
  assert.ok(songs.some((song) => song.title === 'Espresso'))
  assert.ok(songs.some((song) => song.title === 'Get You'))
  assert.equal(songs.filter((song) => song.artist === 'Daniel Caesar' && song.title === 'Japanese Denim').length, 1)
  for (const title of ['bad', 'seasons', 'love.', 'peach eyes', 'light']) {
    assert.ok(songs.some((song) => song.artist === 'wave to earth' && song.title === title))
  }
  assert.notDeepEqual(classicGuestCatalogPage(98765).songs, classicGuestCatalogPage(123).songs)
})

test('paged Classic resolves the supplied page without loading the legacy artist pool', async () => {
  const page = classicGuestCatalogPage(98765)
  const queries = []
  globalThis.fetch = async (input) => {
    const query = new URL(input).searchParams.get('q')
    queries.push(query)
    const index = page.songs.findIndex((song) => `${song.artist} ${song.title}` === query)
    assert.ok(index >= 0, `Unexpected legacy query: ${query}`)
    const song = page.songs[index]
    return Response.json({ data: [{ id: index + 100, title: song.title, artist: { name: song.artist }, preview: recording.preview, release_date: '2020-01-01' }] })
  }
  const { searchClassicDeezerTracks } = await service()
  const tracks = await searchClassicDeezerTracks({ catalogSeed: 98765, limit: 1500 })
  assert.equal(queries.length, page.songs.length)
  assert.equal(tracks.length, page.songs.length)
})

test('the additional song lists are sampled for guest Classic only', async () => {
  assert.ok(CLASSIC_GUEST_TRACKS.length >= 180)
  assert.equal(CLASSIC_GUEST_TRACKS[179].title, 'Borderline')
  const newQueries = new Set(CLASSIC_GUEST_TRACKS.map((song) => `${song.artist} ${song.title}`)
    .filter((query) => !GUEST_TRACKS.some((song) => `${song.artist} ${song.title}` === query)))
  const queries = []
  globalThis.fetch = async (input) => {
    queries.push(new URL(input).searchParams.get('q'))
    return Response.json({ data: [] })
  }
  const random = Math.random
  let seed = 1234
  Math.random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
  try {
    const { searchVSAudioTracks, searchClassicDeezerTracks } = await service()
    await searchVSAudioTracks()
    assert.ok(!queries.some((query) => newQueries.has(query)))
    queries.length = 0
    await searchClassicDeezerTracks()
    assert.ok(queries.some((query) => newQueries.has(query)))
  } finally { Math.random = random }
})

test('both guest catalogs include playable matches from the supplied song list', async () => {
  globalThis.fetch = async (input) => {
    const query = new URL(input).searchParams.get('q')
    const index = GUEST_TRACKS.findIndex((song) => `${song.artist} ${song.title}` === query)
    if (index < 0) return Response.json({ data: [] })
    const song = GUEST_TRACKS[index]
    return Response.json({ data: [{ id: index + 100, title: song.title, artist: { name: song.artist }, preview: recording.preview, release_date: '2020-01-01' }] })
  }
  const { searchVSAudioTracks, searchClassicDeezerTracks } = await service()
  for (const tracks of [await searchVSAudioTracks(), await searchClassicDeezerTracks({ limit: 1500 })]) {
    assert.ok(tracks.length > 0)
    assert.ok(tracks.every((track) => track.playbackUrl && GUEST_TRACKS.some((song) => song.title === track.title && song.artist === track.artist)))
  }
})

test('VS AI resolves Deezer even with Spotify preview metadata; concurrent and repeated requests share a lookup', async () => {
  let calls = 0
  globalThis.fetch = async (input) => {
    assert.equal(new URL(input).hostname, 'api.deezer.com')
    calls++
    return Response.json({ data: [recording] })
  }
  const { resolveVSAudio } = await service()
  const results = await Promise.all([resolveVSAudio(track), resolveVSAudio(track)])
  assert.deepEqual(results[0], { provider: 'deezer', previewUrl: recording.preview, duration: 30000 })
  assert.deepEqual(results[1], results[0])
  assert.deepEqual(await resolveVSAudio(track), results[0])
  assert.equal(calls, 1)
})

test('missing, mismatched and failed Deezer previews never fall back to Spotify', async () => {
  for (const response of [[], [{ ...recording, artist: { name: 'Cover Artist' } }], [{ ...recording, preview: '' }], null]) {
    const { resolveVSAudio } = await service()
    let calls = 0
    globalThis.fetch = async () => {
      calls++
      return response ? Response.json({ data: response }) : new Response(null, { status: 503 })
    }
    assert.equal(await resolveVSAudio(track), null)
    assert.equal(await resolveVSAudio(track), null)
    assert.equal(calls, 1)
  }
})

test('Deezer catalog tolerates a failed search, excludes silent tracks and reuses its exact preview', async () => {
  let calls = 0
  globalThis.fetch = async (input, options) => {
    calls++
    assert.ok(options.signal instanceof AbortSignal)
    if (new URL(input).searchParams.get('q') === 'Miguel') throw new Error('Network unavailable')
    return Response.json({ data: [recording, { ...recording, id: 2, preview: '' }] })
  }
  const { searchVSAudioTracks, resolveVSAudio } = await service()
  const tracks = await searchVSAudioTracks()
  assert.equal(tracks.length, 1)
  assert.equal(tracks[0].id, 'deezer-1')
  assert.equal(tracks[0].provider, 'deezer')
  // Playback must survive a subsequent request reaching a different server instance.
  assert.equal(tracks[0].playbackUrl, `/api/audio-preview?url=${encodeURIComponent(recording.preview)}`)
  assert.equal(tracks[0].previewProvider, 'deezer')
  assert.equal(tracks[0].previewDuration, 30000)
  const catalogCalls = calls
  const preview = await resolveVSAudio({ ...tracks[0], trackId: tracks[0].id })
  assert.equal(preview.previewUrl, recording.preview)
  assert.equal(calls, catalogCalls)
})
