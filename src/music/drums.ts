import type { NoteEvent } from './types.ts'

/**
 * General MIDI drums use one key per drum sound, which only makes sense with a
 * drum kit. The sets use a single pitched percussion instrument instead, so we
 * keep the backbone of the groove (kick, toms, snare) and put each on its own
 * pitch. Hi-hats and cymbals are dropped: on a tom or timpani they just clatter.
 */
const KICK = [35, 36]
const SNARE = [37, 38, 39, 40]
const TOMS = [41, 43, 45, 47, 48, 50]

const KICK_PITCH = 36
const SNARE_PITCH = 50
const TOM_BASE_PITCH = 38 // low floor tom; each higher tom steps up

export function drumPitch(gmDrum: number): number | null {
  if (KICK.includes(gmDrum)) return KICK_PITCH
  if (SNARE.includes(gmDrum)) return SNARE_PITCH
  const tom = TOMS.indexOf(gmDrum)
  if (tom >= 0) return TOM_BASE_PITCH + tom * 2
  return null
}

export function mapDrumNotes(notes: NoteEvent[]): NoteEvent[] {
  const out: NoteEvent[] = []
  for (const n of notes) {
    const pitch = drumPitch(n.midi)
    if (pitch === null) continue
    out.push({ ...n, midi: pitch, duration: Math.max(n.duration, 0.25), velocity: n.velocity * 0.9 })
  }
  return out
}
