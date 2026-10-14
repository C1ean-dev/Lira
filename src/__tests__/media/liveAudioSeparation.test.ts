import { afterEach, describe, expect, it, vi } from 'vitest'
import { MediaManager } from '../../media/MediaManager'
vi.mock('../../p2p/PeerManager', () => ({ PeerManager: {} }))
afterEach(() => vi.unstubAllGlobals())
describe('live capture without microphone mixing', () => {
  it('connects only the application source to the live destination', async () => {
    const source = { connect: vi.fn() }
    const gain = { gain: { setValueAtTime: vi.fn() }, connect: vi.fn() }
    const track = { kind: 'audio', enabled: true }
    const destination = { stream: { getAudioTracks: () => [track] } }
    const makeSource = vi.fn(() => source)
    vi.stubGlobal('MediaStream', class {})
    vi.stubGlobal('window', { AudioContext: class { state = 'running'; currentTime = 0; createMediaStreamSource = makeSource; createGain() { return gain }; createMediaStreamDestination() { return destination } } })
    const manager = Object.create(MediaManager.prototype) as any
    await manager.createLiveAudioTrack({ kind: 'audio' }, { getAudioTracks: () => [{ kind: 'audio', id: 'mic' }] })
    expect(makeSource).toHaveBeenCalledOnce()
    expect(source.connect).toHaveBeenCalledWith(gain)
    expect(gain.connect).toHaveBeenCalledWith(destination)
  })
})
