import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MiniCallOverlay } from '../../components/MiniCallOverlay'
import { MediaManager } from '../../media/MediaManager'
import { PeerManager } from '../../p2p/PeerManager'
import { useGameStore } from '../../store/useGameStore'
import { useMediaStore } from '../../store/useMediaStore'

const receivedAudio = vi.hoisted(() => [] as Array<{ stream: MediaStream; muted: boolean; volume: number }>)
vi.mock('../../components/common/RemoteAudio', () => ({ RemoteAudio: (props: { stream: MediaStream; muted: boolean; volume: number }) => { receivedAudio.push(props); return null } }))
vi.mock('../../data/nativeAssets.json', () => ({ default: { categories: [], assets: [] } }))
vi.mock('../../components/ScreenShareModal', () => ({ ScreenShareModal: () => null }))
vi.mock('../../components/RoomSettingsModal', () => ({ RoomSettingsModal: () => null }))
vi.mock('../../components/common/PlayerAvatar', () => ({ PlayerAvatar: ({ name }: { name: string }) => <span>avatar {name}</span> }))
vi.mock('../../hooks/useLiveGate', () => ({ useLiveGate: () => ({ needsClick: false, connecting: false, watching: true, onFrame() {}, stop() {} }) }))
vi.mock('../../hooks/useLiveViewBox', () => ({ useLiveViewBox: () => {} }))
vi.mock('../../store/useNetworkQualityStore', () => ({ useUserNetworkQuality: () => ({ rating: 'good', pingMs: 10, lossPct: 0 }) }))
vi.mock('../../store/useMapStore', () => ({ useMapStore: (select: any) => select({ mapData: { zones: [{ id: 'zone', name: 'Sala' }] } }) }))
vi.mock('../../hooks/usePlayerDetails', () => ({
  useLocalPlayerDetails: () => useGameStore.getState().localPlayer,
  useZonePeerDetails: () => Object.values(useGameStore.getState().remotePlayers),
}))
vi.mock('../../store/useGameStore', async () => {
  const actual = await vi.importActual<typeof import('../../store/useGameStore')>('../../store/useGameStore')
  return { ...actual, useGameStore: Object.assign((select: any) => select(actual.useGameStore.getState()), actual.useGameStore) }
})
vi.mock('../../store/useMediaStore', async () => {
  const actual = await vi.importActual<typeof import('../../store/useMediaStore')>('../../store/useMediaStore')
  return { ...actual, useMediaStore: Object.assign((select: any) => select(actual.useMediaStore.getState()), actual.useMediaStore) }
})

const originalGame = useGameStore.getState()
const originalMedia = useMediaStore.getState()
afterEach(() => {
  receivedAudio.length = 0
  const manager = PeerManager.getInstance() as any
  manager.stopLiveVoiceCalls?.()
  manager.incomingLiveVoiceCalls?.clear()
  manager.mediaCalls = new Map()
  manager.peer = null
  useGameStore.setState(originalGame)
  useMediaStore.setState(originalMedia, true)
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const track = (id: string, kind: 'audio' | 'video') => ({ id, kind, enabled: true, readyState: 'live' }) as MediaStreamTrack
const stream = (...tracks: MediaStreamTrack[]) => ({
  getTracks: () => tracks,
  getAudioTracks: () => tracks.filter(t => t.kind === 'audio'),
  getVideoTracks: () => tracks.filter(t => t.kind === 'video'),
}) as MediaStream

describe('live audio and participant voice in the mini call', () => {
  it.each(['local', 'remote'])('keeps the call panel anchored when a %s live preview opens', (presenter) => {
    const local = { ...originalGame.localPlayer, id: 'viewer', name: 'Viewer', currentZoneId: 'zone' }
    const remote = { ...local, id: 'presenter', name: 'Presenter', isScreenSharing: presenter === 'remote' }
    const live = stream(track('screen', 'video'))
    useGameStore.setState({ localPlayer: local, remotePlayers: { presenter: remote }, friendProfiles: {}, callStates: {} })
    useMediaStore.setState({ isGridCallOpen: false, isScreenSharing: false, localScreenStream: null, peerStreams: {}, peerVoiceStreams: {} })
    const before = renderToStaticMarkup(<MiniCallOverlay />)
    useMediaStore.setState(presenter === 'local'
      ? { isScreenSharing: true, localScreenStream: live }
      : { peerStreams: { presenter: live } })
    const after = renderToStaticMarkup(<MiniCallOverlay />)
    const anchor = (html: string) => html.match(/<div[^>]*class="fixed z-40[^\"]*"[^>]*>/)?.[0]
    expect(anchor(after)).toBe(anchor(before))
    // The preview must sit above the call outside its layout flow, including
    // after dragging changes the anchor from bottom positioning to top positioning.
    expect(after).toMatch(/<div class="[^"]*absolute[^"]*bottom-full[^"]*">\s*<div[^>]*>[\s\S]*?(Sua Tela|Tela de Presenter)/)
  })

  it('keeps the presenter in their participant tile while only the floating preview shows the live', () => {
    const local = { ...originalGame.localPlayer, id: 'viewer', name: 'Player #2', currentZoneId: 'zone' }
    const presenter = { ...local, id: 'presenter', name: 'Player', isScreenSharing: true }
    const live = stream(track('screen', 'video'), track('screen-audio', 'audio'))
    const voice = stream(track('microphone', 'audio'))
    useGameStore.setState({ localPlayer: local, remotePlayers: { presenter }, friendProfiles: {}, callStates: {} })
    useMediaStore.setState({ peerStreams: { presenter: live }, peerVoiceStreams: { presenter: voice }, liveStreamVolume: 0, participantVolumes: { presenter: 100 }, isGridCallOpen: false } as any)

    const html = renderToStaticMarkup(<MiniCallOverlay />)
    expect(html).toContain('Tela de Player')
    expect(html).not.toContain('Tela (Player)')
    expect(html).toContain('>Player<')
    expect(receivedAudio).toEqual([expect.objectContaining({ stream: voice, muted: false, volume: 1 })])
  })

  it('does not add a second tile for the local presenter', () => {
    const local = { ...originalGame.localPlayer, id: 'presenter', name: 'Player', currentZoneId: 'zone' }
    useGameStore.setState({ localPlayer: local, remotePlayers: {}, friendProfiles: {}, callStates: {} })
    useMediaStore.setState({ localStream: stream(track('mic', 'audio')), localScreenStream: stream(track('screen', 'video')), isScreenSharing: true, isGridCallOpen: false })

    const html = renderToStaticMarkup(<MiniCallOverlay />)
    expect(html).toContain('Sua Tela')
    expect(html).toContain('Player (Você)')
    expect(html).not.toContain('Tela (Player)')
  })

  it('sends the microphone over a separate call while the screen is live', () => {
    vi.stubGlobal('MediaStream', class { constructor(private tracks: MediaStreamTrack[]) {} getAudioTracks() { return this.tracks } })
    const mic = track('mic', 'audio')
    const peer = { call: vi.fn(() => ({ on: vi.fn(), close: vi.fn() })) }
    const manager = PeerManager.getInstance() as any
    manager.peer = peer
    manager.mediaCalls = new Map([['viewer', {}]])
    useMediaStore.setState({ localStream: stream(mic), isScreenSharing: true })

    manager.startLiveVoiceCalls()
    expect(peer.call).toHaveBeenCalledOnce()
    const [id, outgoing, options] = peer.call.mock.calls[0]
    expect(id).toBe('viewer')
    expect(outgoing.getAudioTracks()).toEqual([mic])
    expect(options.metadata.kind).toBe('live-voice')
  })

  it('removes microphone audio from the live connection when the screen has no audio', () => {
    vi.stubGlobal('MediaStream', class { constructor(private tracks: MediaStreamTrack[]) {} getAudioTracks() { return this.tracks } })
    const mic = track('mic', 'audio')
    const sender = { track: mic, replaceTrack: vi.fn(async () => {}) }
    const mainCall = { peerConnection: { getSenders: () => [sender] } }
    const manager = PeerManager.getInstance() as any
    manager.peer = { call: vi.fn(() => ({ on: vi.fn(), close: vi.fn() })) }
    manager.mediaCalls = new Map([['viewer', mainCall]])
    useMediaStore.setState({ localStream: stream(mic), localScreenStream: stream(track('screen', 'video')), isScreenSharing: true })

    manager.startLiveVoiceCalls()
    expect(sender.replaceTrack).toHaveBeenCalledWith(null)
  })

  it('routes an incoming voice call to the participant audio stream', () => {
    vi.stubGlobal('MediaStream', class { constructor(public tracks: MediaStreamTrack[] = []) {} })
    const callbacks: Record<string, (value?: any) => void> = {}
    const call = { peer: 'presenter', metadata: { kind: 'live-voice' }, answer: vi.fn(), on: vi.fn((event: string, callback: (value?: any) => void) => { callbacks[event] = callback }), close: vi.fn() }
    const manager = PeerManager.getInstance() as any
    manager.handleIncomingLiveVoiceCall(call)
    const voice = stream(track('remote-mic', 'audio'))
    callbacks.stream(voice)
    expect(call.answer).toHaveBeenCalledOnce()
    expect(useMediaStore.getState().peerVoiceStreams.presenter).toBe(voice)
    callbacks.close()
    expect(useMediaStore.getState().peerVoiceStreams.presenter).toBeUndefined()
  })

  it('does not mute the live audio when the presenter mutes their microphone', () => {
    const live = Object.assign(track('screen-audio', 'audio'), { __screenShareLiveAudio: true })
    const mic = track('mic', 'audio')
    const manager = PeerManager.getInstance() as any
    manager.mediaCalls = new Map([['viewer', { peerConnection: { getSenders: () => [{ track: live }] } }]])
    useMediaStore.setState({ isScreenSharing: true, localStream: stream(mic) })

    manager.syncSenderTracksMuteState(false)
    expect(mic.enabled).toBe(false)
    expect(live.enabled).toBe(true)
  })

  it('does not mix the microphone into the live audio track', async () => {
    const source = track('screen-audio', 'audio')
    const mic = track('mic', 'audio')
    const audioContext = {
      state: 'running', currentTime: 0, sampleRate: 48000,
      createMediaStreamSource: vi.fn(() => ({ connect: vi.fn() })),
      createGain: vi.fn(() => ({ gain: { setValueAtTime: vi.fn() }, connect: vi.fn() })),
      createMediaStreamDestination: vi.fn(() => ({ stream: stream(track('output', 'audio')) })),
    }
    vi.stubGlobal('window', { AudioContext: class { constructor() { return audioContext } } })
    vi.stubGlobal('MediaStream', class { constructor(public tracks: MediaStreamTrack[]) {} getAudioTracks() { return this.tracks } })
    const manager = Object.create(MediaManager.prototype) as any

    await manager.createLiveAudioTrack(source, stream(mic))
    expect(audioContext.createMediaStreamSource).toHaveBeenCalledTimes(1)
  })
})
