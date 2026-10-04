import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { MediaCallHandler } from '../p2p/mediaCalls'
import {
  CAMERA_CAPS,
  RAMP_SAMPLE_OFFSETS_MS,
  SCREEN_START_HOLD_MS,
  activeScreenCaps,
  watchScreenShareRamp,
  __resetVideoSendPolicyForTests,
} from '../p2p/videoSendPolicy'
import { useGameStore } from '../store/useGameStore'
import { useMediaStore } from '../store/useMediaStore'
import { flushDiagLogs, __resetDiagForTests } from '../utils/diagnosticLogger'

class MockMediaStream {
  constructor(private tracks: any[] = []) {}
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

/**
 * A call whose video sender records, in order, what was done to it. Each
 * setParameters call is kept as a snapshot, the way the browser would see it.
 */
function fakeCall(track: any = { kind: 'video', id: 'camera', enabled: true, readyState: 'live' }) {
  const ops: string[] = []
  const applied: any[] = []
  const encoding: Record<string, unknown> = { maxBitrate: 0, maxFramerate: 0, scaleResolutionDownBy: 0 }
  let degradationPreference: string | undefined
  const sender: any = {
    track,
    getParameters: vi.fn(() => ({ encodings: [{ ...encoding }], degradationPreference })),
    setParameters: vi.fn(async (params: any) => {
      ops.push('setParameters')
      applied.push({ ...params.encodings[0], degradationPreference: params.degradationPreference })
      Object.assign(encoding, params.encodings[0])
      degradationPreference = params.degradationPreference
    }),
    replaceTrack: vi.fn(async (next: any) => {
      ops.push('replaceTrack')
      sender.track = next
    }),
  }
  const pc: any = {
    getSenders: () => [sender],
    getTransceivers: () => [],
    addTrack: vi.fn(),
    addTransceiver: vi.fn(),
  }
  return { call: { peerConnection: pc } as any, pc, sender, ops, applied, last: () => applied[applied.length - 1] }
}

const screenTrack = () => ({ kind: 'video', id: 'screen', enabled: false, contentHint: '', readyState: 'live' }) as any
const cameraTrack = () => ({ kind: 'video', id: 'camera-2', enabled: true, contentHint: '', readyState: 'live' }) as any
const callsOf = (...entries: Array<[string, ReturnType<typeof fakeCall>]>) =>
  new Map<string, any>(entries.map(([id, c]) => [id, c.call]))

describe('screen share start', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    __resetVideoSendPolicyForTests()
    __resetDiagForTests()
  })
  afterEach(() => {
    __resetVideoSendPolicyForTests()
    __resetDiagForTests()
    vi.useRealTimers()
    ;(globalThis as any).window = undefined
  })

  describe('preparing the calls before the capture starts', () => {
    it('raises bitrate and frame rate on every open call without touching the tracks', () => {
      const a = fakeCall()
      const b = fakeCall()
      MediaCallHandler.primeScreenShare(callsOf(['a', a], ['b', b]), 5_500_000, 60)

      for (const c of [a, b]) {
        expect(c.last()).toMatchObject({
          maxBitrate: 5_500_000,
          maxFramerate: 60,
          scaleResolutionDownBy: 1,
          degradationPreference: 'maintain-resolution',
        })
        expect(c.sender.replaceTrack).not.toHaveBeenCalled()
        expect(c.pc.addTrack).not.toHaveBeenCalled()
        expect(c.pc.addTransceiver).not.toHaveBeenCalled()
      }
      expect(activeScreenCaps()).toEqual({ maxBitrate: 5_500_000, maxFramerate: 60 })
    })

    it('never asks for more than 6 Mbps or 60 fps', () => {
      const a = fakeCall()
      MediaCallHandler.primeScreenShare(callsOf(['a', a]), 20_000_000, 144)
      expect(a.last()).toMatchObject({ maxBitrate: 6_000_000, maxFramerate: 60 })
    })

    it('goes back to the camera caps when the capture is cancelled or fails', async () => {
      const a = fakeCall()
      const calls = callsOf(['a', a])
      MediaCallHandler.primeScreenShare(calls, 5_500_000, 60)
      MediaCallHandler.cancelScreenSharePrime(calls)

      expect(a.last()).toMatchObject({ ...CAMERA_CAPS, degradationPreference: 'maintain-framerate' })
      expect(activeScreenCaps()).toBeNull()

      const callsBefore = a.sender.setParameters.mock.calls.length
      await vi.advanceTimersByTimeAsync(SCREEN_START_HOLD_MS * 2)
      expect(a.sender.setParameters).toHaveBeenCalledTimes(callsBefore)
    })

    it('does nothing when there is no prepared live to cancel', () => {
      const a = fakeCall()
      MediaCallHandler.cancelScreenSharePrime(callsOf(['a', a]))
      expect(a.sender.setParameters).not.toHaveBeenCalled()
    })

    it('survives a call without a usable connection', () => {
      const calls = new Map<string, any>([
        ['no-pc', {}],
        ['broken', { peerConnection: { getSenders: () => { throw new Error('closed') } } }],
      ])
      expect(() => MediaCallHandler.primeScreenShare(calls, 5_500_000, 60)).not.toThrow()
      expect(() => MediaCallHandler.cancelScreenSharePrime(calls)).not.toThrow()
    })
  })

  describe('swapping the camera for the screen', () => {
    it('applies the screen caps before the swap, and never the camera caps', async () => {
      const a = fakeCall()
      const screen = screenTrack()
      MediaCallHandler.replaceVideoTrack(callsOf(['a', a]), screen, true, 5_500_000, 60)
      await vi.advanceTimersByTimeAsync(0)

      expect(a.ops.slice(0, 2)).toEqual(['setParameters', 'replaceTrack'])
      expect(a.sender.track).toBe(screen)
      expect(a.applied.length).toBeGreaterThan(0)
      expect(a.applied.every((p) => p.maxBitrate === 5_500_000 && p.maxFramerate === 60)).toBe(true)
    })

    it('holds the resolution for the first seconds, then goes back to holding the frame rate', async () => {
      const a = fakeCall()
      MediaCallHandler.replaceVideoTrack(callsOf(['a', a]), screenTrack(), true, 5_500_000, 60)
      expect(a.last().degradationPreference).toBe('maintain-resolution')

      await vi.advanceTimersByTimeAsync(SCREEN_START_HOLD_MS - 1)
      expect(a.last().degradationPreference).toBe('maintain-resolution')

      await vi.advanceTimersByTimeAsync(1)
      expect(a.last()).toMatchObject({
        maxBitrate: 5_500_000,
        maxFramerate: 60,
        degradationPreference: 'maintain-framerate',
      })
    })

    it('counts the hold from the swap, not from the preparation', async () => {
      const a = fakeCall()
      const calls = callsOf(['a', a])
      MediaCallHandler.primeScreenShare(calls, 5_500_000, 60)
      await vi.advanceTimersByTimeAsync(3000)
      MediaCallHandler.replaceVideoTrack(calls, screenTrack(), true, 5_500_000, 60)

      // 4.5s after the preparation, 1.5s after the swap.
      await vi.advanceTimersByTimeAsync(1500)
      expect(a.last().degradationPreference).toBe('maintain-resolution')

      await vi.advanceTimersByTimeAsync(SCREEN_START_HOLD_MS - 1500)
      expect(a.last().degradationPreference).toBe('maintain-framerate')
    })

    it('restores the camera caps when the live stops, even inside the hold', async () => {
      const a = fakeCall()
      const calls = callsOf(['a', a])
      MediaCallHandler.replaceVideoTrack(calls, screenTrack(), true, 5_500_000, 60)
      await vi.advanceTimersByTimeAsync(1000)

      const camera = cameraTrack()
      MediaCallHandler.replaceVideoTrack(calls, camera, false)
      await vi.advanceTimersByTimeAsync(0)

      expect(a.sender.track).toBe(camera)
      expect(a.last()).toMatchObject({ ...CAMERA_CAPS, degradationPreference: 'maintain-framerate' })
      expect(activeScreenCaps()).toBeNull()

      // The pending release of the hold must not bring the screen caps back.
      const callsBefore = a.sender.setParameters.mock.calls.length
      await vi.advanceTimersByTimeAsync(SCREEN_START_HOLD_MS * 2)
      expect(a.sender.setParameters).toHaveBeenCalledTimes(callsBefore)
    })

    it('leaves the sender alone after a live that ended with no camera to go back to', async () => {
      const a = fakeCall()
      const calls = callsOf(['a', a])
      MediaCallHandler.replaceVideoTrack(calls, screenTrack(), true, 5_500_000, 60)
      await vi.advanceTimersByTimeAsync(1000)
      MediaCallHandler.replaceVideoTrack(calls, null, false)
      await vi.advanceTimersByTimeAsync(0)

      expect(a.sender.track).toBeNull()
      expect(activeScreenCaps()).toBeNull()
      const callsBefore = a.sender.setParameters.mock.calls.length
      await vi.advanceTimersByTimeAsync(SCREEN_START_HOLD_MS * 2)
      expect(a.sender.setParameters).toHaveBeenCalledTimes(callsBefore)
    })

    it('keeps a bitrate change made during the hold when the hold ends', async () => {
      const a = fakeCall()
      const calls = callsOf(['a', a])
      MediaCallHandler.replaceVideoTrack(calls, screenTrack(), true, 5_500_000, 60)
      await vi.advanceTimersByTimeAsync(1000)
      MediaCallHandler.updateScreenShareBitrate(calls, 2_000_000)

      await vi.advanceTimersByTimeAsync(SCREEN_START_HOLD_MS)
      expect(a.last()).toMatchObject({ maxBitrate: 2_000_000, degradationPreference: 'maintain-framerate' })
    })
  })

  describe('a call that connects while the live is running', () => {
    it('gets the screen caps, not the camera caps', async () => {
      MediaCallHandler.replaceVideoTrack(new Map(), screenTrack(), true, 3_000_000, 60)
      const late = fakeCall(screenTrack())
      MediaCallHandler.applyEncoderCaps(late.pc)

      expect(late.last()).toMatchObject({
        maxBitrate: 3_000_000,
        maxFramerate: 60,
        degradationPreference: 'maintain-resolution',
      })
      await vi.advanceTimersByTimeAsync(SCREEN_START_HOLD_MS)
      expect(late.last()).toMatchObject({ maxBitrate: 3_000_000, degradationPreference: 'maintain-framerate' })
      expect(late.sender.replaceTrack).not.toHaveBeenCalled()
    })

    it('gets the bitrate currently in force, after it was adjusted for the room', () => {
      MediaCallHandler.replaceVideoTrack(new Map(), screenTrack(), true, 5_500_000, 60)
      MediaCallHandler.updateScreenShareBitrate(new Map(), 2_000_000)
      const late = fakeCall(screenTrack())
      MediaCallHandler.applyEncoderCaps(late.pc)
      expect(late.last()).toMatchObject({ maxBitrate: 2_000_000, maxFramerate: 60 })
    })

    it('has its own hold, without cutting short or extending the hold of the other calls', async () => {
      const first = fakeCall()
      MediaCallHandler.replaceVideoTrack(callsOf(['first', first]), screenTrack(), true, 5_500_000, 60)
      await vi.advanceTimersByTimeAsync(3000)

      const late = fakeCall(screenTrack())
      MediaCallHandler.applyEncoderCaps(late.pc)

      await vi.advanceTimersByTimeAsync(SCREEN_START_HOLD_MS - 3000)
      expect(first.last().degradationPreference).toBe('maintain-framerate')
      expect(late.last().degradationPreference).toBe('maintain-resolution')

      await vi.advanceTimersByTimeAsync(3000)
      expect(late.last().degradationPreference).toBe('maintain-framerate')
    })

    it('keeps the camera caps when nobody is sharing', () => {
      const a = fakeCall()
      MediaCallHandler.applyEncoderCaps(a.pc)
      expect(a.last()).toMatchObject({ ...CAMERA_CAPS, degradationPreference: 'maintain-framerate' })
    })

    it('goes back to the camera caps for calls that connect after the live stopped', () => {
      MediaCallHandler.replaceVideoTrack(new Map(), screenTrack(), true, 5_500_000, 60)
      MediaCallHandler.replaceVideoTrack(new Map(), cameraTrack(), false)
      const a = fakeCall()
      MediaCallHandler.applyEncoderCaps(a.pc)
      expect(a.last()).toMatchObject({ ...CAMERA_CAPS, degradationPreference: 'maintain-framerate' })
    })

    it('is applied by the call lifecycle as soon as the call is connected', () => {
      useGameStore.setState({ callStates: {} })
      useMediaStore.setState({
        localStream: new MockMediaStream([{ kind: 'audio', enabled: true, readyState: 'live', id: 'mic' }]) as any,
        localScreenStream: null,
        isScreenSharing: true,
        peerStreams: {},
      })
      MediaCallHandler.replaceVideoTrack(new Map(), screenTrack(), true, 5_500_000, 60)

      const late = fakeCall(screenTrack())
      const audioSender = {
        track: { kind: 'audio', enabled: true, readyState: 'live', id: 'mic' },
        replaceTrack: vi.fn(async () => {}),
      }
      const remoteAudio = { kind: 'audio', enabled: true, readyState: 'live', id: 'remote-audio' }
      const remoteVideo = { kind: 'video', enabled: true, readyState: 'live', id: 'remote-video' }
      const listeners: Record<string, () => void> = {}
      const callListeners: Record<string, (value?: any) => void> = {}
      const pc: any = {
        ...late.pc,
        iceConnectionState: 'connected',
        connectionState: 'connected',
        getSenders: () => [audioSender, late.sender],
        getReceivers: () => [{ track: remoteAudio }, { track: remoteVideo }],
        addEventListener: (event: string, fn: () => void) => {
          listeners[event] = fn
        },
        removeEventListener: vi.fn(),
      }
      const call: any = {
        peer: 'viewer',
        peerConnection: pc,
        on: vi.fn((event: string, fn: (value?: any) => void) => {
          callListeners[event] = fn
        }),
        close: vi.fn(),
      }
      const mediaCalls = new Map<string, any>([['viewer', call]])

      MediaCallHandler.setupCallLifecycle({
        call,
        peerId: 'viewer',
        direction: 'out',
        mediaCalls,
        endMediaCallWithPeer: vi.fn(),
      })
      listeners['iceconnectionstatechange']()
      callListeners.stream(new MockMediaStream([remoteAudio, remoteVideo]))

      expect(useGameStore.getState().callStates['viewer']).toBe('connected')
      expect(late.last()).toMatchObject({ maxBitrate: 5_500_000, maxFramerate: 60 })
      expect(late.applied.some((p) => p.maxBitrate === CAMERA_CAPS.maxBitrate)).toBe(false)
    })
  })

  describe('ramp log', () => {
    const captureDiag = () => {
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
        return entries.filter((e) => e.cat === 'screenshare' && e.event === 'ramp')
      }
    }

    const withStats = (c: ReturnType<typeof fakeCall>, bytesPerSample = 125_000) => {
      let bytesSent = 0
      c.pc.getStats = vi.fn(async () => {
        bytesSent += bytesPerSample
        return new Map<string, any>([
          ['in', { type: 'inbound-rtp', kind: 'video', frameWidth: 16, frameHeight: 16 }],
          ['out-audio', { type: 'outbound-rtp', kind: 'audio', bytesSent: 999 }],
          [
            'out-video',
            {
              type: 'outbound-rtp',
              kind: 'video',
              frameWidth: 1920,
              frameHeight: 1080,
              framesPerSecond: 58.6,
              bytesSent,
              targetBitrate: 5_000_000,
              qualityLimitationReason: 'bandwidth',
            },
          ],
          ['idle-pair', { type: 'candidate-pair', nominated: false, availableOutgoingBitrate: 300_000 }],
          ['pair', { type: 'candidate-pair', nominated: true, availableOutgoingBitrate: 8_000_000 }],
        ])
      })
    }

    it('records how the live ramps up after the swap', async () => {
      const ramp = captureDiag()
      const a = fakeCall()
      withStats(a)
      MediaCallHandler.replaceVideoTrack(callsOf(['viewer-1', a]), screenTrack(), true, 5_500_000, 60)
      await vi.advanceTimersByTimeAsync(RAMP_SAMPLE_OFFSETS_MS[RAMP_SAMPLE_OFFSETS_MS.length - 1])

      const entries = await ramp()
      expect(entries.map((e) => e.data.tMs)).toEqual(RAMP_SAMPLE_OFFSETS_MS)
      expect(entries[0].data).toMatchObject({ toPeer: 'viewer-1', phase: 'live', tMs: 0, sentKbps: null })
      expect(entries[1].data).toMatchObject({
        toPeer: 'viewer-1',
        phase: 'live',
        tMs: 500,
        w: 1920,
        h: 1080,
        fps: 59,
        sentKbps: 2000,
        targetKbps: 5000,
        estimateKbps: 8000,
        limit: 'bandwidth',
      })
    })

    it('records the estimate at the moment the calls are prepared', async () => {
      const ramp = captureDiag()
      const a = fakeCall()
      withStats(a)
      MediaCallHandler.primeScreenShare(callsOf(['viewer-1', a]), 5_500_000, 60)
      await vi.advanceTimersByTimeAsync(0)

      const entries = await ramp()
      expect(entries).toHaveLength(1)
      expect(entries[0].data).toMatchObject({ toPeer: 'viewer-1', phase: 'prime', tMs: 0, estimateKbps: 8000 })
    })

    it('stops sampling when the live stops', async () => {
      const ramp = captureDiag()
      const a = fakeCall()
      withStats(a)
      const calls = callsOf(['viewer-1', a])
      MediaCallHandler.replaceVideoTrack(calls, screenTrack(), true, 5_500_000, 60)
      await vi.advanceTimersByTimeAsync(1000)
      MediaCallHandler.replaceVideoTrack(calls, cameraTrack(), false)
      await vi.advanceTimersByTimeAsync(RAMP_SAMPLE_OFFSETS_MS[RAMP_SAMPLE_OFFSETS_MS.length - 1])

      const entries = await ramp()
      expect(entries.map((e) => e.data.tMs)).toEqual([0, 500, 1000])
    })

    it('tags the samples of a call that joined a running live', async () => {
      const ramp = captureDiag()
      MediaCallHandler.replaceVideoTrack(new Map(), screenTrack(), true, 5_500_000, 60)
      const late = fakeCall(screenTrack())
      withStats(late)
      watchScreenShareRamp(late.pc, 'viewer-2', 'join')
      await vi.advanceTimersByTimeAsync(500)

      const entries = await ramp()
      expect(entries.map((e) => [e.data.toPeer, e.data.phase, e.data.tMs])).toEqual([
        ['viewer-2', 'join', 0],
        ['viewer-2', 'join', 500],
      ])
    })

    it('never throws when the stats are unavailable', async () => {
      const ramp = captureDiag()
      const noStats = fakeCall()
      const failing = fakeCall()
      failing.pc.getStats = vi.fn(async () => {
        throw new Error('connection closed')
      })
      const throwing = fakeCall()
      throwing.pc.getStats = vi.fn(() => {
        throw new Error('sync failure')
      })

      const screen = screenTrack()
      expect(() =>
        MediaCallHandler.replaceVideoTrack(
          callsOf(['a', noStats], ['b', failing], ['c', throwing]),
          screen,
          true,
          5_500_000,
          60
        )
      ).not.toThrow()
      await vi.advanceTimersByTimeAsync(RAMP_SAMPLE_OFFSETS_MS[RAMP_SAMPLE_OFFSETS_MS.length - 1])
      expect(await ramp()).toEqual([])
      // A failing log must never cost the viewer the picture.
      for (const c of [noStats, failing, throwing]) expect(c.sender.track).toBe(screen)
    })
  })
})
