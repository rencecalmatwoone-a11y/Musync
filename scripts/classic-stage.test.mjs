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
    return {
      play: handlers[0], skip: handlers[1],
      offset: tree.values[tree.strings.findIndex((s) => /strokeDashoffset=$/.test(s))],
      playhead: parseFloat(tree.values.find((value) => value?.['--playhead-angle'])['--playhead-angle']),
    }
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
  for (const [stage, checkpoint] of [[1, 2], [2, 8], [3, 15]]) {
    p.render().skip()
    assert.equal(p.state[1], 0)
    assert.equal(p.state[2], stage)
    assert.equal(p.render().offset, 1 - checkpoint / 15)
    assert.equal(p.render().playhead, checkpoint / 15 * 360)
    await p.render().play()
    assert.equal(p.render().offset, 1 - [0.5, 2, 8][stage - 1] / 15)
    assert.equal(p.positions.at(-1), 0)
    assert.equal(p.state[0], true)
  }
  p.render().skip()
  assert.equal(p.skipped(), 1)
  assert.equal(p.state[0], false)
  assert.equal(p.render().offset, 0)
})

test('rapid skips use the latest stage even before a render', async () => {
  const p = await player()
  const { skip } = p.render()
  skip(); skip(); skip()
  assert.equal(p.state[2], 3)
  assert.equal(p.render().offset, 0)
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

test('the green line retains all skipped progress during playback and replay', async () => {
  const p = await player()
  for (const [stage, end] of [0.5, 2, 8, 15].entries()) {
    const skippedProgress = stage === 0 ? 0 : [0.5, 2, 8][stage - 1]
    for (let repeat = 0; repeat < 2; repeat++) {
      await p.render().play()
      assert.equal(p.render().offset, 1 - skippedProgress / 15)
      assert.equal(p.positions.at(-1), 0)
      const halfway = p.advance(end / 2)
      assert.equal(halfway.offset, 1 - (skippedProgress + (end - skippedProgress) / 2) / 15)
      assert.equal(halfway.playhead, (skippedProgress + (end - skippedProgress) / 2) / 15 * 360)
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

test('Skip previews the selected stage; Play animates both line and marker from the saved stage', async () => {
  const p = await player()
  const { skip } = p.render()
  skip(); skip(); skip()
  assert.equal(p.render().playhead, 360)
  assert.equal(p.render().offset, 0)
  await p.render().play()
  const savedPosition = p.render().playhead
  assert.equal(savedPosition, 8 / 15 * 360)
  const savedOffset = p.render().offset
  const movingPosition = p.advance(0.1).playhead
  assert.ok(movingPosition > savedPosition, 'the playback dot must move immediately')
  const movingOffset = p.render().offset
  assert.ok(movingOffset < savedOffset, 'the green line must move with the marker')
  await p.render().play()
  assert.equal(p.advance(1).playhead, movingPosition, 'the dot must stay still while paused')
  assert.equal(p.render().offset, movingOffset)
  await p.render().play()
  assert.equal(p.render().playhead, movingPosition, 'resuming must preserve the dot position')
  assert.ok(p.advance(0.1).playhead > movingPosition)
  assert.ok(p.render().offset < movingOffset)
})
