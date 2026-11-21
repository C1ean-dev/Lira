import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { silentAudioTrack, __resetSilentAudioForTests } from '../../media/silentAudioTrack'

describe('silentAudioTrack', () => {
  let originalWindow: any

  beforeEach(() => {
    originalWindow = (globalThis as any).window
    __resetSilentAudioForTests()
  })

  afterEach(() => {
    __resetSilentAudioForTests()
    if (originalWindow !== undefined) {
      ;(globalThis as any).window = originalWindow
    } else {
      delete (globalThis as any).window
    }
    vi.restoreAllMocks()
  })

  it('returns null when AudioContext is unavailable', () => {
    ;(globalThis as any).window = {}
    const track = silentAudioTrack()
    expect(track).toBeNull()
  })

  it('creates an audio track using oscillator and gain nodes connected to destination', () => {
    const mockAudioTrack = { kind: 'audio', readyState: 'live', id: 'track-silent-1' }
    const destination = {
      stream: {
        getAudioTracks: () => [mockAudioTrack],
      },
    }

    const oscConnect = vi.fn()
    const oscStart = vi.fn()
    const mockOsc = {
      connect: oscConnect,
      start: oscStart,
    }

    const gainConnect = vi.fn()
    const mockGain = {
      gain: { value: 1 },
      connect: gainConnect,
    }

    const mockAudioContextInstance = {
      state: 'running',
      createMediaStreamDestination: vi.fn().mockReturnValue(destination),
      createOscillator: vi.fn().mockReturnValue(mockOsc),
      createGain: vi.fn().mockReturnValue(mockGain),
      resume: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    }

    class MockAudioContext {
      constructor() {
        return mockAudioContextInstance
      }
    }
    ;(globalThis as any).window = { AudioContext: MockAudioContext }

    const track = silentAudioTrack()
    expect(track).toBe(mockAudioTrack)
    expect(mockAudioContextInstance.createOscillator).toHaveBeenCalled()
    expect(mockAudioContextInstance.createGain).toHaveBeenCalled()
    expect(mockGain.gain.value).toBe(0)
    expect(oscConnect).toHaveBeenCalledWith(mockGain)
    expect(gainConnect).toHaveBeenCalledWith(destination)
    expect(oscStart).toHaveBeenCalled()
  })

  it('resumes the AudioContext if suspended', () => {
    const mockAudioTrack = { kind: 'audio', readyState: 'live', id: 'track-silent-2' }
    const destination = {
      stream: {
        getAudioTracks: () => [mockAudioTrack],
      },
    }

    const resumeMock = vi.fn().mockResolvedValue(undefined)
    const mockAudioContextInstance = {
      state: 'suspended',
      createMediaStreamDestination: vi.fn().mockReturnValue(destination),
      createOscillator: vi.fn().mockReturnValue(null),
      createGain: vi.fn().mockReturnValue(null),
      resume: resumeMock,
      close: vi.fn().mockResolvedValue(undefined),
    }

    class MockAudioContext {
      constructor() {
        return mockAudioContextInstance
      }
    }

    ;(globalThis as any).window = {
      AudioContext: MockAudioContext,
    }

    const track = silentAudioTrack()
    expect(track).toBe(mockAudioTrack)
    expect(resumeMock).toHaveBeenCalled()
  })

  it('reuses existing live track across multiple calls', () => {
    const mockAudioTrack = { kind: 'audio', readyState: 'live', id: 'track-reused' }
    const destination = {
      stream: {
        getAudioTracks: () => [mockAudioTrack],
      },
    }

    let constructCount = 0
    class MockAudioContext {
      constructor() {
        constructCount++
        return {
          state: 'running',
          createMediaStreamDestination: () => destination,
          close: vi.fn().mockResolvedValue(undefined),
        }
      }
    }

    ;(globalThis as any).window = { AudioContext: MockAudioContext }

    const track1 = silentAudioTrack()
    const track2 = silentAudioTrack()

    expect(track1).toBe(mockAudioTrack)
    expect(track2).toBe(mockAudioTrack)
    expect(constructCount).toBe(1)
  })

  it('creates a new track when the previous track has ended', () => {
    const mockAudioTrack1 = { kind: 'audio', readyState: 'live', id: 'track-1' }
    const mockAudioTrack2 = { kind: 'audio', readyState: 'live', id: 'track-2' }

    let callCount = 0
    class MockAudioContext {
      constructor() {
        callCount++
        const trackToReturn = callCount === 1 ? mockAudioTrack1 : mockAudioTrack2
        return {
          state: 'running',
          createMediaStreamDestination: () => ({
            stream: {
              getAudioTracks: () => [trackToReturn],
            },
          }),
          close: vi.fn().mockResolvedValue(undefined),
        }
      }
    }

    ;(globalThis as any).window = { AudioContext: MockAudioContext }

    const track1 = silentAudioTrack()
    expect(track1).toBe(mockAudioTrack1)

    // Mark track1 as ended
    mockAudioTrack1.readyState = 'ended'

    const track2 = silentAudioTrack()
    expect(track2).toBe(mockAudioTrack2)
    expect(callCount).toBe(2)
  })
})
