import type { Lane, NoteEvent, Song, TrackData } from './types.ts'

/** Notes starting within this many seconds count as sounding together. */
const ONSET_WINDOW = 0.03

export const LANES: Lane[] = ['melody', 'harmony', 'bass']
const LANE_LABEL: Record<Lane, string> = {
  melody: 'Melody',
  harmony: 'Harmony',
  bass: 'Bass',
}

/**
 * Classify every note of a polyphonic track (a piano arrangement, say) by its
 * role, using what else is sounding when it starts:
 *   - nothing higher above it, something below  -> melody (top of the texture)
 *   - something above it, nothing below         -> bass   (bottom of it)
 *   - something both above and below            -> harmony (inner voices)
 *   - alone                                     -> melody if at or above the
 *                                                  track's median pitch, else bass
 * Returns lanes parallel to the input array.
 */
export function classifyLanes(notes: NoteEvent[]): Lane[] {
  const n = notes.length
  if (n === 0) return []

  const order = notes.map((_, i) => i).sort((a, b) => notes[a].time - notes[b].time)
  const pitches = notes.map((x) => x.midi).sort((a, b) => a - b)
  const median = pitches[Math.floor(n / 2)]
  const maxDuration = notes.reduce((m, x) => Math.max(m, x.duration), 0)

  const lanes = new Array<Lane>(n)
  for (let oi = 0; oi < n; oi++) {
    const i = order[oi]
    const t = notes[i].time + ONSET_WINDOW
    let higher = false
    let lower = false

    // Look back for notes still sounding, and forward for near-simultaneous onsets.
    for (let oj = oi - 1; oj >= 0; oj--) {
      const j = order[oj]
      if (notes[j].time < t - ONSET_WINDOW - maxDuration) break
      if (notes[j].time + notes[j].duration > t) {
        if (notes[j].midi > notes[i].midi) higher = true
        else if (notes[j].midi < notes[i].midi) lower = true
      }
    }
    for (let oj = oi + 1; oj < n; oj++) {
      const j = order[oj]
      if (notes[j].time > t) break
      if (notes[j].midi > notes[i].midi) higher = true
      else if (notes[j].midi < notes[i].midi) lower = true
    }

    if (!higher && lower) lanes[i] = 'melody'
    else if (higher && !lower) lanes[i] = 'bass'
    else if (higher && lower) lanes[i] = 'harmony'
    else lanes[i] = notes[i].midi >= median ? 'melody' : 'bass'
  }
  return lanes
}

/** Average number of notes sounding together at each note onset. */
export function averagePolyphony(notes: NoteEvent[]): number {
  if (notes.length === 0) return 0
  let total = 0
  for (const a of notes) {
    let count = 0
    for (const b of notes) {
      if (b.time <= a.time + ONSET_WINDOW && b.time + b.duration > a.time + ONSET_WINDOW) count++
    }
    total += count
  }
  return total / notes.length
}

export function isPolyphonic(track: TrackData): boolean {
  if (track.isPercussion || track.notes.length < 8) return false
  // Cap the work for very large tracks by sampling.
  const sample = track.notes.length > 1500 ? track.notes.slice(0, 1500) : track.notes
  return averagePolyphony(sample) >= 1.5
}

/** Unique, stable index for a split lane. */
export function laneIndex(source: number, lane: Lane): number {
  return 1000 + source * 3 + LANES.indexOf(lane)
}

/** Split one track into melody / harmony / bass tracks (empty lanes are dropped). */
export function splitTrack(track: TrackData): TrackData[] {
  const lanes = classifyLanes(track.notes)
  const result: TrackData[] = []
  for (const lane of LANES) {
    const notes = track.notes.filter((_, i) => lanes[i] === lane)
    if (notes.length === 0) continue
    result.push({
      index: laneIndex(track.index, lane),
      name: `${track.name} · ${LANE_LABEL[lane]}`,
      channel: track.channel,
      isPercussion: false,
      program: track.program,
      notes,
      source: track.index,
      lane,
    })
  }
  return result
}

/** Which tracks to split automatically: only when a file has few tracks. */
export function defaultSplit(song: Song): Set<number> {
  const pitched = song.tracks.filter((t) => !t.isPercussion && t.notes.length > 0)
  const out = new Set<number>()
  if (pitched.length > 2) return out
  for (const t of pitched) if (isPolyphonic(t)) out.add(t.index)
  return out
}

/** Replace the chosen tracks with their split voices. */
export function applySplit(song: Song, split: Set<number>): Song {
  if (split.size === 0) return song
  const tracks = song.tracks.flatMap((t) => (split.has(t.index) ? splitTrack(t) : [t]))
  return { ...song, tracks }
}
