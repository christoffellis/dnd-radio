import type { NoteEvent, TrackData } from './types.ts'

/**
 * Makes sequenced music sound played rather than typed in:
 *  - accents on the beat and phrase-level swells (when bar lines are known),
 *  - small velocity variation and a few milliseconds of timing looseness,
 *  - chords strummed (plucked instruments) or very slightly spread,
 *  - fast notes on sustained instruments slightly detached so each one speaks,
 *    repeated notes given room to re-articulate,
 *  - plucked and struck instruments allowed to ring.
 *
 * Everything is driven by a seeded random generator, so every listener of the
 * radio hears exactly the same performance.
 */

/** Instruments whose sound decays by itself (let them ring). */
const PLUCKED = new Set([
  'acoustic_grand_piano',
  'orchestral_harp',
  'acoustic_guitar_nylon',
  'acoustic_guitar_steel',
  'banjo',
  'dulcimer',
  'harpsichord',
  'koto',
  'shamisen',
  'sitar',
  'kalimba',
  'pizzicato_strings',
  'tubular_bells',
  'celesta',
  'music_box',
  'glockenspiel',
  'marimba',
  'xylophone',
  'vibraphone',
  'steel_drums',
  'tinkle_bell',
  'agogo',
  'timpani',
  'taiko_drum',
  'melodic_tom',
  'woodblock',
])

export function isPlucked(gm: string): boolean {
  return PLUCKED.has(gm)
}

/** mulberry32: tiny, fast, seedable. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hash(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

function barIndex(bars: number[], t: number): number {
  let lo = 0
  let hi = bars.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (bars[mid] <= t + 1e-6) lo = mid
    else hi = mid - 1
  }
  return lo
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export interface HumanizeOptions {
  /** Same seed => same performance (use the song's identity). */
  seed: string
  /** Bar start times, if known. */
  bars?: number[]
  /** Song end, used to estimate the last bar's length. */
  duration: number
  /** Instrument per track index. */
  instrument: (track: TrackData) => string | null
}

export function humanize(tracks: TrackData[], options: HumanizeOptions): TrackData[] {
  const bars = options.bars && options.bars.length > 1 ? options.bars : null
  return tracks.map((track) => {
    const gm = options.instrument(track)
    if (!gm || track.notes.length === 0) return track
    const random = rng(hash(`${options.seed}:${track.index}:${track.name}`))
    const plucked = isPlucked(gm)
    const lead = track.lane === 'melody' || track.index === 0
    const jitter = track.isPercussion ? 0.004 : lead ? 0.009 : 0.006

    // Group notes that start together (chords).
    const notes = [...track.notes].sort((a, b) => a.time - b.time || a.midi - b.midi)
    const groups: NoteEvent[][] = []
    for (const n of notes) {
      const g = groups[groups.length - 1]
      if (g && Math.abs(g[0].time - n.time) < 0.002) g.push(n)
      else groups.push([n])
    }

    // When does each note's pitch next sound? (one backwards pass)
    const nextSame = new Map<NoteEvent, number>()
    const seen = new Map<number, number>()
    for (let i = notes.length - 1; i >= 0; i--) {
      const n = notes[i]
      const t = seen.get(n.midi)
      if (t !== undefined && t > n.time + 0.002) nextSame.set(n, t)
      seen.set(n.midi, n.time)
    }

    const out: NoteEvent[] = []
    groups.forEach((group, gi) => {
      const start = group[0].time
      const nextStart = groups[gi + 1]?.[0].time ?? Infinity

      // Dynamics: beat accents and a gentle swell over 4-bar phrases.
      let accent = 0
      if (bars) {
        const b = barIndex(bars, start)
        const barStart = bars[b]
        const barLen = (bars[b + 1] ?? options.duration) - barStart
        const pos = barLen > 0 ? (start - barStart) / barLen : 0
        if (pos < 0.02) accent += 0.1
        else if (Math.abs(pos - 0.5) < 0.02) accent += 0.05
        else accent -= 0.04
        accent += 0.05 * Math.sin((Math.PI * ((b % 4) + pos)) / 4)
      }

      // Timing: one shared nudge for the group, so chords stay together.
      const nudge = (random() * 2 - 1) * jitter
      const strum = group.length >= 3 ? (plucked ? 0.014 : 0.004) : 0

      group.forEach((n, k) => {
        const velocity = clamp(n.velocity + accent + (random() * 2 - 1) * 0.045, 0.08, 1)
        const time = Math.max(0, start + nudge + k * strum)
        let duration = n.duration - k * strum

        if (!track.isPercussion) {
          const gap = nextStart - start
          if (plucked) {
            // Let it ring a little past the written end, but not into a repeat of itself.
            const limit = (nextSame.get(n) ?? Infinity) - start - 0.02
            duration = Math.min(Math.max(duration, Math.min(duration * 1.6, duration + 0.35)), limit)
          } else if (gap < 0.45 && duration >= gap * 0.95) {
            // Fast passages: slightly detached, like separate bow strokes or tongued notes.
            duration = gap * 0.86
          }
          // Repeated notes need a breath to re-articulate.
          const repeat = nextSame.get(n)
          if (repeat !== undefined && start + duration > repeat - 0.025) duration = repeat - start - 0.025
        }
        out.push({ ...n, time, velocity, duration: Math.max(0.04, duration) })
      })
    })
    return { ...track, notes: out }
  })
}
