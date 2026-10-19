/**
 * Our own sampler voice. Samples are the FluidR3 General MIDI soundfonts
 * (MIDI.js format, as hosted by gleitz/midi-js-soundfonts); what we add is the
 * expressive part a bare sampler lacks:
 *  - a real attack, shaped per instrument family (bowed strings swell,
 *    plucked strings snap),
 *  - tone that follows velocity (soft notes are darker), and opens up during
 *    the attack on bowed, blown and sung notes,
 *  - a few cents of natural pitch drift and delayed vibrato on long notes,
 *  - a curved (exponential) release that varies note to note, longer at the
 *    ends of phrases,
 *  - looping of sustained samples so long notes hold.
 */

export type Family = 'bowed' | 'wind' | 'reed' | 'brass' | 'voice' | 'organ' | 'pluck' | 'struck' | 'perc'

const FAMILIES: Record<string, Family> = {
  violin: 'bowed',
  fiddle: 'bowed',
  viola: 'bowed',
  cello: 'bowed',
  contrabass: 'bowed',
  string_ensemble_1: 'bowed',
  recorder: 'wind',
  flute: 'wind',
  whistle: 'wind',
  pan_flute: 'wind',
  ocarina: 'wind',
  shakuhachi: 'wind',
  piccolo: 'wind',
  oboe: 'reed',
  english_horn: 'reed',
  bassoon: 'reed',
  clarinet: 'reed',
  shanai: 'reed',
  bagpipe: 'reed',
  harmonica: 'reed',
  accordion: 'reed',
  french_horn: 'brass',
  trumpet: 'brass',
  trombone: 'brass',
  tuba: 'brass',
  choir_aahs: 'voice',
  church_organ: 'organ',
  orchestral_harp: 'pluck',
  acoustic_guitar_nylon: 'pluck',
  acoustic_guitar_steel: 'pluck',
  acoustic_bass: 'pluck',
  banjo: 'pluck',
  koto: 'pluck',
  shamisen: 'pluck',
  sitar: 'pluck',
  harpsichord: 'pluck',
  pizzicato_strings: 'pluck',
  dulcimer: 'struck',
  kalimba: 'struck',
  marimba: 'struck',
  xylophone: 'struck',
  vibraphone: 'struck',
  celesta: 'struck',
  music_box: 'struck',
  glockenspiel: 'struck',
  tubular_bells: 'struck',
  steel_drums: 'struck',
  tinkle_bell: 'struck',
  acoustic_grand_piano: 'struck',
  agogo: 'perc',
  woodblock: 'perc',
  timpani: 'perc',
  taiko_drum: 'perc',
  melodic_tom: 'perc',
}

export function familyOf(gm: string): Family {
  return FAMILIES[gm] ?? 'struck'
}

interface Shape {
  /** Attack time range, seconds. */
  attack: [number, number]
  /** Release time range (to ~1% level), seconds. */
  release: [number, number]
  /** Vibrato depth in cents for long notes (0 = none). */
  vibrato: number
  /** Low-pass cutoff at full velocity, Hz. */
  bright: number
  /** Level the note settles to after the attack, relative to its peak. */
  sustain: number
  /** Does the sound swell (filter opens during the attack)? */
  bloom: boolean
  /** Should the sample loop to sustain long notes? */
  loop: boolean
}

export const SHAPES: Record<Family, Shape> = {
  bowed: { attack: [0.05, 0.11], release: [0.22, 0.4], vibrato: 11, bright: 5200, sustain: 0.82, bloom: true, loop: true },
  wind: { attack: [0.035, 0.07], release: [0.14, 0.26], vibrato: 8, bright: 7000, sustain: 0.88, bloom: true, loop: true },
  reed: { attack: [0.025, 0.05], release: [0.12, 0.22], vibrato: 7, bright: 6200, sustain: 0.88, bloom: true, loop: true },
  brass: { attack: [0.035, 0.065], release: [0.14, 0.24], vibrato: 5, bright: 4800, sustain: 0.85, bloom: true, loop: true },
  voice: { attack: [0.09, 0.17], release: [0.35, 0.6], vibrato: 13, bright: 5000, sustain: 0.9, bloom: true, loop: true },
  organ: { attack: [0.02, 0.035], release: [0.15, 0.22], vibrato: 0, bright: 8000, sustain: 1, bloom: false, loop: true },
  pluck: { attack: [0.003, 0.008], release: [0.15, 0.35], vibrato: 0, bright: 9000, sustain: 1, bloom: false, loop: false },
  struck: { attack: [0.002, 0.005], release: [0.25, 0.6], vibrato: 0, bright: 11000, sustain: 1, bloom: false, loop: false },
  perc: { attack: [0.001, 0.003], release: [0.1, 0.22], vibrato: 0, bright: 12000, sustain: 1, bloom: false, loop: false },
}

/** Deterministic 0..1 noise from a note's identity, so every listener hears the same thing. */
export function noteNoise(midi: number, time: number, salt: number): number {
  const x = Math.sin(midi * 12.9898 + time * 78.233 + salt * 37.719) * 43758.5453
  return x - Math.floor(x)
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

export interface Sample {
  midi: number
  buffer: AudioBuffer
  loop?: [number, number]
}

export interface LoadedInstrument {
  gm: string
  family: Family
  samples: Sample[] // sorted by midi
}

export interface VoiceNote {
  midi: number
  velocity: number // 0..1
  /** Context time the note starts (may be in the past when joining mid-note). */
  time: number
  duration: number
  /** Seconds since the note's real onset (non-zero when joining mid-note). */
  into: number
  /** Next note in the same part starts this soon after this one ends (for phrase-end releases). */
  restAfter: number
  /** The previous note in this part ended right as this one began (slur). */
  slurred: boolean
  /** Song time of the note, for deterministic variation. */
  songTime: number
}

function nearestSample(samples: Sample[], midi: number): Sample {
  let lo = 0
  let hi = samples.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (samples[mid].midi < midi) lo = mid + 1
    else hi = mid
  }
  const a = samples[lo]
  const b = samples[lo - 1]
  return b && Math.abs(b.midi - midi) < Math.abs(a.midi - midi) ? b : a
}

/** Schedule one note. Returns a function that silences it early. */
export function playVoice(
  ctx: BaseAudioContext,
  instrument: LoadedInstrument,
  note: VoiceNote,
  destination: AudioNode,
): (at: number) => void {
  const shape = SHAPES[instrument.family]
  const sample = nearestSample(instrument.samples, note.midi)
  const r = (salt: number) => noteNoise(note.midi, note.songTime, salt)
  const v = Math.min(1, Math.max(0.05, note.velocity))
  const t = Math.max(note.time, ctx.currentTime)

  // ---- Source: pitch, with a little natural drift ----
  const src = ctx.createBufferSource()
  src.buffer = sample.buffer
  src.playbackRate.value = Math.pow(2, (note.midi - sample.midi) / 12)
  const drift = (r(1) * 2 - 1) * (instrument.family === 'pluck' || instrument.family === 'struck' ? 2 : 4)
  src.detune.value = drift
  if (shape.loop && sample.loop && sample.loop[1] > sample.loop[0] + 0.01) {
    src.loop = true
    src.loopStart = sample.loop[0]
    src.loopEnd = sample.loop[1]
  }

  // ---- Tone: darker when soft, and higher notes slightly darker ----
  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.Q.value = 0.6
  const pitchTilt = Math.pow(0.985, Math.max(0, note.midi - 72))
  const bright = shape.bright * lerp(0.38, 1, Math.pow(v, 0.8)) * pitchTilt * lerp(0.92, 1.08, r(2))

  // ---- Envelope ----
  const amp = ctx.createGain()
  const peak = 0.12 + 0.88 * Math.pow(v, 1.6)
  let attack = lerp(shape.attack[0], shape.attack[1], r(3)) * lerp(1.25, 0.8, v)
  if (note.slurred) attack *= 0.45
  attack = Math.min(attack, Math.max(0.003, note.duration * 0.35))
  const joining = note.into > 0.02
  if (joining) attack = 0.03 // fade in gently when joining mid-note

  amp.gain.setValueAtTime(0, t)
  amp.gain.linearRampToValueAtTime(peak, t + attack)
  if (shape.sustain < 1) {
    amp.gain.setTargetAtTime(peak * shape.sustain, t + attack, 0.18)
  }
  if (shape.bloom && !joining) {
    filter.frequency.setValueAtTime(bright * 0.45, t)
    filter.frequency.setTargetAtTime(bright, t, attack * 0.9 + 0.01)
  } else {
    filter.frequency.setValueAtTime(bright, t)
  }

  // ---- Vibrato on long notes (delayed, eases in) ----
  let lfo: OscillatorNode | null = null
  if (shape.vibrato > 0 && note.duration > 0.5) {
    lfo = ctx.createOscillator()
    lfo.frequency.value = lerp(4.6, 5.8, r(4))
    const depth = ctx.createGain()
    const cents = shape.vibrato * lerp(0.6, 1.1, r(5))
    const onset = t + Math.min(0.35, note.duration * 0.4)
    depth.gain.setValueAtTime(0, t)
    depth.gain.setValueAtTime(0, onset)
    depth.gain.linearRampToValueAtTime(cents, onset + 0.35)
    lfo.connect(depth).connect(src.detune)
    lfo.start(t)
  }

  // ---- Release: exponential, varied, longer at phrase ends ----
  let release = lerp(shape.release[0], shape.release[1], r(6))
  if (note.restAfter > 0.3) release *= 1.8
  const end = Math.max(t + attack, note.time + note.duration)
  const tau = release / 4.6 // ~1% after `release` seconds
  amp.gain.setTargetAtTime(0, end, tau)
  const stopAt = end + release + 0.05

  src.connect(filter).connect(amp).connect(destination)
  const offset = joining ? note.into * src.playbackRate.value : 0
  src.start(t, src.loop ? offset : Math.min(offset, Math.max(0, sample.buffer.duration - 0.1)))
  src.stop(stopAt)
  lfo?.stop(stopAt)
  src.onended = () => {
    src.disconnect()
    amp.disconnect()
    lfo?.disconnect()
  }

  return (at: number) => {
    const when = Math.max(at, ctx.currentTime)
    if (when >= stopAt) return
    amp.gain.cancelScheduledValues(when)
    amp.gain.setTargetAtTime(0, when, 0.03)
    try {
      src.stop(when + 0.15)
      lfo?.stop(when + 0.15)
    } catch {
      /* already stopped */
    }
  }
}

// ---- Loading -----------------------------------------------------------------

const KIT = 'FluidR3_GM'
const NOTE_NAMES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

export function noteNameToMidi(name: string): number | null {
  const m = /^([A-G])(b|#)?(-?\d)$/.exec(name)
  if (!m) return null
  return (Number(m[3]) + 1) * 12 + NOTE_NAMES[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0)
}

/** Parse a MIDI.js soundfont file ("MIDI.Soundfont.x = { "A0": "data:audio/mp3;base64,..." }"). */
export function parseMidiJs(source: string): Record<string, string> {
  const header = source.indexOf('MIDI.Soundfont.')
  if (header < 0) throw new Error('Not a MIDI.js soundfont')
  const start = source.indexOf('{', header)
  const end = source.lastIndexOf('}')
  const body = source.slice(start, end + 1).replace(/,\s*}$/, '}')
  return JSON.parse(body) as Record<string, string>
}

function base64ToBytes(dataUri: string): ArrayBuffer {
  const b64 = dataUri.slice(dataUri.indexOf(',') + 1)
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
}

export function instrumentUrl(gm: string): string {
  return `https://gleitz.github.io/midi-js-soundfonts/${KIT}/${gm}-mp3.js`
}

export function loopUrl(gm: string): string {
  return `https://goldst.dev/midi-js-soundfonts/${KIT}/${gm}-loop.json`
}

export async function loadInstrument(ctx: BaseAudioContext, gm: string): Promise<LoadedInstrument> {
  const family = familyOf(gm)
  const [text, loops] = await Promise.all([
    fetch(instrumentUrl(gm)).then((r) => {
      if (!r.ok) throw new Error(`Instrument ${gm}: ${r.status}`)
      return r.text()
    }),
    SHAPES[family].loop
      ? fetch(loopUrl(gm))
          .then((r) => (r.ok ? (r.json() as Promise<Record<string, [number, number]>>) : null))
          .catch(() => null)
      : Promise.resolve(null),
  ])
  const notes = parseMidiJs(text)
  const samples: Sample[] = []
  await Promise.all(
    Object.entries(notes).map(async ([name, data]) => {
      const midi = noteNameToMidi(name)
      if (midi === null) return
      try {
        const buffer = await ctx.decodeAudioData(base64ToBytes(data))
        const raw = loops?.[name]
        // Loop points are frames of the original 44.1 kHz files (decoding may resample).
        const loop: [number, number] | undefined = raw ? [raw[0] / 44100, raw[1] / 44100] : undefined
        samples.push({ midi, buffer, loop })
      } catch {
        // A note that fails to decode is covered by its neighbours.
      }
    }),
  )
  if (samples.length === 0) throw new Error(`Instrument ${gm}: no playable samples`)
  samples.sort((a, b) => a.midi - b.midi)
  return { gm, family, samples }
}
