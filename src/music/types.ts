/** A single note. Times are in seconds, velocity is 0..1. */
export interface NoteEvent {
  midi: number
  time: number
  duration: number
  velocity: number
}

export interface TrackData {
  index: number
  name: string
  channel: number
  isPercussion: boolean
  notes: NoteEvent[]
}

export interface Song {
  name: string
  duration: number
  tracks: TrackData[]
}

export type Mode = 'major' | 'minor'

export interface Key {
  /** Pitch class 0..11 (C = 0). */
  tonic: number
  mode: Mode
}
