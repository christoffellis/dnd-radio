import type { Song, TrackData } from './types.ts'

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
  { gm: 'whistle', name: 'Whistle' },
  { gm: 'pan_flute', name: 'Pan flute' },
  { gm: 'ocarina', name: 'Ocarina' },
  { gm: 'oboe', name: 'Oboe' },
  { gm: 'clarinet', name: 'Clarinet' },
  { gm: 'piccolo', name: 'Piccolo' },
  { gm: 'harmonica', name: 'Harmonica' },
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
  { gm: 'acoustic_bass', name: 'Upright bass' },
  { gm: 'string_ensemble_1', name: 'String ensemble' },
  { gm: 'pizzicato_strings', name: 'Plucked strings' },
  { gm: 'accordion', name: 'Accordion' },
  { gm: 'church_organ', name: 'Church organ' },
  { gm: 'choir_aahs', name: 'Choir' },
  { gm: 'french_horn', name: 'French horn' },
  { gm: 'trumpet', name: 'Trumpet' },
  { gm: 'trombone', name: 'Trombone' },
  { gm: 'tuba', name: 'Tuba' },
  { gm: 'tubular_bells', name: 'Tubular bells' },
  { gm: 'celesta', name: 'Celesta' },
  { gm: 'music_box', name: 'Music box' },
  { gm: 'glockenspiel', name: 'Glockenspiel' },
  { gm: 'marimba', name: 'Marimba' },
  { gm: 'xylophone', name: 'Xylophone' },
  { gm: 'vibraphone', name: 'Vibraphone' },
  { gm: 'steel_drums', name: 'Steel drums' },
  { gm: 'agogo', name: 'Agogo' },
  { gm: 'timpani', name: 'Timpani' },
  { gm: 'taiko_drum', name: 'Taiko' },
  { gm: 'melodic_tom', name: 'Tom drum' },
  { gm: 'woodblock', name: 'Woodblock' },
  { gm: 'tinkle_bell', name: 'Tinkle bell' },
  { gm: 'acoustic_grand_piano', name: 'Piano' },
]

export const FALLBACK_GM = 'acoustic_grand_piano'

export function instrumentName(gm: string): string {
  return INSTRUMENTS.find((i) => i.gm === gm)?.name ?? gm
}

/**
 * What a voice does in the arrangement. Tracks are matched to voices by role:
 * the top line gets a lead, the lowest line a bass, sustained or ensemble
 * parts (choir, strings, organ, pads) a pad, bells and mallets an accent, and
 * everything else harmony.
 */
export type Role = 'lead' | 'harmony' | 'pad' | 'accent' | 'bass'

export interface Voice {
  gm: string
  role: Role
}

export interface InstrumentSet {
  id: string
  name: string
  description: string
  voices: Voice[]
  /** Drum tracks are mapped onto this instrument (kick, toms and snare only). */
  percussion: string
}

const v = (gm: string, role: Role): Voice => ({ gm, role })

export const INSTRUMENT_SETS: InstrumentSet[] = [
  {
    id: 'medieval',
    name: 'Medieval fantasy',
    description: 'Recorder, harp and lute over low strings, with choir and timpani.',
    voices: [
      v('recorder', 'lead'),
      v('oboe', 'lead'),
      v('orchestral_harp', 'harmony'),
      v('acoustic_guitar_nylon', 'harmony'),
      v('harpsichord', 'harmony'),
      v('string_ensemble_1', 'pad'),
      v('choir_aahs', 'pad'),
      v('celesta', 'accent'),
      v('cello', 'bass'),
      v('contrabass', 'bass'),
    ],
    percussion: 'timpani',
  },
  {
    id: 'tavern',
    name: 'Tavern',
    description: 'Fiddle, accordion and banjo with a thumping bass.',
    voices: [
      v('fiddle', 'lead'),
      v('flute', 'lead'),
      v('banjo', 'harmony'),
      v('acoustic_guitar_steel', 'harmony'),
      v('dulcimer', 'harmony'),
      v('accordion', 'pad'),
      v('church_organ', 'pad'),
      v('trumpet', 'accent'),
      v('contrabass', 'bass'),
      v('tuba', 'bass'),
    ],
    percussion: 'melodic_tom',
  },
  {
    id: 'celtic',
    name: 'Celtic',
    description: 'Whistle, fiddle and harp, with pipes droning underneath.',
    voices: [
      v('flute', 'lead'),
      v('fiddle', 'lead'),
      v('orchestral_harp', 'harmony'),
      v('acoustic_guitar_steel', 'harmony'),
      v('dulcimer', 'harmony'),
      v('bagpipe', 'pad'),
      v('string_ensemble_1', 'pad'),
      v('glockenspiel', 'accent'),
      v('cello', 'bass'),
      v('contrabass', 'bass'),
    ],
    percussion: 'melodic_tom',
  },
  {
    id: 'asian',
    name: 'East Asian',
    description: 'Shakuhachi, koto and shamisen with taiko.',
    voices: [
      v('shakuhachi', 'lead'),
      v('pan_flute', 'lead'),
      v('koto', 'harmony'),
      v('shamisen', 'harmony'),
      v('orchestral_harp', 'harmony'),
      v('string_ensemble_1', 'pad'),
      v('choir_aahs', 'pad'),
      v('music_box', 'accent'),
      v('cello', 'bass'),
      v('contrabass', 'bass'),
    ],
    percussion: 'taiko_drum',
  },
  {
    id: 'tropical',
    name: 'Tropical',
    description: 'Tropical harbour: pan flute, marimba, steel drums and kalimba.',
    voices: [
      v('pan_flute', 'lead'),
      v('recorder', 'lead'),
      v('marimba', 'harmony'),
      v('acoustic_guitar_nylon', 'harmony'),
      v('kalimba', 'harmony'),
      v('accordion', 'pad'),
      v('choir_aahs', 'pad'),
      v('steel_drums', 'accent'),
      v('agogo', 'accent'),
      v('acoustic_bass', 'bass'),
      v('contrabass', 'bass'),
    ],
    percussion: 'melodic_tom',
  },
  {
    id: 'dungeon',
    name: 'Dungeon',
    description: 'English horn, choir and bells over a deep bass.',
    voices: [
      v('english_horn', 'lead'),
      v('bassoon', 'lead'),
      v('harpsichord', 'harmony'),
      v('tubular_bells', 'harmony'),
      v('celesta', 'harmony'),
      v('choir_aahs', 'pad'),
      v('church_organ', 'pad'),
      v('music_box', 'accent'),
      v('contrabass', 'bass'),
      v('tuba', 'bass'),
    ],
    percussion: 'timpani',
  },
  {
    id: 'court',
    name: 'Royal court',
    description: 'Oboe, harpsichord and strings with horns.',
    voices: [
      v('oboe', 'lead'),
      v('trumpet', 'lead'),
      v('harpsichord', 'harmony'),
      v('orchestral_harp', 'harmony'),
      v('violin', 'harmony'),
      v('string_ensemble_1', 'pad'),
      v('church_organ', 'pad'),
      v('french_horn', 'accent'),
      v('cello', 'bass'),
      v('contrabass', 'bass'),
    ],
    percussion: 'timpani',
  },
  {
    id: 'kobold',
    name: 'Kobold',
    description: 'A frantic polka band: clarinet, accordion, xylophone and a very small tuba.',
    voices: [
      v('clarinet', 'lead'),
      v('piccolo', 'lead'),
      v('accordion', 'harmony'),
      v('banjo', 'harmony'),
      v('pizzicato_strings', 'harmony'),
      v('harmonica', 'pad'),
      v('bassoon', 'pad'),
      v('xylophone', 'accent'),
      v('tinkle_bell', 'accent'),
      v('tuba', 'bass'),
      v('contrabass', 'bass'),
    ],
    percussion: 'woodblock',
  },
]

export function getInstrumentSet(id: string): InstrumentSet {
  return INSTRUMENT_SETS.find((s) => s.id === id) ?? INSTRUMENT_SETS[0]
}

function meanPitch(track: TrackData): number {
  if (track.notes.length === 0) return 0
  return track.notes.reduce((s, n) => s + n.midi, 0) / track.notes.length
}

/** General MIDI programs that behave like sustained pads / ensembles. */
function isPadProgram(program: number | undefined): boolean {
  if (program === undefined) return false
  return (
    (program >= 16 && program <= 20) || // organs, accordion-ish
    (program >= 48 && program <= 55) || // string ensembles, choir, voice
    (program >= 88 && program <= 95) // synth pads
  )
}

function isAccentProgram(program: number | undefined): boolean {
  if (program === undefined) return false
  return program >= 8 && program <= 15 // chromatic percussion: bells, mallets
}

// When a role has no free voice left, borrow from these, in order.
const FALLBACK: Record<Role, Role[]> = {
  lead: ['lead', 'accent', 'harmony', 'pad'],
  harmony: ['harmony', 'accent', 'pad', 'lead'],
  pad: ['pad', 'harmony', 'accent', 'lead'],
  accent: ['accent', 'harmony', 'pad', 'lead'],
  bass: ['bass', 'harmony'],
}

/**
 * Pick an instrument (gm name) for every track from a set.
 *
 * Roles come from register (top line = lead, bottom = bass), split lanes
 * (melody / harmony / bass), and each track's original General MIDI program
 * (choir and strings become pads, bells and mallets become accents). Voices
 * are not reused until every voice in the set has been taken. Drum tracks go
 * to the set's percussion instrument.
 */
export function assignVoices(song: Song, set: InstrumentSet): Map<number, string | null> {
  const result = new Map<number, string | null>()
  const pitched: TrackData[] = []

  for (const t of song.tracks) {
    if (t.notes.length === 0) result.set(t.index, null)
    else if (t.isPercussion) result.set(t.index, set.percussion)
    else pitched.push(t)
  }

  const ranked = [...pitched].sort((a, b) => meanPitch(b) - meanPitch(a))
  const roles = new Map<number, Role>()
  ranked.forEach((track, rank) => {
    let role: Role
    if (track.lane === 'melody') role = 'lead'
    else if (track.lane === 'bass') role = 'bass'
    else if (track.lane === 'harmony') role = 'harmony'
    else if (ranked.length === 1 || rank === 0) role = 'lead'
    else if (rank === ranked.length - 1) role = 'bass'
    else if (isPadProgram(track.program)) role = 'pad'
    else if (isAccentProgram(track.program)) role = 'accent'
    else role = 'harmony'
    roles.set(track.index, role)
  })

  // Leads and basses choose first so they always get their own kind of voice.
  const order: Role[] = ['lead', 'bass', 'pad', 'accent', 'harmony']
  const used = new Set<string>()
  const reuse = new Map<Role, number>()

  for (const role of order) {
    for (const track of ranked) {
      if (roles.get(track.index) !== role) continue

      let chosen: Voice | undefined
      for (const r of FALLBACK[role]) {
        chosen = set.voices.find((voice) => voice.role === r && !used.has(voice.gm))
        if (chosen) break
      }
      if (!chosen) {
        // Everything is taken: cycle through this role's voices.
        const own = set.voices.filter((voice) => voice.role === role)
        const pool = own.length > 0 ? own : set.voices
        const n = reuse.get(role) ?? 0
        reuse.set(role, n + 1)
        chosen = pool[n % pool.length]
      }
      used.add(chosen.gm)
      result.set(track.index, chosen.gm)
    }
  }
  return result
}
