import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

test('logout switches to guest and ignores pending authenticated status', async () => {
  let source = await readFile(new URL('../src/spotify/client.js', import.meta.url), 'utf8')
  source = source.replace(source.split(/\r?\n/)[0], 'const isSpotifyConfigured = true, isSpotifyAuthed = true')
  for (const name of ['tracks', 'popularTracks']) source = source.replace(`../data/${name}.js`, new URL(`../src/data/${name}.js`, import.meta.url).href)
  const originalFetch = globalThis.fetch
  const originalWindow = globalThis.window
  const events = []
  globalThis.window = { dispatchEvent: (event) => events.push(event) }
  let release
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    return new Promise((resolve) => { release = () => resolve(Response.json({ authed: true })) })
  }
  try {
    const client = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
    const pending = client.getSpotifyAuthStatus()
    client.clearSpotifyClientSession()
    assert.equal((await client.getSpotifyAuthStatus()).authed, false)
    release()
    assert.equal((await pending).authed, false)
    assert.equal((await client.getSpotifyAuthStatus()).authed, false)
    assert.equal(calls, 1)
    assert.equal(events[0].type, 'musync:spotify-auth-changed')
    assert.equal(events[0].detail.authed, false)
  } finally {
    globalThis.fetch = originalFetch
    if (originalWindow === undefined) delete globalThis.window
    else globalThis.window = originalWindow
  }
})
