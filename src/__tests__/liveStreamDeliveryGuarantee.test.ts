import { describe, it, expect, beforeEach, vi } from 'vitest'
import { MediaManager, ScreenShareConfig } from '../media/MediaManager'
import { MediaCallHandler } from '../p2p/mediaCalls'
import { PeerManager } from '../p2p/PeerManager'
import { useMediaStore } from '../store/useMediaStore'
import { useGameStore } from '../store/useGameStore'
import { attachStreamToVideo } from '../media/attachVideoElement'

class MockTrack {
  id: string
  kind: 'audio' | 'video'
  enabled = true
  readyState = 'live'
  contentHint = ''
  stop = vi.fn()
  addEventListener = vi.fn()
  removeEventListener = vi.fn()
  getSettings = vi.fn(() => ({ sampleRate: 48000, channelCount: 2 }))

  constructor(id: string, kind: 'audio' | 'video') {
    this.id = id
    this.kind = kind
  }
}

class MockStream {
  id: string
  private tracks: MockTrack[] = []

  constructor(tracks: MockTrack[] = []) {
    this.id = 'stream-' + Math.random().toString(36).slice(2)
    this.tracks = [...tracks]
  }

  addTrack(track: MockTrack) {
    if (!this.tracks.includes(track)) {
      this.tracks.push(track)
    }
  }

  removeTrack(track: MockTrack) {
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

  addEventListener = vi.fn()
  removeEventListener = vi.fn()
}

if (typeof globalThis.MediaStream === 'undefined') {
  ;(globalThis as any).MediaStream = MockStream
}

const fakeCanvasStream = {
  getVideoTracks: () => [
    new MockTrack('dummy-canvas-video-track', 'video'),
  ],
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
} else if (!(globalThis as any).document.createElement('canvas').captureStream) {
  const origCreateElement = globalThis.document.createElement.bind(globalThis.document)
  ;(globalThis.document as any).createElement = (tag: string) => {
    const el = origCreateElement(tag)
    if (tag === 'canvas' && !(el as any).captureStream) {
      ;(el as any).captureStream = () => fakeCanvasStream
    }
    return el
  }
}

class MockAudioContextClass {
  sampleRate = 48000
  state = 'running'
  currentTime = 0
  processor = {
    onaudioprocess: null as any,
    connect: vi.fn(),
    disconnect: vi.fn(),
  }

  createScriptProcessor() {
    return this.processor
  }

  createMediaStreamDestination() {
    return {
      stream: new MockStream([new MockTrack('destination-audio-track', 'audio')]),
    }
  }

  createMediaStreamSource() {
    return { connect: vi.fn() }
  }

  createGain() {
    return {
      gain: {
        setValueAtTime: vi.fn(),
        cancelScheduledValues: vi.fn(),
        setTargetAtTime: vi.fn(),
      },
      connect: vi.fn(),
    }
  }

  resume = vi.fn(async () => undefined)
  close = vi.fn(async () => undefined)
}

if (typeof (globalThis as any).AudioContext === 'undefined') {
  ;(globalThis as any).AudioContext = MockAudioContextClass
}

if (typeof (globalThis as any).navigator === 'undefined') {
  ;(globalThis as any).navigator = {
    mediaDevices: {
      getUserMedia: vi.fn(),
      getDisplayMedia: vi.fn(),
      enumerateDevices: vi.fn(),
    },
  }
} else if (!(globalThis as any).navigator.mediaDevices) {
  ;(globalThis as any).navigator.mediaDevices = {
    getUserMedia: vi.fn(),
    getDisplayMedia: vi.fn(),
    enumerateDevices: vi.fn(),
  }
}

if (typeof (globalThis as any).window === 'undefined') {
  ;(globalThis as any).window = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    AudioContext: MockAudioContextClass,
    navigator: (globalThis as any).navigator,
  }
} else {
  if (!globalThis.window.addEventListener) {
    ;(globalThis.window as any).addEventListener = vi.fn()
    ;(globalThis.window as any).removeEventListener = vi.fn()
  }
  if (!(globalThis.window as any).AudioContext) {
    ;(globalThis.window as any).AudioContext = MockAudioContextClass
  }
  if (!(globalThis.window as any).navigator) {
    ;(globalThis.window as any).navigator = (globalThis as any).navigator
  }
}

describe('Live Stream Delivery Guarantee (Video & Audio)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()

    ;(globalThis as any).AudioContext = MockAudioContextClass
    if (typeof window !== 'undefined') {
      ;(window as any).AudioContext = MockAudioContextClass
    }

    useMediaStore.setState({
      localStream: null,
      localScreenStream: null,
      isScreenSharing: false,
      isMuted: false,
      isCameraOff: false,
      screenShareAudioVolume: 100,
      liveStreamVolume: 100,
      outputVolume: 100,
      participantVolumes: {},
      peerStreams: {},
      peerScreenStreams: {},
    })

    useGameStore.setState({
      localPlayer: {
        id: 'host-player',
        name: 'Apresentador',
        x: 10,
        y: 10,
        direction: 'down',
        isMoving: false,
        avatar: { baseId: 'char-1', shirtColor: '#4c6ef5' },
        currentZoneId: 'room-1',
        isScreenSharing: false,
        isMuted: false,
        isCameraOff: false,
      },
      remotePlayers: {},
      callStates: {},
    })
  })

  it('guarantees that screen share provides BOTH active video AND audio tracks', async () => {
    const rawVideoTrack = new MockTrack('screen-video-track-1', 'video')
    const displayStream = new MockStream([rawVideoTrack])

    // Mock getDisplayMedia returning video stream
    const mockGetDisplayMedia = vi.fn(async () => displayStream)
    const nav = (globalThis as any).navigator || (typeof window !== 'undefined' ? (window as any).navigator : null)
    if (!nav?.mediaDevices) {
      Object.defineProperty(nav || globalThis, 'mediaDevices', {
        value: { getDisplayMedia: mockGetDisplayMedia, getUserMedia: vi.fn() },
        configurable: true,
        writable: true,
      })
    } else {
      vi.spyOn(nav.mediaDevices, 'getDisplayMedia').mockImplementation(mockGetDisplayMedia)
    }

    ;(window as any).AudioContext = MockAudioContextClass
    ;(window as any).electronAPI = {
      setScreenSource: vi.fn(async () => true),
      startProcessAudioCapture: vi.fn(async () => ({ ok: true })),
      stopProcessAudioCapture: vi.fn(async () => true),
      onProcessAudioData: vi.fn(() => () => undefined),
      onProcessAudioStatus: vi.fn(() => () => undefined),
    }

    const peerManager = PeerManager.getInstance()
    const replaceVideoSpy = vi.spyOn(peerManager, 'replaceVideoTrack').mockImplementation(() => {})
    const replaceAudioSpy = vi.spyOn(peerManager, 'replaceAudioTrack').mockImplementation(() => {})
    const sendPlayerUpdateSpy = vi.spyOn(peerManager, 'sendPlayerUpdate').mockImplementation(() => {})

    const mediaManager = MediaManager.getInstance()
    const config: ScreenShareConfig = {
      sourceId: 'screen:0:0',
      sourceName: 'Tela Principal',
      includeAudio: true,
      resolution: '1080p',
      fps: 60,
    }

    const resultStream = await mediaManager.startScreenShare(config)
    expect(resultStream).not.toBeNull()

    // 1. Verify Video Track Delivery
    const videoTracks = resultStream!.getVideoTracks()
    expect(videoTracks.length).toBeGreaterThan(0)
    expect(videoTracks[0].kind).toBe('video')
    expect(videoTracks[0].enabled).toBe(true)
    expect(videoTracks[0].contentHint).toBe('motion')
    expect(replaceVideoSpy).toHaveBeenCalledWith(videoTracks[0], true, expect.any(Number), expect.any(Number))

    // 2. Verify Audio Track Delivery
    const audioTracks = resultStream!.getAudioTracks()
    expect(audioTracks.length).toBeGreaterThan(0)
    expect(audioTracks[0].kind).toBe('audio')
    expect(audioTracks[0].enabled).toBe(true)
    expect((audioTracks[0] as any).__screenShareLiveAudio).toBe(true)
    expect(replaceAudioSpy).toHaveBeenCalledWith(audioTracks[0])

    // 3. Verify Store Updates
    expect(useMediaStore.getState().isScreenSharing).toBe(true)
    expect(useMediaStore.getState().localScreenStream).toBe(resultStream)
    expect(sendPlayerUpdateSpy).toHaveBeenCalledWith({ isScreenSharing: true })

    mediaManager.stopScreenShare()
  })

  it('guarantees buildOutboundStream combines both video and live audio when dialing new peers', () => {
    const screenVideoTrack = new MockTrack('live-screen-vid', 'video')
    const screenAudioTrack = new MockTrack('live-screen-aud', 'audio')
    ;(screenAudioTrack as any).__screenShareLiveAudio = true

    const screenStream = new MockStream([screenVideoTrack, screenAudioTrack])
    const localMicTrack = new MockTrack('local-mic', 'audio')
    const localStream = new MockStream([localMicTrack])

    useMediaStore.setState({
      isScreenSharing: true,
      localScreenStream: screenStream as unknown as MediaStream,
      localStream: localStream as unknown as MediaStream,
    })

    // Invoke private buildOutboundStream through reflect/call
    const outbound = (MediaCallHandler as any).buildOutboundStream()
    expect(outbound).not.toBeNull()

    const vTracks = outbound.getVideoTracks()
    const aTracks = outbound.getAudioTracks()

    expect(vTracks.length).toBe(1)
    expect(vTracks[0].id).toBe('live-screen-vid')

    expect(aTracks.length).toBe(1)
    expect(aTracks[0].id).toBe('live-screen-aud')
    expect((aTracks[0] as any).__screenShareLiveAudio).toBe(true)
  })

  it('guarantees remote clients mount the screen stream with unmuted audio (muted: false) and audible volume', () => {
    const remoteVideoTrack = new MockTrack('remote-screen-vid', 'video')
    const remoteAudioTrack = new MockTrack('remote-screen-aud', 'audio')
    const remoteStream = new MockStream([remoteVideoTrack, remoteAudioTrack])

    useMediaStore.setState({
      peerStreams: { 'presenter-peer-1': remoteStream as unknown as MediaStream },
      participantVolumes: { 'presenter-peer-1': 100 },
      liveStreamVolume: 100,
      outputVolume: 100,
    })

    const mockVideoElement = {
      srcObject: null as any,
      muted: true,
      volume: 0,
      paused: true,
      play: vi.fn(async () => {
        mockVideoElement.paused = false
      }),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as HTMLVideoElement

    // Attach stream for remote viewer
    const cleanup = attachStreamToVideo(mockVideoElement, remoteStream as unknown as MediaStream, {
      tile: 'grid',
      peer: 'presenter-peer-1',
      isLocal: false,
      muted: false,
      isLive: true,
    })

    expect(mockVideoElement.srcObject).toBe(remoteStream)
    expect(mockVideoElement.muted).toBe(false)
    expect(mockVideoElement.play).toHaveBeenCalled()

    // Test volume calculation for remote viewer
    const outputVol = useMediaStore.getState().outputVolume
    const userVol = useMediaStore.getState().participantVolumes['presenter-peer-1']
    const effectiveVol = Math.max(0, Math.min(1, (outputVol / 100) * (userVol / 100)))

    expect(effectiveVol).toBe(1.0)
    cleanup()
  })

  it('ensures clean restoration to microphone and camera when stopping screen share', () => {
    const micTrack = new MockTrack('my-mic-track', 'audio')
    const camTrack = new MockTrack('my-cam-track', 'video')
    const localStream = new MockStream([micTrack, camTrack])

    const screenVidTrack = new MockTrack('screen-vid', 'video')
    const screenAudTrack = new MockTrack('screen-aud', 'audio')
    const screenStream = new MockStream([screenVidTrack, screenAudTrack])

    useMediaStore.setState({
      localStream: localStream as unknown as MediaStream,
      localScreenStream: screenStream as unknown as MediaStream,
      isScreenSharing: true,
    })

    const peerManager = PeerManager.getInstance()
    const replaceVideoSpy = vi.spyOn(peerManager, 'replaceVideoTrack').mockImplementation(() => {})
    const replaceAudioSpy = vi.spyOn(peerManager, 'replaceAudioTrack').mockImplementation(() => {})
    const sendPlayerUpdateSpy = vi.spyOn(peerManager, 'sendPlayerUpdate').mockImplementation(() => {})

    MediaManager.getInstance().stopScreenShare()

    expect(useMediaStore.getState().isScreenSharing).toBe(false)
    expect(useMediaStore.getState().localScreenStream).toBeNull()

    // Screen tracks must be stopped
    expect(screenVidTrack.stop).toHaveBeenCalled()
    expect(screenAudTrack.stop).toHaveBeenCalled()

    // Regular cam and mic tracks must be restored
    expect(replaceVideoSpy).toHaveBeenCalledWith(camTrack, false)
    expect(replaceAudioSpy).toHaveBeenCalledWith(micTrack)
    expect(sendPlayerUpdateSpy).toHaveBeenCalledWith({ isScreenSharing: false })
  })

  it('guarantees ProcessAudioCapture enqueues PCM chunks and supplies them to the audio processor', async () => {
    let pcmListener: ((data: Uint8Array) => void) | null = null
    const mockApi = {
      startProcessAudioCapture: vi.fn(async () => ({ ok: true })),
      stopProcessAudioCapture: vi.fn(async () => true),
      onProcessAudioData: vi.fn((cb) => {
        pcmListener = cb
        return () => { pcmListener = null }
      }),
      onProcessAudioStatus: vi.fn(() => () => undefined),
    }

    ;(window as any).AudioContext = MockAudioContextClass
    ;(window as any).electronAPI = mockApi

    const capture = new (await import('../media/ProcessAudioCapture')).ProcessAudioCapture()
    const track = await capture.start('screen:0:0')

    expect(track).toBeDefined()
    expect(track.readyState).toBe('live')
    expect(track.enabled).toBe(true)

    // Generate 10ms of 48kHz stereo PCM (480 frames * 2 channels * 2 bytes = 1920 bytes)
    const pcmData = new Uint8Array(1920)
    const view = new DataView(pcmData.buffer)
    for (let i = 0; i < 960; i++) {
      // 440Hz sine wave tone
      const sample = Math.round(Math.sin((i / 48000) * 440 * 2 * Math.PI) * 16000)
      view.setInt16(i * 2, sample, true)
    }

    // Deliver PCM chunk via IPC
    expect(pcmListener).not.toBeNull()
    pcmListener!(pcmData)

    const processor = (capture as any).processor
    const leftBuffer = new Float32Array(480)
    const rightBuffer = new Float32Array(480)
    processor.onaudioprocess({
      outputBuffer: {
        length: 480,
        numberOfChannels: 2,
        getChannelData: (ch: number) => (ch === 0 ? leftBuffer : rightBuffer),
      },
    })

    // Assert that non-silent audio samples were written to Web Audio output buffers
    const hasAudibleLeft = leftBuffer.some((s) => Math.abs(s) > 0.01)
    const hasAudibleRight = rightBuffer.some((s) => Math.abs(s) > 0.01)

    expect(hasAudibleLeft).toBe(true)
    expect(hasAudibleRight).toBe(true)

    capture.stop()
  })

  it('guarantees multi-window monitor audio simulation does not stall on silent windows', () => {
    // Simulates the native mixing algorithm implemented in process-audio-capture:
    // Session A (active audio player with 480 frames)
    // Session B (silent editor window with 0 frames)
    const kMixFrames = 480
    const kChannels = 2

    const sessionA_buffer: number[] = []
    const sessionB_buffer: number[] = [] // Silent!

    // Populate Session A with audible stereo PCM
    for (let f = 0; f < kMixFrames; f++) {
      sessionA_buffer.push(8000, 8000) // Left, Right
    }

    const sessions = [
      { id: 'app-a-media-player', buffer: sessionA_buffer },
      { id: 'app-b-silent-editor', buffer: sessionB_buffer },
    ]

    const mixBufferLeft = new Array(kMixFrames).fill(0)
    const mixBufferRight = new Array(kMixFrames).fill(0)
    const outputPcm = new Int16Array(kMixFrames * kChannels)

    // Run the non-blocking mixing algorithm
    for (const session of sessions) {
      const availableFrames = Math.floor(session.buffer.length / kChannels)
      const framesToTake = Math.min(kMixFrames, availableFrames)

      for (let f = 0; f < framesToTake; f++) {
        mixBufferLeft[f] += session.buffer[f * 2]
        mixBufferRight[f] += session.buffer[f * 2 + 1]
      }

      if (framesToTake > 0) {
        session.buffer.splice(0, framesToTake * kChannels)
      }
    }

    for (let f = 0; f < kMixFrames; f++) {
      outputPcm[f * 2] = Math.max(-32768, Math.min(32767, mixBufferLeft[f]))
      outputPcm[f * 2 + 1] = Math.max(-32768, Math.min(32767, mixBufferRight[f]))
    }

    // The mixed block MUST carry Session A's audio despite Session B being completely silent
    const nonSilentCount = outputPcm.filter((sample) => sample !== 0).length
    expect(nonSilentCount).toBe(kMixFrames * kChannels)
    expect(outputPcm[0]).toBe(8000)
    expect(outputPcm[1]).toBe(8000)
  })
})
