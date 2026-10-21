/** A single note. Times are in seconds, velocity is 0..1. */
export interface NoteEvent {
  midi: number
  time: number
  duration: number
  velocity: number
}

export type Lane = 'melody' | 'harmony' | 'bass'

export interface TrackData {
  index: number
  name: string
  channel: number
  isPercussion: boolean
  /** General MIDI program number (0-127) from the file, when known. */
  program?: number
  notes: NoteEvent[]
  /** Set when this track is one voice split out of another track. */
  source?: number
  lane?: Lane
}

export interface Song {
  name: string
  duration: number
  tracks: TrackData[]
  /** Bar start times in seconds, when the source format knows them. */
  bars?: number[]
  /** Tempo marking, when the file has one. */
  bpm?: number
  /** The song's own key and scale (e.g. from an ABC key signature). */
  keyHint?: { tonic: number; scale: number[] }
}

export type Mode = 'major' | 'minor'

export interface Key {
  /** Pitch class 0..11 (C = 0). */
  tonic: number
  mode: Mode
}
