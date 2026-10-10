import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { MediaCallHandler } from '../p2p/mediaCalls'
import {
  CAMERA_CAPS,
  RAMP_SAMPLE_OFFSETS_MS,
  SCREEN_START_HOLD_MS,
  VIEW_RAMP_SAMPLE_OFFSETS_MS,
  VIEW_REQUEST_TTL_MS,
  viewerMode,
  __resetVideoSendPolicyForTests,
} from '../p2p/videoSendPolicy'
import { LIVE_QUALITY_INTERVAL_MS } from '../p2p/liveQualityLog'
import { __resetSilentAudioForTests } from '../media/silentAudioTrack'
import { useGameStore } from '../store/useGameStore'
import { useMediaStore } from '../store/useMediaStore'
import { flushDiagLogs, __resetDiagForTests } from '../utils/diagnosticLogger'

class MockMediaStream {
  private tracks: any[]
  constructor(tracks: any[] = []) {
    this.tracks = [...tracks]
  }
  addTrack(track: any) {
    if (!this.tracks.includes(track)) this.tracks.push(track)
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
}

const micTrack = () => ({ kind: 'audio', id: 'mic', enabled: true, readyState: 'live' }) as any
const liveAudioTrack = () =>
  ({ kind: 'audio', id: 'live-audio', enabled: true, readyState: 'live', __screenShareLiveAudio: true }) as any
const screenTrack = (height = 1080) =>
  ({
    kind: 'video',
    id: 'screen',
    enabled: true,
    contentHint: '',
    readyState: 'live',
    getSettings: () => ({ width: Math.round((height * 16) / 9), height }),
  }) as any
const cameraTrack = () => ({ kind: 'video', id: 'camera', enabled: true, contentHint: '', readyState: 'live' }) as any

/**
 * A call with a video sender and an audio sender. Every setParameters is kept
 * as a snapshot, in order with the track swaps, the way the browser sees them.
 */
function fakeCall(videoTrack: any = cameraTrack(), audioTrack: any = micTrack()) {
  const ops: string[] = []
  const applied: any[] = []
  const encoding: Record<string, unknown> = {}
  let degradationPreference: string | undefined
  const sender: any = {
    track: videoTrack,
    getParameters: vi.fn(() => ({ encodings: [{ ...encoding }], degradationPreference })),
    setParameters: vi.fn(async (params: any) => {
      ops.push(params.encodings[0].active === false ? 'video-off' : 'video-on')
      applied.push({ ...params.encodings[0], degradationPreference: params.degradationPreference })
      Object.assign(encoding, params.encodings[0])
      degradationPreference = params.degradationPreference
    }),
    replaceTrack: vi.fn(async (next: any) => {
      ops.push('replaceTrack')
      sender.track = next
    }),
  }
  const audio: any = {
    track: audioTrack,
    replaceTrack: vi.fn(async (next: any) => {
      audio.track = next
    }),
  }
  const pc: any = {
    getSenders: () => [audio, sender],
    // A sender with no track is still the audio sender of its transceiver.
    getTransceivers: () => [
      { sender: audio, receiver: { track: { kind: 'audio' } } },
      { sender, receiver: { track: { kind: 'video' } } },
    ],
    addTrack: vi.fn(),
    addTransceiver: vi.fn(),
  }
  return { call: { peerConnection: pc } as any, pc, sender, audio, ops, applied, last: () => applied[applied.length - 1] }
}

type Fake = ReturnType<typeof fakeCall>
const callsOf = (...entries: Array<[string, Fake]>) => new Map<string, any>(entries.map(([id, c]) => [id, c.call]))

/** Who is in the room, and which of them wait for a click before a live reaches them. */
const room = (players: Record<string, { liveOptIn?: boolean }>) => {
  useGameStore.setState({
    remotePlayers: Object.fromEntries(
      Object.entries(players).map(([id, p]) => [id, { id, name: id, currentZoneId: 'zone', ...p }])
    ) as any,
  })
}

/** The local side while it is live: microphone, and a screen stream with the live's own audio. */
const goLive = (options: { mic?: any | null; liveAudio?: any | null; screen?: any } = {}) => {
  const mic = options.mic === undefined ? micTrack() : options.mic
  const liveAudio = options.liveAudio === undefined ? liveAudioTrack() : options.liveAudio
  const screen = options.screen ?? screenTrack()
  useMediaStore.setState({
    localStream: new MockMediaStream(mic ? [mic] : []) as any,
    localScreenStream: new MockMediaStream([...(liveAudio ? [liveAudio] : []), screen]) as any,
    isScreenSharing: true,
    isMuted: false,
    peerStreams: {},
  })
  return { mic, liveAudio, screen }
}

/** Start the live on the open calls the way MediaManager.startScreenShare does. */
const startLive = (calls: Map<string, any>, media: ReturnType<typeof goLive>, bitrate = 5_500_000, fps = 60) => {
  MediaCallHandler.primeScreenShare(calls, bitrate, fps)
  if (media.liveAudio) MediaCallHandler.replaceAudioTrack(calls, media.liveAudio)
  MediaCallHandler.replaceVideoTrack(calls, media.screen, true, bitrate, fps)
}

const captureDiag = (event: string) => {
  const entries: any[] = []
  ;(globalThis as any).window = {
    electronAPI: {
      diagnosticLogBatch: vi.fn(async (batch: any[]) => {
        entries.push(...batch)
        return { ok: true, path: null }
      }),
    },
  }
  return async () => {
    await flushDiagLogs()
    return entries.filter((e) => e.cat === 'screenshare' && e.event === event).map((e) => e.data)
  }
}

describe('who a live is sent to', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    ;(globalThis as any).MediaStream = MockMediaStream
    __resetVideoSendPolicyForTests()
    __resetSilentAudioForTests()
    __resetDiagForTests()
    useGameStore.setState({ remotePlayers: {}, callStates: {} })
  })
  afterEach(() => {
    __resetVideoSendPolicyForTests()
    __resetSilentAudioForTests()
    __resetDiagForTests()
    useGameStore.setState({ remotePlayers: {}, callStates: {} })
    useMediaStore.setState({ localStream: null, localScreenStream: null, isScreenSharing: false, peerStreams: {} })
    vi.useRealTimers()
    ;(globalThis as any).window = undefined
  })

  describe('a viewer that has not clicked to watch', () => {
    it('gets no video: the sender is switched off before the screen is put on it', async () => {
      room({ viewer: { liveOptIn: true } })
      const media = goLive()
      const viewer = fakeCall()
      startLive(callsOf(['viewer', viewer]), media)
      await vi.advanceTimersByTimeAsync(0)

      expect(viewer.ops).toEqual(['video-off', 'replaceTrack'])
      expect(viewer.last().active).toBe(false)
      expect(viewer.sender.track).toBe(media.screen)
      expect(viewerMode('viewer')).toBe('off')
    })

    it('keeps hearing the microphone, not the sound of the live', async () => {
      room({ viewer: { liveOptIn: true } })
      const media = goLive()
      const viewer = fakeCall(cameraTrack(), media.mic)
      startLive(callsOf(['viewer', viewer]), media)
      await vi.advanceTimersByTimeAsync(0)

      expect(viewer.audio.track).toBe(media.mic)
      expect(viewer.audio.replaceTrack).not.toHaveBeenCalledWith(media.liveAudio)
    })

    it('keeps its camera picture until the screen replaces it', () => {
      room({ viewer: { liveOptIn: true } })
      goLive()
      const viewer = fakeCall()
      MediaCallHandler.primeScreenShare(callsOf(['viewer', viewer]), 5_500_000, 60)

      // Preparing the live must not switch off a sender that still carries the camera.
      expect(viewer.sender.setParameters).not.toHaveBeenCalled()
    })

    it('stays without video when the hold of the start ends and when the bitrate of the room changes', async () => {
      room({ viewer: { liveOptIn: true } })
      const media = goLive()
      const viewer = fakeCall()
      const calls = callsOf(['viewer', viewer])
      startLive(calls, media)
      await vi.advanceTimersByTimeAsync(SCREEN_START_HOLD_MS + 100)
      MediaCallHandler.updateScreenShareBitrate(calls, 2_000_000)
      MediaCallHandler.applyViewerRequest(calls, 'viewer', false, 0)
      await vi.advanceTimersByTimeAsync(0)

      expect(viewer.applied.every((p) => p.active === false)).toBe(true)
      // Switched off once: an encoder that is off has nothing to be told again.
      expect(viewer.sender.setParameters).toHaveBeenCalledTimes(1)
    })
  })

  describe('a viewer of a version that has no click (or a browser)', () => {
    it('gets the live at once and in full, as before', async () => {
      room({ old: {}, viewer: { liveOptIn: true } })
      const media = goLive()
      const old = fakeCall(cameraTrack(), media.mic)
      const viewer = fakeCall(cameraTrack(), media.mic)
      startLive(callsOf(['old', old], ['viewer', viewer]), media)
      await vi.advanceTimersByTimeAsync(0)

      expect(viewerMode('old')).toBe('legacy')
      expect(old.ops.filter((op) => op === 'video-off')).toEqual([])
      expect(old.last()).toMatchObject({
        active: true,
        maxBitrate: 5_500_000,
        maxFramerate: 60,
        scaleResolutionDownBy: 1,
        degradationPreference: 'maintain-resolution',
      })
      expect(old.sender.track).toBe(media.screen)
      expect(old.audio.track).toBe(media.liveAudio)
    })

    it('is a peer the room knows nothing about, too', () => {
      expect(viewerMode('stranger')).toBe('legacy')
      expect(viewerMode(undefined)).toBe('legacy')
    })
  })

  describe('when the viewer asks to watch', () => {
    const watching = async (need: number | null, source = screenTrack()) => {
      room({ viewer: { liveOptIn: true }, other: { liveOptIn: true } })
      const media = goLive({ screen: source })
      const viewer = fakeCall(cameraTrack(), media.mic)
      const other = fakeCall(cameraTrack(), media.mic)
      const calls = callsOf(['viewer', viewer], ['other', other])
      startLive(calls, media)
      await vi.advanceTimersByTimeAsync(0)
      MediaCallHandler.applyViewerRequest(calls, 'viewer', true, need)
      await vi.advanceTimersByTimeAsync(0)
      return { media, viewer, other, calls }
    }

    it('switches the video on at the size the viewer shows it', async () => {
      const { viewer } = await watching(180)

      expect(viewerMode('viewer')).toBe('on')
      expect(viewer.last()).toMatchObject({
        active: true,
        scaleResolutionDownBy: 4,
        maxBitrate: 688_000,
        maxFramerate: 60,
        degradationPreference: 'maintain-resolution',
      })
    })

    it('holds the resolution for the first seconds of that viewer, then the frame rate', async () => {
      const { viewer } = await watching(180)
      await vi.advanceTimersByTimeAsync(SCREEN_START_HOLD_MS)

      expect(viewer.last()).toMatchObject({
        active: true,
        scaleResolutionDownBy: 4,
        maxBitrate: 688_000,
        degradationPreference: 'maintain-framerate',
      })
    })

    it('gives that viewer the sound of the live, and only that viewer', async () => {
      const { media, viewer, other } = await watching(180)

      expect(viewer.audio.track).toBe(media.liveAudio)
      expect(other.audio.track).toBe(media.mic)
      expect(other.last().active).toBe(false)
    })

    it('sends everything to a viewer that watches without saying a size', async () => {
      const { viewer, calls, media } = await watching(null)
      expect(viewerMode('viewer')).toBe('on')
      expect(viewer.last()).toMatchObject({ active: true, scaleResolutionDownBy: 1, maxBitrate: 5_500_000 })
      expect(viewer.audio.track).toBe(media.liveAudio)

      // And goes back to a size when the viewer says one.
      MediaCallHandler.applyViewerRequest(calls, 'viewer', true, 180)
      await vi.advanceTimersByTimeAsync(0)
      expect(viewer.last()).toMatchObject({ scaleResolutionDownBy: 4 })
      MediaCallHandler.applyViewerRequest(calls, 'viewer', true, Number.NaN)
      await vi.advanceTimersByTimeAsync(0)
      expect(viewer.last()).toMatchObject({ scaleResolutionDownBy: 1, maxBitrate: 5_500_000 })
    })

    it('sends everything to a viewer that shows the live as large as the capture', async () => {
      const { viewer } = await watching(1080)
      expect(viewer.last()).toMatchObject({ active: true, scaleResolutionDownBy: 1, maxBitrate: 5_500_000 })
    })

    it('follows the height of what is being captured', async () => {
      const { viewer } = await watching(180, screenTrack(720))
      // 720 / 3 = 240 lines is the smallest layer above 198.
      expect(viewer.last()).toMatchObject({ scaleResolutionDownBy: 3 })
    })

    it('sends everything when the height of the capture is unknown', async () => {
      const source = { kind: 'video', id: 'screen', enabled: true, contentHint: '', readyState: 'live' } as any
      const { viewer } = await watching(180, source)
      expect(viewer.last()).toMatchObject({ active: true, scaleResolutionDownBy: 1, maxBitrate: 5_500_000 })
    })

    it('treats a larger picture as a start of its own: the resolution is held again', async () => {
      const { viewer, calls } = await watching(180)
      await vi.advanceTimersByTimeAsync(SCREEN_START_HOLD_MS)
      expect(viewer.last().degradationPreference).toBe('maintain-framerate')

      // The bitrate has to climb to the new size; without the hold the
      // encoder answers a still-low bitrate by scaling the picture down.
      MediaCallHandler.applyViewerRequest(calls, 'viewer', true, 630)
      await vi.advanceTimersByTimeAsync(0)
      expect(viewer.last()).toMatchObject({
        active: true,
        scaleResolutionDownBy: 1.5,
        maxBitrate: 2_994_000,
        degradationPreference: 'maintain-resolution',
      })

      await vi.advanceTimersByTimeAsync(SCREEN_START_HOLD_MS - 1)
      expect(viewer.last().degradationPreference).toBe('maintain-resolution')
      await vi.advanceTimersByTimeAsync(1)
      expect(viewer.last()).toMatchObject({
        scaleResolutionDownBy: 1.5,
        maxBitrate: 2_994_000,
        degradationPreference: 'maintain-framerate',
      })
    })

    it('applies a smaller picture as it is, with no hold', async () => {
      const { viewer, calls } = await watching(630)
      await vi.advanceTimersByTimeAsync(SCREEN_START_HOLD_MS)
      const writes = viewer.sender.setParameters.mock.calls.length

      MediaCallHandler.applyViewerRequest(calls, 'viewer', true, 90)
      await vi.advanceTimersByTimeAsync(SCREEN_START_HOLD_MS)
      expect(viewer.last()).toMatchObject({
        scaleResolutionDownBy: 6,
        maxBitrate: 374_000,
        degradationPreference: 'maintain-framerate',
      })
      // One write for the new size, and none later: there was no hold to release.
      expect(viewer.sender.setParameters).toHaveBeenCalledTimes(writes + 1)
    })

    it('keeps the hold of the start when the picture gets smaller inside it', async () => {
      const { viewer, calls } = await watching(630)
      MediaCallHandler.applyViewerRequest(calls, 'viewer', true, 180)
      await vi.advanceTimersByTimeAsync(0)
      expect(viewer.last()).toMatchObject({ scaleResolutionDownBy: 4, degradationPreference: 'maintain-resolution' })

      await vi.advanceTimersByTimeAsync(SCREEN_START_HOLD_MS)
      expect(viewer.last()).toMatchObject({ scaleResolutionDownBy: 4, degradationPreference: 'maintain-framerate' })
    })

    it('holds the resolution again when the window of the viewer is shown again', async () => {
      const { viewer, calls } = await watching(630)
      await vi.advanceTimersByTimeAsync(SCREEN_START_HOLD_MS)
      MediaCallHandler.applyViewerRequest(calls, 'viewer', true, 0)
      await vi.advanceTimersByTimeAsync(0)
      expect(viewer.last()).toMatchObject({ scaleResolutionDownBy: 6, maxFramerate: 15, degradationPreference: 'maintain-framerate' })

      MediaCallHandler.applyViewerRequest(calls, 'viewer', true, 630)
      await vi.advanceTimersByTimeAsync(0)
      expect(viewer.last()).toMatchObject({
        scaleResolutionDownBy: 1.5,
        maxFramerate: 60,
        degradationPreference: 'maintain-resolution',
      })
    })

    it('does not touch the encoder when the viewer repeats what it already said', async () => {
      const { viewer, calls } = await watching(180)
      await vi.advanceTimersByTimeAsync(SCREEN_START_HOLD_MS)
      const videoWrites = viewer.sender.setParameters.mock.calls.length
      const audioSwaps = viewer.audio.replaceTrack.mock.calls.length

      MediaCallHandler.applyViewerRequest(calls, 'viewer', true, 180)
      MediaCallHandler.applyViewerRequest(calls, 'viewer', true, 180)
      await vi.advanceTimersByTimeAsync(0)

      expect(viewer.sender.setParameters).toHaveBeenCalledTimes(videoWrites)
      expect(viewer.audio.replaceTrack).toHaveBeenCalledTimes(audioSwaps)
    })

    it('sends a small, slow picture while the window of the viewer shows nothing', async () => {
      const { viewer, calls, media } = await watching(180)
      MediaCallHandler.applyViewerRequest(calls, 'viewer', true, 0)
      await vi.advanceTimersByTimeAsync(0)

      expect(viewer.last()).toMatchObject({
        active: true,
        scaleResolutionDownBy: 6,
        maxBitrate: 187_000,
        maxFramerate: 15,
      })
      // Still watching: the sound of the live goes on.
      expect(viewer.audio.track).toBe(media.liveAudio)
    })

    it('switches the video off and goes back to the microphone when the viewer stops', async () => {
      const { viewer, calls, media } = await watching(180)
      MediaCallHandler.applyViewerRequest(calls, 'viewer', false, 0)
      await vi.advanceTimersByTimeAsync(0)

      expect(viewerMode('viewer')).toBe('off')
      expect(viewer.last().active).toBe(false)
      expect(viewer.audio.track).toBe(media.mic)
      // The screen stays on the sender, ready for the next click.
      expect(viewer.sender.track).toBe(media.screen)
      expect(viewer.ops.filter((op) => op === 'replaceTrack')).toHaveLength(1)
    })

    it('keeps each viewer at its size when a new capture is prepared during the live', async () => {
      const { viewer, other, calls } = await watching(180)
      await vi.advanceTimersByTimeAsync(SCREEN_START_HOLD_MS)

      // Changing what is shared starts with the same preparation as a new live.
      MediaCallHandler.primeScreenShare(calls, 5_500_000, 60)
      expect(viewer.last()).toMatchObject({ active: true, scaleResolutionDownBy: 4, maxBitrate: 688_000 })
      expect(other.applied.every((p) => p.active === false)).toBe(true)
      expect(viewerMode('viewer')).toBe('on')
    })

    it('ignores a request about a call that does not exist', () => {
      room({ viewer: { liveOptIn: true } })
      goLive()
      expect(() => MediaCallHandler.applyViewerRequest(new Map(), 'viewer', true, 180)).not.toThrow()
      expect(() =>
        MediaCallHandler.applyViewerRequest(new Map([['viewer', {}]]) as any, 'viewer', true, 180)
      ).not.toThrow()
    })

    it('uses the bitrate of the room, scaled to the layer', async () => {
      const { viewer, other, calls } = await watching(180)
      MediaCallHandler.updateScreenShareBitrate(calls, 3_000_000)
      await vi.advanceTimersByTimeAsync(0)

      // 3 Mbps at a quarter of the height: 3 / 4^1.5 = 375 kbps.
      expect(viewer.last()).toMatchObject({ active: true, scaleResolutionDownBy: 4, maxBitrate: 375_000 })
      expect(other.last().active).toBe(false)
    })

    it('records each change of a viewer once', async () => {
      const log = captureDiag('viewer')
      const { calls } = await watching(180)
      MediaCallHandler.applyViewerRequest(calls, 'viewer', true, 180)
      MediaCallHandler.applyViewerRequest(calls, 'viewer', true, 630)
      MediaCallHandler.applyViewerRequest(calls, 'viewer', false, 0)
      await vi.advanceTimersByTimeAsync(0)

      expect(await log()).toEqual([
        { peer: 'viewer', watch: true, h: 180, scale: 4, kbps: 688, fps: 60 },
        { peer: 'viewer', watch: true, h: 630, scale: 1.5, kbps: 2994, fps: 60 },
        { peer: 'viewer', watch: false, h: 0, scale: null, kbps: 0, fps: 0 },
      ])
    })
  })

  describe('the ramp log of one viewer', () => {
    const withStats = (c: Fake) => {
      let bytesSent = 0
      c.pc.getStats = vi.fn(async () => {
        bytesSent += 125_000
        return new Map<string, any>([
          ['out-video', { type: 'outbound-rtp', kind: 'video', frameWidth: 480, frameHeight: 270, bytesSent }],
          ['pair', { type: 'candidate-pair', nominated: true, availableOutgoingBitrate: 1_000_000 }],
        ])
      })
    }
    const rampOf = (samples: any[], peer: string) => samples.filter((s) => s.toPeer === peer).map((s) => [s.phase, s.tMs])

    const liveWith = async () => {
      const log = captureDiag('ramp')
      room({ viewer: { liveOptIn: true }, old: {} })
      const media = goLive()
      const viewer = fakeCall(cameraTrack(), media.mic)
      const old = fakeCall(cameraTrack(), media.mic)
      withStats(viewer)
      withStats(old)
      const calls = callsOf(['viewer', viewer], ['old', old])
      startLive(calls, media)
      await vi.advanceTimersByTimeAsync(RAMP_SAMPLE_OFFSETS_MS[RAMP_SAMPLE_OFFSETS_MS.length - 1])
      return { log, calls }
    }

    it('has nothing about a viewer that is not watching: there is no ramp to follow', async () => {
      const { log } = await liveWith()
      const samples = await log()
      expect(rampOf(samples, 'viewer').filter(([phase]) => phase !== 'prime')).toEqual([])
      expect(rampOf(samples, 'old').filter(([phase]) => phase === 'live')).toHaveLength(RAMP_SAMPLE_OFFSETS_MS.length)
    })

    it('follows the click for five seconds', async () => {
      const { log, calls } = await liveWith()
      MediaCallHandler.applyViewerRequest(calls, 'viewer', true, 180)
      await vi.advanceTimersByTimeAsync(20_000)

      expect(rampOf(await log(), 'viewer').filter(([phase]) => phase === 'view')).toEqual(
        VIEW_RAMP_SAMPLE_OFFSETS_MS.map((tMs) => ['view', tMs])
      )
      expect(VIEW_RAMP_SAMPLE_OFFSETS_MS[VIEW_RAMP_SAMPLE_OFFSETS_MS.length - 1]).toBe(5000)
    })

    it('starts over when the picture gets larger, and leaves the samples of the click behind', async () => {
      const { log, calls } = await liveWith()
      MediaCallHandler.applyViewerRequest(calls, 'viewer', true, 180)
      await vi.advanceTimersByTimeAsync(1200)
      MediaCallHandler.applyViewerRequest(calls, 'viewer', true, 630)
      await vi.advanceTimersByTimeAsync(20_000)

      expect(rampOf(await log(), 'viewer').filter(([phase]) => phase === 'view')).toEqual([
        ['view', 0],
        ['view', 500],
        ['view', 1000],
        ...VIEW_RAMP_SAMPLE_OFFSETS_MS.map((tMs) => ['view', tMs]),
      ])
    })

    it('is not started by a smaller picture, a repeated request or a stop', async () => {
      const { log, calls } = await liveWith()
      MediaCallHandler.applyViewerRequest(calls, 'viewer', true, 630)
      await vi.advanceTimersByTimeAsync(20_000)
      const before = rampOf(await log(), 'viewer').length

      MediaCallHandler.applyViewerRequest(calls, 'viewer', true, 630)
      MediaCallHandler.applyViewerRequest(calls, 'viewer', true, 180)
      MediaCallHandler.applyViewerRequest(calls, 'viewer', false, 0)
      await vi.advanceTimersByTimeAsync(20_000)
      expect(rampOf(await log(), 'viewer')).toHaveLength(before)
    })
  })

  describe('a request that is no longer renewed', () => {
    const withStats = (c: Fake) => {
      c.pc.getStats = vi.fn(async () => new Map<string, any>())
    }

    it('keeps the video on but goes back to the full size', async () => {
      room({ viewer: { liveOptIn: true } })
      const media = goLive()
      const viewer = fakeCall(cameraTrack(), media.mic)
      withStats(viewer)
      const calls = callsOf(['viewer', viewer])
      startLive(calls, media)
      MediaCallHandler.applyViewerRequest(calls, 'viewer', true, 180)
      await vi.advanceTimersByTimeAsync(VIEW_REQUEST_TTL_MS - 1000)
      expect(viewer.last()).toMatchObject({ active: true, scaleResolutionDownBy: 4 })

      await vi.advanceTimersByTimeAsync(LIVE_QUALITY_INTERVAL_MS + 1000)
      expect(viewer.last()).toMatchObject({ active: true, scaleResolutionDownBy: 1, maxBitrate: 5_500_000 })
      expect(viewerMode('viewer')).toBe('on')
      expect(viewer.audio.track).toBe(media.liveAudio)
    })

    it('stays at its size while the viewer keeps renewing it', async () => {
      room({ viewer: { liveOptIn: true } })
      const media = goLive()
      const viewer = fakeCall(cameraTrack(), media.mic)
      withStats(viewer)
      const calls = callsOf(['viewer', viewer])
      startLive(calls, media)
      MediaCallHandler.applyViewerRequest(calls, 'viewer', true, 180)

      for (let i = 0; i < 9; i++) {
        await vi.advanceTimersByTimeAsync(10_000)
        MediaCallHandler.applyViewerRequest(calls, 'viewer', true, 180)
      }
      expect(viewer.last()).toMatchObject({ active: true, scaleResolutionDownBy: 4, maxBitrate: 688_000 })
    })

    it('records once that the size was let go, and again only when a new request runs out', async () => {
      const expired = captureDiag('viewer-expired')
      room({ viewer: { liveOptIn: true } })
      const media = goLive()
      const viewer = fakeCall(cameraTrack(), media.mic)
      withStats(viewer)
      const calls = callsOf(['viewer', viewer])
      startLive(calls, media)
      MediaCallHandler.applyViewerRequest(calls, 'viewer', true, 180)
      await vi.advanceTimersByTimeAsync(VIEW_REQUEST_TTL_MS - 1000)
      expect(await expired()).toEqual([])
      await vi.advanceTimersByTimeAsync(VIEW_REQUEST_TTL_MS * 2)
      expect(await expired()).toEqual([{ peer: 'viewer' }])

      MediaCallHandler.applyViewerRequest(calls, 'viewer', true, 180)
      await vi.advanceTimersByTimeAsync(0)
      expect(viewer.last()).toMatchObject({ active: true, scaleResolutionDownBy: 4 })
      await vi.advanceTimersByTimeAsync(VIEW_REQUEST_TTL_MS * 2)
      expect(await expired()).toEqual([{ peer: 'viewer' }, { peer: 'viewer' }])
    })

    it('goes back to the full size for a change of the room that comes after the request ran out', async () => {
      room({ viewer: { liveOptIn: true } })
      const media = goLive()
      const viewer = fakeCall(cameraTrack(), media.mic)
      const calls = callsOf(['viewer', viewer])
      startLive(calls, media)
      MediaCallHandler.applyViewerRequest(calls, 'viewer', true, 180)
      // One second past the 30 s, before the next tick of the clock.
      await vi.advanceTimersByTimeAsync(VIEW_REQUEST_TTL_MS + 1000)
      expect(viewer.last()).toMatchObject({ scaleResolutionDownBy: 4 })

      MediaCallHandler.updateScreenShareBitrate(calls, 3_000_000)
      await vi.advanceTimersByTimeAsync(0)
      expect(viewer.last()).toMatchObject({ active: true, scaleResolutionDownBy: 1, maxBitrate: 3_000_000 })
    })

    it('takes the same request as news again once it had run out', async () => {
      const log = captureDiag('viewer')
      room({ viewer: { liveOptIn: true } })
      const media = goLive()
      const viewer = fakeCall(cameraTrack(), media.mic)
      const calls = callsOf(['viewer', viewer])
      startLive(calls, media)
      MediaCallHandler.applyViewerRequest(calls, 'viewer', true, 180)
      await vi.advanceTimersByTimeAsync(VIEW_REQUEST_TTL_MS + 1000)
      MediaCallHandler.applyViewerRequest(calls, 'viewer', true, 180)
      MediaCallHandler.applyViewerRequest(calls, 'viewer', true, 180)

      expect(await log()).toEqual([
        { peer: 'viewer', watch: true, h: 180, scale: 4, kbps: 688, fps: 60 },
        { peer: 'viewer', watch: true, h: 180, scale: 4, kbps: 688, fps: 60 },
      ])
    })

    it('never expires for a viewer that is not watching', async () => {
      room({ viewer: { liveOptIn: true } })
      const media = goLive()
      const viewer = fakeCall(cameraTrack(), media.mic)
      withStats(viewer)
      const calls = callsOf(['viewer', viewer])
      startLive(calls, media)
      MediaCallHandler.applyViewerRequest(calls, 'viewer', false, 0)
      await vi.advanceTimersByTimeAsync(VIEW_REQUEST_TTL_MS * 4)

      expect(viewer.applied.every((p) => p.active === false)).toBe(true)
      expect(viewer.audio.track).toBe(media.mic)
    })
  })

  describe('a peer that says it waits for a click', () => {
    it('is believed even when the room has not told us so yet', async () => {
      room({ late: {} })
      const media = goLive()
      const late = fakeCall(cameraTrack(), media.mic)
      const calls = callsOf(['late', late])
      startLive(calls, media)
      await vi.advanceTimersByTimeAsync(0)
      expect(late.last().active).toBe(true)
      expect(late.audio.track).toBe(media.liveAudio)

      MediaCallHandler.applyViewerRequest(calls, 'late', false, 0)
      await vi.advanceTimersByTimeAsync(0)

      expect(viewerMode('late')).toBe('off')
      expect(late.last().active).toBe(false)
      expect(late.audio.track).toBe(media.mic)
    })

    it('is still known as such in the next live', async () => {
      room({ late: {} })
      const media = goLive()
      const late = fakeCall(cameraTrack(), media.mic)
      const calls = callsOf(['late', late])
      startLive(calls, media)
      MediaCallHandler.applyViewerRequest(calls, 'late', true, 180)
      MediaCallHandler.replaceVideoTrack(calls, cameraTrack(), false)
      await vi.advanceTimersByTimeAsync(0)

      expect(viewerMode('late')).toBe('off')
    })
  })

  describe('when the live ends', () => {
    it('gives the camera back to everybody, switched on and at full size', async () => {
      room({ viewer: { liveOptIn: true }, watcher: { liveOptIn: true } })
      const media = goLive()
      const viewer = fakeCall(cameraTrack(), media.mic)
      const watcher = fakeCall(cameraTrack(), media.mic)
      const calls = callsOf(['viewer', viewer], ['watcher', watcher])
      startLive(calls, media)
      MediaCallHandler.applyViewerRequest(calls, 'watcher', true, 180)
      await vi.advanceTimersByTimeAsync(0)

      const camera = cameraTrack()
      MediaCallHandler.replaceVideoTrack(calls, camera, false)
      MediaCallHandler.replaceAudioTrack(calls, media.mic)
      await vi.advanceTimersByTimeAsync(0)

      for (const c of [viewer, watcher]) {
        expect(c.sender.track).toBe(camera)
        expect(c.last()).toMatchObject({
          ...CAMERA_CAPS,
          active: true,
          scaleResolutionDownBy: 1,
          degradationPreference: 'maintain-framerate',
        })
        expect(c.audio.track).toBe(media.mic)
      }
    })

    it('forgets who was watching: the next live needs a new click', async () => {
      room({ watcher: { liveOptIn: true } })
      const media = goLive()
      const watcher = fakeCall(cameraTrack(), media.mic)
      const calls = callsOf(['watcher', watcher])
      startLive(calls, media)
      MediaCallHandler.applyViewerRequest(calls, 'watcher', true, 180)
      MediaCallHandler.replaceVideoTrack(calls, cameraTrack(), false)
      await vi.advanceTimersByTimeAsync(0)
      expect(viewerMode('watcher')).toBe('off')

      const again = goLive()
      startLive(calls, again)
      await vi.advanceTimersByTimeAsync(0)
      expect(watcher.last().active).toBe(false)
    })

    it('does not leave a timer that touches the sender afterwards', async () => {
      room({ watcher: { liveOptIn: true } })
      const media = goLive()
      const watcher = fakeCall(cameraTrack(), media.mic)
      watcher.pc.getStats = vi.fn(async () => new Map<string, any>())
      const calls = callsOf(['watcher', watcher])
      startLive(calls, media)
      MediaCallHandler.applyViewerRequest(calls, 'watcher', true, 180)
      MediaCallHandler.replaceVideoTrack(calls, cameraTrack(), false)
      await vi.advanceTimersByTimeAsync(0)

      const writes = watcher.sender.setParameters.mock.calls.length
      const statsReads = watcher.pc.getStats.mock.calls.length
      await vi.advanceTimersByTimeAsync(VIEW_REQUEST_TTL_MS * 3)
      expect(watcher.sender.setParameters).toHaveBeenCalledTimes(writes)
      expect(watcher.pc.getStats).toHaveBeenCalledTimes(statsReads)
    })
  })

  describe('a live that starts right after another ended', () => {
    it('does not inherit the clock of the one before', async () => {
      room({ watcher: { liveOptIn: true } })
      const media = goLive()
      const watcher = fakeCall(cameraTrack(), media.mic)
      watcher.pc.getStats = vi.fn(async () => new Map<string, any>())
      const calls = callsOf(['watcher', watcher])
      startLive(calls, media)
      MediaCallHandler.replaceVideoTrack(calls, cameraTrack(), false)
      // The next live starts at once, and this call is not one of its calls.
      MediaCallHandler.replaceVideoTrack(new Map(), screenTrack(), true, 5_500_000, 60)
      await vi.advanceTimersByTimeAsync(0)

      const writes = watcher.sender.setParameters.mock.calls.length
      const statsReads = watcher.pc.getStats.mock.calls.length
      await vi.advanceTimersByTimeAsync(VIEW_REQUEST_TTL_MS * 2)
      expect(watcher.sender.setParameters).toHaveBeenCalledTimes(writes)
      expect(watcher.pc.getStats).toHaveBeenCalledTimes(statsReads)
      expect(watcher.last()).toMatchObject({ ...CAMERA_CAPS, active: true })
    })
  })

  describe('when the call with a viewer ends', () => {
    it('forgets what that viewer asked for', async () => {
      room({ watcher: { liveOptIn: true } })
      const media = goLive()
      const watcher = fakeCall(cameraTrack(), media.mic)
      ;(watcher.call as any).close = vi.fn()
      const calls = callsOf(['watcher', watcher])
      startLive(calls, media)
      MediaCallHandler.applyViewerRequest(calls, 'watcher', true, 180)
      expect(viewerMode('watcher')).toBe('on')

      MediaCallHandler.endMediaCall(calls, 'watcher')
      expect(viewerMode('watcher')).toBe('off')
    })

    it('forgets everybody when every call ends', () => {
      room({ a: { liveOptIn: true }, b: { liveOptIn: true } })
      const media = goLive()
      const a = fakeCall(cameraTrack(), media.mic)
      const b = fakeCall(cameraTrack(), media.mic)
      ;(a.call as any).close = vi.fn()
      ;(b.call as any).close = vi.fn()
      const calls = callsOf(['a', a], ['b', b])
      startLive(calls, media)
      MediaCallHandler.applyViewerRequest(calls, 'a', true, 180)
      MediaCallHandler.applyViewerRequest(calls, 'b', true, 180)

      MediaCallHandler.endAllMediaCalls(calls)
      expect(viewerMode('a')).toBe('off')
      expect(viewerMode('b')).toBe('off')
    })
  })

  describe('a call made while the live is running', () => {
    const remotePlayer = (id: string, liveOptIn?: boolean): any => ({
      id,
      name: id,
      x: 0,
      y: 0,
      direction: 'down',
      isMoving: false,
      avatar: { baseId: 'char-1', shirtColor: '#e03131' },
      currentZoneId: 'zone',
      ...(liveOptIn ? { liveOptIn: true } : {}),
    })

    const dial = (id: string, liveOptIn: boolean) => {
      room({ [id]: liveOptIn ? { liveOptIn: true } : {} })
      useGameStore.setState({ localPlayer: { ...useGameStore.getState().localPlayer, currentZoneId: 'zone' } })
      const media = goLive()
      MediaCallHandler.replaceVideoTrack(new Map(), media.screen, true, 5_500_000, 60)

      const placed = fakeCall(media.screen, null)
      let dialed: any = null
      const call: any = { peer: id, peerConnection: placed.pc, on: vi.fn(), close: vi.fn() }
      placed.pc.addEventListener = vi.fn()
      const peer: any = {
        call: vi.fn((_id: string, stream: any) => {
          dialed = stream
          return call
        }),
      }
      const calls = new Map<string, any>()
      MediaCallHandler.checkZoneCallEligibility(remotePlayer(id, liveOptIn), peer, calls, vi.fn())
      return { media, placed, dialed, calls }
    }

    it('is dialed with the microphone and with the video switched off, for a viewer that waits for a click', async () => {
      const { media, placed, dialed } = dial('viewer', true)
      await vi.advanceTimersByTimeAsync(0)

      expect(dialed.getAudioTracks()).toEqual([media.mic])
      // The screen is on the sender from the start: the click only switches it on.
      expect(dialed.getVideoTracks()).toEqual([media.screen])
      expect(placed.last().active).toBe(false)
    })

    it('is dialed with the whole live for a viewer of a version without the click', async () => {
      const { media, placed, dialed } = dial('old', false)
      await vi.advanceTimersByTimeAsync(0)

      expect(dialed.getAudioTracks()).toEqual([media.liveAudio])
      expect(dialed.getVideoTracks()).toEqual([media.screen])
      expect(placed.applied.some((p) => p.active === false)).toBe(false)
    })

    const answer = (id: string, liveOptIn: boolean, whileLive: () => void = () => {}) => {
      room({ [id]: liveOptIn ? { liveOptIn: true } : {} })
      const media = goLive()
      MediaCallHandler.replaceVideoTrack(new Map(), media.screen, true, 5_500_000, 60)
      whileLive()

      const placed = fakeCall(media.screen, null)
      placed.pc.addEventListener = vi.fn()
      let answered: any = null
      const call: any = {
        peer: id,
        on: vi.fn(),
        close: vi.fn(),
        answer: vi.fn((stream: any) => {
          answered = stream
          call.peerConnection = placed.pc
        }),
      }
      MediaCallHandler.handleIncomingCall({ call, myId: 'me', mediaCalls: new Map(), endMediaCallWithPeer: vi.fn() })
      return { media, placed, answered }
    }

    it('is answered with the microphone and with the video switched off, for a viewer that waits for a click', async () => {
      const { media, placed, answered } = answer('viewer', true)
      await vi.advanceTimersByTimeAsync(0)

      expect(answered.getAudioTracks()).toEqual([media.mic])
      expect(answered.getVideoTracks()).toEqual([media.screen])
      expect(placed.last().active).toBe(false)
    })

    it('is answered with the whole live for a viewer of a version without the click', () => {
      const { media, answered } = answer('old', false)
      expect(answered.getAudioTracks()).toEqual([media.liveAudio])
      expect(answered.getVideoTracks()).toEqual([media.screen])
    })

    it('is answered with the live for a viewer that already asked to watch (its call was replaced)', async () => {
      // The request came before there was a call to apply it to.
      const { media, placed, answered } = answer('viewer', true, () =>
        MediaCallHandler.applyViewerRequest(new Map(), 'viewer', true, 180)
      )
      await vi.advanceTimersByTimeAsync(0)

      expect(answered.getAudioTracks()).toEqual([media.liveAudio])
      expect(placed.applied.some((p) => p.active === false)).toBe(false)
    })

    it('does not take a request made when nothing is live as a request for the next live', async () => {
      room({ viewer: { liveOptIn: true } })
      MediaCallHandler.applyViewerRequest(new Map(), 'viewer', true, 180)
      expect(viewerMode('viewer')).toBe('off')

      const { media, placed, answered } = answer('viewer', true)
      await vi.advanceTimersByTimeAsync(0)
      expect(answered.getAudioTracks()).toEqual([media.mic])
      expect(placed.last().active).toBe(false)
    })

    /** Drive a call to "connected" the way the lifecycle does. */
    const connect = (id: string, c: Fake, calls: Map<string, any>) => {
      const remoteAudio = { kind: 'audio', enabled: true, readyState: 'live', id: 'remote-audio' }
      const remoteVideo = { kind: 'video', enabled: true, readyState: 'live', id: 'remote-video' }
      const listeners: Record<string, () => void> = {}
      const callListeners: Record<string, (value?: any) => void> = {}
      Object.assign(c.pc, {
        iceConnectionState: 'connected',
        connectionState: 'connected',
        getReceivers: () => [{ track: remoteAudio }, { track: remoteVideo }],
        addEventListener: (event: string, fn: () => void) => {
          listeners[event] = fn
        },
        removeEventListener: vi.fn(),
      })
      const call: any = {
        peer: id,
        peerConnection: c.pc,
        on: vi.fn((event: string, fn: (value?: any) => void) => {
          callListeners[event] = fn
        }),
        close: vi.fn(),
      }
      calls.set(id, call)
      const onCallConnected = vi.fn()
      MediaCallHandler.setupCallLifecycle({
        call,
        peerId: id,
        direction: 'in',
        mediaCalls: calls,
        endMediaCallWithPeer: vi.fn(),
        onCallConnected,
      })
      listeners['iceconnectionstatechange']()
      callListeners.stream(new MockMediaStream([remoteAudio, remoteVideo]))
      return onCallConnected
    }

    it('stays without video and with the microphone once it is connected', async () => {
      room({ viewer: { liveOptIn: true } })
      const media = goLive()
      MediaCallHandler.replaceVideoTrack(new Map(), media.screen, true, 5_500_000, 60)
      const viewer = fakeCall(media.screen, media.mic)
      const calls = new Map<string, any>()
      const onCallConnected = connect('viewer', viewer, calls)
      await vi.advanceTimersByTimeAsync(0)

      expect(useGameStore.getState().callStates['viewer']).toBe('connected')
      expect(onCallConnected).toHaveBeenCalledWith('viewer')
      // Switched off when the call was made; connecting has nothing to add to that.
      expect(viewer.applied).toHaveLength(1)
      expect(viewer.applied[0].active).toBe(false)
      expect(viewer.audio.track).toBe(media.mic)
    })

    it('does not take the sound of the live from those who are watching', async () => {
      room({ watcher: { liveOptIn: true }, viewer: { liveOptIn: true } })
      const media = goLive()
      const watcher = fakeCall(cameraTrack(), media.mic)
      const calls = callsOf(['watcher', watcher])
      startLive(calls, media)
      MediaCallHandler.applyViewerRequest(calls, 'watcher', true, 180)
      await vi.advanceTimersByTimeAsync(0)
      expect(watcher.audio.track).toBe(media.liveAudio)

      const viewer = fakeCall(media.screen, media.mic)
      connect('viewer', viewer, calls)
      await vi.advanceTimersByTimeAsync(0)

      expect(watcher.audio.track).toBe(media.liveAudio)
      expect(viewer.audio.track).toBe(media.mic)
    })

    it('also lets go of a size that stops being confirmed', async () => {
      room({ viewer: { liveOptIn: true } })
      const media = goLive()
      MediaCallHandler.replaceVideoTrack(new Map(), media.screen, true, 5_500_000, 60)
      const viewer = fakeCall(media.screen, media.mic)
      const calls = new Map<string, any>()
      connect('viewer', viewer, calls)
      MediaCallHandler.applyViewerRequest(calls, 'viewer', true, 180)
      await vi.advanceTimersByTimeAsync(0)
      expect(viewer.last()).toMatchObject({ active: true, scaleResolutionDownBy: 4 })

      await vi.advanceTimersByTimeAsync(VIEW_REQUEST_TTL_MS + LIVE_QUALITY_INTERVAL_MS)
      expect(viewer.last()).toMatchObject({ active: true, scaleResolutionDownBy: 1, maxBitrate: 5_500_000 })
    })

    it('stops that clock when the call is replaced by another', async () => {
      room({ viewer: { liveOptIn: true } })
      const media = goLive()
      MediaCallHandler.replaceVideoTrack(new Map(), media.screen, true, 5_500_000, 60)
      const first = fakeCall(media.screen, media.mic)
      const calls = new Map<string, any>()
      connect('viewer', first, calls)
      MediaCallHandler.applyViewerRequest(calls, 'viewer', true, 180)
      await vi.advanceTimersByTimeAsync(0)

      // Another call takes the place of the first one in the map.
      const second = fakeCall(media.screen, media.mic)
      connect('viewer', second, calls)
      // Past the hold the first call started with: nothing of its own is pending.
      await vi.advanceTimersByTimeAsync(SCREEN_START_HOLD_MS)
      const writes = first.sender.setParameters.mock.calls.length
      await vi.advanceTimersByTimeAsync(VIEW_REQUEST_TTL_MS * 2)

      expect(first.sender.setParameters).toHaveBeenCalledTimes(writes)
      expect(second.last()).toMatchObject({ active: true, scaleResolutionDownBy: 1 })
    })

    it('gets the whole live once connected, for a viewer of a version without the click', async () => {
      room({ old: {} })
      const media = goLive()
      MediaCallHandler.replaceVideoTrack(new Map(), media.screen, true, 5_500_000, 60)
      const old = fakeCall(media.screen, media.mic)
      connect('old', old, new Map())
      await vi.advanceTimersByTimeAsync(0)

      expect(old.last()).toMatchObject({ active: true, maxBitrate: 5_500_000, scaleResolutionDownBy: 1 })
      expect(old.audio.track).toBe(media.liveAudio)
    })
  })

  describe('a live from somebody without a microphone', () => {
    it('sends silence, not the sound of the live, to a viewer that has not clicked', async () => {
      const silent = { kind: 'audio', id: 'silence', enabled: true, readyState: 'live' }
      const AudioContext = vi.fn(function (this: any) {
        this.createMediaStreamDestination = () => ({ stream: new MockMediaStream([silent]) })
      })
      ;(globalThis as any).window = { AudioContext }

      room({ viewer: { liveOptIn: true } })
      const media = goLive({ mic: null })
      const viewer = fakeCall(cameraTrack(), null)
      const calls = callsOf(['viewer', viewer])
      startLive(calls, media)
      await vi.advanceTimersByTimeAsync(0)
      expect(viewer.audio.track).toBe(silent)

      MediaCallHandler.applyViewerRequest(calls, 'viewer', true, 180)
      await vi.advanceTimersByTimeAsync(0)
      expect(viewer.audio.track).toBe(media.liveAudio)

      MediaCallHandler.applyViewerRequest(calls, 'viewer', false, 0)
      await vi.advanceTimersByTimeAsync(0)
      expect(viewer.audio.track).toBe(silent)
      // One silent track for the whole app, however many viewers.
      expect(AudioContext).toHaveBeenCalledTimes(1)
    })

    it('does not put a microphone that ended on a call: that call would never connect', async () => {
      const silent = { kind: 'audio', id: 'silence', enabled: true, readyState: 'live' }
      ;(globalThis as any).window = {
        AudioContext: function (this: any) {
          this.createMediaStreamDestination = () => ({ stream: new MockMediaStream([silent]) })
        },
      }
      const dead = { kind: 'audio', id: 'mic', enabled: true, readyState: 'ended' } as any
      room({ viewer: { liveOptIn: true } })
      const media = goLive({ mic: dead })
      const viewer = fakeCall(cameraTrack(), dead)
      startLive(callsOf(['viewer', viewer]), media)
      await vi.advanceTimersByTimeAsync(0)

      expect(viewer.audio.track).toBe(silent)
    })

    it('falls back to the sound of the live when silence cannot be made: a call with no audio never connects', async () => {
      ;(globalThis as any).window = {}
      room({ viewer: { liveOptIn: true } })
      const media = goLive({ mic: null })
      const viewer = fakeCall(cameraTrack(), null)
      startLive(callsOf(['viewer', viewer]), media)
      await vi.advanceTimersByTimeAsync(0)

      expect(viewer.audio.track).toBe(media.liveAudio)
    })
  })

  describe('a live that got its sound but no picture', () => {
    // The capture came back with no video: the sound was already put on the
    // calls, and the calls go back to the camera caps.
    const soundOnly = async () => {
      room({ viewer: { liveOptIn: true }, old: {} })
      const media = goLive()
      const viewer = fakeCall(cameraTrack(), media.mic)
      const old = fakeCall(cameraTrack(), media.mic)
      const calls = callsOf(['viewer', viewer], ['old', old])
      MediaCallHandler.primeScreenShare(calls, 5_500_000, 60)
      MediaCallHandler.replaceAudioTrack(calls, media.liveAudio)
      MediaCallHandler.cancelScreenSharePrime(calls)
      await vi.advanceTimersByTimeAsync(0)
      return { media, viewer, old, calls }
    }

    it('keeps the microphone alone for who waits for a click, and the camera on', async () => {
      const { media, viewer, old } = await soundOnly()
      expect(viewer.audio.track).toBe(media.mic)
      expect(old.audio.track).toBe(media.liveAudio)
      expect(viewer.applied.some((p) => p.active === false)).toBe(false)
      expect(viewer.last()).toMatchObject({ ...CAMERA_CAPS, active: true })
    })

    it('does not hand that sound to who waits for a click when another call connects', async () => {
      const { media, viewer, old, calls } = await soundOnly()
      const late = fakeCall(cameraTrack(), media.mic)
      room({ viewer: { liveOptIn: true }, old: {}, late: { liveOptIn: true } })
      const remoteAudio = { kind: 'audio', enabled: true, readyState: 'live', id: 'remote-audio' }
      const listeners: Record<string, () => void> = {}
      const callListeners: Record<string, (value?: any) => void> = {}
      Object.assign(late.pc, {
        iceConnectionState: 'connected',
        connectionState: 'connected',
        getReceivers: () => [{ track: remoteAudio }],
        addEventListener: (event: string, fn: () => void) => {
          listeners[event] = fn
        },
        removeEventListener: vi.fn(),
      })
      const call: any = {
        peer: 'late',
        peerConnection: late.pc,
        on: vi.fn((event: string, fn: (value?: any) => void) => {
          callListeners[event] = fn
        }),
        close: vi.fn(),
      }
      calls.set('late', call)
      MediaCallHandler.setupCallLifecycle({
        call,
        peerId: 'late',
        direction: 'in',
        mediaCalls: calls,
        endMediaCallWithPeer: vi.fn(),
      })
      listeners['iceconnectionstatechange']()
      callListeners.stream(new MockMediaStream([remoteAudio]))
      await vi.advanceTimersByTimeAsync(0)

      expect(useGameStore.getState().callStates['late']).toBe('connected')
      expect(viewer.audio.track).toBe(media.mic)
      expect(late.audio.track).toBe(media.mic)
      expect(old.audio.track).toBe(media.liveAudio)
    })
  })

  describe('a live with no sound of its own', () => {
    it('leaves the microphone on every call, watching or not', async () => {
      room({ viewer: { liveOptIn: true } })
      const media = goLive({ liveAudio: null })
      const viewer = fakeCall(cameraTrack(), media.mic)
      const calls = callsOf(['viewer', viewer])
      startLive(calls, media)
      MediaCallHandler.applyViewerRequest(calls, 'viewer', true, 180)
      await vi.advanceTimersByTimeAsync(0)

      expect(viewer.audio.track).toBe(media.mic)
      expect(viewer.audio.replaceTrack).not.toHaveBeenCalled()
      expect(viewer.last().active).toBe(true)
    })
  })

  describe('replacing the microphone during a live', () => {
    it('still reaches every call', async () => {
      room({ viewer: { liveOptIn: true }, old: {} })
      const media = goLive()
      const viewer = fakeCall(cameraTrack(), media.mic)
      const old = fakeCall(cameraTrack(), media.mic)
      const calls = callsOf(['viewer', viewer], ['old', old])
      startLive(calls, media)
      await vi.advanceTimersByTimeAsync(0)

      const newMic = { kind: 'audio', id: 'mic-2', enabled: true, readyState: 'live' } as any
      MediaCallHandler.replaceAudioTrack(calls, newMic)
      await vi.advanceTimersByTimeAsync(0)

      expect(viewer.audio.track).toBe(newMic)
      expect(old.audio.track).toBe(newMic)
    })
  })
})
