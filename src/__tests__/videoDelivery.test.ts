import { describe, it, expect, beforeEach, vi } from 'vitest'
import { MediaManager } from '../media/MediaManager'
import { MediaCallHandler } from '../p2p/mediaCalls'
import { PeerManager } from '../p2p/PeerManager'
import { useMediaStore } from '../store/useMediaStore'
import { useGameStore } from '../store/useGameStore'

// Setup global browser polyfills for Node/Vitest test environment
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

    // Mock getUserMedia: fails with camera, succeeds with audio-only
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

    // Call replaceVideoTrack for Screen Share
    MediaCallHandler.replaceVideoTrack(mediaCalls, fakeScreenTrack, true, 4_500_000, 60)

    expect(fakeScreenTrack.enabled).toBe(true)
    expect(fakeScreenTrack.contentHint).toBe('motion')
    expect(mockSender.replaceTrack).toHaveBeenCalledWith(fakeScreenTrack)

    // Flush the replaceTrack().then() microtask so encoder params land.
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))

    // Recommended bitrate: screenshare supports high-framerate/bitrate (up to 6.0 Mbps and 60 FPS)
    // with maintain-framerate degradation preference to keep streams sharp and smooth.
    expect(encodings[0].maxBitrate).toBe(4_500_000)
    expect(encodings[0].maxFramerate).toBe(60)
    expect(mockSender.setParameters).toHaveBeenCalled()
    const appliedParams = mockSender.setParameters.mock.calls[0][0]
    expect(appliedParams.degradationPreference).toBe('maintain-framerate')
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

    // Apply 600ms buffer. The new adaptive model has a video ceiling of
    // 1500ms (was 5s in legacy), and audio is independently capped at
    // 500ms so the 600ms slider value can never accidentally delay voice.
    // Mock receiver has no `track.kind`, so it falls into the video branch.
    MediaCallHandler.applyJitterBuffer(mediaCalls, 600)

    expect(mockReceiver.playoutDelayHint).toBe(0.6)
    expect(mockReceiver.jitterBufferTarget).toBe(600)

    // Apply 1ms default buffer — the new adaptive floor (was 100ms).
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

    // Test the exact mapping logic used in FullScreenGrid
    const screenStream = peerScreenStreams[remotePlayer.id] || (remotePlayer.isScreenSharing ? peerStreams[remotePlayer.id] : null)

    expect(screenStream).toBe(fakeRemoteStream)
    expect(remotePlayer.isScreenSharing).toBe(true)
  })

  it('should dial zone calls WITH the real stream (never empty) so remote video is not black', () => {
    // Regression test for the black-remote-video bug: dialing with an EMPTY
    // stream and attaching tracks later via pc.addTransceiver never reaches
    // the remote peer (PeerJS ignores post-handshake negotiationneeded),
    // leaving the remote tile BLACK + silent.
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
      // If the implementation ever touches these post-handshake, the test
      // below fails — signaling MUST stay inside peer.call().
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
    // The dialed stream MUST carry real tracks (audio+video), never empty.
    expect(dialedStream).toBeDefined()
    expect(dialedStream.getAudioTracks().length).toBeGreaterThan(0)
    expect(dialedStream.getVideoTracks().length).toBeGreaterThan(0)
    // No out-of-band track surgery on the live PeerConnection.
    expect(mockPc.addTrack).not.toHaveBeenCalled()
    expect(mockPc.addTransceiver).not.toHaveBeenCalled()
    // Player flagged as connecting while the handshake runs.
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
    // startScreenShare touches `window` (electronAPI probe) — stub it.
    const prevWindow = (globalThis as any).window
    ;(globalThis as any).window = {}
    try {
      const screenAudioTrack: any = { id: 'screen-audio-1', kind: 'audio', enabled: false, stop: vi.fn() }
      const screenVideoTrack: any = { id: 'screen-video-1', kind: 'video', enabled: false, stop: vi.fn(), onended: null }
      const fakeScreenStream = new MockMediaStream()
      fakeScreenStream.addTrack(screenAudioTrack)
      fakeScreenStream.addTrack(screenVideoTrack)

      ;(navigator.mediaDevices.getDisplayMedia as any).mockImplementationOnce(async () => fakeScreenStream)

      // Local mic exists but must NOT enter the call in this mode.
      const micTrack: any = { id: 'mic-1', kind: 'audio', enabled: true, stop: vi.fn() }
      const localStream = new MockMediaStream()
      localStream.addTrack(micTrack)
      useMediaStore.getState().setLocalStream(localStream as unknown as MediaStream)

      const replaceSpy = vi.spyOn(PeerManager.getInstance(), 'replaceAudioTrack')

      const stream = await MediaManager.getInstance().startScreenShare({
        // Legacy callers cannot disable the mandatory source-only policy.
        includeAudio: false,
        mixMicrophone: false,
        resolution: '720p',
        fps: 30,
      })

      expect(stream).toBe(fakeScreenStream as unknown as MediaStream)
      // The RAW screen track goes straight to peers — no mix, no ducking.
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
      // Mic restored after sharing stops.
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
      expect(replaceSpy).not.toHaveBeenCalled()

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
      // Mix graph needs a real AudioContext (browser only) — must degrade
      // gracefully instead of throwing.
      expect(stream).toBe(fakeScreenStream as unknown as MediaStream)
      MediaManager.getInstance().stopScreenShare()
    } finally {
      if (prevWindow === undefined) delete (globalThis as any).window
      else (globalThis as any).window = prevWindow
    }
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

      // Now toggle camera OFF
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
})
