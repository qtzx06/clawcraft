import { useRef, useEffect } from 'react'

interface Strand {
  points: { x: number; y: number }[]
  color: string
  width: number
  speed: number
  offset: number
  amplitude: number
  frequency: number
}

const COLORS = [
  'rgba(200, 168, 78, 0.6)',
  'rgba(212, 175, 55, 0.5)',
  'rgba(160, 133, 53, 0.4)',
  'rgba(245, 230, 163, 0.35)',
  'rgba(139, 105, 20, 0.45)',
  'rgba(200, 168, 78, 0.3)',
]

function createStrand(w: number, h: number, i: number): Strand {
  const numPoints = 80
  const points = Array.from({ length: numPoints }, (_, j) => ({
    x: (j / (numPoints - 1)) * w,
    y: h / 2,
  }))
  return {
    points,
    color: COLORS[i % COLORS.length],
    width: 1.2 + Math.random() * 2.5,
    speed: 0.3 + Math.random() * 0.6,
    offset: Math.random() * Math.PI * 2,
    amplitude: 8 + Math.random() * 20,
    frequency: 0.02 + Math.random() * 0.03,
  }
}

export default function RibbonCanvas({ className = '' }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const strandsRef = useRef<Strand[]>([])
  const rafRef = useRef(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    ctx.scale(dpr, dpr)

    const w = rect.width
    const h = rect.height
    const numStrands = 12

    strandsRef.current = Array.from({ length: numStrands }, (_, i) =>
      createStrand(w, h, i)
    )

    let time = 0

    function render() {
      rafRef.current = requestAnimationFrame(render)
      time += 0.016

      ctx!.clearRect(0, 0, w, h)

      for (const strand of strandsRef.current) {
        const { points, color, width, speed, offset, amplitude, frequency } = strand

        for (let j = 0; j < points.length; j++) {
          const t = j / (points.length - 1)
          const wave1 = Math.sin(t * frequency * 200 + time * speed + offset) * amplitude
          const wave2 = Math.sin(t * frequency * 120 + time * speed * 0.7 + offset * 1.3) * amplitude * 0.5
          const wave3 = Math.sin(t * frequency * 300 + time * speed * 1.3 + offset * 0.7) * amplitude * 0.2
          const taper = Math.sin(t * Math.PI) // fade at edges
          points[j].y = h / 2 + (wave1 + wave2 + wave3) * taper
        }

        ctx!.beginPath()
        ctx!.moveTo(points[0].x, points[0].y)

        for (let j = 1; j < points.length - 1; j++) {
          const cx = (points[j].x + points[j + 1].x) / 2
          const cy = (points[j].y + points[j + 1].y) / 2
          ctx!.quadraticCurveTo(points[j].x, points[j].y, cx, cy)
        }

        ctx!.strokeStyle = color
        ctx!.lineWidth = width
        ctx!.lineCap = 'round'
        ctx!.stroke()
      }
    }

    rafRef.current = requestAnimationFrame(render)

    return () => cancelAnimationFrame(rafRef.current)
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: '100%', height: '100%' }}
      aria-hidden="true"
    />
  )
}
