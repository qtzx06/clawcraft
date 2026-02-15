import { useRef, useEffect, useCallback, useState } from 'react'

const TILE_W = 9
const TILE_H = 9
const FPS = 12
const FRAME_INTERVAL = 1000 / FPS
const PLAYBACK_RATE = 0.45
const MIN_BRIGHTNESS = 0.46
const NOISE_STRENGTH = 0.06
const CREAM_BLEND = 0.14
const HIGHLIGHT_KNEE = 0.72
const HIGHLIGHT_BOOST = 0.32

// brighter cream palette to better match the logo treatment
const CREAM_R = 255
const CREAM_G = 253
const CREAM_B = 247

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value))
}

function tileNoise(col: number, row: number) {
  const n = Math.sin(col * 12.9898 + row * 78.233) * 43758.5453
  return n - Math.floor(n)
}

export default function AsciiBackground() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const sampleRef = useRef<HTMLCanvasElement>(null)
  const displayRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number>(0)
  const lastFrameRef = useRef<number>(0)
  const [dims, setDims] = useState({ cols: 0, rows: 0 })

  const calcDims = useCallback(() => {
    const cols = Math.floor(window.innerWidth / TILE_W)
    const rows = Math.floor(window.innerHeight / TILE_H)
    setDims({ cols, rows })
    if (sampleRef.current) {
      sampleRef.current.width = cols
      sampleRef.current.height = rows
    }
    if (displayRef.current) {
      displayRef.current.width = window.innerWidth
      displayRef.current.height = window.innerHeight
    }
  }, [])

  useEffect(() => {
    calcDims()
    window.addEventListener('resize', calcDims)
    return () => window.removeEventListener('resize', calcDims)
  }, [calcDims])

  useEffect(() => {
    const video = videoRef.current
    const sample = sampleRef.current
    const display = displayRef.current
    if (!video || !sample || !display || dims.cols === 0) return

    const ensureLoop = () => {
      video.currentTime = 0
      video.play().catch(() => {})
    }

    const sCtx = sample.getContext('2d', { willReadFrequently: true })
    const dCtx = display.getContext('2d')
    if (!sCtx || !dCtx) return

    function render(now: number) {
      rafRef.current = requestAnimationFrame(render)

      if (now - lastFrameRef.current < FRAME_INTERVAL) return
      lastFrameRef.current = now

      if (video!.paused || video!.ended || video!.readyState < 2) return

      sCtx!.drawImage(video!, 0, 0, dims.cols, dims.rows)
      const { data } = sCtx!.getImageData(0, 0, dims.cols, dims.rows)

      dCtx!.clearRect(0, 0, display!.width, display!.height)

      for (let row = 0; row < dims.rows; row++) {
        for (let col = 0; col < dims.cols; col++) {
          const i = (row * dims.cols + col) * 4
          const brightness = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255
          // Keep the scene bright/creamy and add subtle grain so blocks blend more naturally.
          const liftedBrightness = MIN_BRIGHTNESS + brightness * (1 - MIN_BRIGHTNESS)
          const noisyBrightness =
            liftedBrightness + (tileNoise(col, row) - 0.5) * NOISE_STRENGTH
          const blendedBrightness =
            clamp01(noisyBrightness) * (1 - CREAM_BLEND) + CREAM_BLEND
          const highlightBoost =
            Math.max(0, blendedBrightness - HIGHLIGHT_KNEE) * HIGHLIGHT_BOOST
          const finalBrightness = clamp01(blendedBrightness + highlightBoost)
          const x = col * TILE_W
          const y = row * TILE_H

          // fill cell with cream tinted by brightness
          const cr = Math.floor(CREAM_R * finalBrightness)
          const cg = Math.floor(CREAM_G * finalBrightness)
          const cb = Math.floor(CREAM_B * finalBrightness)
          dCtx!.fillStyle = `rgb(${cr}, ${cg}, ${cb})`
          dCtx!.fillRect(x, y, TILE_W, TILE_H)
        }
      }
    }

    video.loop = true
    video.playbackRate = PLAYBACK_RATE
    video.addEventListener('ended', ensureLoop)
    video.play().catch(() => {})
    rafRef.current = requestAnimationFrame(render)
    return () => {
      video.removeEventListener('ended', ensureLoop)
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
        className="absolute inset-0 pointer-events-none"
        aria-hidden="true"
      />
    </>
  )
}
