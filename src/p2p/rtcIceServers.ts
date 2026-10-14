type TurnEnvironment = {
  VITE_STUN_FALLBACK_URLS?: string
  VITE_TURN_URLS?: string
  VITE_TURN_USERNAME?: string
  VITE_TURN_CREDENTIAL?: string
}

export function buildIceServers(env: TurnEnvironment, useStunFallback = false): RTCIceServer[] {
  const servers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' },
  ]
  const stunUrls = (env.VITE_STUN_FALLBACK_URLS ?? '').split(',').map(url => url.trim()).filter(Boolean)
  if (useStunFallback && stunUrls.length && stunUrls.every(isUsableStunUrl)) {
    servers.push({ urls: [...new Set(stunUrls)] })
  }
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

function isUsableStunUrl(url: string): boolean {
  const match = /^stun:([a-z\d.-]+|\[[a-f\d:]+\])(?::(\d+))?$/i.exec(url)
  if (!match || match[1].toLowerCase().replace(/\.$/, '').endsWith('.onrender.com')) return false
  return !match[2] || (Number(match[2]) > 0 && Number(match[2]) <= 65535)
}
