import { test } from 'node:test'
import assert from 'node:assert/strict'
import { remapPitch, remapNotes } from './remap.ts'
import { detectKey } from './key.ts'
import { NOTE_SETS } from './noteSets.ts'
import { INSTRUMENTS, INSTRUMENT_SETS, assignVoices } from './instruments.ts'
import { drumPitch, mapDrumNotes } from './drums.ts'
import { classifyLanes, defaultSplit, applySplit, isPolyphonic, splitTrack } from './split.ts'
import type { NoteEvent, Song, TrackData } from './types.ts'

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

// ---- voice splitting ------------------------------------------------------

function ev(midi: number, time: number, duration = 0.5): NoteEvent {
  return { midi, time, duration, velocity: 0.8 }
}

/** A tiny piano arrangement: bass note + chord (with melody on top) each beat. */
function pianoNotes(): NoteEvent[] {
  const notes: NoteEvent[] = []
  for (let beat = 0; beat < 8; beat++) {
    const t = beat * 0.5
    notes.push(ev(40, t)) // bass
    notes.push(ev(55, t)) // inner
    notes.push(ev(60, t)) // inner
    notes.push(ev(72 + (beat % 3), t)) // melody
  }
  return notes
}

test('classifyLanes finds bass, harmony and melody in a piano texture', () => {
  const notes = pianoNotes()
  const lanes = classifyLanes(notes)
  notes.forEach((n, i) => {
    if (n.midi === 40) assert.equal(lanes[i], 'bass')
    else if (n.midi === 55 || n.midi === 60) assert.equal(lanes[i], 'harmony')
    else assert.equal(lanes[i], 'melody')
  })
})

test('classifyLanes: a held bass note does not hide the melody above it', () => {
  const notes = [ev(40, 0, 4), ev(72, 0.5), ev(74, 1), ev(72, 1.5)]
  const lanes = classifyLanes(notes)
  assert.deepEqual(lanes, ['bass', 'melody', 'melody', 'melody'])
})

test('classifyLanes: lone notes go by register around the median', () => {
  const notes = [ev(36, 0), ev(38, 1), ev(40, 2), ev(80, 3), ev(82, 4), ev(84, 5)]
  const lanes = classifyLanes(notes)
  assert.deepEqual(lanes, ['bass', 'bass', 'bass', 'melody', 'melody', 'melody'])
})

test('single melodic line is not treated as polyphonic', () => {
  const line = Array.from({ length: 16 }, (_, i) => ev(60 + (i % 5), i * 0.5, 0.4))
  const t: TrackData = { index: 0, name: 'Lead', channel: 0, isPercussion: false, notes: line }
  assert.equal(isPolyphonic(t), false)
  assert.equal(defaultSplit(song([t])).size, 0)
})

test('piano track is polyphonic and auto-splits into three voices', () => {
  const t: TrackData = { index: 0, name: 'Piano', channel: 0, isPercussion: false, notes: pianoNotes() }
  assert.equal(isPolyphonic(t), true)
  const s = song([t])
  const split = defaultSplit(s)
  assert.deepEqual([...split], [0])

  const out = applySplit(s, split)
  assert.deepEqual(out.tracks.map((x) => x.lane), ['melody', 'harmony', 'bass'])
  assert.equal(new Set(out.tracks.map((x) => x.index)).size, 3)
  assert.equal(out.tracks.reduce((n, x) => n + x.notes.length, 0), t.notes.length)
  assert.ok(out.tracks.every((x) => x.source === 0))
})

test('files with several pitched tracks are not auto-split', () => {
  const piano = (index: number): TrackData => ({
    index, name: `P${index}`, channel: index, isPercussion: false, notes: pianoNotes(),
  })
  assert.equal(defaultSplit(song([piano(0), piano(1), piano(2)])).size, 0)
})


// ---- instrument assignment ------------------------------------------------

function roleOf(setIndex: number, gm: string | null | undefined) {
  return INSTRUMENT_SETS[setIndex].voices.find((x) => x.gm === gm)?.role
}

test('every voice and percussion instrument in every set is in the library', () => {
  const known = new Set(INSTRUMENTS.map((i) => i.gm))
  for (const set of INSTRUMENT_SETS) {
    assert.ok(known.has(set.percussion), `${set.id} percussion ${set.percussion}`)
    for (const voice of set.voices) assert.ok(known.has(voice.gm), `${set.id}: ${voice.gm}`)
    const roles = new Set(set.voices.map((x) => x.role))
    for (const r of ['lead', 'harmony', 'pad', 'accent', 'bass']) {
      assert.ok(roles.has(r as never), `${set.id} has no ${r} voice`)
    }
    assert.equal(new Set(set.voices.map((x) => x.gm)).size, set.voices.length, `${set.id} duplicates`)
  }
})

test('there is a Tropical set', () => {
  assert.ok(INSTRUMENT_SETS.some((s) => s.id === 'tropical'))
})

test('highest track leads, lowest gets a bass voice, middle gets harmony', () => {
  const s = song([track(0, [48, 50]), track(1, [72, 74]), track(2, [60, 62])])
  INSTRUMENT_SETS.forEach((_, si) => {
    const a = assignVoices(s, INSTRUMENT_SETS[si])
    assert.equal(roleOf(si, a.get(1)), 'lead')
    assert.equal(roleOf(si, a.get(2)), 'harmony')
    assert.equal(roleOf(si, a.get(0)), 'bass')
  })
})

test('single track gets a lead; drums go to the percussion instrument', () => {
  const set = INSTRUMENT_SETS[1]
  const s = song([track(0, [60, 62]), track(1, [36, 38], true)])
  const a = assignVoices(s, set)
  assert.equal(roleOf(1, a.get(0)), 'lead')
  assert.equal(a.get(1), set.percussion)
})

test('a rich file gets distinct instruments, with choir as a pad', () => {
  // Mirrors a real 6-track file: drums, two e-pianos, whistle, choir, alto sax.
  const t = (index: number, midis: number[], program: number, isPercussion = false): TrackData => ({
    ...track(index, midis, isPercussion),
    program,
  })
  const s = song([
    t(0, [36, 38, 42], 0, true),
    t(1, [48, 50, 52], 4), // electric piano, low
    t(2, [84, 86, 88], 78), // whistle, high
    t(3, [60, 62, 64], 4), // electric piano, mid
    t(4, [67, 69, 71], 52), // choir aahs
    t(5, [55, 57, 59], 65), // alto sax
  ])
  INSTRUMENT_SETS.forEach((set, si) => {
    const a = assignVoices(s, set)
    const pitched = [1, 2, 3, 4, 5].map((i) => a.get(i)!)
    assert.equal(new Set(pitched).size, 5, `${set.id} reused an instrument: ${pitched}`)
    assert.equal(roleOf(si, a.get(2)), 'lead')
    assert.equal(roleOf(si, a.get(1)), 'bass')
    assert.equal(roleOf(si, a.get(4)), 'pad')
    assert.equal(a.get(0), set.percussion)
  })
})

test('more tracks than voices still assigns everything', () => {
  const tracks = Array.from({ length: 16 }, (_, i) => track(i, [40 + i * 3, 42 + i * 3]))
  const a = assignVoices(song(tracks), INSTRUMENT_SETS[0])
  assert.equal(a.size, 16)
  assert.ok([...a.values()].every((x) => typeof x === 'string'))
})

test('split voices map to lead, harmony and bass roles', () => {
  const t: TrackData = { index: 0, name: 'Piano', channel: 0, isPercussion: false, notes: pianoNotes() }
  const parts = splitTrack(t)
  const a = assignVoices(song(parts), INSTRUMENT_SETS[0])
  const byLane = Object.fromEntries(parts.map((p) => [p.lane, roleOf(0, a.get(p.index))]))
  assert.deepEqual(byLane, { melody: 'lead', harmony: 'harmony', bass: 'bass' })
})

// ---- drums ----------------------------------------------------------------

test('drums keep kick, toms and snare and drop hats and cymbals', () => {
  assert.equal(drumPitch(36), 36)
  assert.equal(drumPitch(38), 50)
  assert.notEqual(drumPitch(45), null)
  assert.equal(drumPitch(42), null) // closed hat
  assert.equal(drumPitch(49), null) // crash
  const mapped = mapDrumNotes([
    { midi: 36, time: 0, duration: 0.05, velocity: 1 },
    { midi: 42, time: 0.25, duration: 0.05, velocity: 1 },
    { midi: 38, time: 0.5, duration: 0.05, velocity: 1 },
  ])
  assert.deepEqual(mapped.map((n) => n.midi), [36, 50])
  assert.ok(mapped.every((n) => n.duration >= 0.25))
})

test('original set: tracks play their own GM program; unnamed tracks and drums use the base set', async () => {
  const { assignOriginal, getInstrumentSet } = await import('./instruments.ts')
  const { gmFamily } = await import('./gm.ts')
  const mk = (index: number, program: number | undefined, pitch: number, isPercussion = false) => ({
    index, name: `t${index}`, channel: isPercussion ? 9 : index, isPercussion, program,
    notes: [{ midi: pitch, time: 0, duration: 1, velocity: 0.8 }],
  })
  const song = { name: 's', duration: 1, tracks: [mk(0, 30, 64), mk(1, 33, 40), mk(2, undefined, 72), mk(3, 0, 38, true)] }
  const medieval = getInstrumentSet('medieval')
  const a = assignOriginal(song, medieval)
  assert.equal(a.get(0), 'distortion_guitar')
  assert.equal(a.get(1), 'electric_bass_finger')
  assert.ok(medieval.voices.some((v) => v.gm === a.get(2)), String(a.get(2)))
  assert.equal(a.get(3), medieval.percussion)
  assert.equal(gmFamily('distortion_guitar'), 'organ')
  assert.equal(gmFamily('pad_2_warm'), 'voice')
  assert.equal(gmFamily('electric_bass_finger'), 'pluck')
})
