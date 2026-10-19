import { Soundfont } from 'smplr'
import { FALLBACK_GM } from './instruments.ts'
import type { NoteEvent } from './types.ts'

export interface PlayTrack {
  gm: string
  notes: NoteEvent[]
}

export interface PlayOptions {
  /** Playback speed multiplier. */
  tempo: number
  /** Start offset in song seconds. */
  from: number
}

/**
 * Schedules a song on the Web Audio clock using soundfont instruments.
 * Instruments are loaded once and cached. Changing anything while playing is
 * done by calling play() again from the current position.
 */
export class Player {
  private ctx: AudioContext | null = null
  private cache = new Map<string, Promise<Soundfont>>()
  private active: Soundfont[] = []
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

  private ensureContext(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext()
    return this.ctx
  }

  private loadInstrument(gm: string): Promise<Soundfont> {
    let promise = this.cache.get(gm)
    if (!promise) {
      const ctx = this.ensureContext()
      promise = (async () => {
        const sf = new Soundfont(ctx, { instrument: gm })
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

  /** Preload instruments so playback starts without a gap. */
  async preload(gms: string[]): Promise<void> {
    await Promise.all([...new Set(gms)].map((g) => this.loadInstrument(g)))
  }

  async play(tracks: PlayTrack[], options: PlayOptions): Promise<void> {
    const ctx = this.ensureContext()
    const token = ++this.token
    this.silence()
    this.playing = false
    this.fromSec = options.from

    await ctx.resume()
    const instruments = await Promise.all(tracks.map((t) => this.loadInstrument(t.gm)))
    if (token !== this.token) return // superseded by a newer play/pause/stop

    const tempo = Math.max(0.1, options.tempo)
    const t0 = ctx.currentTime + 0.1
    tracks.forEach((track, i) => {
      const sf = instruments[i]
      for (const n of track.notes) {
        if (n.time < options.from) continue
        sf.start({
          note: n.midi,
          velocity: Math.round(Math.min(1, Math.max(0.05, n.velocity)) * 127),
          time: t0 + (n.time - options.from) / tempo,
          duration: Math.max(0.05, n.duration / tempo),
        })
      }
    })

    this.active = [...new Set(instruments)]
    this.tempo = tempo
    this.startedAt = t0
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
    this.active = []
  }
}
