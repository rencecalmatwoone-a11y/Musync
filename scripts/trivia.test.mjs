import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchTrackTrivia } from '../src/music/trivia.js'

function wikipedia(t, pages) {
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url) => {
    const params = new URL(url).searchParams
    calls.push(params)
    return { ok: true, json: async () => params.get('list') === 'search'
      ? { query: { search: pages.map(({ title }) => ({ title })) } }
      : { query: { pages: { 1: pages.find((page) => page.title === params.get('titles')) } } } }
  })
  return calls
}

test('finds an anecdote beyond release descriptions and caches it', async (t) => {
  const fact = 'The song was inspired by a postcard the singer received while travelling through a mountain village.'
  const calls = wikipedia(t, [{ title: 'Postcard (song)', extract: `Postcard is a song by Example Artist. It was released in 2020.\n\n== Background ==\n${fact}` }])
  const track = { title: 'Postcard', artist: 'Example Artist' }
  assert.equal(await fetchTrackTrivia(track), fact)
  assert.equal(await fetchTrackTrivia(track), fact)
  assert.equal(calls.length, 2)
})

test('rejects generic descriptions and unrelated artist anecdotes', async (t) => {
  wikipedia(t, [{ title: 'Ordinary', extract: 'Ordinary is a song by Example Artist. The song was released as the second single from the album. Example Artist was inspired by childhood trips to the seaside.' }])
  assert.equal(await fetchTrackTrivia({ title: 'Ordinary', artist: 'Example Artist' }), '')
})

test('matches the artist when songs have the same title', async (t) => {
  const fact = 'The song samples a recording of a train that passed outside the studio during the session.'
  wikipedia(t, [
    { title: 'Echo (Other Artist song)', extract: `Echo is a song by Other Artist.\n\n${fact}` },
    { title: 'Echo (Correct Artist song)', extract: `Echo is a song by Correct Artist.\n\n${fact.replace('train', 'tram')}` },
  ])
  assert.equal(await fetchTrackTrivia({ title: 'Echo', artist: 'Correct Artist' }), fact.replace('train', 'tram'))
})

test('handles featured credits and remaster suffixes in song titles', async (t) => {
  const fact = 'The song was originally written for a film that was cancelled before production began.'
  wikipedia(t, [{ title: 'Moonrise (song)', extract: `Moonrise is a song by Test Singer.\n\n${fact}` }])
  assert.equal(await fetchTrackTrivia({ title: 'Moonrise (feat. Guest) - 2020 Remaster', artist: 'Test Singer' }), fact)
})

test('returns no trivia when the lookup fails', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('offline') })
  assert.equal(await fetchTrackTrivia({ title: 'Unavailable', artist: 'Test Singer' }), '')
})

test('requires both a title and an artist', async () => {
  assert.equal(await fetchTrackTrivia({ title: 'Unknown' }), '')
  assert.equal(await fetchTrackTrivia(null), '')
})
