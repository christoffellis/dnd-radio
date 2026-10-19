import type { Key, NoteEvent } from './types.ts'

export const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11]
export const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10]

export function sourceScale(key: Key): number[] {
  return key.mode === 'major' ? MAJOR_SCALE : MINOR_SCALE
}

/** Index of the scale tone nearest to `rel` (0..11). Ties resolve downwards. */
function nearestDegree(rel: number, scale: number[]): number {
  let best = 0
  let bestDist = Infinity
  // Include the octave (scale[0] + 12) so 11 can wrap up to the tonic.
  const withOctave = [...scale, 12]
  for (let i = 0; i < withOctave.length; i++) {
    const d = Math.abs(withOctave[i] - rel)
    if (d < bestDist) {
      best = i
      bestDist = d
    }
  }
  return best // may equal scale.length, meaning "the octave"
}

/**
 * Map one MIDI pitch into the target scale.
 *
 * - 7-note targets use degree mapping: the note is first snapped to the
 *   song's own scale (major or minor), then degree N becomes degree N of the
 *   target. A minor-key song remapped to Dorian keeps its melody shape but
 *   gets the Dorian sixth.
 * - Other targets (pentatonics, whole tone, ...) snap each note to the
 *   nearest tone of the target scale.
 */
export function remapPitch(midi: number, key: Key, target: number[]): number {
  const offset = midi - key.tonic
  const octave = Math.floor(offset / 12)
  const rel = offset - octave * 12

  let mapped: number
  if (target.length === 7) {
    const src = sourceScale(key)
    const degree = nearestDegree(rel, src)
    mapped = degree >= 7 ? 12 : target[degree]
  } else {
    const degree = nearestDegree(rel, target)
    mapped = degree >= target.length ? 12 : target[degree]
  }
  return key.tonic + octave * 12 + mapped
}

export function remapNotes(notes: NoteEvent[], key: Key, target: number[] | null): NoteEvent[] {
  if (!target) return notes
  return notes.map((n) => ({ ...n, midi: remapPitch(n.midi, key, target) }))
}
