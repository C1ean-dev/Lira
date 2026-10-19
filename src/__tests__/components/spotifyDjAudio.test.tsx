import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SpotifyDjAudio } from '../../components/spotify/SpotifyDjAudio'
import { MiniCallOverlay } from '../../components/MiniCallOverlay'
import { useGameStore } from '../../store/useGameStore'
import { useMediaStore } from '../../store/useMediaStore'
import { useSpotifyJamStore } from '../../store/useSpotifyJamStore'

vi.mock('../../p2p/PeerManager', () => ({ PeerManager: { getInstance: () => ({}) } }))
vi.mock('../../components/common/RemoteAudio', () => ({ RemoteAudio: (props: any) =>
  <audio data-peer={props.peer} data-volume={props.volume} muted={props.muted} />,
}))
const game = useGameStore.getState()
const media = useMediaStore.getState()
const spotify = useSpotifyJamStore.getState()
beforeEach(() => { vi.spyOn(React, 'useSyncExternalStore').mockImplementation((_subscribe, getSnapshot) => getSnapshot()) })
afterEach(() => { vi.restoreAllMocks(); useGameStore.setState(game); useMediaStore.setState(media); useSpotifyJamStore.setState(spotify) })

describe('DJ audio outside participant tiles', () => {
  it('keeps the DJ audio at personal volume when the panel is minimized and grid is open', () => {
    useGameStore.setState({ localPlayer: { ...game.localPlayer, currentZoneId: 'room' }, remotePlayers: {
      'dj-room': { ...game.localPlayer, id: 'dj-room', isDjBot: true, currentZoneId: 'room' },
      'dj-other': { ...game.localPlayer, id: 'dj-other', isDjBot: true, currentZoneId: 'other' },
      person: { ...game.localPlayer, id: 'person', currentZoneId: 'room' },
    } })
    const stream = {} as MediaStream
    useMediaStore.setState({ peerStreams: { 'dj-room': stream, 'dj-other': stream, person: stream }, isDeafened: false, outputVolume: 50, isGridCallOpen: true })
    useSpotifyJamStore.setState({ volume: 80, isMuted: false, isSideDisplayMinimized: true })
    const html = renderToStaticMarkup(<SpotifyDjAudio />)
    expect(html).toContain('data-peer="dj-room"')
    expect(html).toContain('data-volume="0.4"')
    expect(html).not.toContain('dj-other')
    expect(html).not.toContain('data-peer="person"')
    useSpotifyJamStore.setState({ isMuted: true })
    expect(renderToStaticMarkup(<SpotifyDjAudio />)).toContain('muted=""')
    useSpotifyJamStore.setState({ isMuted: false })
    useMediaStore.setState({ isDeafened: true })
    expect(renderToStaticMarkup(<SpotifyDjAudio />)).toContain('muted=""')
  })
  it('does not count the DJ or render a DJ participant in the compact call', () => {
    useGameStore.setState({ localPlayer: { ...game.localPlayer, name: 'Eu', currentZoneId: 'room' }, remotePlayers: {
      'dj-room': { ...game.localPlayer, id: 'dj-room', name: 'DJ invisível', isDjBot: true, currentZoneId: 'room' },
      person: { ...game.localPlayer, id: 'person', name: 'Colega', currentZoneId: 'room' },
    } })
    useMediaStore.setState({ isGridCallOpen: false })
    const html = renderToStaticMarkup(<MiniCallOverlay />)
    expect(html).not.toContain('DJ invisível')
    expect(html).toContain('Colega')
    expect(html).toContain('2 online')
  })
})
