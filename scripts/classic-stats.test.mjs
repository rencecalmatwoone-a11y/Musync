import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createClassicStats, restoreClassicStats, classicStatsReducer as reduce } from '../src/classicStats.js'

test('fresh and invalid statistics start at round one with no sample values', () => {
  const initial = createClassicStats()
  assert.deepEqual(initial, { round: 1, score: 0, streak: 0, bestStreak: 0, correct: 0, attempts: 0, roundsPlayed: 0, roundAttempts: 0, roundComplete: false })
  for (const saved of [null, {}, { ...initial, score: -10 }, { ...initial, correct: 3 }]) assert.deepEqual(restoreClassicStats(saved), initial)
})

test('correct answer scores once; the next loaded song advances the round', () => {
  const state = reduce(createClassicStats(), { type: 'guess', correct: true, points: 100 })
  assert.equal(state.round, 1)
  assert.equal(state.score, 100)
  assert.equal(state.streak, 1)
  assert.equal(state.bestStreak, 1)
  assert.equal(state.roundsPlayed, 1)
  assert.equal(state.attempts, 1)
  assert.deepEqual(reduce(state, { type: 'guess', correct: true, points: 100 }), state)
  assert.deepEqual(reduce(state, { type: 'miss' }), state)
  const next = reduce(state, { type: 'advance' })
  assert.equal(next.round, 2)
  assert.deepEqual(reduce(next, { type: 'advance' }), next)
})

test('wrong guesses preserve retry behavior, best streak and round-based statistics', () => {
  let state = createClassicStats()
  for (let i = 0; i < 2; i++) {
    state = reduce(state, { type: 'guess', correct: true, points: 100 + i * 10 })
    state = reduce(state, { type: 'advance' })
  }
  state = reduce(state, { type: 'guess', correct: false, points: 0 })
  assert.equal(state.round, 3)
  assert.equal(state.roundsPlayed, 2)
  assert.equal(state.streak, 0)
  assert.equal(state.bestStreak, 2)
  state = reduce(state, { type: 'guess', correct: true, points: 100 })
  assert.equal(state.score, 310)
  assert.equal(state.roundsPlayed, 3)
  assert.equal(state.correct / state.attempts * 100, 75)
})

test('skips and timeouts complete a round and count unanswered misses exactly once', () => {
  let state = reduce(createClassicStats(), { type: 'miss' })
  assert.equal(state.roundsPlayed, 1)
  assert.equal(state.attempts, 1)
  assert.deepEqual(reduce(state, { type: 'miss' }), state)
  state = reduce(state, { type: 'advance' })
  assert.equal(state.round, 2)
  state = reduce(state, { type: 'guess', correct: false, points: 0 })
  state = reduce(state, { type: 'miss' })
  assert.equal(state.attempts, 2)
  assert.equal(state.roundsPlayed, 2)
  assert.equal(reduce(state, { type: 'advance' }).round, 3)
})

test('reload retains earned totals and moves a completed round to the next song', () => {
  const completed = reduce(createClassicStats(), { type: 'guess', correct: true, points: 100 })
  const restored = restoreClassicStats(JSON.parse(JSON.stringify(completed)))
  assert.equal(restored.round, 2)
  assert.equal(restored.score, 100)
  assert.equal(restored.bestStreak, 1)
  assert.equal(restored.roundComplete, false)
  assert.equal(restoreClassicStats(restored).round, 2)
})
