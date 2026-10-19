import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import PianoRoll, { type RollTrack } from './components/PianoRoll.tsx'
import Visualizer from './components/Visualizer.tsx'
import { WaveProgress, WaveRing } from './components/Wave.tsx'
import { Player } from './music/engine.ts'
import { INSTRUMENTS, instrumentName } from './music/instruments.ts'
import { keyName } from './music/key.ts'
import { ACCEPTED_FILES, fetchSong, songFromBuffer } from './music/load.ts'
import { NOTE_SETS, NOTE_SET_GROUPS, getNoteSet } from './music/noteSets.ts'
import { prepare, type PreparedSong } from './music/prepare.ts'
import { defaultSplit, isPolyphonic } from './music/split.ts'
import type { Key, Mode, Song } from './music/types.ts'
import { SyncedClock, type ClockStatus } from './radio/clock.ts'
import { buildSchedule, locate, type Location } from './radio/schedule.ts'
import { THEMES, applyThemeColors, getTheme, type Theme } from './themes.ts'

/** A playable song: bundled, from the classics corpus, or uploaded. */
interface Entry {
  id: string
  title: string
  composer: string
  group: string
  url: string
  tune?: number
  /** Seconds at normal speed. */
  duration: number
  genres: string[]
  keepScale: boolean
}

interface StockSong {
  title: string
  file: string
  composer?: string
  duration: number
  genres: string[]
  keepScale?: boolean
}

interface Classics {
  base: string
  pieces: { group: string; path: string; title: string; composer: string; duration: number; genres: string[]; tune?: number }[]
}

interface SongSettings {
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

/** FNV-1a: a stable hash so every listener gets the same station order. */
function hash(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** The station's playlist: every song tagged with the genre, in a fixed shuffled order. */
function playlistFor(entries: Entry[], genre: string): Entry[] {
  return entries
    .filter((e) => e.genres.includes(genre))
    .sort((a, b) => hash(`${genre}:${a.id}`) - hash(`${genre}:${b.id}`))
}

function scaleFor(theme: Theme, entry: Entry | null, choice: string): string {
  if (choice !== 'genre') return choice
  return entry?.keepScale ? 'original' : (theme.scale ?? 'original')
}

function Clock({ getPosition, duration }: { getPosition: () => number | null; duration: number }) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 250)
    return () => window.clearInterval(id)
  }, [])
  const pos = Math.min(Math.max(getPosition() ?? 0, 0), duration)
  return (
    <span className="time">
      {formatTime(pos)} <span className="dim">/ {formatTime(duration)}</span>
    </span>
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
  const energyRef = useRef(0)

  // ---- Catalog ------------------------------------------------------------

  const [entries, setEntries] = useState<Entry[]>([])
  const [uploads, setUploads] = useState<Entry[]>([])
  const [songs, setSongs] = useState<Record<string, Song>>({})
  const [failed, setFailed] = useState<Record<string, string>>({})

  // ---- Settings -----------------------------------------------------------

  const [themeId, setThemeId] = useState<string>(() => load('theme', 'medieval'))
  const theme = getTheme(themeId)
  const stationTempo = theme.tempo ?? 1
  const [scaleChoice, setScaleChoice] = useState('genre')
  const [volume, setVolume] = useState<number>(() => load('volume', 90))

  const [mode, setMode] = useState<'radio' | 'free'>('radio')
  const [freeEntry, setFreeEntry] = useState<Entry | null>(null)
  const [tempo, setTempo] = useState(1)
  const [loop, setLoop] = useState(true)

  const [on, setOn] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [slot, setSlot] = useState<Location | null>(null)

  // ---- Station ------------------------------------------------------------

  const playlist = useMemo(() => playlistFor(entries, theme.id), [entries, theme.id])
  const schedule = useMemo(
    () => buildSchedule(playlist.map((e) => e.duration / stationTempo)),
    [playlist, stationTempo],
  )

  const current: Entry | null =
    mode === 'radio' ? (slot ? (playlist[slot.index] ?? null) : null) : freeEntry
  const currentSong = current ? (songs[current.id] ?? null) : null
  const songKey =
    mode === 'radio' ? `r:${theme.id}:${slot?.startMs ?? ''}` : `f:${freeEntry?.id ?? ''}`
  const noteSetId = scaleFor(theme, current, scaleChoice)
  const noteSet = getNoteSet(noteSetId)
  const playTempo = mode === 'radio' ? stationTempo : tempo * stationTempo

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
    () => settings.split ?? (currentSong ? defaultSplit(currentSong) : new Set<number>()),
    [settings.split, currentSong],
  )

  const prepared = useMemo<PreparedSong | null>(() => {
    if (!currentSong) return null
    return prepare(currentSong, {
      setId: theme.set,
      noteSetId,
      key: parseKeyChoice(settings.keyChoice),
      overrides: settings.overrides,
      split,
    })
  }, [currentSong, theme.set, noteSetId, settings.keyChoice, settings.overrides, split])

  const prepareDefault = useCallback(
    (entry: Entry, song: Song) =>
      prepare(song, {
        setId: theme.set,
        noteSetId: scaleFor(theme, entry, scaleChoice),
        key: null,
        overrides: {},
        split: defaultSplit(song),
      }),
    [theme, scaleChoice],
  )

  // Latest values for timers and async callbacks.
  const latest = useRef({ on, mode, songKey, prepared, playTempo, loop, current, currentSong, songs })
  latest.current = { on, mode, songKey, prepared, playTempo, loop, current, currentSong, songs }

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
      const list: Entry[] = []
      try {
        const stock = (await (await fetch(`${base}midi/index.json`)).json()) as StockSong[]
        for (const s of stock) {
          list.push({
            id: `stock:${s.file}`,
            title: s.title,
            composer: s.composer ?? 'Traditional',
            group: 'Station songs',
            url: `${base}midi/${s.file}`,
            duration: s.duration,
            genres: s.genres,
            keepScale: !!s.keepScale,
          })
        }
        const classics = (await (await fetch(`${base}classics.json`)).json()) as Classics
        for (const p of classics.pieces) {
          list.push({
            id: `m21:${p.path}${p.tune ? `#${p.tune}` : ''}`,
            title: p.title,
            composer: p.composer,
            group: p.group,
            url: classics.base + p.path.split('/').map(encodeURIComponent).join('/'),
            tune: p.tune,
            duration: p.duration,
            genres: p.genres,
            keepScale: false,
          })
        }
      } catch {
        if (!cancelled) setMessage('Could not load the station’s song list.')
      }
      if (!cancelled) setEntries(list)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const loadingIds = useRef(new Set<string>())
  const ensureSong = useCallback((entry: Entry) => {
    if (latest.current.songs[entry.id] || loadingIds.current.has(entry.id)) return
    loadingIds.current.add(entry.id)
    fetchSong(entry.url, entry.title, entry.tune)
      .then((song) => {
        setSongs((s) => ({ ...s, [entry.id]: song }))
        setFailed((f) => {
          const { [entry.id]: _, ...rest } = f
          return rest
        })
      })
      .catch((e: unknown) => {
        setFailed((f) => ({ ...f, [entry.id]: e instanceof Error ? e.message : 'Could not load.' }))
      })
      .finally(() => loadingIds.current.delete(entry.id))
  }, [])

  // Always have the current song loading (to show it, and to play it).
  useEffect(() => {
    if (current) ensureSong(current)
  }, [current, ensureSong])

  // ---- Radio --------------------------------------------------------------

  /** startMs of the slot that's been scheduled; null = nothing yet. */
  const scheduledSlot = useRef<number | null>(null)

  useEffect(() => {
    const syncNow = async () => {
      const probe = performance.now()
      const before = clock.atPerf(probe)
      const status = await clock.sync()
      setClockStatus({ ...status })
      if (Math.abs(clock.atPerf(probe) - before) > 40) scheduledSlot.current = null
    }
    clockReady.current = syncNow()
    const id = window.setInterval(() => void syncNow(), 10 * 60 * 1000)
    return () => window.clearInterval(id)
  }, [clock])

  const startRadioSlot = useCallback(
    (prep: PreparedSong, startMs: number, layer: boolean, speed: number) => {
      if (!layer) {
        setBusy(true)
        const pending = [...new Set(prep.playTracks.map((t) => t.gm))].filter((g) => !player.isCached(g))
        setMessage(pending.length ? `Tuning in… loading ${pending.map(instrumentName).join(', ')}.` : '')
      }
      player
        .play(prep.playTracks, {
          tempo: speed,
          from: (heardAtPerf) => ((clock.atPerf(heardAtPerf) - startMs) / 1000) * speed,
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

      // Fetch the next song early.
      const upcoming = playlist[loc.nextIndex]
      if (upcoming) ensureSong(upcoming)

      if (!latest.current.on) return
      const ahead = locate(schedule, now + LOOKAHEAD_MS)
      if (!ahead || scheduledSlot.current === ahead.startMs) return
      const entry = playlist[ahead.index]
      const song = latest.current.songs[entry.id]
      if (!song) {
        ensureSong(entry) // schedule as soon as it arrives; we re-join the live position
        if (scheduledSlot.current === null) setBusy(true)
        return
      }

      const first = scheduledSlot.current === null
      scheduledSlot.current = ahead.startMs
      const L = latest.current
      const prep =
        L.songKey === `r:${theme.id}:${ahead.startMs}` && L.prepared ? L.prepared : prepareDefault(entry, song)
      startRadioSlot(prep, ahead.startMs, !first, stationTempo)

      const following = playlist[ahead.nextIndex]
      const followingSong = following && latest.current.songs[following.id]
      if (followingSong) {
        void player.preload(prepareDefault(following, followingSong).playTracks.map((t) => t.gm)).catch(() => {})
      }
    }
    tick()
    const id = window.setInterval(tick, 250)
    return () => window.clearInterval(id)
  }, [mode, schedule, playlist, clock, theme.id, stationTempo, prepareDefault, startRadioSlot, player, ensureSong])

  // Settings changed mid-song: re-join the live position with the new sound.
  // (A song merely finishing its download is not a change, so it's not in here.)
  const settingsSig = [
    theme.set,
    noteSetId,
    settings.keyChoice,
    JSON.stringify(settings.overrides),
    settings.split ? [...settings.split].join(',') : 'auto',
    playTempo,
  ].join('|')
  const lastSongKey = useRef(songKey)
  const lastSig = useRef(settingsSig)
  useEffect(() => {
    const changed = lastSongKey.current === songKey && lastSig.current !== settingsSig
    lastSongKey.current = songKey
    lastSig.current = settingsSig
    if (!changed || !latest.current.on) return
    if (latest.current.mode === 'radio') {
      scheduledSlot.current = null
    } else if (player.isPlaying) {
      // Wait a frame so `prepared` reflects the new settings.
      requestAnimationFrame(() => void playFree(player.position()))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songKey, settingsSig])

  // ---- Free play ----------------------------------------------------------

  const playFree = useCallback(
    async (from: number) => {
      const prep = latest.current.prepared
      if (!prep) return
      setBusy(true)
      try {
        await player.play(prep.playTracks, { tempo: latest.current.playTempo, from })
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

  // Start free play once the chosen song has arrived.
  const wantFreePlay = useRef(false)
  useEffect(() => {
    if (mode === 'free' && on && prepared && wantFreePlay.current) {
      wantFreePlay.current = false
      void playFree(0)
    }
  }, [mode, on, prepared, playFree])

  useEffect(() => {
    if (mode !== 'free') return
    const id = window.setInterval(() => {
      const L = latest.current
      if (!L.on || !L.currentSong || !player.isPlaying) return
      if (player.position() >= L.currentSong.duration + 0.5) {
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
      setBusy(false)
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
      if (!prepared) {
        wantFreePlay.current = true
        return
      }
      const pos = player.position()
      void playFree(currentSong && pos >= currentSong.duration ? 0 : pos)
    }
  }

  const changeGenre = (id: string) => {
    if (id === theme.id) return
    if (mode === 'radio') {
      player.stop()
      scheduledSlot.current = null
      setSlot(null)
      if (on) setBusy(true)
    }
    setScaleChoice('genre')
    setThemeId(id)
  }

  const chooseFree = (entry: Entry | null) => {
    if (!entry) return
    player.stop()
    scheduledSlot.current = null
    setMode('free')
    setFreeEntry(entry)
    setMessage('')
    setBusy(false)
    if (on) wantFreePlay.current = true
    ensureSong(entry)
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
      const title = file.name.replace(/(\.(midi?|mxl|musicxml|xml|abc))+$/i, '')
      const song = await songFromBuffer(await file.arrayBuffer(), file.name)
      const entry: Entry = {
        id: `upload:${Date.now()}`,
        title,
        composer: 'Your file',
        group: 'Your files',
        url: '',
        duration: song.duration,
        genres: [],
        keepScale: false,
      }
      setSongs((s) => ({ ...s, [entry.id]: { ...song, name: title } }))
      setUploads((u) => [...u, entry])
      chooseFree(entry)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not read that file.')
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
    if (mode === 'radio') return slotStart === null ? null : ((clock.now() - slotStart) / 1000) * stationTempo
    return player.position()
  }, [mode, slotStart, clock, player, stationTempo])

  const heardPosition = useCallback(() => (latest.current.on ? songPosition() : null), [songPosition])
  const rollPosition = useCallback(() => songPosition() ?? 0, [songPosition])

  const duration = currentSong?.duration ?? current?.duration ?? 0
  const loadingSong = !!current && !currentSong && !failed[current.id]
  const showLoader = loadingSong || (busy && on)
  const getProgress = useCallback(() => {
    if (latest.current.current && !latest.current.currentSong) return null
    const pos = songPosition()
    const d = latest.current.currentSong?.duration ?? 0
    return pos === null || d <= 0 ? 0 : pos / d
  }, [songPosition])
  const progressGetter = useCallback(() => (showLoader ? null : getProgress()), [showLoader, getProgress])

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

  const next = mode === 'radio' && slot ? playlist[slot.nextIndex] : null
  const label = mode === 'radio' ? (on ? 'Stop' : 'Tune in') : on ? 'Pause' : 'Play'
  const allEntries = [...entries, ...uploads]
  const groups = [...new Set(allEntries.map((e) => e.group))]
  const failure = current ? failed[current.id] : undefined

  // ---- Render -------------------------------------------------------------

  return (
    <main className="page">
      <header className="masthead">
        <div className="brand">
          <D20 />
          <h1>DnD Radio</h1>
        </div>
        <label className="genre">
          <span className="sr-only">Genre</span>
          <select value={theme.id} onChange={(e) => changeGenre(e.target.value)} aria-label="Genre">
            {THEMES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <span className={`status ${on ? 'on' : ''}`}>
          <span className="dot" />
          {mode === 'radio' ? (on ? 'Live' : 'Off air') : 'Free play'}
        </span>
      </header>
      <p className="tagline">{theme.tagline}</p>

      <section className="stage">
        <Visualizer
          tracks={prepared?.playTracks ?? []}
          motif={theme.motif}
          colors={theme.colors}
          getPosition={heardPosition}
          energyRef={energyRef}
        />
        <div className="now">
          <p className="eyebrow">{mode === 'radio' ? `${theme.name} station` : 'Free play'}</p>
          <h2 className="title">{current?.title ?? 'Tuning…'}</h2>
          <p className="next">
            {current ? current.composer : ' '}
            {next ? ` · Up next: ${next.title}` : ''}
          </p>
          <div className="progress">
            <WaveProgress
              getProgress={progressGetter}
              playing={on && !showLoader}
              colors={theme.colors}
              energyRef={energyRef}
              label={showLoader ? 'Loading' : 'Song progress'}
            />
            <Clock getPosition={songPosition} duration={duration} />
          </div>
        </div>
      </section>

      <div className="controls">
        <button
          className="primary"
          onClick={() => void toggle()}
          disabled={!current || (busy && !on)}
          aria-busy={showLoader}
        >
          {showLoader && on ? <WaveRing color={theme.colors.bg} /> : null}
          {showLoader && on ? 'Tuning' : label}
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
      {(message || failure) && <p className="message">{failure ?? message}</p>}

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
              onClick={() => chooseFree(freeEntry ?? current ?? allEntries[0] ?? null)}
            >
              Free play
            </button>
          </div>
          <p className="hint">
            {mode === 'radio'
              ? `Everyone on the ${theme.name} station hears the same song at the same moment.`
              : 'Only you hear this. Pick any song or upload your own (MIDI, MusicXML or ABC).'}
          </p>
          <div className="row">
            <select
              value={mode === 'free' ? (freeEntry?.id ?? '') : ''}
              onChange={(e) => chooseFree(allEntries.find((x) => x.id === e.target.value) ?? null)}
              aria-label="Song"
            >
              {mode === 'radio' && <option value="">Pick a song…</option>}
              {groups.map((group) => (
                <optgroup key={group} label={group}>
                  {allEntries
                    .filter((x) => x.group === group)
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.title}
                        {x.composer && x.composer !== 'Traditional' && x.composer !== 'Your file'
                          ? ` — ${x.composer}`
                          : ''}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
            <label className="button">
              Upload
              <input
                type="file"
                accept={ACCEPTED_FILES}
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
            <select value={scaleChoice} onChange={(e) => setScaleChoice(e.target.value)} aria-label="Scale">
              <option value="genre">
                {theme.name} default ({getNoteSet(scaleFor(theme, current, 'genre')).name})
              </option>
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
              disabled={!currentSong || noteSet.intervals === null}
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

        {currentSong && prepared && (
          <>
            <section>
              <h3 className="label">Notes</h3>
              <PianoRoll
                tracks={rollTracks}
                duration={currentSong.duration}
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
                        {t.source === undefined && isPolyphonic(t) && (
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
              {mode === 'radio' && <p className="hint">Changes here last until the next song.</p>}
            </section>
          </>
        )}

        <p className="sync dim">
          Clock: {clockStatus.source}
          {Number.isFinite(clockStatus.uncertaintyMs) ? ` ±${clockStatus.uncertaintyMs} ms` : ''} · Audio
          latency {Math.round(player.latency() * 1000)} ms · {playlist.length} songs on this station
        </p>
      </details>

      <footer>
        Traditional and public-domain music. Classics and fiddle tunes stream from the{' '}
        <a href="https://github.com/cuthbertLab/music21" target="_blank" rel="noreferrer">
          music21 corpus
        </a>
        . Instruments load the first time they’re used.
      </footer>
    </main>
  )
}
