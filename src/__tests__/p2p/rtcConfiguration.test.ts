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

  it('starts every transport with discovery only so relays are attempted in priority order', () => {
    const relays = SHARED_RTC_CONFIG.iceServers!.filter(server =>
      (typeof server.urls === 'string' ? [server.urls] : server.urls).some(url => /^turns?:/.test(url)))

    expect(relays.length).toBe(0)
    expect(SHARED_RTC_CONFIG.iceTransportPolicy).toBe('all')
  })
})
