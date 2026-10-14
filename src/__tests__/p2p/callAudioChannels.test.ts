import { afterEach, describe, expect, it, vi } from 'vitest'
import { splitCallAudio, replaceLiveAudio, reserveLiveAudio } from '../../p2p/callAudioChannels'
import { PeerManager } from '../../p2p/PeerManager'

class Stream {
  constructor(private tracks: any[] = []) {}
  getTracks() { return this.tracks }
  getAudioTracks() { return this.tracks.filter(t => t.kind === 'audio') }
  getVideoTracks() { return this.tracks.filter(t => t.kind === 'video') }
}
afterEach(() => vi.unstubAllGlobals())
describe('separate voice and live audio channels', () => {
  it('muting the microphone does not disable a reserved or active live sender', () => {
    const mic = { kind: 'audio', enabled: true }
    const live = { kind: 'audio', enabled: true, __screenShareLiveAudio: true }
    const manager = Object.create(PeerManager.prototype) as any
    manager.mediaCalls = new Map([['viewer', { peerConnection: { getSenders: () => [{ track: mic }, { track: live }] } }]])
    manager.syncSenderTracksMuteState(false)
    expect(mic.enabled).toBe(false)
    expect(live.enabled).toBe(true)
  })
  it('reserves a unique silent live track without using or disabling the microphone', () => {
    const silence = { kind: 'audio', id: 'quiet', clone: vi.fn(() => ({ kind: 'audio', id: 'quiet-clone', enabled: false })) } as any
    const reserved = reserveLiveAudio(silence) as any
    expect(reserved.id).toBe('quiet-clone')
    expect(reserved.enabled).toBe(true)
    expect(reserved.__screenShareLiveAudio).toBe(true)
  })
  it('changes only the negotiated live sender and leaves microphone audio enabled', async () => {
    const mic = { track: { kind: 'audio', id: 'mic' }, replaceTrack: vi.fn(async () => {}) }
    const live = { track: { kind: 'audio', id: 'quiet' }, replaceTrack: vi.fn(async () => {}) }
    const pc = { getSenders: () => [mic, live], getTransceivers: () => [ { sender: mic, receiver: { track: { kind: 'audio' } } }, { sender: live, receiver: { track: { kind: 'audio' } } } ] } as any
    const track = { kind: 'audio', id: 'live' } as any
    await replaceLiveAudio(pc, track)
    expect(live.replaceTrack).toHaveBeenCalledWith(track)
    expect(mic.replaceTrack).not.toHaveBeenCalled()
    await replaceLiveAudio(pc, null)
    expect(live.replaceTrack).toHaveBeenLastCalledWith(null)
    expect(mic.replaceTrack).not.toHaveBeenCalled()
  })
  it('does not replace a legacy microphone sender with the live', async () => {
    const mic = { track: { kind: 'audio' }, replaceTrack: vi.fn() }
    expect(await replaceLiveAudio({ getSenders: () => [mic] } as any, { kind: 'audio' } as any)).toBe(false)
    expect(mic.replaceTrack).not.toHaveBeenCalled()
  })
  it('splits by negotiated audio order even when stream tracks arrive reversed', () => {
    vi.stubGlobal('MediaStream', Stream)
    const mic = { kind: 'audio', id: 'mic' }
    const live = { kind: 'audio', id: 'live' }
    const video = { kind: 'video', id: 'video' }
    const pc = { getTransceivers: () => [{ receiver: { track: mic } }, { receiver: { track: live } }] } as any
    const result = splitCallAudio(new Stream([live, video, mic]) as any, pc, true)
    expect(result.voice.getAudioTracks()).toEqual([mic])
    expect(result.live?.getAudioTracks()).toEqual([live])
    expect(result.live?.getVideoTracks()).toEqual([video])
    expect(result.voice.getVideoTracks()).toEqual([video])
  })
  it('does not route a live track into voice while the microphone track is still arriving', () => {
    vi.stubGlobal('MediaStream', Stream)
    const mic = { kind: 'audio', id: 'mic' }
    const live = { kind: 'audio', id: 'live' }
    const pc = { getTransceivers: () => [{ receiver: { track: mic } }, { receiver: { track: live } }] } as any
    const result = splitCallAudio(new Stream([live]) as any, pc, true)
    expect(result.voice.getAudioTracks()).toEqual([])
    expect(result.live?.getAudioTracks()).toEqual([live])
  })
})
