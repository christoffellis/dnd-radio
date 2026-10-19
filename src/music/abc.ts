import type { NoteEvent, Song } from './types.ts'

/**
 * ABC notation -> Song, for single-voice folk and fiddle tunes.
 *
 * Supports: header fields (X T M L Q K R), key signatures with modes, bar
 * accidentals, note lengths, broken rhythm (> <), chords [CEG], ties, tuplets,
 * rests, repeats with first/second endings, inline [K:] [L:] fields.
 * Skips: decorations, grace notes, annotations and fingerings, lyrics.
 */

/** Short tunes are played through until they last at least this long (max 3 times). */
export const MIN_SECONDS = 40

const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B']
const MAJOR = [0, 2, 4, 5, 7, 9, 11]
const MODES: [RegExp, number][] = [
  [/^(maj|major|ion)/, 0],
  [/^dor/, 1],
  [/^phr/, 2],
  [/^lyd/, 3],
  [/^mix/, 4],
  [/^(m|min|minor|aeo)$|^(min|aeo)/, 5],
  [/^loc/, 6],
]
const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B']
const FIFTHS: Record<string, number> = {
  Cb: -7, Gb: -6, Db: -5, Ab: -4, Eb: -3, Bb: -2, F: -1, C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7,
}

/**
 * Seconds per note when a tune has no Q: field, by tune type. Tempo is set from
 * how many notes the tune packs into its bars, not from how it's written, so a
 * reel notated in 2/4 with sixteenths plays at the same pace as one in 4/4
 * with eighths. These are relaxed, "background at the table" session tempos.
 */
const NOTE_SECONDS: [RegExp, number][] = [
  [/slip ?jig/i, 0.17],
  [/jig/i, 0.17],
  [/reel/i, 0.15],
  [/hornpipe|clog/i, 0.17],
  [/strathspey/i, 0.19],
  [/fling/i, 0.17],
  [/polka/i, 0.17],
  [/march|quickstep/i, 0.2],
  [/waltz/i, 0.3],
  [/air|lament|slow/i, 0.45],
]
const DEFAULT_NOTE_SECONDS = 0.2

export interface AbcKey {
  tonic: number
  /** Pitch classes of the mode, from the tonic. */
  scale: number[]
  /** Key signature: letter -> semitone alteration. */
  signature: Record<string, number>
}

export function parseKey(field: string): AbcKey {
  const text = field.trim()
  const signature: Record<string, number> = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 }
  const m = /^([A-G])([#b]?)\s*([A-Za-z]*)/.exec(text)
  if (!m || /^(none|HP|Hp)/.test(text)) {
    // Highland pipes / none: A mixolydian-ish pipes, written with no signature.
    return { tonic: 9, scale: [0, 2, 4, 5, 7, 9, 10], signature }
  }
  const [, letter, acc, modeText] = m
  const tonic = (LETTER_PC[letter] + (acc === '#' ? 1 : acc === 'b' ? -1 : 0) + 12) % 12
  const modeLower = modeText.toLowerCase()
  let mode = 0
  for (const [re, idx] of MODES) {
    if (modeLower && re.test(modeLower)) {
      mode = idx
      break
    }
  }
  // Relative major: step back `mode` scale degrees.
  const majorLetter = LETTERS[(LETTERS.indexOf(letter) - mode + 7) % 7]
  const majorPc = (tonic - MAJOR[mode] + 12) % 12
  const diff = (((majorPc - LETTER_PC[majorLetter]) % 12) + 18) % 12 - 6
  const name = majorLetter + (diff === 1 ? '#' : diff === -1 ? 'b' : '')
  const fifths = FIFTHS[name] ?? 0
  if (fifths > 0) for (const l of SHARP_ORDER.slice(0, fifths)) signature[l] = 1
  if (fifths < 0) for (const l of [...SHARP_ORDER].reverse().slice(0, -fifths)) signature[l] = -1

  // Explicit accidentals after the mode, e.g. "K:D exp ^c" or "K:Ador ^f".
  for (const a of text.matchAll(/(\^\^|\^|__|_|=)([a-gA-G])/g)) {
    signature[a[2].toUpperCase()] = { '^': 1, '^^': 2, _: -1, __: -2, '=': 0 }[a[1]] ?? 0
  }
  const scale = MAJOR.map((_, i) => (MAJOR[(i + mode) % 7] - MAJOR[mode] + 12) % 12)
  return { tonic, scale, signature }
}

function fraction(s: string | undefined, fallback: number): number {
  if (!s) return fallback
  const m = /(\d+)\s*\/\s*(\d+)/.exec(s)
  if (m) return Number(m[1]) / Number(m[2])
  if (/^\s*C\|/.test(s)) return 1
  if (/^\s*C/.test(s)) return 1
  const n = Number(s)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

interface Item {
  midis: number[] // empty = rest
  len: number // in whole notes
  /** Length as written, before broken rhythm (> <) reshapes it. */
  base?: number
  tie: boolean
  bar?: boolean // marks a bar line
}

/** Split a multi-tune ABC file into tunes, keyed by X: number. */
export function splitTunes(source: string): { x: number; text: string }[] {
  const out: { x: number; text: string }[] = []
  const parts = source.split(/^(?=X:)/m)
  for (const p of parts) {
    const m = /^X:\s*(\d+)/.exec(p)
    if (m) out.push({ x: Number(m[1]), text: p })
  }
  if (out.length === 0 && /^K:/m.test(source)) out.push({ x: 1, text: source })
  return out
}

export function parseAbc(source: string, fallbackName: string, tuneNumber?: number): Song {
  const tunes = splitTunes(source)
  if (tunes.length === 0) throw new Error('No ABC tune found.')
  const tune = (tuneNumber !== undefined && tunes.find((t) => t.x === tuneNumber)) || tunes[0]

  const header: Record<string, string> = {}
  const lines = tune.text.split(/\r?\n/)
  let bodyStart = lines.length
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/%.*$/, '')
    const f = /^([A-Za-z]):(.*)$/.exec(line)
    if (f) {
      if (!(f[1] in header)) header[f[1]] = f[2].trim()
      if (f[1] === 'K') {
        bodyStart = i + 1
        break
      }
    }
  }
  if (!('K' in header)) throw new Error('ABC tune has no K: (key) line.')

  const meter = fraction(header.M, 1)
  let unit = header.L ? fraction(header.L, 1 / 8) : meter < 0.75 ? 1 / 16 : 1 / 8
  let key = parseKey(header.K)
  const startKey = key

  // Tempo: Q:1/4=120, Q:120 (in L units), or a default for the tune type.
  let qpm = 0
  if (header.Q) {
    const q = /(\d+\s*\/\s*\d+)?\s*=\s*(\d+)/.exec(header.Q)
    if (q) qpm = Number(q[2]) * fraction(q[1] ?? '1/4', 1 / 4) * 4
    else if (/^\s*\d+\s*$/.test(header.Q)) qpm = Number(header.Q) * unit * 4
  }
  const kind = `${header.R ?? ''} ${header.T ?? ''}`
  const noteSeconds = NOTE_SECONDS.find(([re]) => re.test(kind))?.[1] ?? DEFAULT_NOTE_SECONDS

  // ---- Tokenise the body into items -----------------------------------------
  const body = lines
    .slice(bodyStart)
    .filter((l) => !/^[A-Za-z]:/.test(l) || /^[KLM]:/.test(l))
    .map((l) => (/^[KLM]:/.test(l) ? `[${l.trim()}]` : l))
    .join('\n')
    .replace(/%.*$/gm, '')

  const items: Item[] = []
  let barAcc: Record<string, number> = {}
  let broken = 1 // multiplier for the next note
  let tuplet: { left: number; factor: number } | null = null
  // Repeats
  const out: Item[] = []
  let sectionStart = 0
  let ending1: number | null = null

  const pushItem = (item: Item) => {
    if (tuplet && item.midis.length >= 0 && !item.bar) {
      item.len *= tuplet.factor
      if (--tuplet.left <= 0) tuplet = null
    }
    item.base = item.len
    if (broken !== 1 && !item.bar) {
      item.len *= broken
      broken = 1
    }
    out.push(item)
  }

  const lastNote = () => {
    for (let k = out.length - 1; k >= 0; k--) if (!out[k].bar) return out[k]
    return undefined
  }

  const readLength = (s: string, i: number): [number, number] => {
    const m = /^(\d*)(\/*)(\d*)/.exec(s.slice(i))!
    const [all, num, slashes, den] = m
    let len = num ? Number(num) : 1
    if (slashes) len /= den ? Number(den) * 2 ** (slashes.length - 1) : 2 ** slashes.length
    return [len, i + all.length]
  }

  const readNote = (s: string, i: number): [number, number] | null => {
    let j = i
    let alter: number | null = null
    const acc = /^(\^\^|\^|__|_|=)/.exec(s.slice(j))
    if (acc) {
      alter = { '^': 1, '^^': 2, _: -1, __: -2, '=': 0 }[acc[1]] ?? 0
      j += acc[1].length
    }
    const ch = s[j]
    if (!ch || !/[A-Ga-g]/.test(ch)) return null
    j++
    const upper = ch.toUpperCase()
    let octave = ch === upper ? 4 : 5
    while (s[j] === "'" || s[j] === ',') {
      octave += s[j] === "'" ? 1 : -1
      j++
    }
    const accKey = `${upper}${octave}`
    if (alter !== null) barAcc[accKey] = alter
    const a = barAcc[accKey] ?? key.signature[upper] ?? 0
    return [(octave + 1) * 12 + LETTER_PC[upper] + a, j]
  }

  const closeRepeat = () => {
    const end = ending1 ?? out.length
    const copy = out.slice(sectionStart, end).map((it) => ({ ...it, midis: [...it.midis] }))
    out.push(...copy)
    ending1 = null
    sectionStart = out.length
  }

  let i = 0
  const s = body
  while (i < s.length) {
    const c = s[i]

    if (c === '"') {
      const end = s.indexOf('"', i + 1)
      i = end < 0 ? s.length : end + 1
    } else if (c === '!' || c === '+') {
      const end = s.indexOf(c, i + 1)
      i = end < 0 || s.slice(i, end).includes('\n') ? i + 1 : end + 1
    } else if (c === '{') {
      const end = s.indexOf('}', i + 1)
      i = end < 0 ? s.length : end + 1
    } else if (/[.~HLMOPSTuvJRy]/.test(c)) {
      i++
    } else if (c === '[' && /^\[[A-Za-z]:/.test(s.slice(i))) {
      const end = s.indexOf(']', i)
      const field = s.slice(i + 1, end < 0 ? s.length : end)
      const name = field[0]
      const value = field.slice(2)
      if (name === 'K') key = parseKey(value)
      if (name === 'L') unit = fraction(value, unit)
      i = end < 0 ? s.length : end + 1
    } else if (c === '[' && /^\[\d/.test(s.slice(i))) {
      // [1 / [2 endings
      if (s[i + 1] === '1') ending1 = out.length
      i += 2
    } else if (c === '|' || c === ':' || (c === '[' && s[i + 1] === '|') || c === ']') {
      const m = /^[|:\][]+/.exec(s.slice(i))!
      const tok = m[0]
      i += tok.length
      const ending = /^\d/.exec(s.slice(i))
      if (tok.includes(':') && /:+[|\]]|::/.test(tok + (s[i] ?? ''))) {
        // :| or :: closes a repeat
        if (/^:/.test(tok) || tok.includes('::')) closeRepeat()
      }
      if (/\|:|::|\[\|/.test(tok) || /:$/.test(tok)) {
        if (/[|:]:$/.test(tok) || tok.endsWith(':')) sectionStart = out.length
      }
      if (ending) {
        if (ending[0] === '1') ending1 = out.length
        i += ending[0].length
      }
      out.push({ midis: [], len: 0, tie: false, bar: true })
      barAcc = {}
    } else if (c === '(' && /^\(\d/.test(s.slice(i))) {
      const m = /^\((\d)(?::(\d)?)?(?::(\d))?/.exec(s.slice(i))!
      const p = Number(m[1])
      const compound = Math.round(meter * 8) % 3 === 0 && meter * 8 >= 6
      const q = m[2] ? Number(m[2]) : p === 2 || p === 4 || p === 8 ? 3 : p === 3 || p === 6 ? 2 : compound ? 3 : 2
      const r = m[3] ? Number(m[3]) : p
      tuplet = { left: r, factor: q / p }
      i += m[0].length
    } else if (c === '(' || c === ')') {
      i++
    } else if (c === '-') {
      const n = lastNote()
      if (n) n.tie = true
      i++
    } else if (c === '>' || c === '<') {
      const m = /^[<>]+/.exec(s.slice(i))![0]
      const k = m.length
      const longer = 2 - 1 / 2 ** k
      const shorter = 1 / 2 ** k
      const prev = lastNote()
      if (prev) prev.len *= c === '>' ? longer : shorter
      broken = c === '>' ? shorter : longer
      i += k
    } else if (c === 'z' || c === 'x') {
      const [len, j] = readLength(s, i + 1)
      pushItem({ midis: [], len: len * unit, tie: false })
      i = j
    } else if (c === 'Z') {
      const [bars, j] = readLength(s, i + 1)
      pushItem({ midis: [], len: bars * meter, tie: false })
      i = j
    } else if (c === '[') {
      // Chord: [CEG]2
      const end = s.indexOf(']', i)
      const inner = s.slice(i + 1, end < 0 ? s.length : end)
      const midis: number[] = []
      let firstLen = 1
      let k = 0
      while (k < inner.length) {
        const note = readNote(inner, k)
        if (!note) {
          k++
          continue
        }
        const [len, next] = readLength(inner, note[1])
        if (midis.length === 0) firstLen = len
        midis.push(note[0])
        k = next
        while (inner[k] === '-') k++
      }
      const [outer, j] = readLength(s, (end < 0 ? s.length : end) + 1)
      if (midis.length) pushItem({ midis, len: firstLen * outer * unit, tie: false })
      i = j
    } else {
      const note = readNote(s, i)
      if (note) {
        const [len, j] = readLength(s, note[1])
        pushItem({ midis: [note[0]], len: len * unit, tie: false })
        i = j
      } else {
        i++
      }
    }
  }
  void sectionStart

  // ---- Items -> timed notes --------------------------------------------------
  // No Q: field? Pace the tune by its running notes: the most common written
  // note length (dotted pairs like B>G count as two eighths).
  if (!qpm) {
    const counts = new Map<number, number>()
    for (const it of out) {
      if (it.bar || it.midis.length === 0) continue
      const key = Math.round((it.base ?? it.len) * 4096) / 4096
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    let running = 1 / 8
    let best = -1
    for (const [len, n] of counts) {
      if (n > best || (n === best && len > running)) {
        best = n
        running = len
      }
    }
    qpm = (240 * running) / noteSeconds
  }
  const secPerWhole = (60 / qpm) * 4
  const notes: NoteEvent[] = []
  const bars: number[] = [0]
  const open = new Map<number, NoteEvent>()
  let t = 0
  for (const it of out) {
    if (it.bar) {
      const at = t * secPerWhole
      if (at - bars[bars.length - 1] > 1e-6) bars.push(at)
      continue
    }
    const start = t * secPerWhole
    const dur = it.len * secPerWhole
    const nextOpen = new Map<number, NoteEvent>()
    for (const midi of it.midis) {
      const prev = open.get(midi)
      if (prev && Math.abs(prev.time + prev.duration - start) < 1e-6) {
        prev.duration += dur
        if (it.tie) nextOpen.set(midi, prev)
      } else {
        const n = { midi, time: start, duration: dur, velocity: 0.72 }
        notes.push(n)
        if (it.tie) nextOpen.set(midi, n)
      }
    }
    open.clear()
    for (const [k, v] of nextOpen) open.set(k, v)
    t += it.len
  }
  void items

  // Bands play a short tune through two or three times; so do we.
  const period = t * secPerWhole
  const once = notes.reduce((m, n) => Math.max(m, n.time + n.duration), 0)
  const passes = once > 0 ? Math.min(3, Math.max(1, Math.ceil(MIN_SECONDS / once))) : 1
  const firstBars = [...bars]
  const firstNotes = [...notes]
  for (let k = 1; k < passes; k++) {
    for (const n of firstNotes) notes.push({ ...n, time: n.time + period * k })
    for (const b of firstBars) bars.push(b + period * k)
  }

  const duration = notes.reduce((m, n) => Math.max(m, n.time + n.duration), 0)
  const title = (header.T ?? fallbackName).replace(/\s*--\s*/g, ' – ').trim()
  return {
    name: title,
    duration,
    tracks: [{ index: 0, name: 'Melody', channel: 0, isPercussion: false, program: 40, notes }],
    bars: bars
      .sort((a, b) => a - b)
      .filter((b, i, all) => b < duration - 1e-6 && (i === 0 || b - all[i - 1] > 1e-6)),
    keyHint: { tonic: startKey.tonic, scale: startKey.scale },
  }
}
