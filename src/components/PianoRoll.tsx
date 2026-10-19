import { useEffect, useRef } from 'react'
import type { NoteEvent } from '../music/types.ts'

export interface RollTrack {
  color: string
  muted: boolean
  notes: NoteEvent[]
}

interface Props {
  tracks: RollTrack[]
  duration: number
  getPosition: () => number
  onSeek: (seconds: number) => void
}

const HEIGHT = 180

/** Minimal piano roll: static notes layer + a moving playhead. */
export default function PianoRoll({ tracks, duration, getPosition, onSeek }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const layerRef = useRef<HTMLCanvasElement | null>(null)
  const sizeRef = useRef({ w: 0, h: HEIGHT, dpr: 1 })

  // Draw notes whenever data or size changes.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const draw = () => {
      const dpr = window.devicePixelRatio || 1
      const w = canvas.clientWidth
      const h = HEIGHT
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      sizeRef.current = { w, h, dpr }

      const layer = document.createElement('canvas')
      layer.width = canvas.width
      layer.height = canvas.height
      const g = layer.getContext('2d')!
      g.scale(dpr, dpr)

      let lo = 127
      let hi = 0
      for (const t of tracks) {
        for (const n of t.notes) {
          lo = Math.min(lo, n.midi)
          hi = Math.max(hi, n.midi)
        }
      }
      if (lo > hi) {
        lo = 48
        hi = 72
      }
      lo -= 2
      hi += 2
      const span = hi - lo + 1
      const rowH = h / span
      const pxPerSec = w / Math.max(duration, 1)

      // Faint octave lines at every C.
      g.strokeStyle = 'rgba(184, 150, 90, 0.12)'
      g.lineWidth = 1
      for (let m = lo; m <= hi; m++) {
        if (m % 12 === 0) {
          const y = h - (m - lo + 0.5) * rowH
          g.beginPath()
          g.moveTo(0, y)
          g.lineTo(w, y)
          g.stroke()
        }
      }

      for (const t of tracks) {
        g.fillStyle = t.color
        g.globalAlpha = t.muted ? 0.18 : 0.9
        for (const n of t.notes) {
          const x = n.time * pxPerSec
          const y = h - (n.midi - lo + 1) * rowH
          g.fillRect(x, y + 0.5, Math.max(1.5, n.duration * pxPerSec - 1), Math.max(2, rowH - 1))
        }
      }
      layerRef.current = layer
    }

    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [tracks, duration])

  // Playhead animation loop.
  useEffect(() => {
    let frame = 0
    const tick = () => {
      const canvas = canvasRef.current
      const layer = layerRef.current
      if (canvas && layer) {
        const { w, h, dpr } = sizeRef.current
        const g = canvas.getContext('2d')!
        g.setTransform(1, 0, 0, 1, 0, 0)
        g.clearRect(0, 0, canvas.width, canvas.height)
        g.drawImage(layer, 0, 0)
        g.scale(dpr, dpr)
        const x = (Math.min(getPosition(), duration) / Math.max(duration, 1)) * w
        g.fillStyle = '#e8dcc2'
        g.fillRect(x, 0, 1.5, h)
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [getPosition, duration])

  return (
    <canvas
      ref={canvasRef}
      className="roll"
      style={{ height: HEIGHT }}
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect()
        onSeek(((e.clientX - rect.left) / rect.width) * duration)
      }}
      aria-label="Piano roll. Click to seek."
    />
  )
}
