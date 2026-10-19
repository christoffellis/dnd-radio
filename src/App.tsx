import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import PianoRoll, { type RollTrack } from './components/PianoRoll.tsx'
import { Player, type PlayTrack } from './music/engine.ts'
import {
  INSTRUMENTS,
  INSTRUMENT_SETS,
  assignVoices,
  getInstrumentSet,
  instrumentName,
} from './music/instruments.ts'
import { detectKey, keyName } from './music/key.ts'
import { parseMidi } from './music/midi.ts'
import { NOTE_SETS, NOTE_SET_GROUPS, getNoteSet } from './music/noteSets.ts'
import { remapNotes } from './music/remap.ts'
import type { Key, Mode, Song } from './music/types.ts'

interface LibraryEntry {
  title: string
  file: string
}

const TRACK_COLORS = ['#b8965a', '#a8493f', '#6f8f72', '#7d8fa8', '#a58bb5', '#c9b68a']
const PITCH_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function parseKeyChoice(choice: string): Key | null {
  if (choice === 'auto') return null
  const [tonic, mode] = choice.split('-')
  return { tonic: Number(tonic), mode: mode as Mode }
}

function Clock({ getPosition, duration }: { getPosition: () => number; duration: number }) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 250)
    return () => window.clearInterval(id)
  }, [])
  return (
    <>
      <span className="time">{formatTime(Math.min(getPosition(), duration))}</span>
      <span className="time dim">/ {formatTime(duration)}</span>
    </>
  )
}

function D20() {
  return (
    <svg className="d20" viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
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

  const [library, setLibrary] = useState<LibraryEntry[]>([])
  const [song, setSong] = useState<Song | null>(null)
  const [libraryChoice, setLibraryChoice] = useState('')

  const [instrumentSetId, setInstrumentSetId] = useState(INSTRUMENT_SETS[0].id)
  const [noteSetId, setNoteSetId] = useState('original')
  const [keyChoice, setKeyChoice] = useState('auto')
  const [overrides, setOverrides] = useState<Record<number, string>>({})

  const [tempo, setTempo] = useState(1)
  const [volume, setVolume] = useState(90)
  const [loop, setLoop] = useState(true)

  const [playing, setPlaying] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const instrumentSet = getInstrumentSet(instrumentSetId)
  const noteSet = getNoteSet(noteSetId)

  // ---- Derived music data -------------------------------------------------

  const detectedKey = useMemo(() => (song ? detectKey(song) : null), [song])
  const key: Key = parseKeyChoice(keyChoice) ?? detectedKey ?? { tonic: 0, mode: 'major' }

  const assignments = useMemo(() => {
    if (!song) return new Map<number, string | null>()
    const base = assignVoices(song, instrumentSet)
    for (const [index, choice] of Object.entries(overrides)) {
      base.set(Number(index), choice === 'mute' ? null : choice)
    }
    return base
  }, [song, instrumentSet, overrides])

  const remapped = useMemo(() => {
    if (!song) return []
    return song.tracks.map((t) => ({
      ...t,
      notes: t.isPercussion ? t.notes : remapNotes(t.notes, key, noteSet.intervals),
    }))
    // `key` is a fresh object each render; depend on its parts instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song, key.tonic, key.mode, noteSet])

  const playTracks = useMemo<PlayTrack[]>(() => {
    const out: PlayTrack[] = []
    for (const t of remapped) {
      const gm = assignments.get(t.index)
      if (gm) out.push({ gm, notes: t.notes })
    }
    return out
  }, [remapped, assignments])

  const rollTracks = useMemo<RollTrack[]>(
    () =>
      remapped.map((t, i) => ({
        color: TRACK_COLORS[i % TRACK_COLORS.length],
        muted: !assignments.get(t.index),
        notes: t.notes,
      })),
    [remapped, assignments],
  )

  // ---- Playback -----------------------------------------------------------

  const tempoRef = useRef(tempo)
  tempoRef.current = tempo
  const playTracksRef = useRef(playTracks)
  playTracksRef.current = playTracks

  const startPlayback = useCallback(
    async (from: number) => {
      setBusy(true)
      setMessage('')
      try {
        await player.play(playTracksRef.current, { tempo: tempoRef.current, from })
        setPlaying(player.isPlaying)
      } catch (e) {
        setPlaying(false)
        setMessage(e instanceof Error ? e.message : 'Playback failed.')
      } finally {
        setBusy(false)
      }
    },
    [player],
  )

  useEffect(() => {
    player.onWarn = (m) => setMessage(m)
  }, [player])

  useEffect(() => {
    player.setVolume(volume)
  }, [player, volume])

  // Swap instruments, scale or tempo live while playing.
  useEffect(() => {
    if (player.isPlaying) void startPlayback(player.position())
  }, [playTracks, tempo, player, startPlayback])

  // Stop or loop at the end of the song.
  useEffect(() => {
    if (!song) return
    const id = window.setInterval(() => {
      if (player.isPlaying && player.position() >= song.duration + 0.3) {
        if (loop) {
          void startPlayback(0)
        } else {
          player.stop()
          setPlaying(false)
        }
      }
    }, 250)
    return () => window.clearInterval(id)
  }, [player, song, loop, startPlayback])

  const getPosition = useCallback(() => player.position(), [player])

  const togglePlay = () => {
    if (!song) return
    if (player.isPlaying) {
      player.pause()
      setPlaying(false)
    } else {
      const from = player.position() >= song.duration ? 0 : player.position()
      void startPlayback(from)
    }
  }

  const stop = () => {
    player.stop()
    setPlaying(false)
  }

  const seek = (seconds: number) => {
    if (player.isPlaying) void startPlayback(seconds)
    else player.seek(seconds)
  }

  // ---- Loading songs ------------------------------------------------------

  const openSong = useCallback(
    (data: ArrayBuffer, fallbackName: string) => {
      try {
        const parsed = parseMidi(data, fallbackName)
        if (parsed.tracks.length === 0) throw new Error('That file has no notes.')
        player.stop()
        setPlaying(false)
        setOverrides({})
        setKeyChoice('auto')
        setSong(parsed)
        setMessage('')
      } catch (e) {
        setMessage(e instanceof Error ? e.message : 'Could not read that MIDI file.')
      }
    },
    [player],
  )

  const loadFromLibrary = useCallback(
    async (entry: LibraryEntry) => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}midi/${entry.file}`)
        if (!res.ok) throw new Error(`Could not load ${entry.title}.`)
        openSong(await res.arrayBuffer(), entry.title)
      } catch (e) {
        setMessage(e instanceof Error ? e.message : 'Could not load that song.')
      }
    },
    [openSong],
  )

  useEffect(() => {
    let cancelled = false
    fetch(`${import.meta.env.BASE_URL}midi/index.json`)
      .then((r) => r.json() as Promise<LibraryEntry[]>)
      .then((entries) => {
        if (cancelled || entries.length === 0) return
        setLibrary(entries)
        setLibraryChoice(entries[0].file)
        void loadFromLibrary(entries[0])
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [loadFromLibrary])

  const onUpload = async (file: File | undefined) => {
    if (!file) return
    setLibraryChoice('')
    openSong(await file.arrayBuffer(), file.name.replace(/\.midi?$/i, ''))
  }

  // ---- Render -------------------------------------------------------------

  return (
    <main className="page">
      <header className="masthead">
        <D20 />
        <h1>DnD Radio</h1>
      </header>

      <section>
        <h2>Song</h2>
        <div className="row">
          <select
            value={libraryChoice}
            onChange={(e) => {
              const entry = library.find((l) => l.file === e.target.value)
              if (entry) {
                setLibraryChoice(entry.file)
                void loadFromLibrary(entry)
              }
            }}
            aria-label="Demo songs"
          >
            {libraryChoice === '' && <option value="">Your file</option>}
            {library.map((l) => (
              <option key={l.file} value={l.file}>
                {l.title}
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
      </section>

      <section>
        <div className="transport">
          <button className="primary" onClick={togglePlay} disabled={!song || busy}>
            {busy ? 'Loading…' : playing ? 'Pause' : 'Play'}
          </button>
          <button onClick={stop} disabled={!song}>
            Stop
          </button>
          <Clock getPosition={getPosition} duration={song?.duration ?? 0} />
          <label className="check">
            <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} />
            Loop
          </label>
        </div>

        {song && (
          <PianoRoll
            tracks={rollTracks}
            duration={song.duration}
            getPosition={getPosition}
            onSeek={seek}
          />
        )}

        <div className="sliders">
          <label>
            Tempo <span className="dim">×{tempo.toFixed(2)}</span>
            <input
              type="range"
              min={0.5}
              max={1.5}
              step={0.05}
              value={tempo}
              onChange={(e) => setTempo(Number(e.target.value))}
            />
          </label>
          <label>
            Volume
            <input
              type="range"
              min={0}
              max={127}
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
            />
          </label>
        </div>
        {message && <p className="message">{message}</p>}
      </section>

      <div className="grid">
        <section>
          <h2>Instruments</h2>
          <select
            value={instrumentSetId}
            onChange={(e) => {
              setInstrumentSetId(e.target.value)
              setOverrides({})
            }}
            aria-label="Instrument set"
          >
            {INSTRUMENT_SETS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <p className="hint">{instrumentSet.description}</p>
        </section>

        <section>
          <h2>Notes</h2>
          <div className="row">
            <select
              value={noteSetId}
              onChange={(e) => setNoteSetId(e.target.value)}
              aria-label="Note set"
            >
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
              value={keyChoice}
              onChange={(e) => setKeyChoice(e.target.value)}
              aria-label="Song key"
              disabled={!song || noteSet.intervals === null}
            >
              <option value="auto">Key: auto{detectedKey ? ` (${keyName(detectedKey)})` : ''}</option>
              {(['major', 'minor'] as const).flatMap((mode) =>
                PITCH_NAMES.map((name, tonic) => (
                  <option key={`${tonic}-${mode}`} value={`${tonic}-${mode}`}>
                    {name} {mode}
                  </option>
                )),
              )}
            </select>
          </div>
          <p className="hint">{noteSet.description}</p>
        </section>
      </div>

      {song && (
        <section>
          <h2>Tracks</h2>
          <ul className="tracks">
            {song.tracks.map((t, i) => {
              const override = overrides[t.index] ?? 'default'
              const defaultGm = assignVoices(song, instrumentSet).get(t.index) ?? null
              return (
                <li key={t.index}>
                  <span
                    className="dot"
                    style={{ background: TRACK_COLORS[i % TRACK_COLORS.length] }}
                  />
                  <span className="track-name">
                    {t.name}
                    {t.isPercussion && <span className="dim"> · drums</span>}
                  </span>
                  <select
                    value={override}
                    onChange={(e) =>
                      setOverrides((prev) => {
                        const next = { ...prev }
                        if (e.target.value === 'default') delete next[t.index]
                        else next[t.index] = e.target.value
                        return next
                      })
                    }
                    aria-label={`Instrument for ${t.name}`}
                  >
                    <option value="default">
                      Set: {defaultGm ? instrumentName(defaultGm) : 'Muted'}
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
        </section>
      )}

      <footer>
        Sounds load from a soundfont CDN the first time an instrument is used.
      </footer>
    </main>
  )
}
