import { parseIceServers } from './rtcIceServers'

type Fetcher = typeof fetch

export function createCloudflareTurnClient(endpoint: string, fetcher: Fetcher = (...args) => fetch(...args), now = Date.now) {
  let cached: RTCIceServer[] = []
  let expiresAt = 0
  let retryAt = 0
  let pending: Promise<RTCIceServer[]> | undefined
  return function load(): Promise<RTCIceServer[]> {
    if (now() < expiresAt - 60000) return Promise.resolve(cached)
    if (pending) return pending
    if (!endpoint || now() < retryAt) return Promise.resolve([])
    pending = (async () => {
      const controller = new AbortController()
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new Error('TURN timeout')) }, 4000)
        })
        const result = (async () => {
          const response = await fetcher(endpoint, { signal: controller.signal, cache: 'no-store', credentials: 'omit' })
          if (!response.ok) throw new Error('TURN unavailable')
          return response.json()
        })()
        const data = await Promise.race([result, timeout])
        const servers = parseIceServers(data.iceServers)
        if (!servers.length || !servers.some(server => (Array.isArray(server.urls) ? server.urls : [server.urls]).some(url => /^turns?:/.test(url)))
          || !Number.isFinite(data.expiresAt) || data.expiresAt <= now() + 60000) throw new Error('Invalid TURN credentials')
        cached = servers
        expiresAt = data.expiresAt
        return cached
      } catch {
        retryAt = now() + 30000
        return []
      } finally {
        clearTimeout(timer)
        pending = undefined
      }
    })()
    return pending
  }
}

export const loadCloudflareIceServers = createCloudflareTurnClient(
  import.meta.env.VITE_TURN_CREDENTIALS_URL || 'https://lira-signaling.onrender.com/turn/credentials',
)
