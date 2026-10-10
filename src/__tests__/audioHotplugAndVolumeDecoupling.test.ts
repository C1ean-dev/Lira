import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useMediaStore } from '../store/useMediaStore'
import { MediaManager } from '../media/MediaManager'
import { applyAudioOutput } from '../media/remoteAudio'

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

    Object.defineProperty(globalThis, 'window', { value: fakeWindow, configurable: true, writable: true })
    Object.defineProperty(globalThis, 'document', { value: fakeDoc, configurable: true, writable: true })
    Object.defineProperty(globalThis, 'navigator', { value: fakeNavigator, configurable: true, writable: true })
    Object.defineProperty(globalThis, 'MediaStream', { value: FakeMediaStream, configurable: true, writable: true })
    Object.defineProperty(globalThis, 'CustomEvent', { value: FakeCustomEvent, configurable: true, writable: true })

    useMediaStore.setState({
      participantVolumes: {},
      liveStreamVolume: 100,
      selectedAudioInput: 'default',
      selectedAudioOutput: 'default',
      selectedVideoInput: 'default',
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (origWindow) Object.defineProperty(globalThis, 'window', origWindow)
    if (origDoc) Object.defineProperty(globalThis, 'document', origDoc)
    if (origNav) Object.defineProperty(globalThis, 'navigator', origNav)
    if (origMS) Object.defineProperty(globalThis, 'MediaStream', origMS)
    if (origCE) Object.defineProperty(globalThis, 'CustomEvent', origCE)
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
})
