import AsciiBackground from './components/AsciiBackground'
import CloudBackdrop from './components/CloudBackdrop'
import GoldCubes from './components/GoldCubes'
import Header from './components/Header'

export default function App() {
  return (
    <main className="h-screen w-screen bg-bg relative overflow-hidden">
      <CloudBackdrop />

      <AsciiBackground />

      {/* arena design — bottom, behind content, in front of ascii+bg */}
      <div
        className="fixed bottom-0 left-0 right-0 z-[5] pointer-events-none"
        style={{
          height: '80%',
          top: '20%',
          backgroundImage: 'url(/arena.webp)',
          backgroundSize: 'cover',
          backgroundPosition: 'center top',
          backgroundRepeat: 'no-repeat',
          filter: 'brightness(0.6) sepia(0.3) saturate(1.2) contrast(1.1)',
          maskImage: 'linear-gradient(to bottom, transparent 0%, black 3%)',
          WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 3%)',
        }}
      />

      {/* header */}
      <Header />

      {/* stream preview — click to open twitch */}
      <section className="relative z-10 px-4 md:px-12 mt-2">
        <div className="max-w-5xl mx-auto">
          <div className="gold-border-wrap">
            <a
              href="https://www.twitch.tv/ryunzz_tech"
              target="_blank"
              rel="noopener noreferrer"
              className="block aspect-video w-full bg-black overflow-hidden relative group cursor-pointer"
            >
              <video
                src="/stream-preview.mp4"
                className="w-full h-full object-cover"
                autoPlay
                loop
                muted
                playsInline
              />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center gap-3">
                <svg className="opacity-0 group-hover:opacity-100 transition-opacity w-10 h-10 drop-shadow-lg" viewBox="0 0 256 268" fill="none">
                  <path d="M17.458 0L0 46.556v185.262h63.983V268h46.555l36.49-36.182h54.735L256 177.69V0H17.458zm23.05 23.395H232.6v141.36l-40.543 40.544h-68.14l-36.182 36.18v-36.18H40.508V23.395z" fill="#fff"/>
                  <path d="M195.21 63.108h-23.395v68.782h23.395V63.108zM131.876 63.108h-23.395v68.782h23.395V63.108z" fill="#fff"/>
                </svg>
                <span className="opacity-0 group-hover:opacity-100 transition-opacity text-white text-lg font-mono tracking-wider">
                  watch live
                </span>
              </div>
            </a>
          </div>
        </div>
      </section>

      {/* gold cubes — fullscreen, in front of everything */}
      <GoldCubes />
    </main>
  )
}
