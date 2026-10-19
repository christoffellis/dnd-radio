import { test } from 'node:test'
import assert from 'node:assert/strict'
import { humanize } from './humanize.ts'
import type { NoteEvent, TrackData } from './types.ts'

const ev = (midi: number, time: number, duration: number): NoteEvent => ({ midi, time, duration, velocity: 0.7 })
const track = (index: number, notes: NoteEvent[]): TrackData => ({
  index,
  name: `t${index}`,
  channel: index,
  isPercussion: false,
  notes,
})

// A fast reel line: legato sixteenths, with a repeated note.
const reel = track(0, [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ev(i === 3 ? 67 : 60 + i, i * 0.15, 0.15)))
// Plucked chords on every beat, alternating C and D minor.
const chords = track(
  1,
  [0, 0.6, 1.2, 1.8].flatMap((t, i) => (i % 2 ? [50, 53, 57] : [48, 52, 55]).map((m) => ev(m, t, 0.6))),
)
const bars = [0, 1.2]
const opts = (instrument: string) => ({ seed: 'The Fairy Dance', bars, duration: 2.4, instrument: () => instrument })

test('humanize: deterministic for the same seed (everyone hears the same thing)', () => {
  const a = humanize([reel, chords], opts('flute'))
  const b = humanize([reel, chords], opts('flute'))
  assert.deepEqual(a, b)
  const c = humanize([reel], { ...opts('flute'), seed: 'another song' })
  assert.notDeepEqual(a[0].notes, c[0].notes)
})

test('humanize: timing stays within a few ms and velocities stay sane', () => {
  const [out] = humanize([reel], opts('flute'))
  out.notes.forEach((n, i) => {
    assert.ok(Math.abs(n.time - reel.notes[i].time) <= 0.0091, `note ${i} moved ${n.time - reel.notes[i].time}`)
    assert.ok(n.velocity >= 0.08 && n.velocity <= 1)
    assert.ok(n.duration > 0)
  })
  // The downbeat is accented relative to an off-beat note.
  assert.ok(out.notes[0].velocity > out.notes[1].velocity - 0.09)
})

test('humanize: fast legato notes on sustained instruments are slightly detached', () => {
  const [out] = humanize([reel], opts('fiddle'))
  for (let i = 0; i < out.notes.length - 1; i++) {
    const gap = out.notes[i + 1].time - out.notes[i].time
    assert.ok(out.notes[i].duration < reel.notes[i].duration, `note ${i} not shortened`)
    assert.ok(out.notes[i].duration < gap + 0.02)
  }
})

test('humanize: plucked chords are strummed upwards and ring, but stay together', () => {
  const [out] = humanize([chords], opts('acoustic_guitar_nylon'))
  const first = out.notes.slice(0, 3)
  assert.ok(first[0].time < first[1].time && first[1].time < first[2].time, 'strummed low to high')
  assert.ok(first[2].time - first[0].time < 0.04, 'strum is quick')
  assert.ok(first[0].duration > 0.6, 'lets the string ring past the written end')
  // ...but never into the next strike of the same string (two chords later).
  assert.ok(first[0].time + first[0].duration <= out.notes[6].time)
})

test('humanize: repeated notes leave room to re-articulate', () => {
  const repeated = track(0, [ev(62, 0, 0.5), ev(62, 0.5, 0.5), ev(62, 1, 0.5)])
  for (const gm of ['flute', 'koto']) {
    const [out] = humanize([repeated], { ...opts(gm), seed: 's' })
    for (let i = 0; i < 2; i++) {
      assert.ok(out.notes[i].time + out.notes[i].duration <= out.notes[i + 1].time - 0.01, `${gm} note ${i}`)
    }
  }
})

test('humanize: muted tracks are untouched', () => {
  const [out] = humanize([reel], { ...opts('flute'), instrument: () => null })
  assert.equal(out, reel)
})
