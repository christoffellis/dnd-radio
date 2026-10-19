import { test } from 'node:test'
import assert from 'node:assert/strict'
import { remapPitch, remapNotes } from './remap.ts'
import { detectKey } from './key.ts'
import { NOTE_SETS } from './noteSets.ts'
import { INSTRUMENT_SETS, assignVoices } from './instruments.ts'
import type { Song, TrackData } from './types.ts'

const C_MAJOR = { tonic: 0, mode: 'major' as const }
const A_MINOR = { tonic: 9, mode: 'minor' as const }

function track(index: number, midis: number[], isPercussion = false): TrackData {
  return {
    index,
    name: `t${index}`,
    channel: isPercussion ? 9 : index,
    isPercussion,
    notes: midis.map((midi, i) => ({ midi, time: i * 0.5, duration: 0.5, velocity: 0.8 })),
  }
}

function song(tracks: TrackData[]): Song {
  return { name: 'test', duration: 10, tracks }
}

test('degree mapping: C major to C dorian changes the 3rd and 7th', () => {
  const dorian = [0, 2, 3, 5, 7, 9, 10]
  // C D E F G A B  ->  C D Eb F G A Bb
  const out = [60, 62, 64, 65, 67, 69, 71].map((n) => remapPitch(n, C_MAJOR, dorian))
  assert.deepEqual(out, [60, 62, 63, 65, 67, 69, 70])
})

test('degree mapping: A natural minor to A dorian only raises the 6th', () => {
  const dorian = [0, 2, 3, 5, 7, 9, 10]
  // A B C D E F G -> A B C D E F# G
  const out = [69, 71, 72, 74, 76, 77, 79].map((n) => remapPitch(n, A_MINOR, dorian))
  assert.deepEqual(out, [69, 71, 72, 74, 76, 78, 79])
})

test('remapping preserves octaves, including below the tonic', () => {
  const dorian = [0, 2, 3, 5, 7, 9, 10]
  assert.equal(remapPitch(52, C_MAJOR, dorian), 51) // E3 -> Eb3
  assert.equal(remapPitch(40, C_MAJOR, dorian), 39) // E2 -> Eb2
  assert.equal(remapPitch(72, C_MAJOR, dorian), 72) // C5 stays
})

test('pentatonic targets snap to the nearest scale tone', () => {
  const pent = [0, 2, 4, 7, 9]
  const allowed = new Set(pent)
  for (let n = 48; n < 84; n++) {
    const out = remapPitch(n, C_MAJOR, pent)
    assert.ok(allowed.has(((out % 12) + 12) % 12), `${n} -> ${out} left the scale`)
  }
  assert.equal(remapPitch(65, C_MAJOR, pent), 64) // F ties down to E
  assert.equal(remapPitch(71, C_MAJOR, pent), 72) // B wraps up to C
})

test('every note set only produces notes inside its scale', () => {
  for (const set of NOTE_SETS) {
    if (!set.intervals) continue
    const allowed = new Set(set.intervals.map((i) => (i + 2) % 12)) // tonic D = 2
    for (const key of [
      { tonic: 2, mode: 'major' as const },
      { tonic: 2, mode: 'minor' as const },
    ]) {
      for (let n = 36; n < 96; n++) {
        const out = remapPitch(n, key, set.intervals)
        assert.ok(allowed.has(((out % 12) + 12) % 12), `${set.id}: ${n} -> ${out}`)
      }
    }
  }
})

test('note sets are well-formed', () => {
  for (const set of NOTE_SETS) {
    if (!set.intervals) continue
    assert.equal(set.intervals[0], 0, set.id)
    for (let i = 1; i < set.intervals.length; i++) {
      assert.ok(set.intervals[i] > set.intervals[i - 1], `${set.id} not ascending`)
    }
    assert.ok(set.intervals[set.intervals.length - 1] < 12, set.id)
  }
})

test('remapNotes keeps timing and returns the same array for "original"', () => {
  const t = track(0, [60, 64])
  assert.equal(remapNotes(t.notes, C_MAJOR, null), t.notes)
  const mapped = remapNotes(t.notes, C_MAJOR, [0, 2, 3, 5, 7, 9, 10])
  assert.deepEqual(
    mapped.map((n) => [n.time, n.duration]),
    t.notes.map((n) => [n.time, n.duration]),
  )
  assert.equal(mapped[1].midi, 63)
})

test('key detection finds C major and A minor', () => {
  const cMajor = song([track(0, [60, 62, 64, 65, 67, 69, 71, 72, 60, 64, 67, 60, 64, 67])])
  assert.deepEqual(detectKey(cMajor), { tonic: 0, mode: 'major' })

  const aMinor = song([track(0, [69, 71, 72, 74, 76, 77, 79, 69, 72, 76, 69, 72, 76, 69, 64])])
  assert.deepEqual(detectKey(aMinor), { tonic: 9, mode: 'minor' })
})

test('voice assignment: highest track leads, lowest gets the bass voice', () => {
  const set = INSTRUMENT_SETS[0]
  const s = song([track(0, [48, 50]), track(1, [72, 74]), track(2, [60, 62])])
  const a = assignVoices(s, set)
  assert.equal(a.get(1), set.voices[0])
  assert.equal(a.get(2), set.voices[1])
  assert.equal(a.get(0), set.voices[set.voices.length - 1])
})

test('voice assignment: single track gets the lead, drums are muted', () => {
  const set = INSTRUMENT_SETS[1]
  const s = song([track(0, [60, 62]), track(1, [36, 38], true)])
  const a = assignVoices(s, set)
  assert.equal(a.get(0), set.voices[0])
  assert.equal(a.get(1), null)
})
