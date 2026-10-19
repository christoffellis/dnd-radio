import { useEffect, useRef } from 'react'
import type { ThemeColors } from '../themes.ts'

/**
 * Wavy progress and loading indicators, after Material 3's wavy progress
 * indicators, with a little more magic: the wave's height breathes with the
 * music, the colour flows along it, and its glowing head sheds sparkles.
 */

interface Spark {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  age: number
  size: number
  color: string
}

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a))})`
}

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

function useCanvasLoop(
  draw: (g: CanvasRenderingContext2D, w: number, h: number, t: number, dt: number) => void,
) {
  const ref = useRef<HTMLCanvasElement>(null)
  const drawRef = useRef(draw)
  drawRef.current = draw

  useEffect(() => {
    const canvas = ref.current
    const g = canvas?.getContext('2d')
    if (!canvas || !g) return
    let w = 0
    let h = 0
    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      w = canvas.clientWidth
      h = canvas.clientHeight
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    let frame = 0
    let last = performance.now()
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      g.clearRect(0, 0, w, h)
      drawRef.current(g, w, h, now / 1000, dt)
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [])
  return ref
}

function updateSparks(g: CanvasRenderingContext2D, sparks: Spark[], dt: number) {
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i]
    s.age += dt
    if (s.age >= s.life) {
      sparks.splice(i, 1)
      continue
    }
    s.x += s.vx * dt
    s.y += s.vy * dt
    s.vy += 18 * dt
    const k = s.age / s.life
    const r = s.size * (1 - k * 0.6)
    const a = Math.sin(Math.PI * Math.min(1, k * 1.4 + 0.1))
    // Four-point twinkle.
    g.fillStyle = rgba(s.color, a)
    g.beginPath()
    g.moveTo(s.x, s.y - r * 2)
    g.quadraticCurveTo(s.x, s.y, s.x + r * 2, s.y)
    g.quadraticCurveTo(s.x, s.y, s.x, s.y + r * 2)
    g.quadraticCurveTo(s.x, s.y, s.x - r * 2, s.y)
    g.quadraticCurveTo(s.x, s.y, s.x, s.y - r * 2)
    g.fill()
  }
}

/** Stroke a sine wave from x0 to x1 with an amplitude envelope. */
function wavePath(
  g: CanvasRenderingContext2D,
  x0: number,
  x1: number,
  mid: number,
  amp: (x: number) => number,
  wavelength: number,
  phase: number,
) {
  g.beginPath()
  for (let x = x0; x <= x1; x += 1.5) {
    const y = mid + Math.sin((x / wavelength) * Math.PI * 2 - phase) * amp(x)
    if (x === x0) g.moveTo(x, y)
    else g.lineTo(x, y)
  }
  const yEnd = mid + Math.sin((x1 / wavelength) * Math.PI * 2 - phase) * amp(x1)
  g.lineTo(x1, yEnd)
  return yEnd
}

interface ProgressProps {
  /** 0..1, or null while loading (indeterminate). */
  getProgress: () => number | null
  playing: boolean
  colors: ThemeColors
  energyRef?: { current: number }
  label?: string
}

export function WaveProgress({ getProgress, playing, colors, energyRef, label }: ProgressProps) {
  const state = useRef({ amp: 0, phase: 0, sparks: [] as Spark[], spawn: 0, load: 0 })
  const reduced = useRef(false)
  useEffect(() => {
    reduced.current = reducedMotion()
  }, [])

  const ref = useCanvasLoop((g, w, h, t, dt) => {
    const st = state.current
    const mid = h / 2
    const progress = getProgress()
    const energy = Math.min(1.5, energyRef?.current ?? 0)
    const still = reduced.current
    const wavelength = 26

    if (progress === null) {
      // ---- Loading: a glowing wave packet sweeping across ----
      st.load += dt
      const cycle = 1.8
      const u = (st.load % cycle) / cycle
      const ease = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2
      const span = w * (0.25 + 0.2 * Math.sin(Math.PI * u))
      const center = -span / 2 + ease * (w + span)
      const x0 = Math.max(0, center - span / 2)
      const x1 = Math.min(w, center + span / 2)
      st.phase += dt * 9

      g.strokeStyle = rgba(colors.line, 0.9)
      g.lineWidth = 2
      g.lineCap = 'round'
      g.beginPath()
      g.moveTo(0, mid)
      g.lineTo(w, mid)
      g.stroke()

      if (x1 > x0 + 2) {
        const env = (x: number) => (still ? 0 : 4.5 * Math.sin(Math.PI * Math.min(1, Math.max(0, (x - (center - span / 2)) / span))))
        const grad = g.createLinearGradient(x0, 0, x1, 0)
        const hueShift = (Math.sin(t * 1.3) + 1) / 2
        grad.addColorStop(0, rgba(colors.accent2, 0.15))
        grad.addColorStop(0.5, rgba(hueShift > 0.5 ? colors.accent : colors.accent2, 1))
        grad.addColorStop(1, rgba(colors.accent, 0.95))
        // glow
        g.strokeStyle = rgba(colors.accent, 0.18)
        g.lineWidth = 7
        wavePath(g, x0, x1, mid, env, wavelength, st.phase)
        g.stroke()
        g.strokeStyle = grad
        g.lineWidth = 2.5
        const yHead = wavePath(g, x0, x1, mid, env, wavelength, st.phase)
        g.stroke()
        st.spawn -= dt
        if (!still && st.spawn <= 0 && x1 < w) {
          st.spawn = 0.05
          st.sparks.push({
            x: x1,
            y: yHead,
            vx: -20 - Math.random() * 40,
            vy: -10 - Math.random() * 20,
            life: 0.5 + Math.random() * 0.5,
            age: 0,
            size: 0.8 + Math.random() * 1,
            color: Math.random() < 0.7 ? colors.accent : colors.ink,
          })
        }
      }
      updateSparks(g, st.sparks, dt)
      return
    }

    // ---- Progress: wavy where played, flat where still to come ----
    const p = Math.min(1, Math.max(0, progress))
    const target = still ? 0 : playing ? 2.6 + energy * 2.4 : 0.8
    st.amp += (target - st.amp) * Math.min(1, dt * 4)
    st.phase += dt * (playing ? 5 + energy * 3 : 1.2)
    const head = 4 + p * (w - 12)
    const gap = 6

    // Track still to come, with Material's little stop dot at the end.
    if (head + gap < w - 4) {
      g.strokeStyle = colors.line
      g.lineWidth = 2
      g.lineCap = 'round'
      g.beginPath()
      g.moveTo(head + gap, mid)
      g.lineTo(w - 6, mid)
      g.stroke()
    }
    g.fillStyle = rgba(colors.accent, 0.8)
    g.beginPath()
    g.arc(w - 3, mid, 1.8, 0, Math.PI * 2)
    g.fill()

    // Played part: a travelling wave that settles to a line at both ends.
    const env = (x: number) => st.amp * Math.min(1, x / 14, Math.max(0, head - x) / 10)
    const grad = g.createLinearGradient(0, 0, Math.max(head, 1), 0)
    grad.addColorStop(0, rgba(colors.accent2, 0.9))
    grad.addColorStop(1, rgba(colors.accent, 1))
    g.lineCap = 'round'
    g.strokeStyle = rgba(colors.accent, 0.12 + energy * 0.1)
    g.lineWidth = 7
    wavePath(g, 2, head, mid, env, wavelength, st.phase)
    g.stroke()
    g.strokeStyle = grad
    g.lineWidth = 2.5
    wavePath(g, 2, head, mid, env, wavelength, st.phase)
    g.stroke()

    // The glowing head.
    const glowR = 7 + energy * 5 + Math.sin(t * 3) * 1.2
    const halo = g.createRadialGradient(head, mid, 0, head, mid, glowR)
    halo.addColorStop(0, rgba(colors.accent, 0.55))
    halo.addColorStop(1, rgba(colors.accent, 0))
    g.fillStyle = halo
    g.beginPath()
    g.arc(head, mid, glowR, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = colors.ink
    g.beginPath()
    g.arc(head, mid, 2.6, 0, Math.PI * 2)
    g.fill()

    if (playing && !still) {
      st.spawn -= dt * (0.6 + energy * 2.5)
      if (st.spawn <= 0) {
        st.spawn = 0.12
        st.sparks.push({
          x: head,
          y: mid,
          vx: -15 - Math.random() * 30,
          vy: -12 - Math.random() * 22,
          life: 0.6 + Math.random() * 0.6,
          age: 0,
          size: 0.8 + Math.random() * 1.1,
          color: Math.random() < 0.6 ? colors.accent : colors.accent2,
        })
      }
    }
    updateSparks(g, st.sparks, dt)
  })

  return <canvas ref={ref} className="wave" role="progressbar" aria-label={label ?? 'Progress'} />
}

/** A small wavy ring spinner (for buttons). */
export function WaveRing({ color, size = 22 }: { color: string; size?: number }) {
  const ref = useCanvasLoop((g, w, h, t) => {
    const cx = w / 2
    const cy = h / 2
    const r = Math.min(w, h) / 2 - 3.5
    const still = reducedMotion()
    const rot = t * 4.2
    const sweep = Math.PI * (0.55 + 0.4 * Math.sin(t * 2.6)) // arc grows and shrinks
    g.lineWidth = 2
    g.lineCap = 'round'
    g.strokeStyle = rgba(color, 0.25)
    g.beginPath()
    g.arc(cx, cy, r, 0, Math.PI * 2)
    g.stroke()
    g.strokeStyle = color
    g.beginPath()
    const steps = 48
    for (let i = 0; i <= steps; i++) {
      const a = rot + (sweep * i) / steps
      const wobble = still ? 0 : 1.3 * Math.sin(a * 9 - t * 10)
      const x = cx + Math.cos(a) * (r + wobble)
      const y = cy + Math.sin(a) * (r + wobble)
      if (i === 0) g.moveTo(x, y)
      else g.lineTo(x, y)
    }
    g.stroke()
    // A twinkle riding the leading edge.
    const a = rot + sweep
    const x = cx + Math.cos(a) * r
    const y = cy + Math.sin(a) * r
    const s = 1.6 + Math.sin(t * 12) * 0.6
    g.fillStyle = color
    g.beginPath()
    g.moveTo(x, y - s * 1.8)
    g.quadraticCurveTo(x, y, x + s * 1.8, y)
    g.quadraticCurveTo(x, y, x, y + s * 1.8)
    g.quadraticCurveTo(x, y, x - s * 1.8, y)
    g.quadraticCurveTo(x, y, x, y - s * 1.8)
    g.fill()
  })
  return <canvas ref={ref} className="wave-ring" style={{ width: size, height: size }} aria-hidden="true" />
}
