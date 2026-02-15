import { useEffect, useRef, useState } from 'react'
import CardSwap, { Card } from './CardSwap'

const strainFrames = [
  '/textures/gold_strains/raw/1.webp',
  '/textures/gold_strains/raw/2.webp',
  '/textures/gold_strains/raw/3.webp',
  '/textures/gold_strains/raw/4.webp',
]

const AGENTS = [
  { name: 'CLAUDECODE', tag: 'CLAUDECODE', tagColor: '#ff6a00', video: '/povs/claudecode.mp4', port: 4001 },
  { name: 'ObsidianWren', tag: 'OPENAI', tagColor: '#4aa3df', video: '/povs/obsidianwren.mp4', port: 4004 },
  { name: 'NovaBlaze', tag: 'CEREBRAS', tagColor: '#ffaa00', video: '/povs/novablaze.mp4', port: 4007 },
]

// sketch jitter at 8fps
const JITTER_FPS = 8
const JITTER_INTERVAL = 1000 / JITTER_FPS

function useSketchJitter(extraTransform = '') {
  const ref = useRef<HTMLImageElement>(null)
  const raf = useRef<number>(0)
  const lastJitter = useRef(0)
  const start = useRef(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    let jx = 0, jy = 0
    const drift = 3
    const speed = 120
    const jitter = 0.5

    function update(now: number) {
      if (!start.current) start.current = now
      const t = (now - start.current) / 1000

      if (now - lastJitter.current > JITTER_INTERVAL) {
        lastJitter.current = now
        jx = (Math.random() - 0.5) * jitter * 2
        jy = (Math.random() - 0.5) * jitter * 2
      }

      const dx = Math.sin(t * (Math.PI * 2) / speed) * drift
      const dy = Math.cos(t * (Math.PI * 2) / (speed * 1.3)) * (drift * 0.3)
      el.style.transform = `translate(-50%, -50%) ${extraTransform} translate(${dx + jx}px, ${dy + jy}px)`

      raf.current = requestAnimationFrame(update)
    }
    raf.current = requestAnimationFrame(update)
    return () => cancelAnimationFrame(raf.current)
  }, [extraTransform])

  return ref
}

export default function Header() {
  const [frameIndex, setFrameIndex] = useState(0)
  const logoCloudRef = useSketchJitter()
  const cardCloudRef = useSketchJitter('scaleX(-1)')

  useEffect(() => {
    const timer = window.setInterval(() => {
      setFrameIndex((prev) => (prev + 1) % strainFrames.length)
    }, 1400)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <header className="relative z-20 w-full py-8 md:py-12 px-6">
      <div className="flex items-center justify-center gap-6 md:gap-10">
        {/* logo group: claw + wordmark — BIG */}
        <div className="relative flex items-center gap-0">
          {/* dedicated cloud behind logo */}
          <img
            ref={logoCloudRef}
            src="/backgrounds/pastel-clouds-03.png"
            alt=""
            aria-hidden="true"
            className="absolute top-1/2 left-1/2 w-[140%] max-w-none pointer-events-none z-0"
            style={{ transform: 'translate(-50%, -50%)', willChange: 'transform', opacity: 0.9 }}
          />

          <div className="minecraft-gold-frame relative z-[1]">
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
                className="w-28 h-28 md:w-44 md:h-44 object-contain"
              />
            </div>
          </div>
          <div className="wordmark-wrap relative z-[1] h-28 md:h-44 w-[300px] md:w-[500px] overflow-hidden self-center -ml-8 md:-ml-14">
            <img
              src="/clawcraft_wordmark_stacked_tight.png"
              alt="clawcraft wordmark"
              className="wordmark-base h-full w-full object-contain object-center block"
            />
          </div>
        </div>

        {/* card swap — agent POV clips, to the right of logos */}
        <div className="hidden md:block relative self-end" style={{ height: 240, width: 340, marginTop: 80 }}>
          {/* dedicated cloud behind card swap — flipped swirl so it's round */}
          <img
            ref={cardCloudRef}
            src="/backgrounds/pastel-clouds-03.png"
            alt=""
            aria-hidden="true"
            className="absolute top-1/2 left-1/2 w-[200%] max-w-none pointer-events-none z-0"
            style={{ transform: 'translate(-50%, -50%) scaleX(-1)', willChange: 'transform', opacity: 0.85 }}
          />

          <div className="relative z-[1]">
            <CardSwap
              width={300}
              height={190}
              cardDistance={25}
              verticalDistance={30}
              delay={5000}
              pauseOnHover={false}
              skewAmount={0}
              easing="elastic"
              onCardClick={(i) => window.open(`http://minecraft.opalbot.gg:${AGENTS[i].port}/`, '_blank')}
            >
              {AGENTS.map((agent) => (
                <Card key={agent.name} customClass="cursor-pointer">
                  <div className="h-full flex flex-col gold-border-wrap">
                    <div className="mc-nametag w-full">
                      <span className="mc-tag" style={{ color: agent.tagColor }}>
                        [{agent.tag}]
                      </span>
                      {' '}
                      <span className="mc-name">{agent.name}</span>
                    </div>
                    <div className="flex-1 bg-black">
                      <video
                        src={agent.video}
                        autoPlay
                        loop
                        muted
                        playsInline
                        className="w-full h-full object-cover"
                      />
                    </div>
                  </div>
                </Card>
              ))}
            </CardSwap>
          </div>
        </div>
      </div>
    </header>
  )
}
