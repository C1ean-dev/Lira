import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useMediaStore } from '../../store/useMediaStore'
import { MediaManager } from '../../media/MediaManager'
import { applyAudioOutput } from '../../media/remoteAudio'

class FakeMediaStream {
  private tracks: any[]
  addEventListener = vi.fn()
  removeEventListener = vi.fn()
  constructor(tracks: any[] = []) {
    this.tracks = [...tracks]
  }
  getTracks() {
    return this.tracks
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === 'audio')
  }
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === 'video')
  }
  addTrack(track: any) {
    this.tracks.push(track)
  }
  removeTrack(track: any) {
    this.tracks = this.tracks.filter((t) => t !== track)
  }
}

describe('Audio Hotplug & Volume Decoupling', () => {
  const origWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const origDoc = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const origNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const origMS = Object.getOwnPropertyDescriptor(globalThis, 'MediaStream')
  const origCE = Object.getOwnPropertyDescriptor(globalThis, 'CustomEvent')

  const origAudioCtx = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext')
  const origAudio = Object.getOwnPropertyDescriptor(globalThis, 'Audio')

  beforeEach(() => {
    class FakeCustomEvent {
      type: string
      detail: any
      constructor(type: string, init?: any) {
        this.type = type
        this.detail = init?.detail
      }
    }

    const fakeWindow: any = {
      dispatchEvent: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }
    const fakeNavigator: any = {
      mediaDevices: {
        enumerateDevices: vi.fn().mockResolvedValue([]),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        getUserMedia: vi.fn(),
      },
    }
    const fakeDoc: any = {
      querySelectorAll: vi.fn().mockReturnValue([]),
      createElement: vi.fn(),
    }

    class MockAudioParam {
      value = 0
      setValueAtTime = vi.fn()
      exponentialRampToValueAtTime = vi.fn()
      linearRampToValueAtTime = vi.fn()
      cancelScheduledValues = vi.fn()
      setTargetAtTime = vi.fn()
    }
    class MockNode {
      connect = vi.fn()
      disconnect = vi.fn()
    }
    class MockOscillator extends MockNode {
      type = 'sine'
      frequency = new MockAudioParam()
      start = vi.fn()
      stop = vi.fn()
    }
    class MockGain extends MockNode {
      gain = new MockAudioParam()
    }
    class MockAnalyser extends MockNode {
      fftSize = 2048
      frequencyBinCount = 1024
      smoothingTimeConstant = 0.8
      getFloatTimeDomainData = vi.fn()
      getByteFrequencyData = vi.fn()
    }
    class MockBiquad extends MockNode {
      type = 'highpass'
      frequency = new MockAudioParam()
      gain = new MockAudioParam()
      Q = new MockAudioParam()
    }
    class MockCompressor extends MockNode {
      threshold = new MockAudioParam()
      knee = new MockAudioParam()
      ratio = new MockAudioParam()
      attack = new MockAudioParam()
      release = new MockAudioParam()
    }
    class MockTestAudioContext {
      currentTime = 0
      sampleRate = 48000
      state = 'running'
      destination = {}
      sinkId = ''
      constructor(public options?: any) {
        if (options?.sinkId) this.sinkId = options.sinkId
      }
      createOscillator() {
        return new MockOscillator()
      }
      createGain() {
        return new MockGain()
      }
      createAnalyser() {
        return new MockAnalyser()
      }
      createBiquadFilter() {
        return new MockBiquad()
      }
      createDynamicsCompressor() {
        return new MockCompressor()
      }
      createMediaStreamSource() {
        return new MockNode()
      }
      createMediaStreamDestination() {
        return { stream: new FakeMediaStream() }
      }
      setSinkId = vi.fn().mockImplementation(async (id: string) => {
        this.sinkId = id
      })
      resume = vi.fn().mockResolvedValue(undefined)
      close = vi.fn().mockResolvedValue(undefined)
    }

    fakeWindow.AudioContext = MockTestAudioContext
    fakeWindow.webkitAudioContext = MockTestAudioContext
    fakeWindow.requestAnimationFrame = vi.fn().mockReturnValue(1)
    fakeWindow.cancelAnimationFrame = vi.fn()

    class MockAudioElement {
      srcObject: any = null
      sinkId: string = ''
      setSinkId = vi.fn().mockImplementation(async (id: string) => {
        this.sinkId = id
      })
      play = vi.fn().mockResolvedValue(undefined)
      pause = vi.fn()
    }

    Object.defineProperty(globalThis, 'window', { value: fakeWindow, configurable: true, writable: true })
    Object.defineProperty(globalThis, 'document', { value: fakeDoc, configurable: true, writable: true })
    Object.defineProperty(globalThis, 'navigator', { value: fakeNavigator, configurable: true, writable: true })
    Object.defineProperty(globalThis, 'MediaStream', { value: FakeMediaStream, configurable: true, writable: true })
    Object.defineProperty(globalThis, 'CustomEvent', { value: FakeCustomEvent, configurable: true, writable: true })
    Object.defineProperty(globalThis, 'AudioContext', { value: MockTestAudioContext, configurable: true, writable: true })
    Object.defineProperty(globalThis, 'Audio', { value: MockAudioElement, configurable: true, writable: true })
    Object.defineProperty(globalThis, 'requestAnimationFrame', { value: fakeWindow.requestAnimationFrame, configurable: true, writable: true })
    Object.defineProperty(globalThis, 'cancelAnimationFrame', { value: fakeWindow.cancelAnimationFrame, configurable: true, writable: true })

    const manager = MediaManager.getInstance()
    ;(manager as any).rawUserStream = null

    useMediaStore.setState({
      participantVolumes: {},
      liveStreamVolume: 100,
      selectedAudioInput: 'default',
      selectedAudioOutput: 'default',
      selectedVideoInput: 'default',
      isTestingMic: false,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (origWindow) Object.defineProperty(globalThis, 'window', origWindow)
    if (origDoc) Object.defineProperty(globalThis, 'document', origDoc)
    if (origNav) Object.defineProperty(globalThis, 'navigator', origNav)
    if (origMS) Object.defineProperty(globalThis, 'MediaStream', origMS)
    if (origCE) Object.defineProperty(globalThis, 'CustomEvent', origCE)
    if (origAudioCtx) Object.defineProperty(globalThis, 'AudioContext', origAudioCtx)
    else delete (globalThis as any).AudioContext
    if (origAudio) Object.defineProperty(globalThis, 'Audio', origAudio)
    else delete (globalThis as any).Audio
  })

  it('keeps participant voice volume decoupled from live stream volume', () => {
    const store = useMediaStore.getState()

    store.setParticipantVolume('peer-aravon', 100)
    store.setParticipantVolume('Aravon', 100)
    expect(useMediaStore.getState().participantVolumes['peer-aravon']).toBe(100)
    expect(useMediaStore.getState().participantVolumes['Aravon']).toBe(100)

    store.setLiveStreamVolume(20)
    expect(useMediaStore.getState().liveStreamVolume).toBe(20)
    expect(useMediaStore.getState().participantVolumes['peer-aravon']).toBe(100)
    expect(useMediaStore.getState().participantVolumes['Aravon']).toBe(100)

    store.setLiveStreamVolume(0)
    expect(useMediaStore.getState().liveStreamVolume).toBe(0)
    expect(useMediaStore.getState().participantVolumes['peer-aravon']).toBe(100)
    expect(useMediaStore.getState().participantVolumes['Aravon']).toBe(100)

    store.setParticipantVolume('peer-clean', 150)
    expect(useMediaStore.getState().participantVolumes['peer-clean']).toBe(150)
    expect(useMediaStore.getState().liveStreamVolume).toBe(0)
  })

  it('falls back to default devices and re-evaluates outputs when selected device is disconnected', async () => {
    useMediaStore.setState({
      selectedAudioInput: 'bt-headset-in',
      selectedAudioOutput: 'bt-headset-out',
      selectedVideoInput: 'usb-cam',
    })

    const enumerated = [
      { deviceId: 'default', kind: 'audioinput', label: 'Default Mic' },
      { deviceId: 'cable-headset-in', kind: 'audioinput', label: 'Cable Mic' },
      { deviceId: 'default', kind: 'audiooutput', label: 'Default Speaker' },
      { deviceId: 'cable-headset-out', kind: 'audiooutput', label: 'Cable Headphones' },
    ]

    navigator.mediaDevices.enumerateDevices = vi.fn().mockResolvedValue(enumerated as any)

    const manager = MediaManager.getInstance()
    const changeOutputSpy = vi.spyOn(manager, 'changeAudioOutput').mockResolvedValue(true)
    const changeInputSpy = vi.spyOn(manager, 'changeAudioInput').mockResolvedValue(true)

    ;(manager as any).rawUserStream = new FakeMediaStream([{ kind: 'audio', readyState: 'live', stop: vi.fn() }])

    await manager.handleDeviceChange()

    expect(useMediaStore.getState().selectedAudioInput).toBe('default')
    expect(useMediaStore.getState().selectedAudioOutput).toBe('default')
    expect(useMediaStore.getState().selectedVideoInput).toBe('default')
    expect(changeOutputSpy).toHaveBeenCalledWith('default')
    expect(changeInputSpy).toHaveBeenCalledWith('default')

    const dispatchSpy = window.dispatchEvent as any
    const firedCustomEvent = dispatchSpy.mock.calls.some(
      ([event]: any) => event?.type === 'lira:devices-changed'
    )
    expect(firedCustomEvent).toBe(true)
  })

  it('re-acquires default audio input when device change occurs on default mic setting', async () => {
    useMediaStore.setState({
      selectedAudioInput: 'default',
      selectedAudioOutput: 'default',
    })

    const enumerated = [
      { deviceId: 'default', kind: 'audioinput', label: 'Default Mic' },
      { deviceId: 'default', kind: 'audiooutput', label: 'Default Speaker' },
    ]

    navigator.mediaDevices.enumerateDevices = vi.fn().mockResolvedValue(enumerated as any)

    const manager = MediaManager.getInstance()
    vi.spyOn(manager, 'changeAudioOutput').mockResolvedValue(true)
    const changeInputSpy = vi.spyOn(manager, 'changeAudioInput').mockResolvedValue(true)

    ;(manager as any).rawUserStream = new FakeMediaStream([{ kind: 'audio', readyState: 'live', stop: vi.fn() }])

    await manager.handleDeviceChange()

    expect(changeInputSpy).toHaveBeenCalledWith('default')
  })

  it('applies sinkId properly to audio element and resumes playback if paused', () => {
    const el = {
      muted: false,
      volume: 0,
      paused: true,
      setSinkId: vi.fn().mockReturnValue(Promise.resolve()),
      play: vi.fn().mockReturnValue(Promise.resolve()),
    } as any

    applyAudioOutput(el, { muted: false, volume: 0.8, sinkId: 'default' })

    expect(el.setSinkId).toHaveBeenCalledWith('')
    expect(el.muted).toBe(false)
    expect(el.volume).toBe(0.8)
    expect(el.play).toHaveBeenCalled()
  })

  it('routes playAudioTestBeep to selected audio output device', async () => {
    useMediaStore.setState({
      selectedAudioOutput: 'monitor-hdmi-out',
    })

    let lastSinkId = ''
    class TrackingAudioElement {
      srcObject: any = null
      setSinkId = vi.fn().mockImplementation(async (id: string) => {
        lastSinkId = id
      })
      play = vi.fn().mockResolvedValue(undefined)
      pause = vi.fn()
    }
    Object.defineProperty(globalThis, 'Audio', { value: TrackingAudioElement, configurable: true, writable: true })

    const manager = MediaManager.getInstance()
    await manager.playAudioTestBeep()

    expect(lastSinkId).toBe('monitor-hdmi-out')
  })

  it('routes playAudioTestBeep to explicitly provided target output device', async () => {
    useMediaStore.setState({
      selectedAudioOutput: 'headset-out',
    })

    let lastSinkId = ''
    class TrackingAudioElement {
      srcObject: any = null
      setSinkId = vi.fn().mockImplementation(async (id: string) => {
        lastSinkId = id
      })
      play = vi.fn().mockResolvedValue(undefined)
      pause = vi.fn()
    }
    Object.defineProperty(globalThis, 'Audio', { value: TrackingAudioElement, configurable: true, writable: true })

    const manager = MediaManager.getInstance()
    await manager.playAudioTestBeep('monitor-speakers-out')

    expect(lastSinkId).toBe('monitor-speakers-out')
  })

  it('stops audio test beep and cleans up when output device is changed', async () => {
    const manager = MediaManager.getInstance()
    const stopSpy = vi.spyOn(manager, 'stopAudioTestBeep')
    await manager.changeAudioOutput('new-device')
    expect(stopSpy).toHaveBeenCalled()
  })

  it('setSelectedAudioOutput does not recursively invoke changeAudioOutput', () => {
    const manager = MediaManager.getInstance()
    const changeSpy = vi.spyOn(manager, 'changeAudioOutput')
    useMediaStore.getState().setSelectedAudioOutput('test-out')
    expect(changeSpy).not.toHaveBeenCalled()
  })

  it('acquires audio input and enables loopback when starting mic test without prior stream', async () => {
    const mockTrack = {
      kind: 'audio',
      enabled: true,
      readyState: 'live',
      stop: vi.fn(),
      applyConstraints: vi.fn().mockResolvedValue(undefined),
    }
    const mockStream = new FakeMediaStream([mockTrack])
    ;(navigator.mediaDevices.getUserMedia as any) = vi.fn().mockResolvedValue(mockStream)

    const manager = MediaManager.getInstance()
    const loopbackSpy = vi.spyOn((manager as any).classicEngine, 'setTestLoopback')

    await manager.setTestMic(true)

    expect(useMediaStore.getState().isTestingMic).toBe(true)
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled()
    expect(loopbackSpy).toHaveBeenCalledWith(true)

    await manager.setTestMic(false)
    expect(useMediaStore.getState().isTestingMic).toBe(false)
    expect(loopbackSpy).toHaveBeenCalledWith(false)
  })

  it('re-enables test loopback when switching microphone during active mic test', async () => {
    const mockTrack1 = {
      kind: 'audio',
      enabled: true,
      readyState: 'live',
      stop: vi.fn(),
      applyConstraints: vi.fn().mockResolvedValue(undefined),
    }
    const mockStream1 = new FakeMediaStream([mockTrack1])

    const mockTrack2 = {
      kind: 'audio',
      enabled: true,
      readyState: 'live',
      stop: vi.fn(),
      applyConstraints: vi.fn().mockResolvedValue(undefined),
    }
    const mockStream2 = new FakeMediaStream([mockTrack2])

    let callCount = 0
    ;(navigator.mediaDevices.getUserMedia as any) = vi.fn().mockImplementation(() => {
      callCount++
      return Promise.resolve(callCount === 1 ? mockStream1 : mockStream2)
    })

    const manager = MediaManager.getInstance()
    await manager.setTestMic(true)
    expect(useMediaStore.getState().isTestingMic).toBe(true)

    const loopbackSpy = vi.spyOn((manager as any).classicEngine, 'setTestLoopback')
    await manager.changeAudioInput('usb-mic-device-id')

    expect(mockTrack1.stop).toHaveBeenCalled()
    expect(useMediaStore.getState().selectedAudioInput).toBe('usb-mic-device-id')
    expect(loopbackSpy).toHaveBeenCalledWith(true)

    await manager.setTestMic(false)
  })
})

