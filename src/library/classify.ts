import type { Song } from '../music/types.ts'

/**
 * Guess a modern genre from a MIDI's instruments and tempo, so an imported
 * pack can be split into stations. It's a guess: songs can be moved later.
 */

export const MODERN_GENRES = ['Pop', 'Rock', 'Punk', 'Electronic'] as const
export type ModernGenre = (typeof MODERN_GENRES)[number]

export const stationName = (genre: string) => `Modern – ${genre}`

/** Rough beats per minute from the tempo mark, else from note density. */
export function estimateBpm(song: Song): number {
  if (song.bpm && song.bpm > 30 && song.bpm < 300) return song.bpm
  const onsets = new Set<number>()
  for (const t of song.tracks) for (const n of t.notes) onsets.add(Math.round(n.time * 20))
  const perSecond = song.duration > 0 ? onsets.size / song.duration : 2
  // Busy modern arrangements land around two onsets per beat.
  return Math.min(220, Math.max(60, (perSecond / 2) * 60))
}

export function classify(song: Song): ModernGenre {
  const programs = song.tracks.filter((t) => !t.isPercussion && t.notes.length > 0).map((t) => t.program ?? -1)
  const distorted = programs.some((p) => p === 29 || p === 30) // overdriven / distortion guitar
  const synthy = programs.filter((p) => (p >= 80 && p <= 103) || p === 38 || p === 39).length
  const bpm = estimateBpm(song)
  if (distorted && bpm >= 150) return 'Punk'
  if (distorted) return 'Rock'
  if (synthy >= 2 || (programs.length > 0 && synthy / programs.length >= 0.5)) return 'Electronic'
  return 'Pop'
}

/** Strip extensions, underscores and site tags ("- Pianoitall", "(1)") from a file name. */
export function cleanTitle(fileName: string): string {
  const base = fileName.split('/').pop() ?? fileName
  return (
    base
      .replace(/(\.(mid|midi|mxl|musicxml|xml|abc))+$/i, '')
      .replace(/_+/g, ' ')
      .replace(/\s*\(\d+\)\s*$/, '')
      .replace(/\s+/g, ' ')
      .trim() || 'Untitled'
  )
}

/** "Artist - Title - Site" -> { artist, title }. */
export function splitTitle(fileName: string): { title: string; artist?: string } {
  const parts = cleanTitle(fileName)
    .split(/\s+-\s+/)
    .map((x) => x.trim())
    .filter(Boolean)
  if (parts.length >= 2) {
    // A trailing source tag (one word, e.g. "Pianoitall", "MuseScore") isn't the title.
    const last = parts[parts.length - 1]
    if (parts.length >= 3 && !/\s/.test(last)) parts.pop()
    return { artist: parts[0], title: parts.slice(1).join(' - ') }
  }
  return { title: parts[0] ?? 'Untitled', artist: undefined }
}
