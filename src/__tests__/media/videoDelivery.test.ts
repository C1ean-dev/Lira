import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { MediaManager } from '../../media/MediaManager'
import { MediaCallHandler } from '../../p2p/mediaCalls'
import { PeerManager } from '../../p2p/PeerManager'
import { SCREEN_START_HOLD_MS, activeScreenCaps, __resetVideoSendPolicyForTests } from '../../p2p/videoSendPolicy'
import { useMediaStore } from '../../store/useMediaStore'
import { useGameStore } from '../../store/useGameStore'

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

const fakeCanvasStream = {
  getVideoTracks: () => [
    {
      id: 'dummy-canvas-video-track',
      kind: 'video',
      enabled: false,
      contentHint: '',
      stop: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  ],
}

if (typeof globalThis.MediaStream === 'undefined') {
  ;(globalThis as any).MediaStream = MockMediaStream
}

if (typeof globalThis.document === 'undefined') {
  ;(globalThis as any).document = {
    createElement: (tag: string) => {
      if (tag === 'canvas') {
        return {
          width: 0,
          height: 0,
          getContext: () => ({
            fillStyle: '',
            fillRect: () => {},
          }),
          captureStream: () => fakeCanvasStream,
        }
      }
      return {}
    },
  }
}

if (typeof globalThis.navigator === 'undefined') {
  ;(globalThis as any).navigator = {
    mediaDevices: {
      getUserMedia: vi.fn(),
      getDisplayMedia: vi.fn(),
    },
  }
} else if (!globalThis.navigator.mediaDevices) {
  ;(globalThis.navigator as any).mediaDevices = {
    getUserMedia: vi.fn(),
    getDisplayMedia: vi.fn(),
  }
}

describe('Video Delivery & Screen Share Guarantee Tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    __resetVideoSendPolicyForTests()
    useMediaStore.setState({
      localStream: null,
      localScreenStream: null,
      isScreenSharing: false,
      isMuted: true,
      isCameraOff: true,
      peerStreams: {},
      peerScreenStreams: {},
    })
    useGameStore.setState({
      localPlayer: {
        id: 'local-user',
        name: 'Local Tester',
        x: 10,
        y: 10,
        direction: 'down',
        isMoving: false,
        avatar: { baseId: 'char-1', shirtColor: '#4c6ef5' },
        currentZoneId: 'zone-1',
        isScreenSharing: false,
        isMuted: true,
        isCameraOff: true,
      },
      remotePlayers: {},
    })
  })

  it.each([undefined, true])('does not capture the webcam at startup when the camera is off (video=%s)', async (video) => {
    const manager = MediaManager.getInstance()
    const gum = vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockResolvedValue(new MockMediaStream() as any)
    vi.spyOn(manager as any, 'runEngine').mockImplementation(async (stream) => stream)
    vi.spyOn(manager as any, 'initDeviceWatcher').mockImplementation(() => {})

    await manager.startMedia(video)

    expect(gum).toHaveBeenCalledWith(expect.objectContaining({ video: false }))
    expect(gum.mock.calls.every(([constraints]) => constraints?.video === false)).toBe(true)
    expect(useMediaStore.getState().isCameraOff).toBe(true)
  })

  it('does not try a camera fallback when audio acquisition fails with the camera off', async () => {
    const manager = MediaManager.getInstance()
    const gum = vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockRejectedValue(new Error('Microphone unavailable'))
    vi.spyOn(manager as any, 'runEngine').mockImplementation(async (stream) => stream)
    vi.spyOn(manager as any, 'initDeviceWatcher').mockImplementation(() => {})

    await manager.startMedia(true, true)

    expect(gum.mock.calls.every(([constraints]) => constraints?.video === false)).toBe(true)
  })

  it('starts a new audio-only session with camera off even after a previous activation', async () => {
    const manager = MediaManager.getInstance()
    useMediaStore.setState({ isCameraOff: false })
    const gum = vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockResolvedValue(new MockMediaStream() as any)
    vi.spyOn(manager as any, 'runEngine').mockImplementation(async (stream) => stream)
    vi.spyOn(manager as any, 'initDeviceWatcher').mockImplementation(() => {})

    await manager.startMedia(false, true)

    expect(gum).toHaveBeenCalledWith(expect.objectContaining({ video: false }))
    expect(useMediaStore.getState().isCameraOff).toBe(true)
    expect(useMediaStore.getState().localStream?.getVideoTracks().every(track => !track.enabled)).toBe(true)
  })

  it.each(['stopAllMedia', 'stopAll'] as const)('clears camera activation and stops capture on %s', (method) => {
    const manager = MediaManager.getInstance()
    const camera = { kind: 'video', enabled: true, stop: vi.fn() }
    const stream = new MockMediaStream([camera])
    ;(manager as any).rawUserStream = stream
    useMediaStore.setState({ localStream: stream as any, isCameraOff: false })
    vi.spyOn(manager, 'stopScreenShare').mockImplementation(() => {})

    manager[method]()

    expect(camera.stop).toHaveBeenCalled()
    expect(useMediaStore.getState().isCameraOff).toBe(true)
    expect(useMediaStore.getState().localStream).toBeNull()
  })

  it.each(['startMedia', 'changeAudioInput'] as const)('does not publish %s that completes after leaving the session', async (method) => {
    const manager = MediaManager.getInstance()
    const audio = { id: 'mic-cancelled', kind: 'audio', enabled: true, stop: vi.fn() }
    const stream = new MockMediaStream([audio])
    vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockResolvedValue(stream as any)
    vi.spyOn(manager, 'createDummyVideoTrack').mockReturnValue(null as any)
    const replace = vi.spyOn(PeerManager.getInstance(), 'replaceAudioTrack').mockImplementation(() => {})
    let finish!: (stream: MediaStream) => void
    const processing = new Promise<MediaStream>(resolve => { finish = resolve })
    const engine = vi.spyOn(manager as any, 'runEngine').mockReturnValue(processing)
    const started = method === 'startMedia' ? manager.startMedia(false, true) : manager.changeAudioInput('new-mic')
    await vi.waitFor(() => expect(engine).toHaveBeenCalled())

    manager.stopAllMedia()
    finish(stream as any)

    await expect(started).resolves.toBe(method === 'startMedia' ? null : false)
    expect(useMediaStore.getState().localStream).toBeNull()
    expect(audio.stop).toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
  })

  it('should generate a dummy video track when canvas is available to guarantee video transceiver', () => {
    const mediaManager = MediaManager.getInstance()
    const dummyTrack = mediaManager.createDummyVideoTrack()

    expect(dummyTrack).toBeDefined()
    expect(dummyTrack.kind).toBe('video')
    expect(dummyTrack.enabled).toBe(false)
  })

  it('should guarantee that startMedia provides a video track even if user has no webcam', async () => {
    const fakeAudioTrack = {
      id: 'mic-audio-track',
      kind: 'audio',
      enabled: true,
      stop: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }

    const fakeVideoTrack = {
      id: 'canvas-video-track',
      kind: 'video',
      enabled: false,
      stop: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }

    vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockImplementation(async (constraints: any) => {
      if (constraints?.video) {
        throw new Error('NotFoundError: No webcam found on system')
      }
      const s = new MockMediaStream()
      s.addTrack(fakeAudioTrack)
      return s as unknown as MediaStream
    })

    const mediaManager = MediaManager.getInstance()
    vi.spyOn(mediaManager, 'createDummyVideoTrack').mockReturnValue(fakeVideoTrack as any)
    vi.spyOn(mediaManager as any, 'runEngine').mockImplementation(async (rawStream: any) => rawStream)

    const stream = await mediaManager.startMedia(true, true)

    expect(stream).toBeDefined()
    expect(stream?.getVideoTracks().length).toBeGreaterThanOrEqual(1)
    expect(stream?.getAudioTracks().length).toBeGreaterThanOrEqual(1)
    expect(useMediaStore.getState().localStream).toBe(stream)
  })

  it('should correctly configure RTCRtpSender and bitrate when replaceVideoTrack is called with screen track', async () => {
    const fakeScreenTrack = {
      id: 'screen-video-track-1',
      kind: 'video',
      enabled: false,
      contentHint: '',
      stop: vi.fn(),
    } as unknown as MediaStreamTrack

    let replacedWith: any = null
    const encodings = [{ maxBitrate: 0, maxFramerate: 0, scaleResolutionDownBy: 0 }]
    const mockSender = {
      track: { kind: 'video' },
      replaceTrack: vi.fn(async (t) => {
        replacedWith = t
      }),
      getParameters: vi.fn(() => ({ encodings })),
      setParameters: vi.fn(async () => {}),
    }

    const mockPeerConnection = {
      getSenders: () => [mockSender],
      getTransceivers: () => [],
    }

    const mockCall = {
      peer: 'remote-peer-1',
      peerConnection: mockPeerConnection,
    }

    const mediaCalls = new Map<string, any>()
    mediaCalls.set('remote-peer-1', mockCall)

    vi.useFakeTimers()
    try {
      MediaCallHandler.replaceVideoTrack(mediaCalls, fakeScreenTrack, true, 4_500_000, 60)

      expect(fakeScreenTrack.enabled).toBe(true)
      expect(fakeScreenTrack.contentHint).toBe('motion')
      expect(mockSender.replaceTrack).toHaveBeenCalledWith(fakeScreenTrack)

      await vi.advanceTimersByTimeAsync(0)
      expect(replacedWith).toBe(fakeScreenTrack)

      expect(encodings[0].maxBitrate).toBe(4_500_000)
      expect(encodings[0].maxFramerate).toBe(60)
      expect(mockSender.setParameters).toHaveBeenCalled()
      const firstParams = mockSender.setParameters.mock.calls[0][0]
      expect(firstParams.degradationPreference).toBe('maintain-resolution')

      await vi.advanceTimersByTimeAsync(SCREEN_START_HOLD_MS)
      const lastCall = mockSender.setParameters.mock.calls[mockSender.setParameters.mock.calls.length - 1]
      expect(lastCall[0].degradationPreference).toBe('maintain-framerate')
      expect(encodings[0].maxBitrate).toBe(4_500_000)
    } finally {
      vi.useRealTimers()
    }
  })

  it('should cap camera tracks at 1.2Mbps/30fps with maintain-framerate', async () => {    const fakeCamTrack = {
      id: 'cam-video-track-1',
      kind: 'video',
      enabled: false,
      contentHint: '',
      stop: vi.fn(),
    } as unknown as MediaStreamTrack

    const encodings = [{ maxBitrate: 0, maxFramerate: 0, scaleResolutionDownBy: 0 }]
    const params: any = { encodings }
    const mockSender = {
      track: { kind: 'video' },
      replaceTrack: vi.fn(async () => {}),
      getParameters: vi.fn(() => params),
      setParameters: vi.fn(async () => {}),
    }

    const mediaCalls = new Map<string, any>()
    mediaCalls.set('remote-peer-1', {
      peer: 'remote-peer-1',
      peerConnection: { getSenders: () => [mockSender], getTransceivers: () => [] },
    })

    MediaCallHandler.replaceVideoTrack(mediaCalls, fakeCamTrack, false)

    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))

    expect(encodings[0].maxBitrate).toBe(1_200_000)
    expect(encodings[0].maxFramerate).toBe(30)
    expect(params.degradationPreference).toBe('maintain-framerate')
  })

  it('should apply receiver jitter buffer to eliminate stuttering in media calls', () => {
    const mockReceiver = {
      playoutDelayHint: 0,
      jitterBufferTarget: 0,
    }

    const mockPeerConnection = {
      getReceivers: () => [mockReceiver],
    }

    const mockCall = {
      peer: 'remote-peer-1',
      peerConnection: mockPeerConnection,
    }

    const mediaCalls = new Map<string, any>()
    mediaCalls.set('remote-peer-1', mockCall)

    MediaCallHandler.applyJitterBuffer(mediaCalls, 600)

    expect(mockReceiver.playoutDelayHint).toBe(0.6)
    expect(mockReceiver.jitterBufferTarget).toBe(600)

    MediaCallHandler.applyJitterBuffer(mediaCalls, 1)
    expect(mockReceiver.playoutDelayHint).toBe(0.001)
    expect(mockReceiver.jitterBufferTarget).toBe(1)
  })

  it('should restore camera/dummy video track when stopScreenShare is called', () => {
    const fakeDummyTrack = {
      id: 'dummy-track-reverted',
      kind: 'video',
      enabled: false,
      contentHint: 'detail',
      stop: vi.fn(),
    } as unknown as MediaStreamTrack

    const localStream = new MockMediaStream()
    localStream.addTrack(fakeDummyTrack)
    useMediaStore.getState().setLocalStream(localStream as unknown as MediaStream)

    const mediaManager = MediaManager.getInstance()
    vi.spyOn(mediaManager, 'createDummyVideoTrack').mockReturnValue(fakeDummyTrack)

    mediaManager.stopScreenShare()

    expect(useMediaStore.getState().isScreenSharing).toBe(false)
    expect(useMediaStore.getState().localScreenStream).toBeNull()
    expect(useGameStore.getState().localPlayer.isScreenSharing).toBe(false)
  })

  it('should properly map remote presenter stream in full screen grid', () => {
    const fakeRemoteStream = {
      id: 'remote-stream-with-screen',
      getVideoTracks: () => [{ id: 'remote-video', kind: 'video', enabled: true }],
      getAudioTracks: () => [{ id: 'remote-audio', kind: 'audio', enabled: true }],
    } as unknown as MediaStream

    useGameStore.setState({
      remotePlayers: {
        'remote-peer-1': {
          id: 'remote-peer-1',
          name: 'Remote Presenter',
          x: 10,
          y: 10,
          direction: 'down',
          isMoving: false,
          avatar: { baseId: 'char-1', shirtColor: '#e03131' },
          currentZoneId: 'zone-1',
          isScreenSharing: true,
          isMuted: false,
          isCameraOff: false,
        },
      },
    })

    useMediaStore.getState().setPeerStream('remote-peer-1', fakeRemoteStream)

    const remotePlayer = useGameStore.getState().remotePlayers['remote-peer-1']
    const peerStreams = useMediaStore.getState().peerStreams
    const peerScreenStreams = useMediaStore.getState().peerScreenStreams

    const screenStream = peerScreenStreams[remotePlayer.id] || (remotePlayer.isScreenSharing ? peerStreams[remotePlayer.id] : null)

    expect(screenStream).toBe(fakeRemoteStream)
    expect(remotePlayer.isScreenSharing).toBe(true)
  })

  it('should dial zone calls WITH the real stream (never empty) so remote video is not black', () => {
    const fakeAudioTrack = { id: 'mic-1', kind: 'audio', enabled: true, stop: vi.fn() }
    const fakeVideoTrack = { id: 'cam-1', kind: 'video', enabled: true, stop: vi.fn() }
    const localStream = new MockMediaStream()
    localStream.addTrack(fakeAudioTrack)
    localStream.addTrack(fakeVideoTrack)
    useMediaStore.getState().setLocalStream(localStream as unknown as MediaStream)

    let dialedStream: any = null
    const mockPc: any = {
      addEventListener: vi.fn(),
      getReceivers: () => [],
      getSenders: () => [],
      addTrack: vi.fn(),
      addTransceiver: vi.fn(),
    }
    const mockCall: any = {
      peer: 'remote-peer-1',
      peerConnection: mockPc,
      on: vi.fn(),
    }
    const mockPeer: any = {
      call: vi.fn((_peerId: string, stream: any) => {
        dialedStream = stream
        return mockCall
      }),
    }

    const remotePlayer: any = {
      id: 'remote-peer-1',
      name: 'Remote',
      x: 10,
      y: 10,
      direction: 'down',
      isMoving: false,
      avatar: { baseId: 'char-1', shirtColor: '#e03131' },
      currentZoneId: 'zone-1',
    }

    const mediaCalls = new Map<string, any>()
    MediaCallHandler.checkZoneCallEligibility(remotePlayer, mockPeer, mediaCalls, () => {})

    expect(mockPeer.call).toHaveBeenCalledTimes(1)
    expect(dialedStream).toBeDefined()
    expect(dialedStream.getAudioTracks().length).toBeGreaterThan(0)
    expect(dialedStream.getVideoTracks().length).toBeGreaterThan(0)
    expect(mockPc.addTrack).not.toHaveBeenCalled()
    expect(mockPc.addTransceiver).not.toHaveBeenCalled()
    expect(useGameStore.getState().callStates['remote-peer-1']).toBe('connecting')
  })

    it('applyEncoderCaps should only touch setParameters (never renegotiate tracks)', () => {    const encodings = [{ maxBitrate: 0, maxFramerate: 0, scaleResolutionDownBy: 0 }]
    const params: any = { encodings }
    const mockSender = {
      track: { kind: 'video' },
      replaceTrack: vi.fn(async () => {}),
      getParameters: vi.fn(() => params),
      setParameters: vi.fn(async () => {}),
    }
    const mockPc: any = {
      getSenders: () => [mockSender],
      addTrack: vi.fn(),
      addTransceiver: vi.fn(),
    }

    MediaCallHandler.applyEncoderCaps(mockPc)

    expect(mockPc.addTrack).not.toHaveBeenCalled()
    expect(mockPc.addTransceiver).not.toHaveBeenCalled()
    expect(mockSender.replaceTrack).not.toHaveBeenCalled()
    expect(mockSender.setParameters).toHaveBeenCalled()
    expect(encodings[0].maxBitrate).toBe(1_200_000)
    expect(params.degradationPreference).toBe('maintain-framerate')
  })

  it('screen-only audio mode should send JUST the screen track (mic never mixed)', async () => {
    const prevWindow = (globalThis as any).window
    ;(globalThis as any).window = {}
    try {
      const manager = MediaManager.getInstance() as any
      manager.isDjStreaming = true
      const djCapture = { stop: vi.fn() }
      manager.djProcessAudioCapture = djCapture
      const screenAudioTrack: any = { id: 'screen-audio-1', kind: 'audio', enabled: false, stop: vi.fn() }
      const screenVideoTrack: any = { id: 'screen-video-1', kind: 'video', enabled: false, stop: vi.fn(), onended: null }
      const fakeScreenStream = new MockMediaStream()
      fakeScreenStream.addTrack(screenAudioTrack)
      fakeScreenStream.addTrack(screenVideoTrack)

      ;(navigator.mediaDevices.getDisplayMedia as any).mockImplementationOnce(async () => fakeScreenStream)

      const micTrack: any = { id: 'mic-1', kind: 'audio', enabled: true, stop: vi.fn() }
      const localStream = new MockMediaStream()
      localStream.addTrack(micTrack)
      useMediaStore.getState().setLocalStream(localStream as unknown as MediaStream)

      const replaceSpy = vi.spyOn(PeerManager.getInstance(), 'replaceAudioTrack')

      const stream = await MediaManager.getInstance().startScreenShare({
        includeAudio: false,
        mixMicrophone: false,
        resolution: '720p',
        fps: 30,
      })

      expect(stream).toBe(fakeScreenStream as unknown as MediaStream)
      expect(manager.djProcessAudioCapture).toBe(djCapture)
      expect(djCapture.stop).not.toHaveBeenCalled()
      expect(replaceSpy).toHaveBeenCalledWith(screenAudioTrack)
      expect(screenAudioTrack.enabled).toBe(true)
      expect(navigator.mediaDevices.getDisplayMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          systemAudio: 'exclude',
          windowAudio: 'window',
        })
      )
      expect(useMediaStore.getState().isScreenSharing).toBe(true)

      MediaManager.getInstance().stopScreenShare()
      expect(manager.isDjStreaming).toBe(true)
      expect(djCapture.stop).not.toHaveBeenCalled()
      manager.isDjStreaming = false
      manager.djProcessAudioCapture = null
      expect(replaceSpy).toHaveBeenLastCalledWith(micTrack)
      expect(useMediaStore.getState().isScreenSharing).toBe(false)
    } finally {
      if (prevWindow === undefined) delete (globalThis as any).window
      else (globalThis as any).window = prevWindow
    }
  })

  it('Electron screen sharing never falls back to system audio and keeps the microphone active', async () => {
    const prevWindow = (globalThis as any).window
    const setScreenSource = vi.fn(async () => true)
    ;(globalThis as any).window = { electronAPI: { setScreenSource } }
    try {
      const screenVideoTrack: any = { id: 'screen-video-only', kind: 'video', enabled: false, stop: vi.fn(), onended: null }
      const screenStream = new MockMediaStream([screenVideoTrack])
      ;(navigator.mediaDevices.getDisplayMedia as any).mockImplementationOnce(async () => screenStream)

      const micTrack: any = { id: 'mic-to-mute', kind: 'audio', enabled: true, stop: vi.fn() }
      const localStream = new MockMediaStream([micTrack])
      useMediaStore.getState().setLocalStream(localStream as unknown as MediaStream)
      const replaceSpy = vi.spyOn(PeerManager.getInstance(), 'replaceAudioTrack')

      await MediaManager.getInstance().startScreenShare({
        sourceId: 'window:4242:0',
        includeAudio: true,
      })

      expect(setScreenSource).toHaveBeenCalledWith('window:4242:0', true, 'auto')
      expect(navigator.mediaDevices.getDisplayMedia).toHaveBeenCalledWith(
        expect.objectContaining({ audio: false })
      )
      expect(micTrack.enabled).toBe(true)
      expect(replaceSpy).toHaveBeenCalledWith(null)

      MediaManager.getInstance().stopScreenShare()
      expect(micTrack.enabled).toBe(true)
      expect(replaceSpy).toHaveBeenLastCalledWith(micTrack)
    } finally {
      if (prevWindow === undefined) delete (globalThis as any).window
      else (globalThis as any).window = prevWindow
    }
  })

  it('default mix mode should not crash without a browser AudioContext', async () => {
    const prevWindow = (globalThis as any).window
    ;(globalThis as any).window = {}
    try {
      const screenAudioTrack: any = { id: 'screen-audio-2', kind: 'audio', enabled: false, stop: vi.fn() }
      const screenVideoTrack: any = { id: 'screen-video-2', kind: 'video', enabled: false, stop: vi.fn(), onended: null }
      const fakeScreenStream = new MockMediaStream()
      fakeScreenStream.addTrack(screenAudioTrack)
      fakeScreenStream.addTrack(screenVideoTrack)

      ;(navigator.mediaDevices.getDisplayMedia as any).mockImplementationOnce(async () => fakeScreenStream)

      const stream = await MediaManager.getInstance().startScreenShare({ includeAudio: true })
      expect(stream).toBe(fakeScreenStream as unknown as MediaStream)
      MediaManager.getInstance().stopScreenShare()
    } finally {
      if (prevWindow === undefined) delete (globalThis as any).window
      else (globalThis as any).window = prevWindow
    }
  })

  describe('preparing the calls for a live', () => {
    let prevWindow: any
    beforeEach(() => {
      prevWindow = (globalThis as any).window
      ;(globalThis as any).window = {}
    })
    afterEach(() => {
      if (prevWindow === undefined) delete (globalThis as any).window
      else (globalThis as any).window = prevWindow
    })

    const failCapture = () => {
      ;(navigator.mediaDevices.getDisplayMedia as any)
        .mockImplementationOnce(async () => {
          throw new Error('NotAllowedError')
        })
        .mockImplementationOnce(async () => {
          throw new Error('NotAllowedError')
        })
    }

    it('raises the call caps BEFORE capturing the screen, then swaps the track', async () => {
      const order: string[] = []
      const primeSpy = vi.spyOn(PeerManager.getInstance(), 'primeScreenShare').mockImplementation(() => {
        order.push('prime')
      })
      const replaceSpy = vi.spyOn(PeerManager.getInstance(), 'replaceVideoTrack').mockImplementation(() => {
        order.push('swap')
      })
      const screenVideoTrack: any = { id: 'screen-video-prime', kind: 'video', enabled: false, stop: vi.fn(), onended: null }
      ;(navigator.mediaDevices.getDisplayMedia as any).mockImplementationOnce(async () => {
        order.push('capture')
        return new MockMediaStream([screenVideoTrack])
      })

      await MediaManager.getInstance().startScreenShare({ resolution: '1080p', fps: 60 })

      expect(order).toEqual(['prime', 'capture', 'swap'])
      expect(primeSpy).toHaveBeenCalledWith(5_500_000, 60)
      expect(replaceSpy).toHaveBeenCalledWith(screenVideoTrack, true, 5_500_000, 60)
      MediaManager.getInstance().stopScreenShare()
    })

    it('puts the camera caps back when the capture is cancelled or fails', async () => {
      const cancelSpy = vi.spyOn(PeerManager.getInstance(), 'cancelScreenSharePrime')
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      failCapture()

      const stream = await MediaManager.getInstance().startScreenShare({})

      expect(stream).toBeNull()
      expect(cancelSpy).toHaveBeenCalledTimes(1)
      expect(activeScreenCaps()).toBeNull()
      expect(useMediaStore.getState().isScreenSharing).toBe(false)
    })

    it('keeps the caps of a live that is still running when changing its source fails', async () => {
      useMediaStore.setState({ isScreenSharing: true })
      const cancelSpy = vi.spyOn(PeerManager.getInstance(), 'cancelScreenSharePrime')
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      failCapture()

      const stream = await MediaManager.getInstance().startScreenShare({ resolution: '720p', fps: 30 })

      expect(stream).toBeNull()
      expect(cancelSpy).not.toHaveBeenCalled()
      expect(activeScreenCaps()).toEqual({ maxBitrate: 2_000_000, maxFramerate: 30 })
    })

    it('puts the camera caps back when the capture has no video to send', async () => {
      const cancelSpy = vi.spyOn(PeerManager.getInstance(), 'cancelScreenSharePrime')
      const replaceSpy = vi.spyOn(PeerManager.getInstance(), 'replaceVideoTrack')
      const audioOnly = new MockMediaStream([{ id: 'screen-audio-only', kind: 'audio', enabled: true, stop: vi.fn() }])
      ;(navigator.mediaDevices.getDisplayMedia as any).mockImplementationOnce(async () => audioOnly)

      await MediaManager.getInstance().startScreenShare({})

      expect(replaceSpy).not.toHaveBeenCalled()
      expect(cancelSpy).toHaveBeenCalledTimes(1)
      expect(activeScreenCaps()).toBeNull()
      MediaManager.getInstance().stopScreenShare()
    })
  })

  it('should acquire physical camera, create a new MediaStream instance, and update peer senders when camera is toggled on', async () => {
    const fakeAudioTrack = { id: 'mic-1', kind: 'audio', enabled: true, stop: vi.fn() }
    const initialStream = new MockMediaStream([fakeAudioTrack])
    useMediaStore.getState().setLocalStream(initialStream as unknown as MediaStream)
    useMediaStore.getState().setCameraOff(true)

    const fakeCamTrack = {
      id: 'cam-track-1',
      kind: 'video',
      readyState: 'live',
      enabled: true,
      stop: vi.fn(),
    }
    const camStream = new MockMediaStream([fakeCamTrack])
    const gumSpy = vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockImplementation(async () => camStream as unknown as MediaStream)
    const replaceSpy = vi.spyOn(PeerManager.getInstance(), 'replaceVideoTrack')

    try {
      await MediaManager.getInstance().syncCameraState(false)

      expect(useMediaStore.getState().isCameraOff).toBe(false)
      const newStream = useMediaStore.getState().localStream
      expect(newStream).not.toBe(initialStream)
      expect(newStream?.getVideoTracks()).toContain(fakeCamTrack)
      expect(replaceSpy).toHaveBeenCalledWith(fakeCamTrack, false)

      await MediaManager.getInstance().syncCameraState(true)
      expect(useMediaStore.getState().isCameraOff).toBe(true)
      expect(fakeCamTrack.stop).toHaveBeenCalled()
    } finally {
      gumSpy.mockRestore()
      replaceSpy.mockRestore()
    }
  })

  it('should hot-swap camera track when changing video input device', async () => {
    useMediaStore.getState().setCameraOff(false)
    const oldCamTrack = { id: 'cam-old', kind: 'video', readyState: 'live', enabled: true, stop: vi.fn() }
    const newCamTrack = { id: 'cam-new', kind: 'video', readyState: 'live', enabled: true, stop: vi.fn() }

    const initialStream = new MockMediaStream([oldCamTrack])
    useMediaStore.getState().setLocalStream(initialStream as unknown as MediaStream)

    const gumSpy = vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockImplementation(async (constraints: any) => {
      if (constraints?.video?.deviceId?.exact === 'device-2') {
        return new MockMediaStream([newCamTrack]) as unknown as MediaStream
      }
      return new MockMediaStream([oldCamTrack]) as unknown as MediaStream
    })

    const replaceSpy = vi.spyOn(PeerManager.getInstance(), 'replaceVideoTrack')
    try {
      const success = await MediaManager.getInstance().changeVideoInput('device-2')

      expect(success).toBe(true)
      expect(useMediaStore.getState().selectedVideoInput).toBe('device-2')
      expect(replaceSpy).toHaveBeenCalledWith(newCamTrack, false)
      expect(oldCamTrack.stop).toHaveBeenCalled()
    } finally {
      gumSpy.mockRestore()
      replaceSpy.mockRestore()
    }
  })

  it('automatically recovers and replaces screen video track when track ends unexpectedly', async () => {
    const prevWindow = (globalThis as any).window
    const setScreenSource = vi.fn(async () => true)
    const getSources = vi.fn(async () => [
      { id: 'window:4242:0', name: 'Google Chrome - Serie Ep 1' },
      { id: 'window:8888:0', name: 'Google Chrome - Serie Ep 2' },
    ])
    ;(globalThis as any).window = { electronAPI: { setScreenSource, getSources } }

    const track1: any = { id: 'screen-ep1', kind: 'video', readyState: 'live', enabled: true, stop: vi.fn(), onended: null }
    const stream1 = new MockMediaStream([track1])
    const track2: any = { id: 'screen-ep2', kind: 'video', readyState: 'live', enabled: true, stop: vi.fn(), onended: null }
    const stream2 = new MockMediaStream([track2])

    let callCount = 0
    const gdmSpy = vi.spyOn(navigator.mediaDevices, 'getDisplayMedia').mockImplementation(async () => {
      callCount++
      return (callCount === 1 ? stream1 : stream2) as unknown as MediaStream
    })
    const replaceSpy = vi.spyOn(PeerManager.getInstance(), 'replaceVideoTrack')

    try {
      await MediaManager.getInstance().startScreenShare({
        sourceId: 'window:4242:0',
        sourceName: 'Google Chrome - Serie Ep 1',
      })

      expect(useMediaStore.getState().isScreenSharing).toBe(true)
      expect(replaceSpy).toHaveBeenCalledWith(track1, true, expect.any(Number), expect.any(Number))

      if (track1.onended) {
        track1.onended()
      }

      await new Promise((r) => setTimeout(r, 800))

      expect(useMediaStore.getState().isScreenSharing).toBe(true)
      expect(replaceSpy).toHaveBeenCalledWith(track2, true, expect.any(Number), expect.any(Number))

      MediaManager.getInstance().stopScreenShare()
      expect(useMediaStore.getState().isScreenSharing).toBe(false)
    } finally {
      gdmSpy.mockRestore()
      replaceSpy.mockRestore()
      if (prevWindow === undefined) delete (globalThis as any).window
      else (globalThis as any).window = prevWindow
    }
  })
})

