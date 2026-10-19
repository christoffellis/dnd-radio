import type { NoteEvent, Song, TrackData } from './types.ts'
import { child, children, parseXml, textOf, type XNode } from './xml.ts'

/**
 * MusicXML (score-partwise) -> Song.
 *
 * Handles chords, multiple voices (backup/forward), ties, multi-staff parts
 * (each staff becomes its own track), tempo marks and basic dynamics.
 * Repeats are played once, grace notes are skipped.
 */

/** Used when a score has no tempo marking (the spec's 120 feels rushed for hymns and madrigals). */
export const DEFAULT_BPM = 96

const STEPS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
const DYNAMICS: Record<string, number> = {
  ppp: 0.25,
  pp: 0.35,
  p: 0.5,
  mp: 0.6,
  mf: 0.7,
  f: 0.82,
  ff: 0.92,
  fff: 1,
  sf: 0.85,
  sfz: 0.85,
  fz: 0.85,
}

interface BeatNote {
  midi: number
  beat: number
  beats: number
  velocity: number
}

interface PartInfo {
  name: string
  program?: number
  percussion: boolean
  unpitched: Map<string, number>
}

function num(s: string | undefined, fallback = 0): number {
  const v = s === undefined ? NaN : Number(s)
  return Number.isFinite(v) ? v : fallback
}

function readPartList(score: XNode): Map<string, PartInfo> {
  const parts = new Map<string, PartInfo>()
  for (const sp of children(child(score, 'part-list'), 'score-part')) {
    const id = sp.attrs.id
    const midiInstruments = children(sp, 'midi-instrument')
    const first = midiInstruments[0]
    const program = first ? num(textOf(first, 'midi-program'), 0) - 1 : undefined
    const channel = first ? num(textOf(first, 'midi-channel'), 0) : 0
    const unpitched = new Map<string, number>()
    for (const mi of midiInstruments) {
      const u = textOf(mi, 'midi-unpitched')
      if (u) unpitched.set(mi.attrs.id, num(u) - 1)
    }
    parts.set(id, {
      name: textOf(sp, 'part-name') || textOf(sp, 'part-abbreviation') || id,
      program: program !== undefined && program >= 0 ? program : undefined,
      percussion: channel === 10,
      unpitched,
    })
  }
  return parts
}

/** Convert beats to seconds with a tempo map. */
function makeClock(tempos: { beat: number; bpm: number }[]) {
  const map = [...tempos].sort((a, b) => a.beat - b.beat)
  if (map.length === 0 || map[0].beat > 0) map.unshift({ beat: 0, bpm: map[0]?.bpm ?? DEFAULT_BPM })
  // Precompute seconds at each tempo change.
  const secs: number[] = [0]
  for (let i = 1; i < map.length; i++) {
    secs.push(secs[i - 1] + ((map[i].beat - map[i - 1].beat) * 60) / map[i - 1].bpm)
  }
  return (beat: number) => {
    let i = map.length - 1
    while (i > 0 && map[i].beat > beat) i--
    return secs[i] + ((beat - map[i].beat) * 60) / map[i].bpm
  }
}

export function parseMusicXml(source: string, fallbackName: string): Song {
  const doc = parseXml(source)
  const score = child(doc, 'score-partwise')
  if (!score) {
    if (child(doc, 'score-timewise')) throw new Error('Timewise MusicXML is not supported yet.')
    throw new Error('That doesn’t look like a MusicXML score.')
  }

  const partInfo = readPartList(score)
  const tempos: { beat: number; bpm: number }[] = []
  // Notes per track key ("partId:staff").
  const byTrack = new Map<string, { info: PartInfo; staff: number; notes: BeatNote[] }>()
  const trackOrder: string[] = []
  const barBeats: number[] = []

  for (const [partIndex, part] of children(score, 'part').entries()) {
    const info = partInfo.get(part.attrs.id) ?? {
      name: part.attrs.id,
      percussion: false,
      unpitched: new Map<string, number>(),
    }
    let divisions = 1
    let measureStart = 0
    let velocity = 0.7
    let staves = 1
    const lastStart = new Map<string, number>() // per voice, for <chord/>
    const openTies = new Map<string, BeatNote>() // "staff:midi" -> note waiting for a tie stop

    for (const measure of children(part, 'measure')) {
      if (partIndex === 0) barBeats.push(measureStart)
      let cursor = measureStart
      let measureEnd = measureStart

      for (const el of measure.children) {
        switch (el.name) {
          case 'attributes': {
            divisions = num(textOf(el, 'divisions'), divisions) || divisions
            staves = Math.max(staves, num(textOf(el, 'staves'), 1))
            break
          }
          case 'sound': {
            const t = num(el.attrs.tempo, 0)
            if (t > 0) tempos.push({ beat: cursor, bpm: t })
            break
          }
          case 'direction': {
            const sound = child(el, 'sound')
            const t = num(sound?.attrs.tempo, 0)
            if (t > 0) {
              tempos.push({ beat: cursor, bpm: t })
            } else {
              for (const dt of children(el, 'direction-type')) {
                const metronome = child(dt, 'metronome')
                const perMinute = num(textOf(metronome, 'per-minute'), 0)
                if (metronome && perMinute > 0) {
                  const unit = textOf(metronome, 'beat-unit') ?? 'quarter'
                  const units: Record<string, number> = { whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25 }
                  const dotted = child(metronome, 'beat-unit-dot') ? 1.5 : 1
                  tempos.push({ beat: cursor, bpm: perMinute * (units[unit] ?? 1) * dotted })
                }
                for (const dyn of children(dt, 'dynamics')) {
                  const mark = dyn.children[0]?.name
                  if (mark && DYNAMICS[mark] !== undefined) velocity = DYNAMICS[mark]
                }
              }
            }
            const dyn = num(sound?.attrs.dynamics, 0)
            if (dyn > 0) velocity = Math.min(1, (dyn / 100) * 0.7)
            break
          }
          case 'backup':
            cursor -= num(textOf(el, 'duration')) / divisions
            break
          case 'forward':
            cursor += num(textOf(el, 'duration')) / divisions
            measureEnd = Math.max(measureEnd, cursor)
            break
          case 'note': {
            if (child(el, 'grace') || child(el, 'cue')) break
            const beats = num(textOf(el, 'duration')) / divisions
            const voice = textOf(el, 'voice') ?? '1'
            const staff = staves > 1 ? num(textOf(el, 'staff'), 1) : 1
            const isChord = !!child(el, 'chord')
            const start = isChord ? (lastStart.get(voice) ?? cursor) : cursor
            if (!isChord) {
              lastStart.set(voice, cursor)
              cursor += beats
              measureEnd = Math.max(measureEnd, cursor)
            }
            if (child(el, 'rest')) break

            let midi: number
            const pitch = child(el, 'pitch')
            let percussion = info.percussion
            if (pitch) {
              midi =
                (num(textOf(pitch, 'octave'), 4) + 1) * 12 +
                (STEPS[textOf(pitch, 'step') ?? 'C'] ?? 0) +
                Math.round(num(textOf(pitch, 'alter'), 0))
            } else {
              const instrumentId = child(el, 'instrument')?.attrs.id
              midi = (instrumentId && info.unpitched.get(instrumentId)) || 38
              percussion = true
            }
            if (beats <= 0) break

            const key = `${staff}:${midi}`
            const ties = children(el, 'tie').map((t) => t.attrs.type)
            const open = openTies.get(key)
            if (ties.includes('stop') && open && Math.abs(open.beat + open.beats - start) < 1e-6) {
              open.beats += beats
              if (!ties.includes('start')) openTies.delete(key)
            } else {
              const note: BeatNote = { midi, beat: start, beats, velocity }
              const trackKey = `${part.attrs.id}:${percussion ? 'perc' : staff}`
              let track = byTrack.get(trackKey)
              if (!track) {
                track = { info: { ...info, percussion }, staff, notes: [] }
                byTrack.set(trackKey, track)
                trackOrder.push(trackKey)
              }
              track.notes.push(note)
              if (ties.includes('start')) openTies.set(key, note)
            }
            break
          }
        }
      }
      measureStart = measureEnd
    }
  }

  const toSec = makeClock(tempos)
  const tracks: TrackData[] = []
  let duration = 0
  trackOrder.forEach((key, index) => {
    const t = byTrack.get(key)!
    const multiStaff = [...byTrack.keys()].filter((k) => k.startsWith(key.split(':')[0] + ':')).length > 1
    const notes: NoteEvent[] = t.notes
      .map((n) => {
        const time = toSec(n.beat)
        return { midi: n.midi, time, duration: toSec(n.beat + n.beats) - time, velocity: n.velocity }
      })
      .sort((a, b) => a.time - b.time)
    for (const n of notes) duration = Math.max(duration, n.time + n.duration)
    tracks.push({
      index,
      name: multiStaff && !t.info.percussion ? `${t.info.name} (${t.staff === 1 ? 'upper' : 'lower'})` : t.info.name,
      channel: t.info.percussion ? 9 : index,
      isPercussion: t.info.percussion,
      program: t.info.program,
      notes,
    })
  })

  const work = child(score, 'work')
  const title = textOf(score, 'movement-title') || textOf(work, 'work-title') || fallbackName
  const bars = barBeats.map(toSec).filter((b, i, all) => b < duration - 1e-6 && (i === 0 || b > all[i - 1] + 1e-6))
  return { name: title, duration, tracks, bars }
}
