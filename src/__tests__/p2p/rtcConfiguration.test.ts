import { describe, expect, it, vi } from 'vitest'
import { SHARED_RTC_CONFIG } from '../../p2p/mediaCalls'

vi.mock('../../data/nativeAssets.json', () => ({ default: { categories: [], assets: [] } }))

describe('shared call relay configuration', () => {
  it('does not ask Chromium to resolve the obsolete anonymous relay', () => {
    const urls = SHARED_RTC_CONFIG.iceServers!.flatMap(server =>
      typeof server.urls === 'string' ? [server.urls] : server.urls)
    expect(urls.some(url => url.includes('openrelay.metered.ca'))).toBe(false)
    expect(urls.filter(url => url.startsWith('stun:'))).toHaveLength(2)
  })
})
