import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'

// Exercise the actual component handlers with deterministic hooks and audio.
async function player() {
  const state = [], refs = [], positions = []
  let stateIndex = 0, refIndex = 0, effectIndex = 0, skipped = 0, now = 0, frameId = 0
  const effects = [], pendingEffects = [], frames = new Map()
  const audio = { pause() {}, stop() {}, async playFrom(url, position) { positions.push(position); return true } }
  const context = vm.createContext({
    useState(initial) {
      const index = stateIndex++
      if (!(index in state)) state[index] = initial
      return [state[index], (value) => { state[index] = value }]
    },
    useRef(initial) { const index = refIndex++; return refs[index] ??= { current: initial } },
    useEffect(callback, deps) {
      const index = effectIndex++
      const previous = effects[index]
      if (!previous || deps.some((value, i) => value !== previous.deps[i])) {
        pendingEffects.push(() => {
          previous?.cleanup?.()
          effects[index] = { deps, cleanup: callback() }
        })
      }
    },
    usePreviewAudio: () => audio,
    useSpotifyPlayback: () => audio,
    performance: { now: () => now },
    requestAnimationFrame(callback) { frames.set(++frameId, callback); return frameId },
    cancelAnimationFrame(id) { frames.delete(id) },
    html: (strings, ...values) => ({ strings, values }),
  })
  const source = (await readFile(new URL('../src/components/AudioPlayer.js', import.meta.url), 'utf8'))
    .replace(/^import .*\r?\n/gm, '')
    .replace('export default function AudioPlayer', 'function AudioPlayer')
  vm.runInContext(source, context)
  function render(extra = {}) {
    stateIndex = 0; refIndex = 0; effectIndex = 0
    const tree = context.AudioPlayer({ trackId: 'test', playbackUrl: '/test.mp3', playbackType: 'preview', onSkip: () => skipped++, ...extra })
    const handlers = tree.values.filter((value, index) => /onClick=$/.test(tree.strings[index]))
    pendingEffects.splice(0).forEach((effect) => effect())
    return { play: handlers[0], skip: handlers[1], offset: tree.values[tree.strings.findIndex((s) => /strokeDashoffset=$/.test(s))] }
  }
  function advance(seconds) {
    now += seconds * 1000
    const callbacks = [...frames.values()]
    frames.clear()
    callbacks.forEach((callback) => callback(now))
    return render()
  }
  return { render, advance, state, positions, skipped: () => skipped }
}

test('successive skips unlock longer clips from the beginning', async () => {
  const p = await player()
  for (const [stage, start] of [[1, 0.5], [2, 2], [3, 8]]) {
    p.render().skip()
    assert.equal(p.state[1], 0)
    assert.equal(p.state[2], stage)
    await p.render().play()
    assert.equal(p.positions.at(-1), 0)
    assert.equal(p.state[0], true)
  }
  p.render().skip()
  assert.equal(p.skipped(), 1)
  assert.equal(p.state[0], false)
})

test('rapid skips use the latest stage even before a render', async () => {
  const p = await player()
  const { skip } = p.render()
  skip(); skip(); skip()
  assert.equal(p.state[2], 3)
  await p.render().play()
  assert.equal(p.positions.at(-1), 0)
})

test('completed stages replay themselves and revealed tracks ignore skip', async () => {
  const p = await player()
  p.render().skip()
  p.state[1] = 2
  await p.render().play()
  assert.equal(p.positions.at(-1), 0)
  assert.equal(p.state[2], 1)
  p.render({ revealActive: true }).skip()
  assert.equal(p.state[2], 1)
  assert.equal(p.skipped(), 0)
})

test('the line replays from zero to the same checkpoint at every stage until Skip', async () => {
  const p = await player()
  for (const [stage, end] of [0.5, 2, 8, 15].entries()) {
    for (let repeat = 0; repeat < 2; repeat++) {
      await p.render().play()
      assert.equal(p.render().offset, 1)
      assert.equal(p.positions.at(-1), 0)
      const halfway = p.advance(end / 2)
      assert.equal(halfway.offset, 1 - end / 2 / 15)
      const complete = p.advance(end / 2)
      assert.equal(complete.offset, 1 - end / 15)
      assert.equal(p.state[0], false)
      assert.equal(p.state[2], stage)
      assert.equal(p.skipped(), 0)
    }
    p.render().skip()
  }
  assert.equal(p.skipped(), 1)
})
