/**
 * Note sets: target scales that every note of a song gets remapped into.
 * `intervals` are semitones above the tonic, ascending, starting at 0.
 * `null` means "leave the notes alone".
 */
export interface NoteSet {
  id: string
  name: string
  group: 'Original' | 'Fantasy' | 'Celtic' | 'Asian' | 'Dark'
  description: string
  intervals: number[] | null
}

export const NOTE_SETS: NoteSet[] = [
  {
    id: 'original',
    name: 'Original',
    group: 'Original',
    description: 'Notes as written.',
    intervals: null,
  },

  // Fantasy / medieval
  {
    id: 'dorian',
    name: 'Dorian',
    group: 'Fantasy',
    description: 'Minor with a bright sixth. The classic tavern-and-road sound.',
    intervals: [0, 2, 3, 5, 7, 9, 10],
  },
  {
    id: 'lydian',
    name: 'Lydian',
    group: 'Fantasy',
    description: 'Major with a raised fourth. Wonder, elves, hidden groves.',
    intervals: [0, 2, 4, 6, 7, 9, 11],
  },
  {
    id: 'mixolydian',
    name: 'Mixolydian',
    group: 'Fantasy',
    description: 'Major with a flat seventh. Open, adventurous.',
    intervals: [0, 2, 4, 5, 7, 9, 10],
  },
  {
    id: 'natural-minor',
    name: 'Natural minor',
    group: 'Fantasy',
    description: 'Plain minor. Somber and heroic.',
    intervals: [0, 2, 3, 5, 7, 8, 10],
  },
  {
    id: 'harmonic-minor',
    name: 'Harmonic minor',
    group: 'Fantasy',
    description: 'Minor with a raised seventh. Courts, intrigue, vampires.',
    intervals: [0, 2, 3, 5, 7, 8, 11],
  },

  // Celtic
  {
    id: 'celtic-pentatonic',
    name: 'Celtic pentatonic',
    group: 'Celtic',
    description: 'Major pentatonic. Hills, pipes and open skies.',
    intervals: [0, 2, 4, 7, 9],
  },
  {
    id: 'minor-pentatonic',
    name: 'Minor pentatonic',
    group: 'Celtic',
    description: 'Five notes, no half steps. Wistful and wide.',
    intervals: [0, 3, 5, 7, 10],
  },

  // Asian
  {
    id: 'hirajoshi',
    name: 'Hirajoshi',
    group: 'Asian',
    description: 'Japanese five-note scale. Calm with a shadow in it.',
    intervals: [0, 2, 3, 7, 8],
  },
  {
    id: 'in-sen',
    name: 'In (Miyako-bushi)',
    group: 'Asian',
    description: 'Japanese scale with half steps. Tense, ritual, night.',
    intervals: [0, 1, 5, 7, 8],
  },
  {
    id: 'yo',
    name: 'Yo',
    group: 'Asian',
    description: 'Japanese folk scale. Open and bright.',
    intervals: [0, 2, 5, 7, 9],
  },

  // Dark
  {
    id: 'phrygian',
    name: 'Phrygian',
    group: 'Dark',
    description: 'Minor with a flat second. Dungeons and desert ruins.',
    intervals: [0, 1, 3, 5, 7, 8, 10],
  },
  {
    id: 'double-harmonic',
    name: 'Double harmonic',
    group: 'Dark',
    description: 'Two augmented seconds. Bazaars, cults, strange magic.',
    intervals: [0, 1, 4, 5, 7, 8, 11],
  },
  {
    id: 'whole-tone',
    name: 'Whole tone',
    group: 'Dark',
    description: 'No resolution anywhere. Dreams, portals, the Feywild.',
    intervals: [0, 2, 4, 6, 8, 10],
  },
]

export const NOTE_SET_GROUPS = ['Original', 'Fantasy', 'Celtic', 'Asian', 'Dark'] as const

export function getNoteSet(id: string): NoteSet {
  return NOTE_SETS.find((s) => s.id === id) ?? NOTE_SETS[0]
}
