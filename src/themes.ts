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
}

export const THEMES: Theme[] = [
  {
    id: 'medieval',
    name: 'Medieval',
    set: 'medieval',
    tagline: 'Candlelit halls and old roads.',
    motif: 'motes',
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
