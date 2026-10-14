import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyAudioOutput, attachRemoteAudio } from '../../media/remoteAudio'

afterEach(() => vi.unstubAllGlobals())
function audio() {
  const track = { kind: 'audio', id: 'remote', stop: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() }
  class Stream { constructor(public tracks: any[] = []) {} getAudioTracks() { return this.tracks }; getVideoTracks() { return [] }; addEventListener = vi.fn(); removeEventListener = vi.fn() }
  vi.stubGlobal('MediaStream', Stream)
  const contexts: any[] = []
  class Context {
    currentTime = 0; state = 'running'; destination = {}
    gain = { gain: { value: 1, setValueAtTime: vi.fn((value: number) => { this.gain.gain.value = value }) }, connect: vi.fn(), disconnect: vi.fn() }
    source = { connect: vi.fn(), disconnect: vi.fn() }
    createMediaStreamSource = vi.fn(() => this.source)
    createGain = vi.fn(() => this.gain)
    setSinkId = vi.fn(async () => {})
    resume = vi.fn(async () => {})
    close = vi.fn(async () => {})
    constructor() { contexts.push(this) }
  }
  vi.stubGlobal('window', { AudioContext: Context })
  const stream = new Stream([track]) as any
  const el = { srcObject: null, muted: false, volume: 1, paused: false, play: vi.fn(async () => {}), pause: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), setSinkId: vi.fn(async () => {}) } as any
  const cleanup = attachRemoteAudio(el, stream, { tile: 'test', peer: 'person', muted: false })
  return { el, track, contexts, cleanup }
}
describe('local audio amplification', () => {
  it('amplifies above 100 percent through Web Audio and avoids duplicate native playback', () => {
    const a = audio()
    applyAudioOutput(a.el, { volume: 1.5, muted: false })
    expect(a.contexts).toHaveLength(1)
    const ctx = a.contexts[0]
    expect(ctx.gain.gain.value).toBe(1.5)
    expect(ctx.source.connect).toHaveBeenCalledWith(ctx.gain)
    expect(ctx.gain.connect).toHaveBeenCalledWith(ctx.destination)
    expect(a.el.muted).toBe(true)
    applyAudioOutput(a.el, { volume: 2, muted: false })
    expect(ctx.gain.gain.value).toBe(2)
    applyAudioOutput(a.el, { volume: 0.4, muted: false })
    expect(ctx.gain.gain.value).toBe(0.4)
    expect(a.contexts).toHaveLength(1)
    a.cleanup()
    expect(ctx.source.disconnect).toHaveBeenCalledOnce()
    expect(ctx.close).toHaveBeenCalledOnce()
    expect(a.track.stop).not.toHaveBeenCalled()
  })
  it('respects mute and output-device changes in the amplified playback graph', () => {
    const a = audio()
    applyAudioOutput(a.el, { volume: 2, muted: false })
    applyAudioOutput(a.el, { volume: 2, muted: true, sinkId: 'headset' })
    expect(a.contexts[0].gain.gain.value).toBe(0)
    expect(a.contexts[0].setSinkId).toHaveBeenCalledWith('headset')
    applyAudioOutput(a.el, { volume: 2, muted: false, sinkId: 'default' })
    expect(a.contexts[0].gain.gain.value).toBe(2)
    expect(a.contexts[0].setSinkId).toHaveBeenLastCalledWith('')
    a.cleanup()
  })
  it('keeps live and microphone amplification independent', () => {
    const voice = audio()
    const live = audio()
    applyAudioOutput(voice.el, { volume: 2, muted: false })
    applyAudioOutput(live.el, { volume: 1.5, muted: false })
    const contexts = live.contexts
    applyAudioOutput(voice.el, { volume: 0, muted: true })
    expect(contexts[0].gain.gain.value).toBe(0)
    expect(contexts[1].gain.gain.value).toBe(1.5)
    voice.cleanup(); live.cleanup()
  })
})
