import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
let rtc: typeof import('../../p2p/rtcConfiguration')

describe('private STUN recovery', () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2030-01-01'))
    vi.stubEnv('VITE_STUN_FALLBACK_URLS', 'stun:stun.example.com:3478')
    rtc = await import('../../p2p/rtcConfiguration')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.useRealTimers()
  })

  it('keeps the private endpoint idle, enables it for retries, and returns to public STUN after the cooldown', () => {
    vi.advanceTimersByTime(180000)
    expect(rtc.SHARED_RTC_CONFIG.iceServers).toHaveLength(2)
    expect(rtc.enableStunFallback()).toBe(true)
    expect(rtc.SHARED_RTC_CONFIG.iceServers).toHaveLength(3)
    expect(rtc.enableStunFallback()).toBe(false)
    vi.advanceTimersByTime(120001)
    expect(rtc.SHARED_RTC_CONFIG.iceServers).toHaveLength(2)
  })

  it('only enables the fallback when ICE actually fails', () => {
    vi.advanceTimersByTime(180000)
    const listeners: Record<string, () => void> = {}
    const pc = { iceConnectionState: 'checking', connectionState: 'connecting',
      addEventListener: (event: string, fn: () => void) => { listeners[event] = fn } }
    rtc.watchIceFallback(pc as any)
    listeners.iceconnectionstatechange()
    expect(rtc.SHARED_RTC_CONFIG.iceServers).toHaveLength(2)
    pc.iceConnectionState = 'failed'
    listeners.iceconnectionstatechange()
    expect(rtc.SHARED_RTC_CONFIG.iceServers).toHaveLength(3)
    vi.advanceTimersByTime(120001)
  })

  it('does not retry with an absent or invalid endpoint', () => {
    vi.advanceTimersByTime(180000)
    vi.stubEnv('VITE_STUN_FALLBACK_URLS', 'stun:lira-signaling.onrender.com:3478')
    expect(rtc.enableStunFallback()).toBe(false)
    expect(rtc.SHARED_RTC_CONFIG.iceServers).toHaveLength(2)
  })

  it('enables fallback before PeerJS closes a failed peer connection', () => {
    const listeners: Array<{ event: string; listener: () => void; capture: boolean }> = []
    const pc = { iceConnectionState: 'checking', connectionState: 'connecting',
      addEventListener: (event: string, listener: () => void, capture = false) => {
        listeners.push({ event, listener, capture })
      } }
    // PeerJS installs this handler before the application sees the connection.
    pc.addEventListener('iceconnectionstatechange', () => { pc.iceConnectionState = 'closed' })
    rtc.watchIceFallback(pc as any)
    pc.iceConnectionState = 'failed'
    // DOM dispatch runs capturing listeners before non-capturing listeners at the target.
    for (const capture of [true, false]) {
      for (const entry of listeners) {
        if (entry.event === 'iceconnectionstatechange' && entry.capture === capture) entry.listener()
      }
    }
    expect(pc.iceConnectionState).toBe('closed')
    expect(rtc.SHARED_RTC_CONFIG.iceServers).toHaveLength(3)
  })
})
