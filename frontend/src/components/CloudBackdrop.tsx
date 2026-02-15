import { useEffect, useRef } from 'react'

// only top cloud bank — bottom fades to dark
const layers = [
  { src: '/backgrounds/pastel-clouds-overlay-top.png', className: 'absolute top-0 left-0 w-full', opacity: 1, drift: 8, jitter: 1.2, speed: 25, style: { height: '55%', objectFit: 'cover' as const, objectPosition: 'center top' } },
]

const JITTER_FPS = 8
const JITTER_INTERVAL = 1000 / JITTER_FPS

export default function CloudBackdrop() {
  const layerRefs = useRef<(HTMLImageElement | null)[]>([])
  const rafRef = useRef<number>(0)
  const lastJitterRef = useRef<number>(0)
  const startRef = useRef<number>(0)

  useEffect(() => {
    const els = layerRefs.current.filter(Boolean) as HTMLImageElement[]
    if (els.length === 0) return

    const jitterX = new Float32Array(layers.length)
    const jitterY = new Float32Array(layers.length)

    function update(now: number) {
      if (!startRef.current) startRef.current = now
      const elapsed = (now - startRef.current) / 1000

      if (now - lastJitterRef.current > JITTER_INTERVAL) {
        lastJitterRef.current = now
        for (let i = 0; i < layers.length; i++) {
          const j = layers[i].jitter
          jitterX[i] = (Math.random() - 0.5) * j * 2
          jitterY[i] = (Math.random() - 0.5) * j * 2
        }
      }

      for (let i = 0; i < els.length; i++) {
        const l = layers[i]
        const driftX = Math.sin(elapsed * (Math.PI * 2) / l.speed) * l.drift
        const driftY = Math.cos(elapsed * (Math.PI * 2) / (l.speed * 1.3)) * (l.drift * 0.3)

        const baseTransform = (l.style as Record<string, string>)?.transform ?? ''
        els[i].style.transform = `${baseTransform} translate(${driftX + jitterX[i]}px, ${driftY + jitterY[i]}px)`
      }

      rafRef.current = requestAnimationFrame(update)
    }

    rafRef.current = requestAnimationFrame(update)
    return () => cancelAnimationFrame(rafRef.current)
  }, [])

  return (
    <div className="fixed inset-0 z-[2] pointer-events-none overflow-hidden" aria-hidden="true">
      {/* cream sky top → dark bottom */}
      <div
        className="absolute inset-0"
        style={{ background: 'linear-gradient(to bottom, #f0ebe2 0%, #e4ddd0 25%, #9a8e7a 50%, #2e2820 75%, #0a0a08 100%)' }}
      />

      {layers.map((l, i) => (
        <img
          key={l.src}
          ref={el => { layerRefs.current[i] = el }}
          src={l.src}
          alt=""
          className={l.className}
          style={{ opacity: l.opacity, willChange: 'transform', ...l.style }}
        />
      ))}
    </div>
  )
}
