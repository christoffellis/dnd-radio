/**
 * The radio plays a fixed playlist on a loop that started at EPOCH_MS. Anyone
 * who knows the current UTC time and the song durations can work out exactly
 * which song is playing and how far into it, so every listener hears the same
 * thing without any server.
 */

/** 2026-01-01T00:00:00Z. Changing this shifts the whole station. */
export const EPOCH_MS = Date.UTC(2026, 0, 1)

/** Silence between songs, in seconds. */
export const GAP = 2

export interface Slot {
  /** Index into the playlist. */
  index: number
  /** Start of this song within one cycle, seconds. */
  start: number
  duration: number
}

export interface Schedule {
  slots: Slot[]
  /** Length of one full cycle of the playlist, seconds. */
  cycle: number
}

export interface Location {
  index: number
  /** Seconds into the song (can exceed the duration during the gap). */
  offset: number
  /** UTC ms at which this play of the song started. */
  startMs: number
  nextIndex: number
  /** UTC ms at which the next song starts. */
  nextStartMs: number
}

export function buildSchedule(durations: number[], gap = GAP): Schedule {
  const slots: Slot[] = []
  let t = 0
  durations.forEach((duration, index) => {
    // Round so every client computes bit-identical slot boundaries.
    const d = Math.round(Math.max(duration, 0.5) * 1000) / 1000
    slots.push({ index, start: t, duration: d })
    t += d + gap
  })
  return { slots, cycle: t }
}

export function locate(schedule: Schedule, nowMs: number): Location | null {
  const { slots, cycle } = schedule
  if (slots.length === 0 || cycle <= 0) return null

  const elapsed = (nowMs - EPOCH_MS) / 1000
  const cycleNumber = Math.floor(elapsed / cycle)
  const within = elapsed - cycleNumber * cycle
  const cycleStartMs = EPOCH_MS + cycleNumber * cycle * 1000

  let i = slots.length - 1
  for (let k = 0; k < slots.length; k++) {
    if (within < slots[k].start) {
      i = k - 1
      break
    }
  }
  const slot = slots[Math.max(i, 0)]
  const nextIsNewCycle = slot.index === slots.length - 1
  const next = nextIsNewCycle ? slots[0] : slots[slot.index + 1]
  return {
    index: slot.index,
    offset: within - slot.start,
    startMs: cycleStartMs + slot.start * 1000,
    nextIndex: next.index,
    nextStartMs: cycleStartMs + (nextIsNewCycle ? cycle : next.start) * 1000,
  }
}
