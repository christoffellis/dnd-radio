import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classify, estimateBpm, splitTitle } from './classify.ts'
import { parseSmf } from '../music/smf.ts'
import type { Song, TrackData } from '../music/types.ts'


const track = (index: number, program: number, notes: [number, number][], isPercussion = false): TrackData => ({
  index,
  name: `t${index}`,
  channel: isPercussion ? 9 : index,
  isPercussion,
  program,
  notes: notes.map(([midi, time]) => ({ midi, time, duration: 0.2, velocity: 0.8 })),
})
const song = (tracks: TrackData[], bpm?: number): Song => ({ name: 's', duration: 30, tracks, bpm })
const line = (n: number, step: number): [number, number][] => Array.from({ length: n }, (_, i) => [60 + (i % 5), i * step])

test('classify: distorted guitars and a fast tempo make punk', () => {
  const s = song([track(0, 30, line(40, 0.2)), track(1, 33, line(40, 0.4)), track(2, 0, line(80, 0.1), true)], 180)
  assert.equal(classify(s), 'Punk')
})

test('classify: distorted guitars at a moderate tempo make rock', () => {
  assert.equal(classify(song([track(0, 29, line(40, 0.3)), track(1, 33, line(40, 0.6))], 120)), 'Rock')
})

test('classify: synth leads and pads make electronic', () => {
  assert.equal(classify(song([track(0, 81, line(40, 0.3)), track(1, 89, line(10, 2)), track(2, 38, line(40, 0.5))], 124)), 'Electronic')
})

test('classify: pianos, strings and clean guitars make pop', () => {
  assert.equal(classify(song([track(0, 0, line(40, 0.3)), track(1, 48, line(10, 2)), track(2, 25, line(40, 0.5))], 100)), 'Pop')
})

test('estimateBpm: uses the tempo mark, else note density', () => {
  assert.equal(estimateBpm(song([], 172)), 172)
  const busy = song([track(0, 0, line(120, 0.25))]) // 4 onsets/s over 30 s
  assert.ok(Math.abs(estimateBpm(busy) - 120) < 30, String(estimateBpm(busy)))
})

test('titles: file names become readable titles, with the artist split off', () => {
  assert.deepEqual(splitTitle('Taylor_Swift_-_Blank_Space_-_Pianoitall.mid'), { title: 'Blank Space', artist: 'Taylor Swift' })
  assert.deepEqual(splitTitle('Song 2.mid'), { title: 'Song 2', artist: undefined })
  assert.deepEqual(splitTitle('pack/Green Day - Basket Case (1).midi'), { title: 'Basket Case', artist: 'Green Day' })
})

test('parseSmf: sysex messages and running status after meta events keep timing intact', () => {
  const ppq = 480
  const track = [
    0x00, 0xf0, 0x05, 0x7e, 0x7f, 0x09, 0x01, 0xf7, // GM reset sysex
    0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20, // 120 bpm
    0x00, 0x90, 60, 100, // note on
    0x00, 0xff, 0x01, 0x01, 0x41, // text meta between notes
    0x83, 0x60, 60, 0, // one beat later, note off by running status
    0x00, 0xff, 0x2f, 0x00,
  ]
  const bytes = new Uint8Array([
    ...[0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, ppq >> 8, ppq & 255],
    ...[0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, track.length],
    ...track,
  ])
  const s = parseSmf(bytes.buffer, 'x')
  assert.equal(s.tracks.length, 1)
  assert.equal(s.tracks[0].notes.length, 1)
  assert.ok(Math.abs(s.duration - 0.5) < 1e-9, String(s.duration))
})
