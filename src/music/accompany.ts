import { detectKey } from './key.ts'
import { MAJOR_SCALE, MINOR_SCALE } from './remap.ts'
import { averagePolyphony } from './split.ts'
import type { NoteEvent, Song, TrackData } from './types.ts'

/**
 * Fiddle tunes and lead sheets are a single melody line. To make them sound
 * like a band, we pick a chord for every half bar (or bar) from the song's own
 * scale, choosing the triad that best fits the melody notes there, and add a
 * chord track and a bass track.
 */

interface Triad {
  root: number // pitch class
  pcs: number[]
  degree: number
}

function triads(tonic: number, scale: number[]): Triad[] {
  const out: Triad[] = []
  for (let d = 0; d < 7 && d < scale.length; d++) {
    const pcs = [0, 2, 4].map((step) => (tonic + scale[(d + step) % scale.length]) % 12)
    const third = (pcs[1] - pcs[0] + 12) % 12
    const fifth = (pcs[2] - pcs[0] + 12) % 12
    if (fifth !== 7) continue // skip diminished/augmented triads
    if (third !== 3 && third !== 4) continue
    out.push({ root: pcs[0], pcs, degree: d })
  }
  return out
}

/** Score how well a triad fits the melody in [start, end). */
function fit(triad: Triad, notes: NoteEvent[], start: number, end: number): number {
  let score = 0
  for (const n of notes) {
    const a = Math.max(start, n.time)
    const b = Math.min(end, n.time + n.duration)
    if (b <= a) continue
    const weight = (b - a) * (Math.abs(n.time - start) < 1e-6 ? 1.6 : 1)
    score += triad.pcs.includes(((n.midi % 12) + 12) % 12) ? weight : -0.4 * weight
  }
  // Mild preference for the home chord and its neighbours.
  const pull = [0.25, 0, 0, 0.12, 0.15, 0.05, 0.05][triad.degree] ?? 0
  return score + pull * (end - start)
}

function nearest(pc: number, low: number): number {
  let m = low + ((pc - low) % 12 + 12) % 12
  if (m < low) m += 12
  return m
}

export function needsAccompaniment(song: Song): boolean {
  const pitched = song.tracks.filter((t) => !t.isPercussion && t.notes.length > 0)
  if (pitched.length !== 1 || !song.bars || song.bars.length < 4) return false
  return averagePolyphony(pitched[0].notes.slice(0, 600)) < 1.2
}

export function accompany(song: Song): Song {
  if (!needsAccompaniment(song)) return song
  const melody = song.tracks.find((t) => !t.isPercussion && t.notes.length > 0)!
  const key = song.keyHint ?? (() => {
    const k = detectKey(song)
    return { tonic: k.tonic, scale: k.mode === 'major' ? MAJOR_SCALE : MINOR_SCALE }
  })()
  const options = triads(key.tonic, key.scale)
  if (options.length === 0) return song

  // Segments: half bars when bars are long enough, else whole bars.
  const bars = [...song.bars!, song.duration]
  const segments: [number, number][] = []
  for (let i = 0; i < bars.length - 1; i++) {
    const [a, b] = [bars[i], bars[i + 1]]
    if (b - a <= 1e-6) continue
    if (b - a >= 1.4) segments.push([a, (a + b) / 2], [(a + b) / 2, b])
    else segments.push([a, b])
  }

  const chordNotes: NoteEvent[] = []
  const bassNotes: NoteEvent[] = []
  let prev: Triad | null = null
  for (const [a, b] of segments) {
    let best = options[0]
    let bestScore = -Infinity
    for (const t of options) {
      // Slight stickiness so chords don't flicker.
      const s = fit(t, melody.notes, a, b) + (prev && t.root === prev.root ? 0.08 * (b - a) : 0)
      if (s > bestScore) {
        bestScore = s
        best = t
      }
    }
    const len = Math.max(0.05, b - a - 0.02)
    const hasMelody = melody.notes.some((n) => n.time < b && n.time + n.duration > a)
    if (!hasMelody) continue
    bassNotes.push({ midi: nearest(best.root, 36), time: a, duration: len, velocity: 0.55 })
    for (const pc of best.pcs) chordNotes.push({ midi: nearest(pc, 52), time: a, duration: len, velocity: 0.4 })
    prev = best
  }

  const next = song.tracks.length
  const extra: TrackData[] = [
    { index: next, name: 'Accompaniment · Chords', channel: 1, isPercussion: false, program: 24, notes: chordNotes },
    { index: next + 1, name: 'Accompaniment · Bass', channel: 2, isPercussion: false, program: 32, notes: bassNotes },
  ]
  return { ...song, tracks: [...song.tracks, ...extra] }
}
