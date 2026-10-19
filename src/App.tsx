import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import PianoRoll, { type RollTrack } from './components/PianoRoll.tsx'
import Visualizer from './components/Visualizer.tsx'
import { Player } from './music/engine.ts'
import { INSTRUMENTS, instrumentName } from './music/instruments.ts'
import { keyName } from './music/key.ts'
import { parseMidi } from './music/midi.ts'
import { NOTE_SETS, NOTE_SET_GROUPS, getNoteSet } from './music/noteSets.ts'
import { prepare, type PreparedSong } from './music/prepare.ts'
import { defaultSplit } from './music/split.ts'
import type { Key, Mode, Song } from './music/types.ts'
import { SyncedClock, type ClockStatus } from './radio/clock.ts'
import { buildSchedule, locate, type Location } from './radio/schedule.ts'
import { THEMES, applyThemeColors, getTheme } from './themes.ts'

interface LibraryEntry {
  title: string
  file: string
  /** false keeps a song out of the radio rotation. */
  radio?: boolean
}

/** A song that can be played: stock or uploaded. */
interface Track {
  id: string
  title: string
  song: Song
  radio: boolean
}

interface SongSettings {
  /** Which song these settings belong to. */
  key: string
  overrides: Record<number, string>
  split: Set<number> | null
  keyChoice: string
}

/** How far ahead the radio schedules the next song, ms. */
const LOOKAHEAD_MS = 3000
const PITCH_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`dnd-radio:${key}`)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(`dnd-radio:${key}`, JSON.stringify(value))
  } catch {
    // Storage unavailable: settings just won't persist.
  }
}

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function parseKeyChoice(choice: string): Key | null {
  if (choice === 'auto') return null
  const [tonic, mode] = choice.split('-')
  return { tonic: Number(tonic), mode: mode as Mode }
}

function Progress({ getPosition, duration }: { getPosition: () => number | null; duration: number }) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 250)
    return () => window.clearInterval(id)
  }, [])
  const pos = Math.min(Math.max(getPosition() ?? 0, 0), duration)
  const pct = duration > 0 ? (pos / duration) * 100 : 0
  return (
    <div className="progress">
      <div className="bar">
        <div className="fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="time">
        {formatTime(pos)} <span className="dim">/ {formatTime(duration)}</span>
      </span>
    </div>
  )
}

function D20() {
  return (
    <svg className="d20" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
      <path
        d="M12 2 21 7v10l-9 5-9-5V7z M12 2 3 17h18z M3 7l9 5 9-5 M12 12v10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export default function App() {
  const [player] = useState(() => new Player())
  const [clock] = useState(() => new SyncedClock())
  const [clockStatus, setClockStatus] = useState<ClockStatus>(clock.status)
  const clockReady = useRef<Promise<unknown>>(Promise.resolve())

  // ---- Library ------------------------------------------------------------

  const [library, setLibrary] = useState<Track[]>([])
  const [uploads, setUploads] = useState<Track[]>([])
  const radioTracks = useMemo(() => library.filter((t) => t.radio), [library])
  const schedule = useMemo(
    () => buildSchedule(radioTracks.map((t) => t.song.duration)),
    [radioTracks],
  )

  // ---- Settings -----------------------------------------------------------

  const [themeId, setThemeId] = useState<string>(() => load('theme', 'medieval'))
  const theme = getTheme(themeId)
  const [noteSetId, setNoteSetId] = useState('original')
  const noteSet = getNoteSet(noteSetId)
  const [volume, setVolume] = useState<number>(() => load('volume', 90))

  const [mode, setMode] = useState<'radio' | 'free'>('radio')
  const [freeTrack, setFreeTrack] = useState<Track | null>(null)
  const [tempo, setTempo] = useState(1)
  const [loop, setLoop] = useState(true)

  const [on, setOn] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [slot, setSlot] = useState<Location | null>(null)

  // ---- Current song -------------------------------------------------------

  const current: Track | null =
    mode === 'radio' ? (slot ? (radioTracks[slot.index] ?? null) : null) : freeTrack
  const songKey = mode === 'radio' ? `r:${slot?.startMs ?? ''}` : `f:${freeTrack?.id ?? ''}`

  // Per-song settings reset automatically when the song changes.
  const [songSettings, setSongSettings] = useState<SongSettings>({
    key: '',
    overrides: {},
    split: null,
    keyChoice: 'auto',
  })
  const settings: SongSettings =
    songSettings.key === songKey
      ? songSettings
      : { key: songKey, overrides: {}, split: null, keyChoice: 'auto' }
  const updateSettings = (patch: Partial<SongSettings>) => setSongSettings({ ...settings, ...patch })

  const split = useMemo(
    () => settings.split ?? (current ? defaultSplit(current.song) : new Set<number>()),
    [settings.split, current],
  )

  const prepared = useMemo<PreparedSong | null>(() => {
    if (!current) return null
    return prepare(current.song, {
      setId: theme.set,
      noteSetId,
      key: parseKeyChoice(settings.keyChoice),
      overrides: settings.overrides,
      split,
    })
  }, [current, theme.set, noteSetId, settings.keyChoice, settings.overrides, split])

  const prepareDefault = useCallback(
    (track: Track) =>
      prepare(track.song, {
        setId: theme.set,
        noteSetId,
        key: null,
        overrides: {},
        split: defaultSplit(track.song),
      }),
    [theme.set, noteSetId],
  )

  // Latest values for timers and async callbacks.
  const latest = useRef({ on, mode, songKey, prepared, tempo, loop, current })
  latest.current = { on, mode, songKey, prepared, tempo, loop, current }

  // ---- Theme --------------------------------------------------------------

  useLayoutEffect(() => {
    applyThemeColors(theme)
    save('theme', theme.id)
  }, [theme])

  useEffect(() => {
    player.setVolume(volume)
    save('volume', volume)
  }, [player, volume])

  useEffect(() => {
    player.onWarn = (m) => setMessage(m)
  }, [player])

  // ---- Loading ------------------------------------------------------------

  useEffect(() => {
    let cancelled = false
    const base = import.meta.env.BASE_URL
    ;(async () => {
      try {
        const entries = (await (await fetch(`${base}midi/index.json`)).json()) as LibraryEntry[]
        const tracks = await Promise.all(
          entries.map(async (e): Promise<Track> => {
            const buf = await (await fetch(`${base}midi/${e.file}`)).arrayBuffer()
            return { id: e.file, title: e.title, song: parseMidi(buf, e.title), radio: e.radio !== false }
          }),
        )
        if (!cancelled) setLibrary(tracks)
      } catch {
        if (!cancelled) setMessage('Could not load the station’s songs.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // ---- Radio --------------------------------------------------------------

  /** startMs of the radio slot that's been scheduled; null = nothing yet. */
  const scheduledSlot = useRef<number | null>(null)

  useEffect(() => {
    const syncNow = async () => {
      const probe = performance.now()
      const before = clock.atPerf(probe)
      const status = await clock.sync()
      setClockStatus({ ...status })
      // If the clock estimate moved noticeably, re-align what's playing.
      if (Math.abs(clock.atPerf(probe) - before) > 40) scheduledSlot.current = null
    }
    clockReady.current = syncNow()
    const id = window.setInterval(() => void syncNow(), 10 * 60 * 1000)
    return () => window.clearInterval(id)
  }, [clock])

  const startRadioSlot = useCallback(
    (prep: PreparedSong, startMs: number, layer: boolean) => {
      if (!layer) {
        setBusy(true)
        const pending = [...new Set(prep.playTracks.map((t) => t.gm))].filter((g) => !player.isCached(g))
        setMessage(pending.length ? `Tuning in… loading ${pending.map(instrumentName).join(', ')}.` : '')
      }
      player
        .play(prep.playTracks, {
          tempo: 1,
          from: (heardAtPerf) => (clock.atPerf(heardAtPerf) - startMs) / 1000,
          layer,
        })
        .then(() => {
          if (!layer) setMessage((m) => (m.startsWith('Tuning in') ? '' : m))
        })
        .catch((e: unknown) => {
          setMessage(e instanceof Error ? e.message : 'Playback failed.')
          scheduledSlot.current = null
        })
        .finally(() => {
          if (!layer) setBusy(false)
        })
    },
    [player, clock],
  )

  useEffect(() => {
    if (mode !== 'radio' || schedule.slots.length === 0) return
    const tick = () => {
      const now = clock.now()
      const loc = locate(schedule, now)
      if (!loc) return
      setSlot((prev) => (prev && prev.startMs === loc.startMs ? prev : loc))

      if (!latest.current.on) return
      const ahead = locate(schedule, now + LOOKAHEAD_MS)
      if (!ahead || scheduledSlot.current === ahead.startMs) return

      const first = scheduledSlot.current === null
      scheduledSlot.current = ahead.startMs
      const L = latest.current
      const prep =
        L.songKey === `r:${ahead.startMs}` && L.prepared
          ? L.prepared
          : prepareDefault(radioTracks[ahead.index])
      startRadioSlot(prep, ahead.startMs, !first)

      // Warm up the instruments the following song will need.
      const following = radioTracks[ahead.nextIndex]
      if (following) void player.preload(prepareDefault(following).playTracks.map((t) => t.gm)).catch(() => {})
    }
    tick()
    const id = window.setInterval(tick, 250)
    return () => window.clearInterval(id)
  }, [mode, schedule, clock, radioTracks, prepareDefault, startRadioSlot, player])

  // Settings changed mid-song: re-join the live position with the new sound.
  const lastSongKey = useRef(songKey)
  useEffect(() => {
    const sameSong = lastSongKey.current === songKey
    lastSongKey.current = songKey
    if (!sameSong || !latest.current.on) return
    if (latest.current.mode === 'radio') {
      scheduledSlot.current = null
    } else if (player.isPlaying) {
      void playFree(player.position())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prepared, tempo])

  // ---- Free play ----------------------------------------------------------

  const playFree = useCallback(
    async (from: number) => {
      const prep = latest.current.prepared
      if (!prep) return
      setBusy(true)
      try {
        await player.play(prep.playTracks, { tempo: latest.current.tempo, from })
        setMessage('')
      } catch (e) {
        setOn(false)
        setMessage(e instanceof Error ? e.message : 'Playback failed.')
      } finally {
        setBusy(false)
      }
    },
    [player],
  )

  useEffect(() => {
    if (mode !== 'free') return
    const id = window.setInterval(() => {
      const L = latest.current
      if (!L.on || !L.current || !player.isPlaying) return
      if (player.position() >= L.current.song.duration + 0.5) {
        if (L.loop) void playFree(0)
        else {
          player.stop()
          setOn(false)
        }
      }
    }, 250)
    return () => window.clearInterval(id)
  }, [mode, player, playFree])

  // ---- Controls -----------------------------------------------------------

  const toggle = async () => {
    if (on) {
      if (mode === 'radio') player.stop()
      else player.pause()
      scheduledSlot.current = null
      setOn(false)
      return
    }
    await player.unlock()
    if (mode === 'radio') {
      setBusy(true)
      // Don't start on the device clock if a better one is on its way.
      await Promise.race([clockReady.current, new Promise((r) => setTimeout(r, 2500))])
      scheduledSlot.current = null
      setOn(true)
    } else {
      setOn(true)
      const pos = player.position()
      void playFree(current && pos >= current.song.duration ? 0 : pos)
    }
  }

  const chooseFree = (track: Track | null) => {
    if (!track) return
    player.stop()
    scheduledSlot.current = null
    setOn(false)
    setMode('free')
    setFreeTrack(track)
    setMessage('')
  }

  const backToRadio = () => {
    if (mode === 'radio') return
    player.stop()
    setOn(false)
    setMode('radio')
    setMessage('')
  }

  const onUpload = async (file: File | undefined) => {
    if (!file) return
    try {
      const title = file.name.replace(/(\.midi?)+$/i, '')
      const song = parseMidi(await file.arrayBuffer(), title)
      if (song.tracks.length === 0) throw new Error('That file has no notes.')
      const track: Track = { id: `upload:${Date.now()}`, title, song, radio: false }
      setUploads((u) => [...u, track])
      chooseFree(track)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not read that MIDI file.')
    }
  }

  const toggleSplit = (sourceIndex: number) => {
    const next = new Set<number>(split)
    if (next.has(sourceIndex)) next.delete(sourceIndex)
    else next.add(sourceIndex)
    updateSettings({ split: next })
  }

  // ---- Positions ----------------------------------------------------------

  const slotStart = slot?.startMs ?? null
  const songPosition = useCallback((): number | null => {
    if (mode === 'radio') return slotStart === null ? null : (clock.now() - slotStart) / 1000
    return player.position()
  }, [mode, slotStart, clock, player])

  const heardPosition = useCallback(
    () => (latest.current.on ? songPosition() : null),
    [songPosition],
  )
  const rollPosition = useCallback(() => songPosition() ?? 0, [songPosition])

  const palette = [theme.colors.accent, theme.colors.accent2, theme.colors.ink, theme.colors.muted]
  const rollTracks = useMemo<RollTrack[]>(
    () =>
      (prepared?.tracks ?? []).map((t, i) => ({
        color: palette[i % palette.length],
        muted: !prepared?.assignments.get(t.index),
        notes: t.notes,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [prepared, theme],
  )

  const next = mode === 'radio' && slot ? radioTracks[slot.nextIndex] : null
  const label = mode === 'radio' ? (on ? 'Stop' : 'Tune in') : on ? 'Pause' : 'Play'
  const allTracks = [...library, ...uploads]

  // ---- Render -------------------------------------------------------------

  return (
    <main className="page">
      <header className="masthead">
        <D20 />
        <h1>DnD Radio</h1>
        <span className={`status ${on ? 'on' : ''}`}>
          <span className="dot" />
          {mode === 'radio' ? (on ? 'Live' : 'Off air') : 'Free play'}
        </span>
      </header>

      <section className="stage">
        <Visualizer
          tracks={prepared?.playTracks ?? []}
          motif={theme.motif}
          colors={theme.colors}
          getPosition={heardPosition}
        />
        <div className="now">
          <p className="eyebrow">{theme.name}</p>
          <h2 className="title">{current?.title ?? 'Tuning…'}</h2>
          <p className="next">{next ? `Up next · ${next.title}` : ' '}</p>
          <Progress getPosition={songPosition} duration={current?.song.duration ?? 0} />
        </div>
      </section>

      <div className="controls">
        <button className="primary" onClick={() => void toggle()} disabled={!current || busy}>
          {busy ? 'Tuning…' : label}
        </button>
        <label className="volume">
          <span className="dim">Volume</span>
          <input
            type="range"
            min={0}
            max={127}
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            aria-label="Volume"
          />
        </label>
      </div>
      {message && <p className="message">{message}</p>}

      <section className="setting">
        <h3 className="label">Setting</h3>
        <div className="themes" role="radiogroup" aria-label="Setting">
          {THEMES.map((t) => (
            <button
              key={t.id}
              role="radio"
              aria-checked={t.id === theme.id}
              className={t.id === theme.id ? 'chip active' : 'chip'}
              onClick={() => setThemeId(t.id)}
            >
              <span className="swatch" style={{ background: t.colors.accent }} />
              {t.name}
            </button>
          ))}
        </div>
        <p className="hint">{theme.tagline}</p>
      </section>

      <details className="advanced">
        <summary>Advanced</summary>

        <section>
          <h3 className="label">Source</h3>
          <div className="segmented" role="group" aria-label="Source">
            <button aria-pressed={mode === 'radio'} onClick={backToRadio}>
              Radio · live
            </button>
            <button
              aria-pressed={mode === 'free'}
              onClick={() => chooseFree(freeTrack ?? current ?? allTracks[0] ?? null)}
            >
              Free play
            </button>
          </div>
          <p className="hint">
            {mode === 'radio'
              ? 'Everyone tuned in hears the same song at the same moment.'
              : 'Only you hear this. Pick any song or upload your own.'}
          </p>
          <div className="row">
            <select
              value={mode === 'free' ? (freeTrack?.id ?? '') : ''}
              onChange={(e) => chooseFree(allTracks.find((t) => t.id === e.target.value) ?? null)}
              aria-label="Song"
            >
              {mode === 'radio' && <option value="">Pick a song…</option>}
              {allTracks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
            <label className="button">
              Upload .mid
              <input
                type="file"
                accept=".mid,.midi,audio/midi"
                hidden
                onChange={(e) => {
                  void onUpload(e.target.files?.[0])
                  e.target.value = ''
                }}
              />
            </label>
          </div>
          {mode === 'free' && (
            <div className="row free-controls">
              <label className="slider">
                <span className="dim">Tempo ×{tempo.toFixed(2)}</span>
                <input
                  type="range"
                  min={0.5}
                  max={1.5}
                  step={0.05}
                  value={tempo}
                  onChange={(e) => setTempo(Number(e.target.value))}
                />
              </label>
              <label className="check">
                <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} />
                Loop
              </label>
            </div>
          )}
        </section>

        <section>
          <h3 className="label">Scale</h3>
          <div className="row">
            <select value={noteSetId} onChange={(e) => setNoteSetId(e.target.value)} aria-label="Scale">
              {NOTE_SET_GROUPS.map((group) => (
                <optgroup key={group} label={group}>
                  {NOTE_SETS.filter((s) => s.group === group).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <select
              value={settings.keyChoice}
              onChange={(e) => updateSettings({ keyChoice: e.target.value })}
              aria-label="Song key"
              disabled={!current || noteSet.intervals === null}
            >
              <option value="auto">
                Key: auto{prepared ? ` (${keyName(prepared.detectedKey)})` : ''}
              </option>
              {(['major', 'minor'] as const).flatMap((m) =>
                PITCH_NAMES.map((name, tonic) => (
                  <option key={`${tonic}-${m}`} value={`${tonic}-${m}`}>
                    {name} {m}
                  </option>
                )),
              )}
            </select>
          </div>
          <p className="hint">{noteSet.description}</p>
        </section>

        {current && prepared && (
          <>
            <section>
              <h3 className="label">Notes</h3>
              <PianoRoll
                tracks={rollTracks}
                duration={current.song.duration}
                getPosition={rollPosition}
                onSeek={
                  mode === 'free'
                    ? (s) => {
                        if (player.isPlaying) void playFree(s)
                        else player.seek(s)
                      }
                    : undefined
                }
                gridColor={theme.colors.line}
                playheadColor={theme.colors.ink}
              />
            </section>

            <section>
              <h3 className="label">Tracks</h3>
              <ul className="tracks">
                {prepared.song.tracks.map((t, i) => {
                  const override = settings.overrides[t.index] ?? 'default'
                  const defaultGm = prepared.defaults.get(t.index) ?? null
                  const firstOfSplit =
                    t.source !== undefined && prepared.song.tracks[i - 1]?.source !== t.source
                  return (
                    <li key={t.index}>
                      <span className="swatch" style={{ background: palette[i % palette.length] }} />
                      <span className="track-name">
                        {t.name}
                        {t.isPercussion && <span className="dim"> · drums</span>}
                        {t.source === undefined && !t.isPercussion && t.notes.length > 1 && (
                          <button className="link" onClick={() => toggleSplit(t.index)}>
                            Split voices
                          </button>
                        )}
                        {firstOfSplit && (
                          <button className="link" onClick={() => toggleSplit(t.source as number)}>
                            Merge
                          </button>
                        )}
                      </span>
                      <select
                        value={override}
                        onChange={(e) => {
                          const nextOverrides = { ...settings.overrides }
                          if (e.target.value === 'default') delete nextOverrides[t.index]
                          else nextOverrides[t.index] = e.target.value
                          updateSettings({ overrides: nextOverrides })
                        }}
                        aria-label={`Instrument for ${t.name}`}
                      >
                        <option value="default">
                          {theme.name}: {defaultGm ? instrumentName(defaultGm) : 'Muted'}
                        </option>
                        <option value="mute">Muted</option>
                        {INSTRUMENTS.map((inst) => (
                          <option key={inst.gm} value={inst.gm}>
                            {inst.name}
                          </option>
                        ))}
                      </select>
                    </li>
                  )
                })}
              </ul>
              {mode === 'radio' && (
                <p className="hint">Changes here last until the next song.</p>
              )}
            </section>
          </>
        )}

        <p className="sync dim">
          Clock: {clockStatus.source}
          {Number.isFinite(clockStatus.uncertaintyMs) ? ` ±${clockStatus.uncertaintyMs} ms` : ''} · Audio
          latency {Math.round(player.latency() * 1000)} ms
        </p>
      </details>

      <footer>
        Traditional and public-domain songs. Instruments load the first time they’re used.
      </footer>
    </main>
  )
}
