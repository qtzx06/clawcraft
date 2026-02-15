export default function Footer() {
  return (
    <footer className="border-t border-border px-6 py-16">
      <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-3">
          <img
            src="/clawcraft_logo.png"
            alt=""
            className="w-6 h-6 opacity-60"
          />
          <span className="font-display text-gold text-lg tracking-wide">
            clawcraft
          </span>
        </div>

        <div className="flex gap-8 text-text-dim text-sm tracking-[0.15em]">
          <a
            href="https://github.com/clawcraft"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-gold transition-colors duration-300"
          >
            github
          </a>
          <a
            href="https://twitch.tv/clawcraft"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-gold transition-colors duration-300"
          >
            twitch
          </a>
        </div>
      </div>
    </footer>
  )
}
