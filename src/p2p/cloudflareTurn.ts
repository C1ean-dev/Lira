import { parseIceServers } from './rtcIceServers'

type Fetcher = typeof fetch

export const DEFAULT_TURN_CREDENTIALS_URL = 'https://p01--lira--tj9yvq5j5cgs.code.run/turn/credentials'

function normalizeEndpoints(endpoint: string | string[]): string[] {
  const list = Array.isArray(endpoint) ? endpoint : [endpoint]
  const unique: string[] = []
  for (const item of list) {
    const trimmed = typeof item === 'string' ? item.trim() : ''
    if (trimmed && !unique.includes(trimmed)) unique.push(trimmed)
  }
  return unique
}

export function createCloudflareTurnClient(
  endpoint: string | string[],
  fetcher: Fetcher = (...args) => fetch(...args),
  now = Date.now,
) {
  const endpoints = normalizeEndpoints(endpoint)
  let cached: RTCIceServer[] = []
  let expiresAt = 0
  let retryAt = 0
  let pending: Promise<RTCIceServer[]> | undefined

  async function fetchFrom(target: string): Promise<RTCIceServer[] | undefined> {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error('TURN timeout')) }, 4000)
      })
      const result = (async () => {
        const response = await fetcher(target, { signal: controller.signal, cache: 'no-store', credentials: 'omit' })
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
      return undefined
    } finally {
      clearTimeout(timer)
    }
  }

  return function load(): Promise<RTCIceServer[]> {
    if (now() < expiresAt - 60000) return Promise.resolve(cached)
    if (pending) return pending
    if (!endpoints.length || now() < retryAt) return Promise.resolve([])
    pending = (async () => {
      try {
        for (const target of endpoints) {
          const servers = await fetchFrom(target)
          if (servers) return servers
        }
        retryAt = now() + 30000
        return []
      } finally {
        pending = undefined
      }
    })()
    return pending
  }
}

export const loadCloudflareIceServers = createCloudflareTurnClient([
  import.meta.env.VITE_TURN_CREDENTIALS_URL || '',
  DEFAULT_TURN_CREDENTIALS_URL,
])
