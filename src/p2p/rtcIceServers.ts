type TurnEnvironment = {
  VITE_TURN_URLS?: string
  VITE_TURN_USERNAME?: string
  VITE_TURN_CREDENTIAL?: string
}

export function parseIceServers(value: unknown): RTCIceServer[] {
  if (!Array.isArray(value)) return []
  const servers: RTCIceServer[] = []
  for (const server of value) {
    const urls = typeof server?.urls === 'string' ? [server.urls] : server?.urls
    if (!Array.isArray(urls) || !urls.length || !urls.every(url => typeof url === 'string' && /^(?:stun|turn)s?:[^\s/?#]+(?:\?transport=(?:udp|tcp))?$/.test(url))) return []
    const relay = urls.some(url => /^turns?:/.test(url))
    if (relay && (typeof server.username !== 'string' || !server.username.trim() || typeof server.credential !== 'string' || !server.credential.trim())) return []
    servers.push({ urls: server.urls, ...(relay ? { username: server.username, credential: server.credential } : {}) })
  }
  return servers
}

export function buildIceServers(env: TurnEnvironment): RTCIceServer[] {
  const servers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' },
  ]
  const urls = (env.VITE_TURN_URLS ?? '').split(',').map(url => url.trim()).filter(Boolean)
  const username = env.VITE_TURN_USERNAME
  const credential = env.VITE_TURN_CREDENTIAL
  // A relay needs a real endpoint and its own credentials. Incomplete settings
  // must not break direct calls or send invalid URLs to Chromium.
  if (urls.length && username?.trim() && credential?.trim()
    && urls.every(url => /^turns?:[^\s/?#]+(?:\?transport=(?:udp|tcp))?$/.test(url))) {
    servers.push({ urls, username, credential })
  }
  return servers
}
