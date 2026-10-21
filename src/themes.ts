/**
 * A theme is the station's mood: which instrument set plays, the colours of
 * the page, and the animation that reacts to the music.
 */

export type Motif = 'motes' | 'embers' | 'leaves' | 'petals' | 'bubbles' | 'fog' | 'sparkles' | 'skitter' | 'sand'

export interface ThemeColors {
  bg: string
  surface: string
  ink: string
  muted: string
  line: string
  accent: string
  accent2: string
}

export interface Theme {
  id: string
  name: string
  /** Instrument set id (src/music/instruments.ts). */
  set: string
  tagline: string
  motif: Motif
  colors: ThemeColors
  /** Scale songs are remapped into by default (src/music/noteSets.ts). */
  scale?: string
  /** Playback speed of the whole station. */
  tempo?: number
  /** The space the music plays in: reverb length (s) and wet level. */
  room: { seconds: number; wet: number }
  /** Heading in the genre list. */
  group?: 'Modern'
}

export const THEMES: Theme[] = [
  {
    id: 'medieval',
    name: 'Medieval',
    set: 'medieval',
    tagline: 'Candlelit halls and old roads.',
    motif: 'motes',
    room: { seconds: 2.2, wet: 0.24 },
    colors: {
      bg: '#14110d',
      surface: '#1d1813',
      ink: '#ece0c6',
      muted: '#9a8c72',
      line: '#3a3026',
      accent: '#c9a25e',
      accent2: '#a3433a',
    },
  },
  {
    id: 'tavern',
    name: 'Tavern',
    set: 'tavern',
    tagline: 'Hearth smoke, spilled ale, a fiddler who won’t stop.',
    motif: 'embers',
    room: { seconds: 1.1, wet: 0.16 },
    colors: {
      bg: '#1a110a',
      surface: '#241810',
      ink: '#f1e2c8',
      muted: '#a8916f',
      line: '#43301f',
      accent: '#e39a3b',
      accent2: '#c0582b',
    },
  },
  {
    id: 'celtic',
    name: 'Celtic',
    set: 'celtic',
    tagline: 'Mist, moss and far green hills.',
    motif: 'leaves',
    room: { seconds: 1.7, wet: 0.2 },
    colors: {
      bg: '#0e1511',
      surface: '#15201a',
      ink: '#e3eadb',
      muted: '#8fa290',
      line: '#2a3a30',
      accent: '#86b97e',
      accent2: '#d2b55b',
    },
  },
  {
    id: 'asian',
    name: 'East Asian',
    set: 'asian',
    tagline: 'Lanterns, cedar and quiet courtyards.',
    motif: 'petals',
    scale: 'yo',
    room: { seconds: 2.0, wet: 0.24 },
    colors: {
      bg: '#141212',
      surface: '#1d1a19',
      ink: '#f0e6da',
      muted: '#a39a8f',
      line: '#3a3330',
      accent: '#d9503f',
      accent2: '#e8b4b8',
    },
  },
  {
    id: 'tropical',
    name: 'Tropical',
    set: 'tropical',
    tagline: 'Harbour heat, jungle drums and spice.',
    motif: 'bubbles',
    room: { seconds: 0.9, wet: 0.14 },
    colors: {
      bg: '#08191b',
      surface: '#0f2427',
      ink: '#e6f4ef',
      muted: '#86a8a3',
      line: '#1f3e41',
      accent: '#34c3b0',
      accent2: '#ff8f5e',
    },
  },
  {
    id: 'dungeon',
    name: 'Dungeon',
    set: 'dungeon',
    tagline: 'Torchlight, damp stone, something breathing.',
    motif: 'fog',
    scale: 'harmonic-minor',
    room: { seconds: 3.8, wet: 0.34 },
    colors: {
      bg: '#0b0a0f',
      surface: '#131119',
      ink: '#ddd8e8',
      muted: '#8a8399',
      line: '#27232f',
      accent: '#8f7fd1',
      accent2: '#5d8a6e',
    },
  },
  {
    id: 'court',
    name: 'Royal court',
    set: 'court',
    tagline: 'Banners, marble and polite knives.',
    motif: 'sparkles',
    room: { seconds: 2.6, wet: 0.26 },
    colors: {
      bg: '#0f0f1a',
      surface: '#171726',
      ink: '#efe9da',
      muted: '#9d97a8',
      line: '#2d2c42',
      accent: '#d8b45a',
      accent2: '#b0324a',
    },
  },
  {
    id: 'egyptian',
    name: 'Egyptian',
    set: 'egyptian',
    tagline: 'Sandstone, torchlit tombs and a long, slow river.',
    motif: 'sand',
    scale: 'hijaz',
    room: { seconds: 3.0, wet: 0.3 },
    colors: {
      bg: '#0d1120',
      surface: '#151a2d',
      ink: '#f3e7c8',
      muted: '#a79d82',
      line: '#2b3251',
      accent: '#e2b24c',
      accent2: '#3fa7a0',
    },
  },
  {
    id: 'kobold',
    name: 'Kobold',
    set: 'kobold',
    tagline: 'Scurrying feet, stolen pots, a very small tuba.',
    motif: 'skitter',
    scale: 'harmonic-minor',
    tempo: 1.3,
    room: { seconds: 0.7, wet: 0.12 },
    colors: {
      bg: '#11130b',
      surface: '#1a1d10',
      ink: '#eef0d2',
      muted: '#9da078',
      line: '#34381f',
      accent: '#c6e04a',
      accent2: '#ff9f1c',
    },
  },
  // Modern hits, played by medieval minstrels.
  {
    id: 'modern-pop',
    name: 'Modern – Pop',
    group: 'Modern',
    set: 'minstrels',
    tagline: 'Chart hits, as the castle minstrels play them.',
    motif: 'sparkles',
    room: { seconds: 1.8, wet: 0.22 },
    colors: {
      bg: '#141019',
      surface: '#1d1724',
      ink: '#f2e6ee',
      muted: '#a493a3',
      line: '#3a2d3d',
      accent: '#e7a6c4',
      accent2: '#d8b45a',
    },
  },
  {
    id: 'modern-rock',
    name: 'Modern – Rock',
    group: 'Modern',
    set: 'minstrels',
    tagline: 'Power chords on a lute. The hall shakes anyway.',
    motif: 'embers',
    room: { seconds: 1.4, wet: 0.18 },
    colors: {
      bg: '#160f0d',
      surface: '#211613',
      ink: '#f1e3d6',
      muted: '#a8907f',
      line: '#3f2a23',
      accent: '#d9603b',
      accent2: '#e3b04b',
    },
  },
  {
    id: 'modern-punk',
    name: 'Modern – Punk',
    group: 'Modern',
    set: 'minstrels',
    tagline: 'Three chords, a recorder and no respect for the king.',
    motif: 'skitter',
    room: { seconds: 0.9, wet: 0.14 },
    colors: {
      bg: '#10120f',
      surface: '#191c17',
      ink: '#eef2e4',
      muted: '#9aa293',
      line: '#30362b',
      accent: '#ff4f7b',
      accent2: '#c6e04a',
    },
  },
  {
    id: 'modern-electronic',
    name: 'Modern – Electronic',
    group: 'Modern',
    set: 'minstrels',
    tagline: 'Arcane synthesis: the wizard’s tower has a drop.',
    motif: 'bubbles',
    room: { seconds: 2.4, wet: 0.28 },
    colors: {
      bg: '#0b0e1a',
      surface: '#121729',
      ink: '#e6ecff',
      muted: '#8e98b8',
      line: '#252c48',
      accent: '#6fd3ff',
      accent2: '#b07cff',
    },
  },
  {
    id: 'modern-hiphop',
    name: 'Modern – Hip-Hop',
    group: 'Modern',
    set: 'minstrels',
    tagline: 'The bard drops a verse. The innkeeper nods along.',
    motif: 'embers',
    room: { seconds: 1.0, wet: 0.14 },
    colors: {
      bg: '#0f0d10',
      surface: '#19151b',
      ink: '#f0e8f0',
      muted: '#a497a6',
      line: '#352b38',
      accent: '#f2c14e',
      accent2: '#9b5de5',
    },
  },
  {
    id: 'modern-film',
    name: 'Modern – Film & TV',
    group: 'Modern',
    set: 'minstrels',
    tagline: 'Epic themes for when the dice decide everything.',
    motif: 'motes',
    room: { seconds: 3.0, wet: 0.3 },
    colors: {
      bg: '#0c0f14',
      surface: '#141922',
      ink: '#ece6da',
      muted: '#9a9588',
      line: '#2a303c',
      accent: '#c9a25e',
      accent2: '#4f7cac',
    },
  },
  {
    id: 'modern-games',
    name: 'Modern – Games',
    group: 'Modern',
    set: 'minstrels',
    tagline: 'Fairy fountains, hidden shops and a very old ocarina.',
    motif: 'leaves',
    room: { seconds: 2.2, wet: 0.24 },
    colors: {
      bg: '#0d1410',
      surface: '#141e18',
      ink: '#e6f0df',
      muted: '#93a58e',
      line: '#28372c',
      accent: '#7ccf6a',
      accent2: '#e5c45a',
    },
  },
  {
    id: 'modern-piano',
    name: 'Modern – Piano & Classical',
    group: 'Modern',
    set: 'minstrels',
    tagline: 'Quiet pieces for a long rest by the fire.',
    motif: 'petals',
    room: { seconds: 2.6, wet: 0.28 },
    colors: {
      bg: '#121114',
      surface: '#1b1a1e',
      ink: '#eeebf2',
      muted: '#9f9aa6',
      line: '#312e36',
      accent: '#c9b8e8',
      accent2: '#e8c4a0',
    },
  },
]

export function getTheme(id: string): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]
}

/** Apply a theme's colours as CSS variables on the page. */
export function applyThemeColors(theme: Theme): void {
  const root = document.documentElement
  for (const [name, value] of Object.entries(theme.colors)) {
    root.style.setProperty(`--${name}`, value)
  }
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.colors.bg)
}
