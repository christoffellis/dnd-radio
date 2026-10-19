import type { Song } from './types.ts'

/**
 * Instruments come from General MIDI soundfonts via smplr. `gm` is the
 * soundfont instrument name (snake_case), loaded from a CDN on first use.
 */
export interface Instrument {
  gm: string
  name: string
}

export const INSTRUMENTS: Instrument[] = [
  { gm: 'recorder', name: 'Recorder' },
  { gm: 'flute', name: 'Flute / whistle' },
  { gm: 'pan_flute', name: 'Pan flute' },
  { gm: 'ocarina', name: 'Ocarina' },
  { gm: 'oboe', name: 'Oboe' },
  { gm: 'english_horn', name: 'English horn' },
  { gm: 'bassoon', name: 'Bassoon' },
  { gm: 'bagpipe', name: 'Bagpipes' },
  { gm: 'shakuhachi', name: 'Shakuhachi' },
  { gm: 'orchestral_harp', name: 'Harp' },
  { gm: 'acoustic_guitar_nylon', name: 'Lute (nylon guitar)' },
  { gm: 'acoustic_guitar_steel', name: 'Steel guitar' },
  { gm: 'banjo', name: 'Banjo' },
  { gm: 'dulcimer', name: 'Dulcimer' },
  { gm: 'harpsichord', name: 'Harpsichord' },
  { gm: 'koto', name: 'Koto' },
  { gm: 'shamisen', name: 'Shamisen' },
  { gm: 'sitar', name: 'Sitar' },
  { gm: 'kalimba', name: 'Kalimba' },
  { gm: 'violin', name: 'Violin' },
  { gm: 'fiddle', name: 'Fiddle' },
  { gm: 'viola', name: 'Viola' },
  { gm: 'cello', name: 'Cello' },
  { gm: 'contrabass', name: 'Double bass' },
  { gm: 'string_ensemble_1', name: 'String ensemble' },
  { gm: 'pizzicato_strings', name: 'Plucked strings' },
  { gm: 'accordion', name: 'Accordion' },
  { gm: 'church_organ', name: 'Church organ' },
  { gm: 'choir_aahs', name: 'Choir' },
  { gm: 'french_horn', name: 'French horn' },
  { gm: 'trumpet', name: 'Trumpet' },
  { gm: 'trombone', name: 'Trombone' },
  { gm: 'tubular_bells', name: 'Tubular bells' },
  { gm: 'celesta', name: 'Celesta' },
  { gm: 'music_box', name: 'Music box' },
  { gm: 'glockenspiel', name: 'Glockenspiel' },
  { gm: 'marimba', name: 'Marimba' },
  { gm: 'timpani', name: 'Timpani' },
  { gm: 'acoustic_grand_piano', name: 'Piano' },
]

export const FALLBACK_GM = 'acoustic_grand_piano'

export function instrumentName(gm: string): string {
  return INSTRUMENTS.find((i) => i.gm === gm)?.name ?? gm
}

/**
 * An instrument set is an ordered list of voices:
 * [lead, second, third, ..., bass]. The highest track of a song gets the
 * lead, the lowest track gets the last voice, the rest fill in between.
 */
export interface InstrumentSet {
  id: string
  name: string
  description: string
  voices: string[]
}

export const INSTRUMENT_SETS: InstrumentSet[] = [
  {
    id: 'medieval',
    name: 'Medieval fantasy',
    description: 'Recorder, harp and lute over low strings.',
    voices: ['recorder', 'orchestral_harp', 'acoustic_guitar_nylon', 'cello'],
  },
  {
    id: 'tavern',
    name: 'Tavern',
    description: 'Fiddle, accordion and banjo with a thumping bass.',
    voices: ['fiddle', 'accordion', 'banjo', 'contrabass'],
  },
  {
    id: 'celtic',
    name: 'Celtic',
    description: 'Whistle, fiddle and harp over cello.',
    voices: ['flute', 'fiddle', 'orchestral_harp', 'cello'],
  },
  {
    id: 'asian',
    name: 'East Asian',
    description: 'Shakuhachi, koto and shamisen.',
    voices: ['shakuhachi', 'koto', 'shamisen', 'cello'],
  },
  {
    id: 'dungeon',
    name: 'Dungeon',
    description: 'English horn, choir and bells over a deep bass.',
    voices: ['english_horn', 'choir_aahs', 'tubular_bells', 'contrabass'],
  },
  {
    id: 'court',
    name: 'Royal court',
    description: 'Harpsichord, oboe and strings.',
    voices: ['oboe', 'harpsichord', 'string_ensemble_1', 'contrabass'],
  },
]

export function getInstrumentSet(id: string): InstrumentSet {
  return INSTRUMENT_SETS.find((s) => s.id === id) ?? INSTRUMENT_SETS[0]
}

function meanPitch(song: Song, trackIndex: number): number {
  const notes = song.tracks.find((t) => t.index === trackIndex)?.notes ?? []
  if (notes.length === 0) return 0
  return notes.reduce((s, n) => s + n.midi, 0) / notes.length
}

/**
 * Pick an instrument (gm name) for every track from a set.
 * Percussion tracks are muted (null): General MIDI drums don't fit the sets.
 */
export function assignVoices(song: Song, set: InstrumentSet): Map<number, string | null> {
  const result = new Map<number, string | null>()
  const pitched = song.tracks.filter((t) => !t.isPercussion && t.notes.length > 0)
  for (const t of song.tracks) {
    if (t.isPercussion || t.notes.length === 0) result.set(t.index, null)
  }

  const ranked = [...pitched].sort((a, b) => meanPitch(song, b.index) - meanPitch(song, a.index))
  const voices = set.voices
  ranked.forEach((track, rank) => {
    if (ranked.length === 1) {
      result.set(track.index, voices[0])
    } else if (rank === ranked.length - 1) {
      result.set(track.index, voices[voices.length - 1])
    } else {
      result.set(track.index, voices[Math.min(rank, voices.length - 2)])
    }
  })
  return result
}
