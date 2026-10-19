import { useEffect, useMemo, useRef } from 'react'
import type { PlayTrack } from '../music/engine.ts'
import type { Motif, ThemeColors } from '../themes.ts'

interface Props {
  tracks: PlayTrack[]
  motif: Motif
  colors: ThemeColors
  /** Song position in seconds, or null when nothing is playing. */
  getPosition: () => number | null
}

interface Onset {
  time: number
  midi: number
  velocity: number
}

interface Particle {
  /** The motif the particle was born with; theme switches don't redraw old ones. */
  motif: Motif
  x: number
  y: number
  vx: number
  vy: number
  size: number
  life: number
  age: number
  spin: number
  angle: number
  color: string
}

const MAX_PARTICLES = 260

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex)
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, alpha))})`
}

const rand = (a: number, b: number) => a + Math.random() * (b - a)

/** Find the first onset at or after `time`. */
function seekIndex(onsets: Onset[], time: number): number {
  let lo = 0
  let hi = onsets.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (onsets[mid].time < time) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * Ambient animation that reacts to the notes being heard. Each theme has its
 * own motif; every note onset spawns particles at a position set by pitch.
 */
export default function Visualizer({ tracks, motif, colors, getPosition }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const onsets = useMemo<Onset[]>(() => {
    const all: Onset[] = []
    for (const t of tracks) for (const n of t.notes) all.push({ time: n.time, midi: n.midi, velocity: n.velocity })
    return all.sort((a, b) => a.time - b.time)
  }, [tracks])

  // Keep the latest props in refs so the animation loop never restarts.
  const live = useRef({ onsets, motif, colors, getPosition })
  live.current = { onsets, motif, colors, getPosition }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const g = canvas.getContext('2d')
    if (!g) return

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const particles: Particle[] = []
    let energy = 0
    let lastPos: number | null = null
    let cursor = 0
    let lastFrame = performance.now()
    let ambientTimer = 0
    let frame = 0
    let width = 0
    let height = 0

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      width = canvas.clientWidth
      height = canvas.clientHeight
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)

    const spawn = (x: number, strength: number, ambient: boolean) => {
      if (reduced || particles.length >= MAX_PARTICLES) return
      const { motif: m, colors: c } = live.current
      const pick = Math.random() < 0.7 ? c.accent : c.accent2
      const p: Particle = {
        motif: m,
        x,
        y: height,
        vx: 0,
        vy: 0,
        size: 2,
        life: 2,
        age: 0,
        spin: 0,
        angle: rand(0, Math.PI * 2),
        color: pick,
      }
      switch (m) {
        case 'motes':
          p.y = rand(height * 0.25, height * 0.85)
          p.vx = rand(-6, 6)
          p.vy = rand(-14, -4)
          p.size = rand(1.2, 2.6) * (0.8 + strength * 0.6)
          p.life = rand(3, 5.5)
          break
        case 'embers':
          p.y = height + 4
          p.vx = rand(-12, 12)
          p.vy = rand(-95, -45) * (0.7 + strength * 0.5)
          p.size = rand(1.2, 2.4)
          p.life = rand(1.6, 2.8)
          p.color = Math.random() < 0.5 ? c.accent : c.accent2
          break
        case 'leaves':
          p.y = ambient ? -8 : rand(-8, height * 0.3)
          p.vx = rand(8, 26)
          p.vy = rand(14, 32)
          p.size = rand(3, 5.5) * (0.8 + strength * 0.4)
          p.life = rand(4, 7)
          p.spin = rand(-2, 2)
          break
        case 'petals':
          p.y = ambient ? -8 : rand(-8, height * 0.35)
          p.vx = rand(10, 30)
          p.vy = rand(12, 26)
          p.size = rand(2.5, 4.5) * (0.8 + strength * 0.4)
          p.life = rand(4.5, 7)
          p.spin = rand(-1.5, 1.5)
          p.color = Math.random() < 0.65 ? c.accent2 : c.accent
          break
        case 'bubbles':
          p.y = height - rand(0, 18)
          p.vx = rand(-4, 4)
          p.vy = rand(-50, -22) * (0.8 + strength * 0.4)
          p.size = rand(2, 6) * (0.7 + strength * 0.6)
          p.life = rand(2.5, 4.5)
          break
        case 'fog':
          p.y = rand(height * 0.2, height * 0.9)
          p.vx = rand(-10, 10)
          p.vy = rand(-3, 3)
          p.size = ambient ? rand(50, 110) : rand(12, 22) * (0.8 + strength)
          p.life = ambient ? rand(6, 10) : rand(1.2, 2)
          p.spin = ambient ? 0 : 1 // 1 = expanding ring
          break
        case 'sparkles':
          p.x = x + rand(-30, 30)
          p.y = rand(height * 0.1, height * 0.85)
          p.size = rand(3, 7) * (0.7 + strength * 0.6)
          p.life = rand(0.8, 1.6)
          p.color = Math.random() < 0.75 ? c.accent : c.ink
          break
      }
      particles.push(p)
    }

    const draw = (p: Particle) => {
      const m = p.motif
      const k = p.age / p.life
      const fade = k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85
      switch (m) {
        case 'motes':
        case 'embers': {
          g.fillStyle = rgba(p.color, fade * 0.18)
          g.beginPath()
          g.arc(p.x, p.y, p.size * 3, 0, Math.PI * 2)
          g.fill()
          g.fillStyle = rgba(p.color, fade * (m === 'embers' ? 0.95 : 0.8))
          g.beginPath()
          g.arc(p.x, p.y, p.size, 0, Math.PI * 2)
          g.fill()
          break
        }
        case 'leaves':
        case 'petals': {
          g.save()
          g.translate(p.x, p.y)
          g.rotate(p.angle)
          g.fillStyle = rgba(p.color, fade * 0.75)
          g.beginPath()
          g.ellipse(0, 0, p.size * 1.6, p.size * (m === 'leaves' ? 0.6 : 0.8), 0, 0, Math.PI * 2)
          g.fill()
          g.restore()
          break
        }
        case 'bubbles': {
          g.strokeStyle = rgba(p.color, fade * 0.7)
          g.lineWidth = 1.2
          g.beginPath()
          g.arc(p.x, p.y, p.size, 0, Math.PI * 2)
          g.stroke()
          break
        }
        case 'fog': {
          if (p.spin === 1) {
            g.strokeStyle = rgba(p.color, (1 - k) * 0.45)
            g.lineWidth = 1.5
            g.beginPath()
            g.arc(p.x, p.y, p.size * (1 + k * 3), 0, Math.PI * 2)
            g.stroke()
          } else {
            const grad = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size)
            grad.addColorStop(0, rgba(p.color, fade * 0.12))
            grad.addColorStop(1, rgba(p.color, 0))
            g.fillStyle = grad
            g.beginPath()
            g.arc(p.x, p.y, p.size, 0, Math.PI * 2)
            g.fill()
          }
          break
        }
        case 'sparkles': {
          const s = p.size * Math.sin(Math.PI * k)
          g.fillStyle = rgba(p.color, 0.9 * Math.sin(Math.PI * k))
          g.beginPath()
          g.moveTo(p.x, p.y - s)
          g.quadraticCurveTo(p.x, p.y, p.x + s, p.y)
          g.quadraticCurveTo(p.x, p.y, p.x, p.y + s)
          g.quadraticCurveTo(p.x, p.y, p.x - s, p.y)
          g.quadraticCurveTo(p.x, p.y, p.x, p.y - s)
          g.fill()
          break
        }
      }
    }

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - lastFrame) / 1000)
      lastFrame = now
      const { onsets: list, motif: m, colors: c, getPosition: pos } = live.current

      // Spawn on note onsets heard since the last frame.
      const p = pos()
      if (p === null) {
        lastPos = null
      } else {
        if (lastPos === null || p < lastPos - 0.25 || p > lastPos + 1) {
          cursor = seekIndex(list, p)
        } else {
          let spawned = 0
          while (cursor < list.length && list[cursor].time <= p) {
            const o = list[cursor++]
            if (o.time <= lastPos) continue
            energy = Math.min(1.5, energy + 0.06 + o.velocity * 0.08)
            if (spawned++ < 10) {
              const x = width * (0.08 + 0.84 * Math.min(1, Math.max(0, (o.midi - 36) / 60)))
              spawn(x + rand(-12, 12), o.velocity, false)
            }
          }
        }
        lastPos = p
      }

      // A little ambient life even in silence.
      ambientTimer -= dt
      if (ambientTimer <= 0) {
        ambientTimer = m === 'fog' ? 1.4 : p === null ? 0.9 : 0.5
        spawn(rand(0, width), 0.3, true)
      }
      energy *= Math.pow(0.35, dt)

      g.clearRect(0, 0, width, height)

      // Glow that breathes with the music.
      const glow = g.createRadialGradient(width / 2, height * 1.1, 0, width / 2, height * 1.1, height * 1.4)
      glow.addColorStop(0, rgba(c.accent, 0.1 + energy * 0.12))
      glow.addColorStop(1, rgba(c.accent, 0))
      g.fillStyle = glow
      g.fillRect(0, 0, width, height)

      if (m === 'bubbles') {
        // Gentle swell along the bottom.
        g.strokeStyle = rgba(c.accent, 0.35)
        g.lineWidth = 1.5
        g.beginPath()
        for (let x = 0; x <= width; x += 8) {
          const y = height - 10 - Math.sin(x / 38 + now / 700) * (3 + energy * 6)
          if (x === 0) g.moveTo(x, y)
          else g.lineTo(x, y)
        }
        g.stroke()
      }

      for (let i = particles.length - 1; i >= 0; i--) {
        const q = particles[i]
        q.age += dt
        if (q.age >= q.life || q.y < -40 || q.y > height + 40 || q.x < -60 || q.x > width + 60) {
          particles.splice(i, 1)
          continue
        }
        const wobble = q.motif === 'embers' || q.motif === 'bubbles' ? Math.sin(q.age * 4 + q.angle) * 10 : 0
        q.x += (q.vx + wobble) * dt
        q.y += q.vy * dt
        q.angle += q.spin * dt
        draw(q)
      }

      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [])

  return <canvas ref={canvasRef} className="visualizer" aria-hidden="true" />
}
