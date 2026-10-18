import { describe, expect, it, vi } from 'vitest'
import { SHARED_RTC_CONFIG } from '../../p2p/mediaCalls'

vi.mock('../../data/nativeAssets.json', () => ({ default: { categories: [], assets: [] } }))

describe('shared call relay configuration', () => {
  it('avoids pre-gathered candidates for PeerJS data and media transports', () => {
    expect(SHARED_RTC_CONFIG.iceCandidatePoolSize).toBe(0)
  })

  it('does not ask Chromium to resolve the obsolete anonymous relay', () => {
    const urls = SHARED_RTC_CONFIG.iceServers!.flatMap(server =>
      typeof server.urls === 'string' ? [server.urls] : server.urls)
    expect(urls.some(url => url.includes('openrelay.metered.ca'))).toBe(false)
    expect(urls.filter(url => url.startsWith('stun:'))).toHaveLength(2)
  })

  it('loads the build environment into the shared data and media relay configuration', () => {
    const urls = (import.meta.env.VITE_TURN_URLS ?? '').split(',').map(url => url.trim()).filter(Boolean)
    const username = import.meta.env.VITE_TURN_USERNAME
    const credential = import.meta.env.VITE_TURN_CREDENTIAL
    const configured = urls.length > 0 && !!username?.trim() && !!credential?.trim()
    const relays = SHARED_RTC_CONFIG.iceServers!.filter(server =>
      (typeof server.urls === 'string' ? [server.urls] : server.urls).some(url => /^turns?:/.test(url)))

    // Assert secret comparisons as booleans so a failure never prints them.
    expect(relays.length).toBe(configured ? 1 : 0)
    if (configured) {
      expect(relays[0].urls).toEqual(urls)
      expect(relays[0].username === username).toBe(true)
      expect(relays[0].credential === credential).toBe(true)
    }
    expect(SHARED_RTC_CONFIG.iceTransportPolicy).toBe('all')
  })
})
