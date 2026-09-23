import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'

// Exercise the actual component handlers with deterministic hooks and audio.
async function player(props = {}) {
  const state = [], refs = [], positions = []
  const dom = { offset: 1, angle: 0 }
  const progressNode = { setAttribute(name, value) { dom.offset = Number(value) } }
  const playheadNode = { style: { setProperty(name, value) { dom.angle = parseFloat(value) } } }
  let stateIndex = 0, refIndex = 0, effectIndex = 0, skipped = 0, now = 0, frameId = 0
  const effects = [], pendingEffects = [], frames = new Map()
  const audio = {
    pause() {}, stop() {},
    async playFrom(url, position) { positions.push(position); return true },
    async playTrack(id, options) { positions.push(options.positionMs / 1000); return true },
  }
  const context = vm.createContext({
    useState(initial) {
      const index = stateIndex++
      if (!(index in state)) state[index] = initial
      return [state[index], (value) => { state[index] = typeof value === 'function' ? value(state[index]) : value }]
    },
    useRef(initial) { const index = refIndex++; return refs[index] ??= { current: initial } },
    useEffect(callback, deps) {
      const index = effectIndex++
      const previous = effects[index]
      if (!previous || !deps || !previous.deps || deps.some((value, i) => value !== previous.deps[i])) {
        pendingEffects.push(() => {
          previous?.cleanup?.()
          effects[index] = { deps, cleanup: callback() }
        })
      }
    },
    usePreviewAudio: () => audio,
    useSpotifyPlayback: () => audio,
    performance: { now: () => now },
    matchMedia: () => ({ matches: Boolean(props.reducedMotion) }),
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
    const tree = context.AudioPlayer({ trackId: 'test', playbackUrl: '/test.mp3', playbackType: 'preview', onSkip: () => skipped++, ...props, ...extra })
    const handlers = tree.values.filter((value, index) => /onClick=$/.test(tree.strings[index]))
    tree.values[tree.strings.findIndex((s) => /<circle\s+ref=$/.test(s))].current = progressNode
    tree.values[tree.strings.findIndex((s) => /<span\s+ref=$/.test(s))].current = playheadNode
    pendingEffects.splice(0).forEach((effect) => effect())
    return {
      play: handlers[0], skip: handlers[1],
      timer: tree.values[tree.strings.findIndex((s) => s.endsWith('<div className="timer">'))],
      offset: tree.values[tree.strings.findIndex((s) => /strokeDashoffset=$/.test(s))],
      playhead: parseFloat(tree.values.find((value) => value?.['--playhead-angle'])['--playhead-angle']),
    }
  }
  function tick(seconds) {
    now += seconds * 1000
    const callbacks = [...frames.values()]
    frames.clear()
    callbacks.forEach((callback) => callback(now))
  }
  function advance(seconds) { tick(seconds); return render() }
  return { render, advance, tick, dom, audio, state, positions, skipped: () => skipped }
}

for (const playbackType of ['preview', 'spotify-sdk']) {
  test(playbackType + ': first Play after Skip plays the next segment, then replay includes earlier stages', async () => {
    const p = await player({ playbackType })
    for (const [stage, checkpoint] of [[1, 2], [2, 8], [3, 15]]) {
      p.render().skip()
      const selected = p.render()
      assert.equal(p.state[2], stage)
      assert.equal(selected.timer, '0:' + String(checkpoint).padStart(2, '0'))
      assert.equal(selected.playhead, checkpoint / 15 * 360)
      assert.equal(p.state[0], false)
      await selected.play()
      const start = [0, 0.5, 2, 8][stage]
      assert.equal(p.render().playhead, selected.playhead, 'Play begins the rewind without snapping')
      assert.equal(p.render().offset, selected.offset)
      assert.equal(p.positions.at(-1), start)
      assert.equal(p.state[0], true, 'Play remains usable at every stage')
      p.advance(checkpoint - start)
      assert.equal(p.state[0], false)
      await p.render().play()
      assert.equal(p.positions.at(-1), 0, 'subsequent replay includes every unlocked stage')
      p.render()
      p.advance(checkpoint)
      assert.equal(p.state[0], false)
    }
    p.render().skip()
    assert.equal(p.skipped(), 1)
    assert.equal(p.state[0], false)
  })
}

test('rapid skips use the latest stage before React renders', async () => {
  const p = await player()
  const { skip } = p.render()
  skip(); skip(); skip()
  assert.equal(p.state[2], 3)
  assert.equal(p.render().timer, '0:15')
  assert.equal(p.render().playhead, 360)
  await p.render().play()
  assert.equal(p.positions.at(-1), 8)
  assert.equal(p.render().playhead, 360)
  assert.ok(p.advance(0.1).playhead < 360)
})

test('Stage 2 first plays from 0.5 to 2 seconds and never enters Stage 3', async () => {
  const p = await player()
  p.render().skip()
  const selected = p.render()
  assert.equal(selected.timer, '0:02')
  await selected.play()
  const started = p.render()
  assert.equal(started.timer, '0:00')
  let previous = p.advance(0.2).playhead
  for (let frame = 0; frame < 12; frame++) {
    p.tick(1 / 60)
    assert.ok(p.dom.angle > previous)
    assert.ok(Math.abs(p.dom.offset - (1 - p.dom.angle / 360)) < 1e-12)
    assert.equal(p.state[1], 0.5, 'animation does not wait for the timer text to change')
    previous = p.dom.angle
  }
  assert.equal(p.render().playhead, previous, 'a React render cannot rewind the animation')
  assert.equal(p.advance(0.7).timer, '0:01')
  const completed = p.advance(5)
  assert.equal(completed.timer, '0:02')
  assert.equal(completed.playhead, 2 / 15 * 360)
  assert.equal(p.state[0], false)
  assert.equal(p.state[2], 1)
  assert.equal(p.advance(5).playhead, completed.playhead)
})

test('replay animates the node backwards before following playback within the same stage', async () => {
  const p = await player()
  for (const [stage, start, end] of [[0, 0, 0.5], [1, 0, 2], [2, 0, 8], [3, 0, 15]]) {
    await p.render().play()
    p.render()
    const completed = p.advance(end - start)
    assert.equal(p.state[0], false)
    assert.equal(completed.playhead, end / 15 * 360)
    await completed.play()
    assert.equal(p.positions.at(-1), start)
    const replay = p.render()
    assert.equal(replay.playhead, completed.playhead, 'the first render cannot snap backwards')
    assert.equal(replay.timer, '0:' + String(Math.floor(start)).padStart(2, '0'))
    assert.equal(p.state[2], stage)
    const rewinding = p.advance(0.1)
    assert.ok(rewinding.playhead < completed.playhead)
    assert.ok(rewinding.playhead > (start + 0.1) / 15 * 360)
    assert.ok(Math.abs(rewinding.offset - (1 - rewinding.playhead / 360)) < 1e-12)
    const halfway = p.advance((end - start) / 2 - 0.1)
    assert.equal(halfway.playhead, (start + end) / 2 / 15 * 360)
    assert.equal(halfway.offset, 1 - (start + end) / 2 / 15)
    assert.equal(p.advance((end - start) / 2).offset, completed.offset)
    assert.equal(p.skipped(), 0)
    p.render().skip()
  }
  assert.equal(p.skipped(), 1)
})

test('pause/resume keeps fractional audio time and node position', async () => {
  const p = await player()
  p.render().skip()
  await p.render().play()
  p.render()
  const moving = p.advance(0.25)
  await moving.play()
  assert.equal(p.state[1], 0.75)
  assert.equal(p.advance(1).playhead, moving.playhead)
  await p.render().play()
  assert.equal(p.positions.at(-1), 0.75)
  assert.equal(p.render().playhead, moving.playhead)
  assert.ok(p.advance(0.25).playhead > moving.playhead)
})

test('failed replay does not reset the timer or reached node', async () => {
  const p = await player()
  p.render().skip()
  await p.render().play()
  p.render()
  const completed = p.advance(6)
  p.audio.playFrom = async () => false
  await completed.play()
  assert.equal(p.state[0], false)
  assert.equal(p.render().timer, completed.timer)
  assert.equal(p.render().playhead, completed.playhead)
})

test('pausing during rewind freezes the node, and Skip cancels the old animation', async () => {
  const p = await player()
  p.render().skip()
  await p.render().play()
  p.render()
  const rewinding = p.advance(0.05)
  await rewinding.play()
  const paused = p.render()
  assert.equal(p.advance(1).playhead, paused.playhead)
  await p.render().play()
  assert.equal(p.render().playhead, paused.playhead)
  const resumed = p.advance(0.05)
  assert.ok(resumed.playhead < paused.playhead)
  resumed.skip()
  const skipped = p.render()
  assert.equal(skipped.playhead, 8 / 15 * 360)
  assert.equal(p.advance(1).playhead, skipped.playhead)
  assert.equal(p.state[0], false)
})

test('reduced motion starts the new segment immediately, then replays from the beginning', async () => {
  const p = await player({ reducedMotion: true })
  p.render().skip()
  await p.render().play()
  assert.equal(p.render().playhead, 0.5 / 15 * 360)
  assert.equal(p.positions.at(-1), 0.5)
  p.advance(1.5)
  await p.render().play()
  assert.equal(p.render().playhead, 0)
  assert.equal(p.positions.at(-1), 0)
})

test('revealed tracks ignore Skip and Play', async () => {
  const p = await player({ revealActive: true })
  p.render().skip()
  await p.render().play()
  assert.equal(p.state[2], 0)
  assert.equal(p.positions.length, 0)
  assert.equal(p.skipped(), 0)
})
