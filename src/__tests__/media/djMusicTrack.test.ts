import { afterEach, describe, expect, it, vi } from 'vitest'
import { MediaManager } from '../../media/MediaManager'
import { useSpotifyJamStore } from '../../store/useSpotifyJamStore'
import { useMediaStore } from '../../store/useMediaStore'
import { useGameStore } from '../../store/useGameStore'
vi.mock('../../p2p/PeerManager', () => ({ PeerManager: {} }))

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  useSpotifyJamStore.setState({ volume: 80, isMuted: false })
})
describe('DJ music stream', () => {
  it('mutes only local listening and restores the saved volume without touching another room or voice', () => {
    const local = useGameStore.getState().localPlayer
    useGameStore.setState({ remotePlayers: {
      dj: { id: 'dj', isDjBot: true, currentZoneId: local.currentZoneId } as any,
      other: { id: 'other', isDjBot: true, currentZoneId: 'another-zone' } as any,
      voice: { id: 'voice', currentZoneId: local.currentZoneId } as any,
    } })
    const volume = vi.spyOn(useMediaStore.getState(), 'setParticipantVolume')
    useSpotifyJamStore.getState().setVolume(1)
    expect(volume).toHaveBeenLastCalledWith('dj', 1)
    useSpotifyJamStore.getState().toggleMute()
    expect(volume).toHaveBeenLastCalledWith('dj', 0)
    useSpotifyJamStore.getState().toggleMute()
    expect(volume).toHaveBeenLastCalledWith('dj', 1)
    expect(volume.mock.calls.every(([id]) => id === 'dj')).toBe(true)
  })
  it.each([[0, 0], [100, 1], [150, 1.5], [200, 2], [250, 2], [-10, 0]])(
    'applies %s percent only to local DJ listening volume %s', (percent, expected) => {
      const manager = Object.create(MediaManager.prototype) as any
      manager.djGainNode = { gain: { setValueAtTime: vi.fn() } }
      manager.djAudioContext = { currentTime: 10 }
      const local = useGameStore.getState().localPlayer
      useGameStore.setState({ remotePlayers: { 'dj-test': { id: 'dj-test', isDjBot: true, currentZoneId: local.currentZoneId } as any } })
      const setVolume = vi.spyOn(useMediaStore.getState(), 'setParticipantVolume')
      manager.setDjVolume(percent)
      expect(setVolume).toHaveBeenCalledWith('dj-test', expected * 100)
      expect(manager.djGainNode.gain.setValueAtTime).not.toHaveBeenCalled()
      setVolume.mockRestore()
    })

  it.each([[150, 150], [200, 200], [250, 200], [-10, 0]])(
    'stores %s percent as %s without limiting amplification to 100', (input, expected) => {
      useSpotifyJamStore.getState().setVolume(input)
      expect(useSpotifyJamStore.getState().volume).toBe(expected)
      useSpotifyJamStore.setState({ volume: 80, isMuted: false })
    })
  it('keeps the stereo destination and music hint after applying the DJ volume', async () => {
    useSpotifyJamStore.getState().setVolume(200)
    const track = { enabled: false, contentHint: '' }
    const source = { connect: vi.fn() }
    const gain = { gain: { setValueAtTime: vi.fn() }, connect: vi.fn() }
    const destination = { channelCount: 1, channelCountMode: 'max', stream: { getAudioTracks: () => [track] } }
    vi.stubGlobal('MediaStream', class {})
    vi.stubGlobal('window', { AudioContext: class {
      state = 'running'; currentTime = 0
      createMediaStreamSource() { return source }
      createGain() { return gain }
      createMediaStreamDestination() { return destination }
    } })
    const manager = Object.create(MediaManager.prototype) as any
    expect(await manager.createDjLiveAudioTrack({ kind: 'audio' })).toBe(track)
    expect(track.contentHint).toBe('music')
    expect(destination.channelCount).toBe(2)
    expect(destination.channelCountMode).toBe('explicit')
    expect(source.connect).toHaveBeenCalledWith(gain)
    expect(gain.connect).toHaveBeenCalledWith(destination)
    expect(gain.gain.setValueAtTime).toHaveBeenCalledWith(1, 0)
  })
})
