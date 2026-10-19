import type { Key, Song } from './types.ts'

// Krumhansl-Kessler key profiles.
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

function correlation(a: number[], b: number[]): number {
  const n = a.length
  const meanA = a.reduce((s, v) => s + v, 0) / n
  const meanB = b.reduce((s, v) => s + v, 0) / n
  let num = 0
  let da = 0
  let db = 0
  for (let i = 0; i < n; i++) {
    const x = a[i] - meanA
    const y = b[i] - meanB
    num += x * y
    da += x * x
    db += y * y
  }
  const den = Math.sqrt(da * db)
  return den === 0 ? 0 : num / den
}

/** Duration-weighted pitch class histogram of all pitched tracks. */
export function pitchClassHistogram(song: Song): number[] {
  const hist = new Array<number>(12).fill(0)
  for (const track of song.tracks) {
    if (track.isPercussion) continue
    for (const n of track.notes) {
      hist[((n.midi % 12) + 12) % 12] += Math.max(n.duration, 0.05)
    }
  }
  return hist
}

export function detectKey(song: Song): Key {
  const hist = pitchClassHistogram(song)
  if (hist.every((v) => v === 0)) return { tonic: 0, mode: 'major' }

  let best: Key = { tonic: 0, mode: 'major' }
  let bestScore = -Infinity
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const mode of ['major', 'minor'] as const) {
      const profile = mode === 'major' ? MAJOR_PROFILE : MINOR_PROFILE
      const rotated = hist.map((_, pc) => profile[(pc - tonic + 12) % 12])
      const score = correlation(hist, rotated)
      if (score > bestScore) {
        bestScore = score
        best = { tonic, mode }
      }
    }
  }
  return best
}

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

export function keyName(key: Key): string {
  return `${NAMES[key.tonic]} ${key.mode}`
}
