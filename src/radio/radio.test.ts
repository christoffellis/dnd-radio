import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EPOCH_MS, GAP, buildSchedule, locate } from './schedule.ts'
import { bestSample } from './clock.ts'

const durations = [30, 45.5, 12.25]
const schedule = buildSchedule(durations)

test('schedule: slots are back to back with a gap, cycle covers them all', () => {
  assert.deepEqual(
    schedule.slots.map((s) => s.start),
    [0, 30 + GAP, 30 + GAP + 45.5 + GAP],
  )
  assert.equal(schedule.cycle, 30 + 45.5 + 12.25 + 3 * GAP)
})

test('locate: the station starts at the epoch with the first song', () => {
  const loc = locate(schedule, EPOCH_MS)!
  assert.equal(loc.index, 0)
  assert.equal(loc.offset, 0)
  assert.equal(loc.startMs, EPOCH_MS)
  assert.equal(loc.nextIndex, 1)
  assert.equal(loc.nextStartMs, EPOCH_MS + (30 + GAP) * 1000)
})

test('locate: mid-song and during the gap', () => {
  const mid = locate(schedule, EPOCH_MS + (30 + GAP + 10) * 1000)!
  assert.equal(mid.index, 1)
  assert.ok(Math.abs(mid.offset - 10) < 1e-9)

  const gap = locate(schedule, EPOCH_MS + 31 * 1000)!
  assert.equal(gap.index, 0)
  assert.ok(gap.offset > durations[0])
  assert.equal(gap.nextIndex, 1)
})

test('locate: the last song wraps to the first, in the next cycle', () => {
  const lastStart = schedule.slots[2].start
  const loc = locate(schedule, EPOCH_MS + (lastStart + 5) * 1000)!
  assert.equal(loc.index, 2)
  assert.equal(loc.nextIndex, 0)
  assert.equal(loc.nextStartMs, EPOCH_MS + schedule.cycle * 1000)
})

test('locate: startMs + offset always equals now, years after the epoch', () => {
  const now = EPOCH_MS + 3 * 365 * 24 * 3600 * 1000
  for (let ms = 0; ms < 400_000; ms += 777) {
    const t = now + ms
    const loc = locate(schedule, t)!
    assert.ok(Math.abs(loc.startMs + loc.offset * 1000 - t) < 0.01, `drift at ${t}`)
    assert.ok(loc.offset >= 0 && loc.offset < durations[loc.index] + GAP + 1e-6)
    assert.ok(loc.nextStartMs > t)
  }
})

test('locate: position advances continuously within a song', () => {
  const base = EPOCH_MS + 1_000_000_000
  let prev = locate(schedule, base)!
  for (let ms = 100; ms < 300_000; ms += 100) {
    const loc = locate(schedule, base + ms)!
    if (loc.index === prev.index && loc.startMs === prev.startMs) {
      assert.ok(Math.abs(loc.offset - prev.offset - 0.1) < 1e-6)
    } else {
      // Only ever moves on to the scheduled next song, at its start.
      assert.equal(loc.index, prev.nextIndex)
      assert.equal(loc.startMs, prev.nextStartMs)
    }
    prev = loc
  }
})

test('schedule: float noise in durations does not change slot boundaries', () => {
  const a = buildSchedule([30.0000000001, 45.5, 12.25])
  const b = buildSchedule([29.9999999999, 45.5, 12.25])
  assert.deepEqual(a, b)
})

test('locate: empty playlist', () => {
  assert.equal(locate(buildSchedule([]), Date.now()), null)
})

test('clock: the fastest round trip wins', () => {
  const best = bestSample([
    { rtt: 120, id: 'a' },
    { rtt: 35, id: 'b' },
    { rtt: 80, id: 'c' },
  ])
  assert.equal(best?.id, 'b')
  assert.equal(bestSample([]), null)
})
