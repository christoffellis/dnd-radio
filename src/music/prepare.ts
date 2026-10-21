import type { PlayTrack } from './engine.ts'
import { mapDrumNotes } from './drums.ts'
import { humanize } from './humanize.ts'
import { ORIGINAL_SET_ID, assignOriginal, assignVoices, getInstrumentSet } from './instruments.ts'
import { detectKey } from './key.ts'
import { getNoteSet } from './noteSets.ts'
import { remapNotes } from './remap.ts'
import { applySplit } from './split.ts'
import type { Key, Song, TrackData } from './types.ts'

export interface PrepareOptions {
  setId: string
  /** With setId 'original': the set for tracks whose file names no instrument (and drums). */
  baseSetId?: string
  noteSetId: string
  /** null = use the detected key. */
  key: Key | null
  /** Per-track instrument overrides: gm name or 'mute'. */
  overrides: Record<number, string>
  /** Source tracks split into melody / harmony / bass. */
  split: Set<number>
}

export interface PreparedSong {
  /** The song after voice splitting. */
  song: Song
  detectedKey: Key
  key: Key
  /** Instrument per track after overrides (null = muted). */
  assignments: Map<number, string | null>
  /** Instrument per track straight from the set. */
  defaults: Map<number, string | null>
  /** Tracks with notes remapped into the chosen scale. */
  tracks: TrackData[]
  /** What actually gets played. */
  playTracks: PlayTrack[]
}

export function prepare(raw: Song, options: PrepareOptions): PreparedSong {
  const song = applySplit(raw, options.split)
  const detectedKey = detectKey(raw)
  const key = options.key ?? detectedKey
  const noteSet = getNoteSet(options.noteSetId)

  const defaults =
    options.setId === ORIGINAL_SET_ID
      ? assignOriginal(song, getInstrumentSet(options.baseSetId ?? 'medieval'))
      : assignVoices(song, getInstrumentSet(options.setId))
  const assignments = new Map(defaults)
  for (const [index, choice] of Object.entries(options.overrides)) {
    assignments.set(Number(index), choice === 'mute' ? null : choice)
  }

  const tracks = song.tracks.map((t) => ({
    ...t,
    notes: t.isPercussion ? t.notes : remapNotes(t.notes, key, noteSet.intervals),
  }))

  // Drums onto the set's percussion instrument, then a played-not-typed pass.
  const performed = humanize(
    tracks.map((t) => (t.isPercussion ? { ...t, notes: mapDrumNotes(t.notes) } : t)),
    {
      seed: raw.name,
      bars: song.bars,
      duration: song.duration,
      instrument: (t) => assignments.get(t.index) ?? null,
    },
  )
  const playTracks: PlayTrack[] = []
  for (const t of performed) {
    const gm = assignments.get(t.index)
    if (gm) playTracks.push({ gm, notes: t.notes })
  }

  return { song, detectedKey, key, assignments, defaults, tracks, playTracks }
}
