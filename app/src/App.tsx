import { useEffect, useState } from 'react'
import AsciiBackground from './components/AsciiBackground'

export default function App() {
  const strainFrames = [
    '/textures/gold_strains/raw/1.webp',
    '/textures/gold_strains/raw/2.webp',
    '/textures/gold_strains/raw/3.webp',
    '/textures/gold_strains/raw/4.webp',
  ]
  const [frameIndex, setFrameIndex] = useState(0)

  useEffect(() => {
    const timer = window.setInterval(() => {
      setFrameIndex((prev) => (prev + 1) % strainFrames.length)
    }, 1400)
    return () => window.clearInterval(timer)
  }, [strainFrames.length])

  return (
    <main className="h-screen w-screen overflow-hidden bg-bg relative">
      <AsciiBackground />
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
        <div className="flex items-center gap-0">
          <div className="minecraft-gold-frame relative">
            <img
              src={strainFrames[frameIndex]}
              alt=""
              aria-hidden="true"
              className="logo-strain-overlay-img"
            />
            <div className="minecraft-gold-frame__inner">
              <img
                src="/clawcraft_logo.png"
                alt="clawcraft logo"
                className="w-40 h-40 md:w-56 md:h-56 object-contain"
              />
            </div>
          </div>
          <div className="wordmark-wrap relative h-40 md:h-56 w-[420px] md:w-[640px] overflow-hidden self-center -ml-10 md:-ml-16">
            <img
              src="/clawcraft_wordmark_stacked_tight.png"
              alt="clawcraft wordmark"
              className="wordmark-base h-full w-full object-contain object-center block"
            />
          </div>
        </div>
      </div>
    </main>
  )
}
