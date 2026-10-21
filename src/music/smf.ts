import type { NoteEvent, Song, TrackData } from './types.ts'

/**
 * A small, dependency-free Standard MIDI File reader with a tempo map. The app
 * plays MIDI through @tonejs/midi; this one exists so build scripts can read
 * MIDI under plain Node (durations, instruments, tempo) without installing it.
 */
export function parseSmf(data: ArrayBuffer, fallbackName: string): Song {
  const b = new Uint8Array(data)
  const dv = new DataView(data)
  let p = 0
  const str = (n: number) => {
    let s = ''
    for (let i = 0; i < n; i++) s += String.fromCharCode(b[p + i])
    p += n
    return s
  }
  const vlq = () => {
    let v = 0
    let x: number
    do {
      x = b[p++]
      v = (v << 7) | (x & 127)
    } while (x & 128)
    return v
  }
  if (str(4) !== 'MThd') throw new Error('Not a MIDI file')
  const headerLen = dv.getUint32(p)
  p += 4
  const ntrk = dv.getUint16(p + 2)
  const ppq = dv.getUint16(p + 4)
  p += headerLen

  const tempos: { tick: number; us: number }[] = []
  let timeSig: { tick: number; num: number; den: number } | null = null
  let title = ''
  const raw: { name: string; channel: number; program: number; notes: { tick: number; end: number; midi: number; vel: number }[] }[] = []

  for (let t = 0; t < ntrk && p < b.length; t++) {
    if (str(4) !== 'MTrk') break
    const end = dv.getUint32(p) + p + 4
    p += 4
    let tick = 0
    let running = 0 // the last channel status; meta and sysex events don't change it
    let name = ''
    let channel = -1
    let program = 0
    const open = new Map<number, { tick: number; vel: number }[]>()
    const notes: { tick: number; end: number; midi: number; vel: number }[] = []
    while (p < end) {
      tick += vlq()
      let status = running
      if (b[p] & 0x80) {
        status = b[p++]
        if (status < 0xf0) running = status
      }
      if (status === 0xff) {
        const type = b[p++]
        const len = vlq()
        if (type === 0x03) name = new TextDecoder('latin1').decode(b.subarray(p, p + len)).trim()
        if (type === 0x51) tempos.push({ tick, us: (b[p] << 16) | (b[p + 1] << 8) | b[p + 2] })
        if (type === 0x58 && !timeSig) timeSig = { tick, num: b[p], den: 2 ** b[p + 1] }
        p += len
      } else if (status === 0xf0 || status === 0xf7) {
        const len = vlq() // (not `p += vlq()`: that adds to p as it was before the length was read)
        p += len
      } else {
        const hi = status & 0xf0
        const ch = status & 15
        if (hi === 0x90 && b[p + 1] > 0) {
          const key = (ch << 8) | b[p]
          const list = open.get(key) ?? []
          list.push({ tick, vel: b[p + 1] })
          open.set(key, list)
          if (channel < 0) channel = ch
          p += 2
        } else if (hi === 0x80 || hi === 0x90) {
          const key = (ch << 8) | b[p]
          const o = open.get(key)?.shift()
          if (o) notes.push({ tick: o.tick, end: tick, midi: b[p], vel: o.vel })
          p += 2
        } else if (hi === 0xc0) {
          program = b[p]
          p += 1
        } else if (hi === 0xd0) p += 1
        else p += 2
      }
    }
    p = end
    if (t === 0) title = name
    raw.push({ name, channel: Math.max(0, channel), program, notes })
  }

  // Tick -> seconds through the tempo map.
  tempos.sort((a, c) => a.tick - c.tick)
  const map = tempos.length && tempos[0].tick === 0 ? tempos : [{ tick: 0, us: 500000 }, ...tempos]
  const secs: number[] = [0]
  for (let i = 1; i < map.length; i++) secs.push(secs[i - 1] + ((map[i].tick - map[i - 1].tick) * map[i - 1].us) / 1e6 / ppq)
  const toSec = (tick: number) => {
    let i = map.length - 1
    while (i > 0 && map[i].tick > tick) i--
    return secs[i] + ((tick - map[i].tick) * map[i].us) / 1e6 / ppq
  }

  const tracks: TrackData[] = []
  let duration = 0
  raw.forEach((r, i) => {
    if (r.notes.length === 0) return
    const notes: NoteEvent[] = r.notes
      .map((n) => {
        const time = toSec(n.tick)
        return { midi: n.midi, time, duration: toSec(n.end) - time, velocity: n.vel / 127 }
      })
      .sort((a, c) => a.time - c.time)
    for (const n of notes) duration = Math.max(duration, n.time + n.duration)
    tracks.push({
      index: i,
      name: r.name || `Track ${i + 1}`,
      channel: r.channel,
      isPercussion: r.channel === 9,
      program: r.program,
      notes,
    })
  })

  return {
    name: title || fallbackName,
    duration,
    tracks,
    bpm: map[0] ? Math.round((60e6 / map[0].us) * 100) / 100 : undefined,
  }
}
