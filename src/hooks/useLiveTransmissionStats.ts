import { useEffect, useState } from 'react'
import { PeerManager } from '../p2p/PeerManager'
import { createTransmissionSampler, type TransmissionStats } from '../media/liveTransmissionStats'

export function useLiveTransmissionStats(open: boolean, stream: MediaStream | null, local: boolean) {
  const [stats, setStats] = useState<TransmissionStats[]>([])
  useEffect(() => {
    setStats([])
    if (!open || !stream) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const sample = createTransmissionSampler()
    const update = async () => {
      try {
        const rows = await sample(PeerManager.getInstance().getMediaCalls(), stream, local)
        if (!disposed) setStats(rows)
      } catch {
        if (!disposed) setStats([])
      }
      if (!disposed) timer = setTimeout(update, 1000)
    }
    void update()
    return () => { disposed = true; clearTimeout(timer) }
  }, [open, stream, local])
  return stats
}
