import { useRef, useEffect, useCallback, useState } from 'react'

const TILE = 10
const FPS = 24
const FRAME_INTERVAL = 1000 / FPS
const PLAYBACK_RATE = 0.5

// cream tint pulled from the cloud video
const CR = 255
const CG = 251
const CB = 242

export default function AsciiBackground() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const sampleRef = useRef<HTMLCanvasElement>(null)
  const displayRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number>(0)
  const lastFrameRef = useRef<number>(0)
  const prevBrightness = useRef<Float32Array | null>(null)
  const [dims, setDims] = useState({ cols: 0, rows: 0 })

  const calcDims = useCallback(() => {
    const cols = Math.ceil(window.innerWidth / TILE)
    const rows = Math.ceil(window.innerHeight / TILE)
    setDims({ cols, rows })
    if (sampleRef.current) {
      sampleRef.current.width = cols
      sampleRef.current.height = rows
    }
    if (displayRef.current) {
      displayRef.current.width = window.innerWidth
      displayRef.current.height = window.innerHeight
    }
    prevBrightness.current = null
  }, [])

  useEffect(() => {
    // Avoid synchronous setState inside an effect body (eslint rule); schedule it.
    const raf = requestAnimationFrame(calcDims)
    window.addEventListener('resize', calcDims)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', calcDims)
    }
  }, [calcDims])

  useEffect(() => {
    const video = videoRef.current
    const sample = sampleRef.current
    const display = displayRef.current
    if (!video || !sample || !display || dims.cols === 0) return

    const sCtx = sample.getContext('2d', { willReadFrequently: true })
    const dCtx = display.getContext('2d')
    if (!sCtx || !dCtx) return

    const total = dims.cols * dims.rows

    function render(now: number) {
      rafRef.current = requestAnimationFrame(render)
      if (now - lastFrameRef.current < FRAME_INTERVAL) return
      lastFrameRef.current = now
      if (video!.paused || video!.ended || video!.readyState < 2) return

      sCtx!.drawImage(video!, 0, 0, dims.cols, dims.rows)
      const { data } = sCtx!.getImageData(0, 0, dims.cols, dims.rows)

      // init prev buffer on first frame
      if (!prevBrightness.current) {
        prevBrightness.current = new Float32Array(total)
        for (let j = 0; j < total; j++) {
          const k = j * 4
          prevBrightness.current[j] = (0.299 * data[k] + 0.587 * data[k + 1] + 0.114 * data[k + 2]) / 255
        }
      }

      dCtx!.clearRect(0, 0, display!.width, display!.height)

      const lerp = 0.35 // temporal smoothing — blends with previous frame

      for (let row = 0; row < dims.rows; row++) {
        for (let col = 0; col < dims.cols; col++) {
          const idx = row * dims.cols + col
          const i = idx * 4
          const raw = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255

          // smooth over time — no jitter
          const smoothed = prevBrightness.current![idx] * (1 - lerp) + raw * lerp
          prevBrightness.current![idx] = smoothed

          // lift and soften — keep everything bright & cloudy
          const b = 0.38 + smoothed * 0.62

          const r = Math.floor(CR * b)
          const g = Math.floor(CG * b)
          const bl = Math.floor(CB * b)
          dCtx!.fillStyle = `rgb(${r},${g},${bl})`
          dCtx!.fillRect(col * TILE, row * TILE, TILE, TILE)
        }
      }
    }

    video.loop = true
    video.playbackRate = PLAYBACK_RATE
    video.play().catch(() => {})
    rafRef.current = requestAnimationFrame(render)
    return () => {
      cancelAnimationFrame(rafRef.current)
    }
  }, [dims])

  return (
    <>
      <video
        ref={videoRef}
        src="/clouds-30s.mp4"
        autoPlay
        loop
        muted
        playsInline
        className="hidden"
        preload="auto"
      />
      <canvas ref={sampleRef} className="hidden" />
      <canvas
        ref={displayRef}
        className="fixed inset-0 pointer-events-none z-[3] opacity-[0.67]"
        aria-hidden="true"
      />
    </>
  )
}
