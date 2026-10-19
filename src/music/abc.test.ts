import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MIN_SECONDS, parseAbc, parseKey, splitTunes } from './abc.ts'
import { accompany, needsAccompaniment } from './accompany.ts'

const tune = (body: string, header = 'M:4/4\nL:1/8\nQ:1/4=120\nK:C') => `X:1\nT:Test\n${header}\n${body}\n`
/** Notes of one pass (short tunes are repeated to fill MIN_SECONDS). */
const firstPass = (abc: string) => {
  const song = parseAbc(abc, 'x')
  const notes = song.tracks[0].notes
  const passes = Math.min(3, Math.ceil(MIN_SECONDS / notes.reduce((m, n) => Math.max(m, n.time + n.duration), 0)))
  return notes.slice(0, notes.length / passes).map((n) => [n.midi, +n.time.toFixed(4), +n.duration.toFixed(4)])
}

test('abc: key signatures with modes', () => {
  assert.deepEqual(parseKey('G').signature.F, 1)
  assert.equal(parseKey('Ador').signature.F, 1) // A dorian = G major's notes
  assert.equal(parseKey('Ador').tonic, 9)
  assert.deepEqual(parseKey('Ador').scale, [0, 2, 3, 5, 7, 9, 10])
  const bb = parseKey('Bb').signature
  assert.equal(bb.B, -1)
  assert.equal(bb.E, -1)
  assert.equal(bb.A, 0)
  assert.equal(parseKey('Gm').signature.E, -1) // G minor = Bb major
  assert.equal(parseKey('Emix').signature.C, 1) // E mixolydian = A major
  assert.equal(parseKey('D exp ^c').signature.C, 1)
})

test('abc: pitches, octaves, lengths and accidentals within a bar', () => {
  // 120 qpm, L:1/8 => an eighth = 0.25 s
  assert.deepEqual(firstPass(tune("C c c' C, ^F2 F | F")), [
    [60, 0, 0.25],
    [72, 0.25, 0.25],
    [84, 0.5, 0.25],
    [48, 0.75, 0.25],
    [66, 1, 0.5],
    [66, 1.5, 0.25], // accidental carries to the end of the bar
    [65, 1.75, 0.25], // ...and resets after it
  ])
})

test('abc: key signature applies, broken rhythm, triplets, chords and ties', () => {
  assert.deepEqual(firstPass(tune('F>G (3ABc [CEG]2 d-d', 'M:4/4\nL:1/8\nQ:1/4=120\nK:G')), [
    [66, 0, 0.375], // F# from the key, dotted
    [67, 0.375, 0.125],
    [69, 0.5, 0.1667], // triplet: three in the time of two
    [71, 0.6667, 0.1667],
    [72, 0.8333, 0.1667],
    [60, 1, 0.5],
    [64, 1, 0.5],
    [67, 1, 0.5],
    [74, 1.5, 0.5], // tied d-d
  ])
})

test('abc: repeats with first and second endings', () => {
  const pitches = firstPass(tune('|: C D |1 E :|2 F |]')).map((n) => n[0])
  assert.deepEqual(pitches, [60, 62, 64, 60, 62, 65])
})

test('abc: decorations, annotations, grace notes and fingerings are skipped', () => {
  const pitches = firstPass(tune('u"4"C {AB}D !trill!E ~F "^SEGUE".G')).map((n) => n[0])
  assert.deepEqual(pitches, [60, 62, 64, 65, 67])
})

test('abc: short tunes play through again to fill time; bars are recorded', () => {
  const song = parseAbc(tune('C D E F | G A B c |]'), 'x')
  // one pass = 8 eighths at 120 = 2 s => played 3 times (the cap)
  assert.equal(song.tracks[0].notes.length, 24)
  assert.equal(song.duration, 6)
  assert.deepEqual(song.bars?.slice(0, 4), [0, 1, 2, 3])
})

test('abc: default tempo comes from note density, whatever the notation', () => {
  const jig = parseAbc('X:1\nT:A Jig\nR:jig\nM:6/8\nL:1/8\nK:D\nDEF GAB|\n', 'x')
  const reel44 = parseAbc('X:1\nT:A Reel\nR:reel\nM:4/4\nL:1/8\nK:D\nDEFG ABcd|\n', 'x')
  const reel24 = parseAbc('X:1\nT:A Reel\nR:reel\nM:2/4\nL:1/16\nK:D\nDEFG ABcd|\n', 'x')
  const first = (s: typeof jig) => s.tracks[0].notes[0].duration
  assert.ok(Math.abs(first(jig) - 0.17) < 1e-9)
  assert.ok(Math.abs(first(reel44) - 0.15) < 1e-9)
  // Same music written in 2/4 with sixteenths plays at the same speed.
  assert.ok(Math.abs(first(reel24) - first(reel44)) < 1e-9)
})

test('abc: picks a tune by X: in a multi-tune file', () => {
  const book = 'X:1\nT:One\nK:C\nC|\n\nX:2\nT:Two\nK:C\nG|\n'
  assert.equal(splitTunes(book).length, 2)
  assert.equal(parseAbc(book, 'x', 2).name, 'Two')
  assert.equal(parseAbc(book, 'x', 2).tracks[0].notes[0].midi, 67)
})

test('accompaniment: single melodies get chords and bass that fit', () => {
  // C major arpeggio bar, then G major arpeggio bar, then C again.
  const song = parseAbc(tune('C E G c | B, D G B | C E G c |]', 'M:4/4\nL:1/4\nQ:1/4=60\nK:C'), 'x')
  assert.ok(needsAccompaniment(song))
  const full = accompany(song)
  assert.equal(full.tracks.length, 3)
  const bass = full.tracks.find((t) => t.name.endsWith('Bass'))!
  const roots = bass.notes.slice(0, 6).map((n) => n.midi % 12)
  // Half-bar segments (bars are 4 s): C C G G C C
  assert.deepEqual(roots, [0, 0, 7, 7, 0, 0])
  const chords = full.tracks.find((t) => t.name.endsWith('Chords'))!
  assert.deepEqual(
    chords.notes.slice(0, 3).map((n) => n.midi % 12).sort((a, b) => a - b),
    [0, 4, 7],
  )
  // Already-harmonised songs are left alone.
  assert.equal(accompany(full), full)
})

test('accompaniment: modal tunes use their own scale (dorian keeps F#)', () => {
  const song = parseAbc(tune('A c e a | D F A d |]', 'M:4/4\nL:1/4\nQ:1/4=60\nK:Ador'), 'x')
  const full = accompany(song)
  const chordPcs = new Set(full.tracks[1].notes.map((n) => n.midi % 12))
  assert.ok(!chordPcs.has(5), 'no F natural in A dorian')
  assert.ok(chordPcs.has(6), 'D major chord (with F#) for the D bar')
})
