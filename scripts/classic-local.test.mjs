import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'

const asModule = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`

test('signed-in OPM ignores era/genre, samples uniformly, and avoids repeats; International retains filters', async () => {
  let client = await readFile(new URL('../src/spotify/client.js', import.meta.url), 'utf8')
  client = client.replace(client.split(/\r?\n/)[0], 'const isSpotifyConfigured = true, isSpotifyAuthed = true')
  for (const name of ['tracks', 'popularTracks']) client = client.replace(`../data/${name}.js`, new URL(`../src/data/${name}.js`, import.meta.url).href)
  let source = await readFile(new URL('../src/data/classicTracks.js', import.meta.url), 'utf8')
  source = source.replace('../spotify/client.js', asModule(client))
  const { fetchClassicTrack } = await import(asModule(source))
  const nativeFetch = globalThis.fetch
  const nativeRandom = Math.random
  const requests = []
  const tracks = Array.from({ length: 5 }, (_, index) => ({
    id: `local-${index}`, title: `Song ${index}`, artist: `Artist ${index}`, popularity: index === 0 ? 100 : 1,
  }))
  globalThis.fetch = async (input) => {
    if (input === '/api/spotify/status') return Response.json({ configured: true, authed: true })
    const url = new URL(input, 'https://musync.test')
    assert.equal(url.pathname, '/api/spotify/tracks')
    requests.push(url.searchParams)
    return Response.json({ tracks, nextOffset: null })
  }
  Math.random = () => 0.6
  try {
    const filters = { musicOrigin: 'OPM / Local', genre: 'Rock', yearFrom: 1990, yearTo: 1999, difficulty: 2 }
    const first = await fetchClassicTrack(filters)
    assert.equal(first.id, 'local-3', 'uniform random selection must not favor the popular song')
    assert.equal(first.playbackType, 'spotify-sdk')
    assert.equal(requests[0].get('musicOrigin'), 'OPM')
    for (const key of ['genre', 'yearFrom', 'yearTo']) assert.equal(requests[0].has(key), false)
    const played = new Set([first.id])
    for (let i = 0; i < 4; i++) {
      const next = await fetchClassicTrack({ ...filters, genre: 'Jazz', yearFrom: 2020, recentIds: [...played] })
      assert.ok(!played.has(next.id))
      played.add(next.id)
    }
    assert.equal(requests.length, 1, 'inactive era/genre values share the same OPM pool')
    const last = [...played].at(-1)
    const recycled = await fetchClassicTrack({ ...filters, recentIds: [last] })
    assert.notEqual(recycled.id, last)
    await fetchClassicTrack({ ...filters, musicOrigin: 'International' })
    assert.equal(requests.length, 2)
    assert.equal(requests[1].get('musicOrigin'), 'International')
    assert.equal(requests[1].get('genre'), 'Rock')
    assert.equal(requests[1].get('yearFrom'), '1990')
    assert.equal(requests[1].get('yearTo'), '1999')
  } finally {
    globalThis.fetch = nativeFetch
    Math.random = nativeRandom
  }
})

test('OPM disables only Era and Genre; switching to International restores their values', async () => {
  const source = (await readFile(new URL('../src/components/GameArea.js', import.meta.url), 'utf8'))
    .replace(/^import .*\r?\n/gm, '')
    .replace('export default function GameArea', 'function GameArea')
  const context = vm.createContext({
    useState: (value) => [value, () => {}], useRef: (value) => ({ current: value }), useEffect() {},
    html: (strings, ...values) => ({ strings, values }),
    AudioPlayer() {}, GuessInput() {}, searchClassicCatalog() {}, GENRES: ['Any Genre', 'Rock'],
  })
  vm.runInContext(source, context)
  const valuesFor = (tree, attr) => tree.values.filter((_, i) => tree.strings[i].endsWith(`${attr}=`))
  const props = { era: '1990s', genre: 'Rock', musicOrigin: 'OPM / Local', filtersDisabled: false }
  const local = context.GameArea(props)
  assert.deepEqual(Array.from(valuesFor(local, 'disabled').slice(0, 3)), [false, true, true])
  assert.deepEqual(Array.from(valuesFor(local, 'value')), ['OPM / Local', 'Any Era', 'Any Genre'])
  for (const message of valuesFor(local, 'reminderMessage')) assert.match(message, /randomized/)
  const international = context.GameArea({ ...props, musicOrigin: 'International' })
  assert.deepEqual(Array.from(valuesFor(international, 'disabled').slice(0, 3)), [false, false, false])
  assert.deepEqual(Array.from(valuesFor(international, 'value')), ['International', '1990s', 'Rock'])
  const guest = context.GameArea({ ...props, filtersDisabled: true })
  assert.deepEqual(Array.from(valuesFor(guest, 'disabled').slice(0, 3)), [true, true, true])

  let changed = false, reminded = false
  const carousel = context.FilterCarousel({ label: 'Era', options: ['Any Era', '1990s'], value: 'Any Era',
    disabled: true, onChange: () => { changed = true }, onShowReminder: () => { reminded = true } })
  valuesFor(carousel, 'onClick')[0]({ stopPropagation() {} })
  assert.equal(changed, false)
  assert.equal(reminded, true)
})
