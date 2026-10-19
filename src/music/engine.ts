import { FALLBACK_GM } from './instruments.ts'
import type { NoteEvent } from './types.ts'
import { loadInstrument, playVoice, type LoadedInstrument } from './voice.ts'

export interface PlayTrack {
  gm: string
  notes: NoteEvent[]
}

export interface PlayOptions {
  /** Playback speed multiplier (stations may run faster, e.g. Kobold). */
  tempo: number
  /**
   * Song position (seconds) to start from. Either a number, or a function
   * that gets the performance.now() time at which the first scheduled sound
   * will actually reach the listener's ears, and returns the song position
   * that should be heard at that moment. Negative values start in the future.
   */
  from: number | ((heardAtPerfMs: number) => number)
  /** Keep whatever is already playing instead of silencing it first. */
  layer?: boolean
}

export interface Room {
  /** Reverb tail length, seconds. */
  seconds: number
  /** Wet level, 0..1. */
  wet: number
}

/** Lead time between deciding to start and the first note, seconds. */
const LEAD = 0.15
/** Notes are turned into audio nodes only this far ahead, seconds. */
const LOOKAHEAD = 2
const PUMP_MS = 200

interface Pending {
  inst: LoadedInstrument
  gm: string
  /** Context time the note starts. */
  at: number
  note: NoteEvent
  into: number
  duration: number
  restAfter: number
  slurred: boolean
}

interface Session {
  pending: Pending[]
  cursor: number
}

/** Optional test hook: called for every note scheduled. */
type Probe = (e: { gm: string; midi: number; heardAtPerf: number }) => void

/**
 * Plays songs on the Web Audio clock with our own sampler voices (see
 * voice.ts), through a small room reverb. Notes are scheduled just in time
 * (a couple of seconds ahead), which keeps long pieces light.
 */
export class Player {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private bus: GainNode | null = null
  private wet: GainNode | null = null
  private convolver: ConvolverNode | null = null
  private cache = new Map<string, Promise<LoadedInstrument>>()
  private sessions: Session[] = []
  private voices: { stop: (at: number) => void; until: number }[] = []
  private pump: number | null = null
  private playing = false
  private startedAt = 0
  private fromSec = 0
  private tempo = 1
  private token = 0
  private volume = 90 // 0..127
  private room: Room = { seconds: 1.8, wet: 0.22 }

  /** Called when an instrument could not be loaded and a fallback was used. */
  onWarn: (message: string) => void = () => {}

  get isPlaying(): boolean {
    return this.playing
  }

  /** Song position of the most recent play() at this moment, seconds. */
  position(): number {
    if (!this.playing || !this.ctx) return this.fromSec
    return this.fromSec + (this.ctx.currentTime - this.startedAt) * this.tempo
  }

  seek(seconds: number): void {
    this.fromSec = Math.max(0, seconds)
  }

  setVolume(volume: number): void {
    this.volume = volume
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.gainFor(volume), this.ctx.currentTime, 0.05)
    }
  }

  private gainFor(volume: number): number {
    return Math.pow(volume / 127, 2) * 1.4
  }

  /** Size of the room the music plays in. */
  setRoom(room: Room): void {
    const changed = room.seconds !== this.room.seconds
    this.room = room
    if (!this.ctx || !this.wet) return
    this.wet.gain.setTargetAtTime(room.wet, this.ctx.currentTime, 0.2)
    if (changed && this.convolver) this.convolver.buffer = this.impulse(room.seconds)
  }

  /** Total output latency of the audio device, seconds. */
  latency(): number {
    const ctx = this.ctx
    if (!ctx) return 0
    return (ctx.outputLatency || 0) + (ctx.baseLatency || 0)
  }

  /**
   * performance.now() time at which audio scheduled for context time `t`
   * reaches the speakers. getOutputTimestamp() pairs the two clocks exactly
   * (and includes output latency); reading currentTime and performance.now()
   * side by side can be off by a whole audio buffer.
   */
  heardAt(t: number): number {
    const ctx = this.ensureContext()
    const ts = ctx.getOutputTimestamp?.()
    if (ts && ts.performanceTime && ts.contextTime !== undefined && ts.performanceTime > 0) {
      return ts.performanceTime + (t - ts.contextTime) * 1000
    }
    return performance.now() + (t - ctx.currentTime + this.latency()) * 1000
  }

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      const ctx = new AudioContext({ latencyHint: 'playback' })
      this.ctx = ctx
      // instruments -> bus -> (dry + room) -> master -> gentle compressor -> out
      this.bus = ctx.createGain()
      this.master = ctx.createGain()
      this.master.gain.value = this.gainFor(this.volume)
      this.convolver = ctx.createConvolver()
      this.convolver.buffer = this.impulse(this.room.seconds)
      this.wet = ctx.createGain()
      this.wet.gain.value = this.room.wet
      const compressor = ctx.createDynamicsCompressor()
      compressor.threshold.value = -14
      compressor.knee.value = 12
      compressor.ratio.value = 3
      compressor.attack.value = 0.01
      compressor.release.value = 0.25
      this.bus.connect(this.master)
      this.bus.connect(this.convolver).connect(this.wet).connect(this.master)
      this.master.connect(compressor).connect(ctx.destination)
    }
    return this.ctx
  }

  /** A synthetic room: decaying stereo noise, darker towards the tail. */
  private impulse(seconds: number): AudioBuffer {
    const ctx = this.ctx!
    const rate = ctx.sampleRate
    const length = Math.max(1, Math.floor(rate * seconds))
    const buffer = ctx.createBuffer(2, length, rate)
    let seed = 1234567
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch)
      let lp = 0
      for (let i = 0; i < length; i++) {
        const k = i / length
        const noise = rand() * 2 - 1
        const smooth = 0.2 + 0.75 * k // the tail loses its highs
        lp = lp + (noise - lp) * (1 - smooth)
        data[i] = lp * Math.pow(1 - k, 3) * (i < rate * 0.008 ? i / (rate * 0.008) : 1)
      }
    }
    return buffer
  }

  private loadInstrument(gm: string): Promise<LoadedInstrument> {
    let promise = this.cache.get(gm)
    if (!promise) {
      const ctx = this.ensureContext()
      promise = (async () => {
        try {
          return await loadInstrument(ctx, gm)
        } catch {
          if (gm === FALLBACK_GM) throw new Error('Could not load any instruments (offline?)')
          this.onWarn(`Could not load "${gm}", using piano instead.`)
          return this.loadInstrument(FALLBACK_GM)
        }
      })()
      this.cache.set(gm, promise)
      // Do not cache failures forever.
      promise.catch(() => this.cache.delete(gm))
    }
    return promise
  }

  isCached(gm: string): boolean {
    return this.cache.has(gm)
  }

  /** Start loading instruments ahead of time (e.g. for the next song). */
  async preload(gms: string[]): Promise<void> {
    await Promise.all([...new Set(gms)].map((g) => this.loadInstrument(g)))
  }

  /** Must be called from a user gesture before the first play. */
  async unlock(): Promise<void> {
    await this.ensureContext().resume()
  }

  async play(tracks: PlayTrack[], options: PlayOptions): Promise<void> {
    const ctx = this.ensureContext()
    const token = ++this.token
    if (!options.layer) {
      this.silence()
      this.playing = false
    }

    await ctx.resume()
    const instruments = await Promise.all(tracks.map((t) => this.loadInstrument(t.gm)))
    if (token !== this.token) return // superseded by a newer play/pause/stop

    const tempo = Math.max(0.1, options.tempo)
    // Decide the start position only now that everything is loaded, so a slow
    // download doesn't put this listener behind everyone else.
    const t0 = ctx.currentTime + LEAD
    const heardAtPerf = this.heardAt(t0)
    const from = typeof options.from === 'function' ? options.from(heardAtPerf) : options.from

    const pending: Pending[] = []
    tracks.forEach((track, i) => {
      const inst = instruments[i]
      const notes = [...track.notes].sort((a, b) => a.time - b.time)
      notes.forEach((n, k) => {
        const end = n.time + n.duration
        if (end <= from + 0.05) return
        const start = Math.max(n.time, from)
        // Phrasing context: is there a rest after this note? Was it slurred into?
        let next = Infinity
        for (let j = k + 1; j < notes.length; j++) {
          if (notes[j].time > n.time + 0.002) {
            next = notes[j].time
            break
          }
        }
        let prevEnd = -Infinity
        for (let j = k - 1; j >= 0; j--) {
          if (notes[j].time < n.time - 0.002) {
            prevEnd = notes[j].time + notes[j].duration
            break
          }
        }
        pending.push({
          inst,
          gm: track.gm,
          at: t0 + (start - from) / tempo,
          note: n,
          into: (start - n.time) / tempo,
          duration: (end - start) / tempo,
          restAfter: (next - end) / tempo,
          slurred: Math.abs(prevEnd - n.time) < 0.03,
        })
      })
    })
    pending.sort((a, b) => a.at - b.at)
    this.sessions.push({ pending, cursor: 0 })
    this.schedule()
    this.startPump()

    this.tempo = tempo
    this.startedAt = t0
    this.fromSec = from
    this.playing = true
  }

  private startPump(): void {
    if (this.pump !== null) return
    this.pump = window.setInterval(() => this.schedule(), PUMP_MS)
  }

  /** Turn notes that are about to play into voices. */
  private schedule(): void {
    const ctx = this.ctx
    if (!ctx || !this.bus) return
    const horizon = ctx.currentTime + LOOKAHEAD
    const probe = (globalThis as { __radioProbe?: Probe }).__radioProbe
    for (const s of this.sessions) {
      while (s.cursor < s.pending.length && s.pending[s.cursor].at < horizon) {
        const p = s.pending[s.cursor++]
        const stop = playVoice(
          ctx,
          p.inst,
          {
            midi: p.note.midi,
            velocity: p.note.velocity,
            time: p.at,
            duration: p.duration,
            into: p.into,
            restAfter: p.restAfter,
            slurred: p.slurred,
            songTime: p.note.time,
          },
          this.bus,
        )
        this.voices.push({ stop, until: p.at + p.duration + 2 })
        probe?.({ gm: p.gm, midi: p.note.midi, heardAtPerf: this.heardAt(p.at) })
      }
    }
    this.sessions = this.sessions.filter((s) => s.cursor < s.pending.length)
    const now = ctx.currentTime
    this.voices = this.voices.filter((v) => v.until > now)
  }

  pause(): void {
    this.token++
    this.fromSec = this.position()
    this.silence()
    this.playing = false
  }

  stop(): void {
    this.token++
    this.silence()
    this.playing = false
    this.fromSec = 0
  }

  private silence(): void {
    const now = this.ctx?.currentTime ?? 0
    for (const v of this.voices) v.stop(now)
    this.voices = []
    this.sessions = []
  }
}
