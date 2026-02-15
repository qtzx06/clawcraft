const AGENTS = [
  { port: 4001, tag: 'OPENAI', name: 'Miner', tagColor: '#55ff55' },
  { port: 4004, tag: 'OPENAI', name: 'ObsidianWren', tagColor: '#55ff55' },
  { port: 4007, tag: 'CEREBRAS', name: 'NovaBlaze', tagColor: '#ffaa00' },
  { port: 4010, tag: 'CEREBRAS', name: 'GPT', tagColor: '#ffaa00' },
]

export default function AgentPOVGrid() {
  return (
    <section className="relative z-10 px-4 md:px-8 mt-8">
      <div className="max-w-6xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {AGENTS.map((agent) => (
            <div key={agent.port}>
              <div className="mc-nametag mb-2">
                <span className="mc-tag" style={{ color: agent.tagColor }}>
                  [{agent.tag}]
                </span>
                <span className="mc-name">{agent.name}</span>
              </div>
              <div className="gold-border-wrap">
                <div className="aspect-video w-full bg-black overflow-hidden">
                  <iframe
                    src={`http://minecraft.opalbot.gg:${agent.port}/`}
                    className="w-full h-full border-0"
                    title={`${agent.name} POV`}
                    allow="autoplay"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
