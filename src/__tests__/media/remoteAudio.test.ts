import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { applyAudioOutput, attachRemoteAudio, audioOnlyStream } from '../../media/remoteAudio'
import { __resetDiagForTests } from '../../utils/diagnosticLogger'

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

const track = (kind: 'audio' | 'video', id: string) => ({
  kind,
  id,
  enabled: true,
  muted: false,
  readyState: 'live',
  label: id,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
})

const peerStream = () => {
  const mic = track('audio', 'remote-mic')
  const placeholder = track('video', 'remote-placeholder-video')
  return { mic, placeholder, stream: new FakeMediaStream([mic, placeholder]) as unknown as MediaStream }
}

const fakeElement = (extra: Record<string, unknown> = {}) =>
  ({
    srcObject: null as unknown,
    muted: false,
    volume: 1,
    play: vi.fn(() => Promise.resolve()),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    ...extra,
  }) as any

describe('remote call audio', () => {
  let previousMediaStream: unknown
  beforeEach(() => {
    previousMediaStream = (globalThis as any).MediaStream
    ;(globalThis as any).MediaStream = FakeMediaStream
    __resetDiagForTests()
  })
  afterEach(() => {
    ;(globalThis as any).MediaStream = previousMediaStream
    __resetDiagForTests()
  })

  describe('audioOnlyStream', () => {
    it('keeps the audio tracks and leaves the video out', () => {
      const { stream, mic } = peerStream()
      const view = audioOnlyStream(stream)
      expect(view).not.toBe(stream)
      expect(view.getAudioTracks()).toEqual([mic])
      expect(view.getVideoTracks()).toEqual([])
    })

    it('returns the same object while the audio tracks do not change', () => {
      const { stream } = peerStream()
      expect(audioOnlyStream(stream)).toBe(audioOnlyStream(stream))
    })

    it('follows a change of the audio tracks', () => {
      const { stream, mic } = peerStream()
      const first = audioOnlyStream(stream)
      const second = track('audio', 'remote-mic-2')
      ;(stream as any).removeTrack(mic)
      ;(stream as any).addTrack(second)

      const next = audioOnlyStream(stream)
      expect(next).not.toBe(first)
      expect(next.getAudioTracks()).toEqual([second])
    })

    it('handles a stream with no audio yet', () => {
      const stream = new FakeMediaStream([track('video', 'v')]) as unknown as MediaStream
      expect(audioOnlyStream(stream).getAudioTracks()).toEqual([])
    })
  })

  describe('attachRemoteAudio', () => {
    it('amplifies to 200%, follows volume and mute changes, and releases its audio graph', () => {
      const gain = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() }
      const source = { connect: vi.fn(), disconnect: vi.fn() }
      const destination = { stream: new FakeMediaStream([track('audio', 'amplified')]), disconnect: vi.fn() }
      const context = {
        createMediaStreamSource: vi.fn(() => source),
        createGain: vi.fn(() => gain),
        createMediaStreamDestination: vi.fn(() => destination),
        state: 'running', resume: vi.fn(async () => {}), close: vi.fn(async () => {}),
      }
      vi.stubGlobal('AudioContext', class { constructor() { return context } })
      try {
        const { stream, mic } = peerStream()
        const el = fakeElement({ setSinkId: vi.fn(async () => {}) })
        const cleanup = attachRemoteAudio(el, stream, { tile: 'grid-audio', peer: 'Ana', muted: false })
        expect(context.createMediaStreamSource).toHaveBeenCalledWith(audioOnlyStream(stream))
        expect(source.connect).toHaveBeenCalledWith(gain)
        expect(gain.connect).toHaveBeenCalledWith(destination)
        expect(el.srcObject).toBe(destination.stream)
        for (const volume of [1, 1.5, 2, 0.4, 0]) {
          applyAudioOutput(el, { muted: false, volume, sinkId: 'headphones' })
          expect(gain.gain.value).toBe(volume)
          expect(el.volume).toBe(1)
        }
        applyAudioOutput(el, { muted: true, volume: 2 })
        expect(gain.gain.value).toBe(0)
        expect(el.muted).toBe(true)
        applyAudioOutput(el, { muted: false, volume: 2 })
        expect(gain.gain.value).toBe(2)
        expect(el.setSinkId).toHaveBeenLastCalledWith('headphones')
        context.state = 'suspended'
        applyAudioOutput(el, { muted: false, volume: 1.5 })
        expect(context.resume).toHaveBeenCalledTimes(1)
        const click = el.addEventListener.mock.calls.find((call: any[]) => call[0] === 'click' && call[1].name === 'resume')
        click[1]()
        expect(context.resume).toHaveBeenCalledTimes(2)
        cleanup()
        expect(source.disconnect).toHaveBeenCalled()
        expect(gain.disconnect).toHaveBeenCalled()
        expect(context.close).toHaveBeenCalled()
        expect(el.srcObject).toBeNull()
        expect(mic.enabled).toBe(true)
      } finally {
        vi.unstubAllGlobals()
      }
    })

    it('keeps ordinary playback when audio processing is unavailable', () => {
      const close = vi.fn(async () => {})
      vi.stubGlobal('AudioContext', class {
        close = close
        createMediaStreamSource() { throw new Error('Audio processing unavailable') }
      })
      try {
        const { stream } = peerStream()
        const el = fakeElement()
        const cleanup = attachRemoteAudio(el, stream, { tile: 'grid-audio', peer: 'Ana', muted: false })
        applyAudioOutput(el, { muted: false, volume: 0.7 })
        expect(el.srcObject).toBe(audioOnlyStream(stream))
        expect(el.volume).toBeCloseTo(0.7)
        expect(close).toHaveBeenCalledTimes(1)
        cleanup()
      } finally {
        vi.unstubAllGlobals()
      }
    })

    it('plays the peer audio without waiting for a video frame', () => {
      const { stream, mic } = peerStream()
      const el = fakeElement()
      attachRemoteAudio(el, stream, { tile: 'mini-audio', peer: 'Ana', muted: false })

      expect(el.srcObject).toBe(audioOnlyStream(stream))
      expect((el.srcObject as MediaStream).getVideoTracks()).toEqual([])
      expect((el.srcObject as MediaStream).getAudioTracks()).toEqual([mic])
      expect(el.play).toHaveBeenCalledTimes(1)
      expect(el.muted).toBe(false)
    })

    it('keeps the element on the same source across re-attaches', () => {
      const { stream } = peerStream()
      const el = fakeElement()
      attachRemoteAudio(el, stream, { tile: 'mini-audio', peer: 'Ana', muted: false })
      const source = el.srcObject
      attachRemoteAudio(el, stream, { tile: 'mini-audio', peer: 'Ana', muted: true })
      expect(el.srcObject).toBe(source)
      expect(el.muted).toBe(true)
    })

    it('retries play when the microphone track starts delivering audio', () => {
      const { stream, mic } = peerStream()
      const el = fakeElement()
      attachRemoteAudio(el, stream, { tile: 'grid-audio', peer: 'Ana', muted: false })
      const unmute = mic.addEventListener.mock.calls.find((c: any[]) => c[0] === 'unmute')
      expect(unmute).toBeDefined()
      ;(unmute as unknown as [string, () => void])[1]()
      expect(el.play).toHaveBeenCalledTimes(2)
    })

    it('removes its listeners on cleanup', () => {
      const { stream, mic } = peerStream()
      const el = fakeElement()
      const cleanup = attachRemoteAudio(el, stream, { tile: 'mini-audio', peer: 'Ana', muted: false })
      cleanup()
      expect(mic.removeEventListener).toHaveBeenCalledWith('unmute', expect.any(Function))
      expect(el.removeEventListener).toHaveBeenCalledWith('click', expect.any(Function))
    })
  })

  describe('applyAudioOutput', () => {
    it('applies mute and volume', () => {
      const el = fakeElement()
      applyAudioOutput(el, { muted: false, volume: 0.4 })
      expect(el.muted).toBe(false)
      expect(el.volume).toBeCloseTo(0.4)
    })

    it('keeps the volume between 0 and 1', () => {
      const el = fakeElement()
      applyAudioOutput(el, { muted: false, volume: 2 })
      expect(el.volume).toBe(1)
      applyAudioOutput(el, { muted: false, volume: -1 })
      expect(el.volume).toBe(0)
      applyAudioOutput(el, { muted: false, volume: Number.NaN })
      expect(el.volume).toBe(0)
    })

    it('silences the element when muted, whatever the volume', () => {
      const el = fakeElement()
      applyAudioOutput(el, { muted: true, volume: 1 })
      expect(el.muted).toBe(true)
      expect(el.volume).toBe(0)
    })

    it('routes the sound to the chosen output device', () => {
      const setSinkId = vi.fn(async () => {})
      const el = fakeElement({ setSinkId })
      applyAudioOutput(el, { muted: false, volume: 1, sinkId: 'speakers-1' })
      expect(setSinkId).toHaveBeenLastCalledWith('speakers-1')
      applyAudioOutput(el, { muted: false, volume: 1, sinkId: 'default' })
      expect(setSinkId).toHaveBeenLastCalledWith('')
    })

    it('leaves the output device alone when none is selected', () => {
      const setSinkId = vi.fn(async () => {})
      const el = fakeElement({ setSinkId })
      applyAudioOutput(el, { muted: false, volume: 1 })
      expect(setSinkId).not.toHaveBeenCalled()
    })

    it('never throws when the output device cannot be set', async () => {
      const rejecting = fakeElement({ setSinkId: vi.fn(async () => { throw new Error('NotFoundError') }) })
      const throwing = fakeElement({ setSinkId: vi.fn(() => { throw new Error('sync failure') }) })
      const unsupported = fakeElement()
      for (const el of [rejecting, throwing, unsupported]) {
        expect(() => applyAudioOutput(el, { muted: false, volume: 0.7, sinkId: 'speakers-1' })).not.toThrow()
        expect(el.volume).toBeCloseTo(0.7)
      }
      await Promise.resolve()
    })
  })
})
