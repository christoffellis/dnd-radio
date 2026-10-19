import { Midi } from '@tonejs/midi'
import type { Song, TrackData } from './types.ts'

/** Parse a .mid file into our own plain song model (times in seconds). */
export function parseMidi(data: ArrayBuffer, fallbackName: string): Song {
  const midi = new Midi(data)
  const tracks: TrackData[] = []
  let duration = 0

  midi.tracks.forEach((t, i) => {
    if (t.notes.length === 0) return
    const notes = t.notes.map((n) => ({
      midi: n.midi,
      time: n.time,
      duration: n.duration,
      velocity: n.velocity,
    }))
    for (const n of notes) duration = Math.max(duration, n.time + n.duration)
    tracks.push({
      index: i,
      name: t.name?.trim() || t.instrument?.name || `Track ${i + 1}`,
      channel: t.channel,
      isPercussion: t.instrument?.percussion ?? t.channel === 9,
      program: t.instrument?.number,
      notes,
    })
  })

  return {
    name: midi.header.name?.trim() || fallbackName,
    duration,
    tracks,
  }
}
