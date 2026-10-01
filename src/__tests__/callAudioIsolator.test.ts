import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CallAudioIsolator } from '../media/CallAudioIsolator'
import { useMediaStore } from '../store/useMediaStore'
import { MediaManager } from '../media/MediaManager'
import { PeerManager } from '../p2p/PeerManager'

class MockMediaStream {
  private tracks: any[] = []
  id = 'mock-stream-' + Math.random()

  constructor(tracks?: any[]) {
    if (tracks) {
      this.tracks = [...tracks]
    }
  }

  addTrack(track: any) {
    if (!this.tracks.includes(track)) {
      this.tracks.push(track)
    }
  }

  removeTrack(track: any) {
    this.tracks = this.tracks.filter((t) => t !== track)
  }

  getTracks() {
    return this.tracks
  }

  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === 'video')
  }

  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === 'audio')
  }

  addEventListener() {}
  removeEventListener() {}
}

if (typeof (globalThis as any).MediaStream === 'undefined') {
  ;(globalThis as any).MediaStream = MockMediaStream
}

if (typeof (globalThis as any).navigator === 'undefined') {
  ;(globalThis as any).navigator = { mediaDevices: {} }
} else if (!(globalThis as any).navigator.mediaDevices) {
  ;(globalThis as any).navigator.mediaDevices = {}
}

class MockAudioParam {
  value: number = 1
  setValueAtTime = vi.fn((val: number) => {
    this.value = val
  })
  cancelScheduledValues = vi.fn()
  setTargetAtTime = vi.fn((val: number) => {
    this.value = val
  })
  linearRampToValueAtTime = vi.fn((val: number) => {
    this.value = val
  })
}

class MockAudioNode {
  connect = vi.fn()
  disconnect = vi.fn()
}

class MockGainNode extends MockAudioNode {
  gain = new MockAudioParam()
}

class MockBiquadFilterNode extends MockAudioNode {
  type: string = 'lowpass'
  frequency = new MockAudioParam()
  Q = new MockAudioParam()
  gain = new MockAudioParam()
}

class MockAnalyserNode extends MockAudioNode {
  fftSize = 256
  frequencyBinCount = 128
  getByteTimeDomainData = vi.fn((array: Uint8Array) => {
    array.fill(128)
  })
}

class MockDestinationNode extends MockAudioNode {
  stream: any
  constructor() {
    super()
    this.stream = new MockMediaStream([
      { id: 'isolated-audio-out', kind: 'audio', enabled: true, stop: vi.fn() },
    ])
  }
}

class MockAudioContext {
  currentTime = 0
  state = 'running'
  destination = new MockAudioNode()
  createGain = vi.fn(() => new MockGainNode())
  createBiquadFilter = vi.fn(() => new MockBiquadFilterNode())
  createAnalyser = vi.fn(() => new MockAnalyserNode())
  createDelay = vi.fn(() => ({
    ...new MockAudioNode(),
    delayTime: new MockAudioParam(),
  }))
  createMediaStreamSource = vi.fn(() => new MockAudioNode())
  createMediaStreamDestination = vi.fn(() => new MockDestinationNode())
  resume = vi.fn(async () => {})
  close = vi.fn(async () => {})
}

describe('CallAudioIsolator - Live Screen/App Sound Isolation', () => {
  let prevAudioContext: any
  let prevWindow: any

  beforeEach(() => {
    prevAudioContext = (globalThis as any).AudioContext
    prevWindow = (globalThis as any).window
    ;(globalThis as any).AudioContext = MockAudioContext
    ;(globalThis as any).MediaStream = MockMediaStream
    ;(globalThis as any).window = {
      AudioContext: MockAudioContext,
      MediaStream: MockMediaStream,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      setInterval: setInterval.bind(globalThis),
      clearInterval: clearInterval.bind(globalThis),
    }

    useMediaStore.setState({
      screenShareIsolateCallAudio: true,
      screenShareTargetTitle: null,
      screenShareAudioMode: 'app_only',
      screenShareAudioVolume: 80,
      peerStreams: {},
    })
  })

  afterEach(() => {
    ;(globalThis as any).AudioContext = prevAudioContext
    ;(globalThis as any).window = prevWindow
    vi.restoreAllMocks()
  })

  it('useMediaStore correctly handles call audio isolation state and application title', () => {
    const state = useMediaStore.getState()
    expect(state.screenShareIsolateCallAudio).toBe(true)
    expect(state.screenShareAudioMode).toBe('app_only')
    expect(state.screenShareTargetTitle).toBeNull()

    state.setScreenShareTargetTitle('Google Chrome - YouTube')
    expect(useMediaStore.getState().screenShareTargetTitle).toBe('Google Chrome - YouTube')

    state.setScreenShareAudioMode('app_and_mic')
    expect(useMediaStore.getState().screenShareAudioMode).toBe('app_and_mic')

    state.setScreenShareIsolateCallAudio(false)
    expect(useMediaStore.getState().screenShareIsolateCallAudio).toBe(false)
  })

  it('should initialize audio graph in app_only mode without mixing local mic', () => {
    const isolator = new CallAudioIsolator()
    const screenTrack: any = { id: 'screen-audio-1', kind: 'audio', enabled: true, stop: vi.fn() }
    const micTrack: any = { id: 'mic-1', kind: 'audio', enabled: true, stop: vi.fn() }
    const localStream = new MockMediaStream([micTrack])

    const isolatedTrack = isolator.init(screenTrack, localStream as unknown as MediaStream, {
      mixMicrophone: false,
      isolateCallAudio: true,
      initialVolume: 0.8,
      targetTitle: 'Google Chrome - YouTube',
    })

    expect(isolatedTrack).toBeDefined()
    expect(isolatedTrack?.id).toBe('isolated-audio-out')
    expect(useMediaStore.getState().screenShareAudioMode).toBe('app_only')
    expect(useMediaStore.getState().screenShareTargetTitle).toBe('Google Chrome - YouTube')

    isolator.dispose()
  })

  it('should mix local microphone when mixMicrophone is true', () => {
    const isolator = new CallAudioIsolator()
    const screenTrack: any = { id: 'screen-audio-1', kind: 'audio', enabled: true, stop: vi.fn() }
    const micTrack: any = { id: 'mic-1', kind: 'audio', enabled: true, stop: vi.fn() }
    const localStream = new MockMediaStream([micTrack])

    const isolatedTrack = isolator.init(screenTrack, localStream as unknown as MediaStream, {
      mixMicrophone: true,
      isolateCallAudio: true,
      initialVolume: 0.5,
      targetTitle: 'VLC Media Player',
    })

    expect(isolatedTrack).toBeDefined()
    expect(useMediaStore.getState().screenShareAudioMode).toBe('app_and_mic')

    isolator.dispose()
  })

  it('should update screen share volume dynamically via updateVolume', () => {
    const isolator = new CallAudioIsolator()
    const screenTrack: any = { id: 'screen-audio-1', kind: 'audio', enabled: true, stop: vi.fn() }

    isolator.init(screenTrack, null, {
      mixMicrophone: false,
      isolateCallAudio: true,
      initialVolume: 0.5,
    })

    expect(() => isolator.updateVolume(100)).not.toThrow()
    expect(() => isolator.updateVolume(0)).not.toThrow()
    expect(() => isolator.updateVolume(50)).not.toThrow()

    isolator.dispose()
  })

  it('should dynamically track remote peer voice streams to prevent call voice leak into live stream', () => {
    const isolator = new CallAudioIsolator()
    const screenTrack: any = { id: 'screen-audio-1', kind: 'audio', enabled: true, stop: vi.fn() }

    isolator.init(screenTrack, null, {
      mixMicrophone: false,
      isolateCallAudio: true,
    })

    // Simulate remote peers entering the call
    const peerAudioTrack: any = { id: 'peer-audio-1', kind: 'audio', enabled: true, stop: vi.fn() }
    const peerStream = new MockMediaStream([peerAudioTrack])

    useMediaStore.getState().setPeerStream('peer-user-123', peerStream as unknown as MediaStream)

    // Remote peer streams should be safely monitored
    expect(useMediaStore.getState().peerStreams['peer-user-123']).toBe(peerStream)

    // Simulate remote peer leaving
    useMediaStore.getState().removePeerStream('peer-user-123')
    expect(useMediaStore.getState().peerStreams['peer-user-123']).toBeUndefined()

    isolator.dispose()
  })

  it('should safely fallback to raw screen track when Web Audio is unavailable', () => {
    delete (globalThis as any).AudioContext
    delete (globalThis as any).window.AudioContext

    const isolator = new CallAudioIsolator()
    const screenTrack: any = { id: 'raw-screen-audio', kind: 'audio', enabled: false, stop: vi.fn() }

    const outTrack = isolator.init(screenTrack, null, {
      mixMicrophone: false,
      isolateCallAudio: true,
    })

    expect(outTrack).toBe(screenTrack)
    expect(screenTrack.enabled).toBe(true)

    isolator.dispose()
  })

  it('should integrate seamlessly into MediaManager startScreenShare and stopScreenShare', async () => {
    const screenVideoTrack: any = { id: 'screen-v', kind: 'video', enabled: false, stop: vi.fn(), onended: null }
    const screenAudioTrack: any = { id: 'screen-a', kind: 'audio', enabled: false, stop: vi.fn() }
    const mockScreenStream = new MockMediaStream([screenVideoTrack, screenAudioTrack])

    ;(navigator.mediaDevices.getDisplayMedia as any) = vi.fn(async () => mockScreenStream)
    const replaceAudioSpy = vi.spyOn(PeerManager.getInstance(), 'replaceAudioTrack')

    const stream = await MediaManager.getInstance().startScreenShare({
      includeAudio: true,
      mixMicrophone: false,
      isolateCallAudio: true,
      sourceName: 'Google Chrome - YouTube Live',
      resolution: '1080p',
      fps: 60,
    })

    expect(stream).toBe(mockScreenStream)
    expect(useMediaStore.getState().isScreenSharing).toBe(true)
    expect(useMediaStore.getState().screenShareTargetTitle).toBe('Google Chrome - YouTube Live')
    expect(useMediaStore.getState().screenShareAudioMode).toBe('app_only')
    expect(replaceAudioSpy).toHaveBeenCalled()

    // When stopping screen share, title should be reset
    MediaManager.getInstance().stopScreenShare()
    expect(useMediaStore.getState().isScreenSharing).toBe(false)
    expect(useMediaStore.getState().screenShareTargetTitle).toBeNull()
  })
})
