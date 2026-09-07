import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

let clientVersion = 0
async function loadClient() {
  let source = await readFile(new URL('../src/spotify/client.js', import.meta.url), 'utf8')
  source = source.replace(source.split(/\r?\n/)[0], 'const isSpotifyConfigured = true, isSpotifyAuthed = true')
  for (const name of ['tracks', 'popularTracks']) source = source.replace(`../data/${name}.js`, new URL(`../src/data/${name}.js`, import.meta.url).href)
  return import(`data:text/javascript;base64,${Buffer.from(source + `\n// test ${clientVersion++}`).toString('base64')}`)
}

test('Classic starts with one page and preserves the pool across calls', async () => {
  const { fetchRandomTrack } = await loadClient()
  const originalFetch = globalThis.fetch
  const offsets = []
  globalThis.fetch = async (input) => {
    const url = new URL(input, 'https://musync.test')
    assert.equal(url.pathname, '/api/spotify/tracks')
    assert.equal(url.searchParams.get('mode'), 'classic')
    assert.equal(url.searchParams.get('limit'), '10')
    const offset = Number(url.searchParams.get('offset'))
    offsets.push(offset)
    return Response.json({ tracks: Array.from({ length: 10 }, (_, i) => ({ id: `song-${offset + i}`, title: `Song ${offset + i}`, artist: 'Artist' })) })
  }
  try {
    const options = { source: 'classic', musicOrigin: 'International' }
    const first = await fetchRandomTrack(options)
    assert.deepEqual(offsets, [0])
    assert.notEqual((await fetchRandomTrack({ ...options, recentIds: [first.id] })).id, first.id)
    assert.deepEqual(offsets, [0])
    const recentIds = Array.from({ length: 10 }, (_, i) => `song-${i}`)
    assert.ok(!recentIds.includes((await fetchRandomTrack({ ...options, recentIds })).id))
    assert.deepEqual(offsets, [0, 10])
  } finally { globalThis.fetch = originalFetch }
})

const song = (id) => ({ id: String(id), title: `Song ${id}`, artist: `Artist ${id}`, popularity: 50 })

test('Classic preloads pages, passes 30 unique songs, and remembers filter pools', async () => {
  const client = await loadClient()
  const originalFetch = globalThis.fetch
  const offsets = []
  globalThis.fetch = async (input) => {
    const url = new URL(input, 'https://musync.test')
    const offset = Number(url.searchParams.get('offset'))
    const genre = url.searchParams.get('genre')
    offsets.push([genre, offset])
    return Response.json({ tracks: Array.from({ length: 10 }, (_, i) => song(`${genre}-${offset + i}`)), nextOffset: offset < 90 ? offset + 10 : null })
  }
  try {
    const options = { source: 'classic', genre: 'Rock' }
    const played = new Set()
    for (let i = 0; i < 60; i++) {
      const track = await client.fetchRandomTrack(options)
      assert.ok(track)
      assert.ok(!played.has(track.id), `Repeated ${track.id}`)
      played.add(track.id)
      if (i === 6) {
        await new Promise((resolve) => setImmediate(resolve))
        assert.ok(offsets.some(([genre, offset]) => genre === 'Rock' && offset === 10), 'preload before exhaustion')
      }
    }
    await client.fetchRandomTrack({ source: 'classic', genre: 'Pop' })
    const next = await client.fetchRandomTrack(options)
    assert.ok(!played.has(next.id))
    assert.ok(next.id.startsWith('Rock-'))
    assert.equal(offsets.filter(([genre, offset]) => genre === 'Rock' && offset === 0).length, 1)
    await new Promise((resolve) => setImmediate(resolve))
  } finally { globalThis.fetch = originalFetch }
})

test('Classic follows pagination through empty filtered pages without broadening filters', async () => {
  const client = await loadClient()
  const originalFetch = globalThis.fetch
  const offsets = []
  globalThis.fetch = async (input) => {
    const url = new URL(input, 'https://musync.test')
    for (const [key, value] of Object.entries({ genre: 'Rock', musicOrigin: 'OPM', yearFrom: '1990', yearTo: '1999' })) assert.equal(url.searchParams.get(key), value)
    const offset = Number(url.searchParams.get('offset'))
    offsets.push(offset)
    return Response.json({ tracks: offset === 20 ? [song('matched')] : [], nextOffset: offset < 20 ? offset + 10 : null })
  }
  try {
    const track = await client.fetchRandomTrack({ source: 'classic', genre: 'Rock', musicOrigin: 'OPM', yearFrom: 1990, yearTo: 1999 })
    assert.equal(track.id, 'matched')
    assert.deepEqual(offsets, [0, 10, 20])
  } finally { globalThis.fetch = originalFetch }
})

test('quota cooldown expires and a subsequent request recovers without logout', async () => {
  const client = await loadClient()
  const originalFetch = globalThis.fetch
  const originalNow = Date.now
  let now = originalNow()
  let calls = 0
  Date.now = () => now
  globalThis.fetch = async () => ++calls === 1
    ? Response.json({ code: 'SPOTIFY_QUOTA_EXCEEDED', quotaExceeded: true, retryAfter: 300 }, { status: 503 })
    : Response.json({ tracks: [song('recovered')], nextOffset: null })
  try {
    const options = { source: 'classic' }
    await assert.rejects(client.fetchRandomTrack(options), { code: 'SPOTIFY_QUOTA_EXCEEDED' })
    now += 299000
    await assert.rejects(client.fetchRandomTrack(options), { code: 'SPOTIFY_QUOTA_EXCEEDED' })
    assert.equal(calls, 1)
    now += 1001
    assert.equal((await client.fetchRandomTrack(options)).id, 'recovered')
    assert.equal(calls, 2)
  } finally { globalThis.fetch = originalFetch; Date.now = originalNow }
})

test('expired Classic pools are fetched again and selection is not fixed to the top song', async () => {
  const client = await loadClient()
  const originalFetch = globalThis.fetch
  const originalNow = Date.now
  const originalRandom = Math.random
  let now = originalNow()
  let calls = 0
  Date.now = () => now
  Math.random = () => 0.999
  globalThis.fetch = async () => {
    calls++
    return Response.json({ tracks: Array.from({ length: 10 }, (_, i) => song(`${calls}-${i}`)), nextOffset: null })
  }
  try {
    assert.notEqual((await client.fetchRandomTrack({ source: 'classic', preferPopular: true })).id, '1-0')
    now += 300001
    assert.ok((await client.fetchRandomTrack({ source: 'classic' })).id.startsWith('2-'))
    assert.equal(calls, 2)
  } finally { globalThis.fetch = originalFetch; Date.now = originalNow; Math.random = originalRandom }
})

test('failed prefetch preserves unplayed songs and resumes the same page after cooldown', async () => {
  const client = await loadClient()
  const originalFetch = globalThis.fetch
  const originalNow = Date.now
  let now = originalNow()
  let pageTwoCalls = 0
  Date.now = () => now
  globalThis.fetch = async (input) => {
    const offset = Number(new URL(input, 'https://musync.test').searchParams.get('offset'))
    if (offset === 10 && ++pageTwoCalls === 1) return Response.json({ rateLimited: true, retryAfter: 10 }, { status: 429 })
    return Response.json({ tracks: Array.from({ length: 10 }, (_, i) => song(offset + i)), nextOffset: offset ? null : 10 })
  }
  try {
    const options = { source: 'classic' }
    const played = new Set()
    for (let i = 0; i < 10; i++) {
      const track = await client.fetchRandomTrack(options)
      assert.ok(track && !played.has(track.id))
      played.add(track.id)
      await new Promise((resolve) => setImmediate(resolve))
    }
    await assert.rejects(client.fetchRandomTrack(options), { status: 429 })
    assert.equal(pageTwoCalls, 1)
    now += 10001
    assert.ok(Number((await client.fetchRandomTrack(options)).id) >= 10)
    assert.equal(pageTwoCalls, 2)
  } finally { globalThis.fetch = originalFetch; Date.now = originalNow }
})

test('sparse searches keep their cursor after the foreground request budget', async () => {
  const client = await loadClient()
  const originalFetch = globalThis.fetch
  const offsets = []
  globalThis.fetch = async (input) => {
    const offset = Number(new URL(input, 'https://musync.test').searchParams.get('offset'))
    offsets.push(offset)
    return Response.json({ tracks: offset === 50 ? [song('deep-match')] : [], nextOffset: offset < 50 ? offset + 10 : null })
  }
  try {
    assert.equal(await client.fetchRandomTrack({ source: 'classic' }), null)
    assert.equal(offsets.length, 5)
    assert.equal((await client.fetchRandomTrack({ source: 'classic' })).id, 'deep-match')
    assert.deepEqual(offsets, [0, 10, 20, 30, 40, 50])
  } finally { globalThis.fetch = originalFetch }
})
