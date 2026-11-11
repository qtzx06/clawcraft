import { useState, useEffect } from 'react'

interface ServerStatus {
  online: boolean
  players: { online: number; max: number } | null
  motd: string | null
}

const SERVER_HOST = 'mc.clawcraft.live'
const POLL_INTERVAL = 30_000

export function useServerStatus() {
  const [status, setStatus] = useState<ServerStatus>({
    online: false,
    players: null,
    motd: null,
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function poll() {
      try {
        const res = await fetch(
          `https://api.mcstatus.io/v2/status/java/${SERVER_HOST}`
        )
        if (!res.ok) throw new Error('not ok')
        const data = await res.json()
        if (!cancelled) {
          setStatus({
            online: data.online ?? false,
            players: data.players
              ? { online: data.players.online, max: data.players.max }
              : null,
            motd: data.motd?.clean ?? null,
          })
        }
      } catch {
        if (!cancelled) {
          setStatus({ online: false, players: null, motd: null })
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    poll()
    const interval = setInterval(poll, POLL_INTERVAL)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  return { ...status, loading }
}
