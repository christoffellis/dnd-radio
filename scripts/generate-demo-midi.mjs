// Generates small public-domain demo MIDI files into public/midi.
// No dependencies: writes Standard MIDI Files by hand.
//   npm run gen:midi
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'midi')
const PPQ = 480

const PITCH = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 }
function midi(name) {
  const m = /^([A-G]#?)(-?\d)$/.exec(name)
  if (!m) throw new Error(`bad note ${name}`)
  return PITCH[m[1]] + (Number(m[2]) + 1) * 12
}

function vlq(value) {
  const bytes = [value & 0x7f]
  while ((value >>= 7) > 0) bytes.unshift((value & 0x7f) | 0x80)
  return bytes
}

function chunk(type, data) {
  const len = data.length
  return [...Buffer.from(type), (len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255, ...data]
}

// Meta event bytes without a delta time (trackChunk adds the delta).
function meta(type, data) {
  return [0xff, type, ...vlq(data.length), ...data]
}

function text(s) {
  return [...Buffer.from(s, 'utf8')]
}

/** events: [{ tick, bytes }] -> track chunk with delta times. */
function trackChunk(events) {
  events.sort((a, b) => a.tick - b.tick || (a.order ?? 0) - (b.order ?? 0))
  const data = []
  let last = 0
  for (const e of events) {
    data.push(...vlq(e.tick - last), ...e.bytes)
    last = e.tick
  }
  data.push(0, ...meta(0x2f, []))
  return chunk('MTrk', data)
}

/**
 * sequence: [[pitches | null, units], ...] where pitches is a note name or an
 * array of names (a chord), and units are multiples of `unit` ticks.
 */
function noteEvents(sequence, unit, channel, velocity) {
  const events = []
  let tick = 0
  for (const [pitches, units] of sequence) {
    const len = units * unit
    if (pitches) {
      for (const name of [].concat(pitches)) {
        events.push({ tick, order: 1, bytes: [0x90 | channel, midi(name), velocity] })
        events.push({ tick: tick + len - 12, order: 0, bytes: [0x80 | channel, midi(name), 0] })
      }
    }
    tick += len
  }
  return events
}

/** progression: [[root, [triad...], units] | [null, units]] -> bass + chord sequences */
function fromProgression(progression) {
  const bass = []
  const chords = []
  for (const step of progression) {
    if (step[0] === null) {
      bass.push([null, step[1]])
      chords.push([null, step[1]])
    } else {
      const [root, triad, units] = step
      bass.push([root, units])
      chords.push([triad, units])
    }
  }
  return { bass, chords }
}

function writeSong({ file, title, bpm, unit, melody, progression }) {
  const { bass, chords } = fromProgression(progression)
  const sum = (seq) => seq.reduce((s, [, u]) => s + u, 0)
  if (sum(melody) !== sum(bass)) {
    throw new Error(`${title}: melody ${sum(melody)} units vs accompaniment ${sum(bass)}`)
  }

  const tempo = Math.round(60_000_000 / bpm)
  const conductor = trackChunk([
    { tick: 0, bytes: meta(0x03, text(title)) },
    { tick: 0, bytes: meta(0x51, [(tempo >> 16) & 255, (tempo >> 8) & 255, tempo & 255]) },
  ])
  const named = (name, program, channel, seq, vel) =>
    trackChunk([
      { tick: 0, bytes: meta(0x03, text(name)) },
      { tick: 0, bytes: [0xc0 | channel, program] },
      ...noteEvents(seq, unit, channel, vel),
    ])

  const header = chunk('MThd', [0, 1, 0, 4, (PPQ >> 8) & 255, PPQ & 255])
  const bytes = Buffer.from([
    ...header,
    ...conductor,
    ...named('Melody', 73, 0, melody, 92),
    ...named('Chords', 46, 1, chords, 64),
    ...named('Bass', 42, 2, bass, 78),
  ])
  writeFileSync(join(OUT, file), bytes)
  console.log(`wrote ${file} (${bytes.length} bytes)`)
}

mkdirSync(OUT, { recursive: true })

// Greensleeves (traditional). 6/8, unit = one eighth note.
const Am = ['A2', ['A3', 'C4', 'E4']]
const C = ['C3', ['C4', 'E4', 'G4']]
const G = ['G2', ['G3', 'B3', 'D4']]
const Em = ['E2', ['E3', 'G3', 'B3']]
const E = ['E2', ['E3', 'G#3', 'B3']]
const chord = ([root, triad], units) => [root, triad, units]

writeSong({
  file: 'greensleeves.mid',
  title: 'Greensleeves',
  bpm: 100,
  unit: PPQ / 2,
  melody: [
    ['A4', 2],
    ['C5', 4], ['D5', 2],
    ['E5', 3], ['F5', 1], ['E5', 2],
    ['D5', 4], ['B4', 2],
    ['G4', 3], ['A4', 1], ['B4', 2],
    ['C5', 4], ['A4', 2],
    ['A4', 3], ['G#4', 1], ['A4', 2],
    ['B4', 4], ['G#4', 2],
    ['E4', 6],
    ['A4', 2],
    ['C5', 4], ['D5', 2],
    ['E5', 3], ['F5', 1], ['E5', 2],
    ['D5', 4], ['B4', 2],
    ['G4', 3], ['A4', 1], ['B4', 2],
    ['C5', 3], ['B4', 1], ['A4', 2],
    ['G#4', 3], ['F#4', 1], ['G#4', 2],
    ['A4', 6],
  ],
  progression: [
    [null, 2],
    chord(Am, 6), chord(C, 6), chord(G, 6), chord(Em, 6),
    chord(Am, 6), chord(E, 6), chord(E, 6), chord(E, 6),
    [null, 2],
    chord(Am, 6), chord(C, 6), chord(G, 6), chord(Em, 6),
    chord(Am, 6), chord(E, 6), chord(Am, 6),
  ],
})

// Auld Lang Syne (traditional). 4/4, unit = one eighth note.
const GM = ['G2', ['G3', 'B3', 'D4']]
const D = ['D3', ['D3', 'F#3', 'A3']]
const Cc = ['C3', ['C4', 'E4', 'G4']]

writeSong({
  file: 'auld-lang-syne.mid',
  title: 'Auld Lang Syne',
  bpm: 84,
  unit: PPQ / 2,
  melody: [
    ['D4', 2],
    ['G4', 3], ['G4', 1], ['G4', 2], ['B4', 2],
    ['A4', 3], ['G4', 1], ['A4', 2], ['B4', 2],
    ['G4', 3], ['G4', 1], ['B4', 2], ['D5', 2],
    ['E5', 6], ['E5', 2],
    ['D5', 3], ['B4', 1], ['B4', 2], ['G4', 2],
    ['A4', 3], ['G4', 1], ['A4', 2], ['B4', 2],
    ['G4', 3], ['E4', 1], ['E4', 2], ['D4', 2],
    ['G4', 6], [null, 2],
  ],
  progression: [
    [null, 2],
    chord(GM, 8), chord(D, 8), chord(GM, 8), chord(Cc, 8),
    chord(GM, 8), chord(D, 8), chord(GM, 8), chord(GM, 8),
  ],
})

// Sakura Sakura (traditional, simplified). 4/4, unit = one quarter note.
const AmS = ['A2', ['A3', 'C4', 'E4']]
const Dm = ['D3', ['D4', 'F4', 'A4']]
const ES = ['E2', ['E3', 'G#3', 'B3']]

writeSong({
  file: 'sakura.mid',
  title: 'Sakura Sakura',
  bpm: 76,
  unit: PPQ,
  melody: [
    ['A4', 1], ['A4', 1], ['B4', 2],
    ['A4', 1], ['A4', 1], ['B4', 2],
    ['A4', 1], ['B4', 1], ['C5', 1], ['B4', 1],
    ['A4', 1], ['B4', 1], ['A4', 1], ['F4', 1],
    ['E4', 4],
  ],
  progression: [chord(AmS, 4), chord(AmS, 4), chord(AmS, 4), chord(Dm, 4), chord(ES, 4)],
})

writeFileSync(
  join(OUT, 'index.json'),
  JSON.stringify(
    [
      { title: 'Greensleeves', file: 'greensleeves.mid' },
      { title: 'Auld Lang Syne', file: 'auld-lang-syne.mid' },
      { title: 'Sakura Sakura', file: 'sakura.mid' },
    ],
    null,
    2,
  ) + '\n',
)
console.log('wrote index.json')
