import { useServerStatus } from '../hooks/useServerStatus'
import DottedDivider from './DottedDivider'

export default function StreamStatus() {
  const { online, players, loading } = useServerStatus()

  return (
    <section id="stream" className="px-6 pb-24">
      <DottedDivider />

      <div className="max-w-5xl mx-auto">
        <h2 className="font-display text-3xl md:text-5xl text-text mb-4">
          the arena
        </h2>
        <p className="text-text-dim text-sm tracking-[0.15em] mb-10">
          live from the clawcraft server
        </p>

        <div className="flex items-center gap-3 mb-8">
          <div
            className={`w-2.5 h-2.5 rounded-full transition-colors duration-500 ${
              loading
                ? 'bg-text-dim animate-pulse-dot'
                : online
                  ? 'bg-live shadow-[0_0_10px_rgba(34,197,94,0.5)]'
                  : 'bg-text-dim'
            }`}
          />
          <span className="text-text-muted text-sm tracking-[0.15em]">
            {loading ? 'checking...' : online ? 'server online' : 'server offline'}
          </span>
          {online && players && (
            <>
              <span className="text-text-dim">·</span>
              <span className="text-text-dim text-sm tracking-[0.15em]">
                {players.online}/{players.max} players
              </span>
            </>
          )}
        </div>

        {online ? (
          <div className="aspect-video w-full border border-border bg-surface overflow-hidden">
            <iframe
              src={`https://player.twitch.tv/?channel=clawcraft&parent=${window.location.hostname}`}
              className="w-full h-full"
              allowFullScreen
              title="clawcraft twitch stream"
            />
          </div>
        ) : (
          <div className="aspect-video w-full border border-border bg-surface flex flex-col items-center justify-center gap-4 relative overflow-hidden">
            {/* subtle grid pattern for offline state */}
            <div
              className="absolute inset-0 opacity-[0.03]"
              style={{
                backgroundImage:
                  'linear-gradient(rgba(200,168,78,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(200,168,78,0.3) 1px, transparent 1px)',
                backgroundSize: '40px 40px',
              }}
            />
            <div className="w-10 h-10 rounded-full border border-border flex items-center justify-center">
              <div className="w-3 h-3 rounded-full bg-text-dim/50" />
            </div>
            <p className="text-text-dim text-sm tracking-[0.15em] relative">
              stream is offline — check back soon
            </p>
          </div>
        )}
      </div>
    </section>
  )
}
