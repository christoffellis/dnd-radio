/**
 * A UTC clock that every listener agrees on, independent of the device clock
 * (which can easily be seconds off). It asks a public time server for the
 * current time a few times, keeps the sample with the shortest round trip and
 * assumes the server answered halfway through it (NTP-style).
 *
 * After syncing it runs on performance.now(), which is monotonic, so device
 * clock changes or NTP jumps on the device don't disturb playback.
 */

export type ClockSource = 'time server' | 'page server' | 'device'

export interface ClockStatus {
  source: ClockSource
  /** Worst-case error of the estimate in ms (half the round trip, or more). */
  uncertaintyMs: number
}

interface Sample {
  serverMs: number
  /** performance.now() at the moment the server is assumed to have read its clock. */
  perfAtServer: number
  rtt: number
  error: number
}

const TIME_URL = 'https://time.akamai.com/?iso&ms'
const SAMPLES = 5

export class SyncedClock {
  private serverMsAtSync = Date.now()
  private perfAtSync = performance.now()
  status: ClockStatus = { source: 'device', uncertaintyMs: Infinity }

  /** Current UTC time in ms, as agreed with the time server. */
  now(): number {
    return this.atPerf(performance.now())
  }

  /** UTC time in ms at a given performance.now() timestamp. */
  atPerf(perfMs: number): number {
    return this.serverMsAtSync + (perfMs - this.perfAtSync)
  }

  private adopt(sample: Sample, source: ClockSource): void {
    this.serverMsAtSync = sample.serverMs
    this.perfAtSync = sample.perfAtServer
    this.status = { source, uncertaintyMs: Math.round(sample.error) }
  }

  async sync(fetchImpl: typeof fetch = fetch.bind(globalThis)): Promise<ClockStatus> {
    const fromTimeServer = await sampleTimeServer(fetchImpl)
    if (fromTimeServer) {
      this.adopt(fromTimeServer, 'time server')
      return this.status
    }
    const fromPage = await samplePageDate(fetchImpl)
    if (fromPage) {
      this.adopt(fromPage, 'page server')
      return this.status
    }
    this.serverMsAtSync = Date.now()
    this.perfAtSync = performance.now()
    this.status = { source: 'device', uncertaintyMs: Infinity }
    return this.status
  }
}

/** Pick the sample with the smallest round trip: it has the least error. */
export function bestSample<T extends { rtt: number }>(samples: T[]): T | null {
  let best: T | null = null
  for (const s of samples) if (!best || s.rtt < best.rtt) best = s
  return best
}

async function sampleTimeServer(fetchImpl: typeof fetch): Promise<Sample | null> {
  const samples: Sample[] = []
  for (let i = 0; i < SAMPLES; i++) {
    try {
      const sent = performance.now()
      const res = await fetchImpl(`${TIME_URL}&_=${Math.random().toString(36).slice(2)}`, {
        cache: 'no-store',
      })
      const body = (await res.text()).trim()
      const received = performance.now()
      const serverMs = Date.parse(body)
      if (!res.ok || Number.isNaN(serverMs)) continue
      const rtt = received - sent
      samples.push({ serverMs, perfAtServer: sent + rtt / 2, rtt, error: rtt / 2 + 1 })
    } catch {
      // Blocked or offline: fall through to the next source.
      break
    }
  }
  return bestSample(samples)
}

/**
 * Fallback: the Date header of our own page (same origin, so it's readable).
 * It only has whole seconds, so the estimate is good to about half a second.
 */
async function samplePageDate(fetchImpl: typeof fetch): Promise<Sample | null> {
  const samples: Sample[] = []
  for (let i = 0; i < 3; i++) {
    try {
      const sent = performance.now()
      const res = await fetchImpl(`${location.pathname}?_=${Date.now()}`, {
        method: 'HEAD',
        cache: 'no-store',
      })
      const received = performance.now()
      const header = res.headers.get('date')
      const serverMs = header ? Date.parse(header) : NaN
      if (Number.isNaN(serverMs)) continue
      const rtt = received - sent
      // The header truncates to the second, so the true time is ~0.5 s later.
      samples.push({ serverMs: serverMs + 500, perfAtServer: sent + rtt / 2, rtt, error: rtt / 2 + 500 })
    } catch {
      break
    }
  }
  return bestSample(samples)
}
