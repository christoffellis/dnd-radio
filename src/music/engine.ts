import { Soundfont } from 'smplr'
import { FALLBACK_GM } from './instruments.ts'
import type { NoteEvent } from './types.ts'

export interface PlayTrack {
  gm: string
  notes: NoteEvent[]
}

export interface PlayOptions {
  /** Playback speed multiplier (the radio always uses 1). */
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

/** Lead time between deciding to start and the first note, seconds. */
const LEAD = 0.15

/**
 * Schedules songs on the Web Audio clock using soundfont instruments.
 * Instruments are loaded once and cached.
 */
export class Player {
  private ctx: AudioContext | null = null
  private cache = new Map<string, Promise<Soundfont>>()
  private active = new Set<Soundfont>()
  private playing = false
  private startedAt = 0
  private fromSec = 0
  private tempo = 1
  private token = 0
  private volume = 90 // 0..127

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
    this.cache.forEach((p) => {
      p.then((sf) => sf.output.setVolume(volume)).catch(() => {})
    })
  }

  /** Total output latency of the audio device, seconds. */
  latency(): number {
    const ctx = this.ctx
    if (!ctx) return 0
    return (ctx.outputLatency || 0) + (ctx.baseLatency || 0)
  }

  private ensureContext(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext({ latencyHint: 'playback' })
    return this.ctx
  }

  private loadInstrument(gm: string): Promise<Soundfont> {
    let promise = this.cache.get(gm)
    if (!promise) {
      const ctx = this.ensureContext()
      promise = (async () => {
        // FluidR3_GM is ~1 MB per instrument; the MusyngKite default is ~8 MB.
        const options = { instrument: gm, kit: 'FluidR3_GM' } as { instrument: string }
        const sf = new Soundfont(ctx, options)
        try {
          await sf.load
          sf.output.setVolume(this.volume)
          return sf
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
    const heardAtPerf = performance.now() + (LEAD + this.latency()) * 1000
    const from = typeof options.from === 'function' ? options.from(heardAtPerf) : options.from

    tracks.forEach((track, i) => {
      const sf = instruments[i]
      for (const n of track.notes) {
        const end = n.time + n.duration
        if (end <= from + 0.05) continue
        // Notes already sounding when we join start now with what's left.
        const start = Math.max(n.time, from)
        sf.start({
          note: n.midi,
          velocity: Math.round(Math.min(1, Math.max(0.05, n.velocity)) * 127),
          time: t0 + (start - from) / tempo,
          duration: Math.max(0.05, (end - start) / tempo),
        })
      }
    })

    for (const sf of instruments) this.active.add(sf)
    this.tempo = tempo
    this.startedAt = t0
    this.fromSec = from
    this.playing = true
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
    for (const sf of this.active) sf.stop()
    this.active.clear()
  }
}
