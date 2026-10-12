import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ParticipantContextMenu } from '../../components/grid/ParticipantContextMenu'
import { SpotifyJamSideDisplay } from '../../components/spotify/SpotifyJamSideDisplay'
import { useGameStore } from '../../store/useGameStore'
import { useMediaStore } from '../../store/useMediaStore'
import { useSpotifyJamStore } from '../../store/useSpotifyJamStore'

vi.mock('../../data/nativeAssets.json', () => ({ default: { categories: [], assets: [] } }))
vi.mock('../../p2p/PeerManager', () => ({ PeerManager: {} }))
vi.mock('../../media/MediaManager', () => ({ MediaManager: { getInstance: () => ({ setDjVolume: vi.fn() }) } }))
vi.mock('../../store/useMapStore', () => ({ useMapStore: (select: any) => select({ mapData: { zones: [{ id: 'room', name: 'Sala' }] } }) }))
// Read the current stores in static rendering rather than Zustand's initial SSR snapshot.
vi.mock('../../store/useGameStore', async () => {
  const actual = await vi.importActual<typeof import('../../store/useGameStore')>('../../store/useGameStore')
  return { ...actual, useGameStore: Object.assign((select: any) => select(actual.useGameStore.getState()), actual.useGameStore) }
})
vi.mock('../../store/useMediaStore', async () => {
  const actual = await vi.importActual<typeof import('../../store/useMediaStore')>('../../store/useMediaStore')
  return { ...actual, useMediaStore: Object.assign((select: any) => select(actual.useMediaStore.getState()), actual.useMediaStore) }
})
vi.mock('../../store/useSpotifyJamStore', async () => {
  const actual = await vi.importActual<typeof import('../../store/useSpotifyJamStore')>('../../store/useSpotifyJamStore')
  return { ...actual, useSpotifyJamStore: Object.assign((select: any) => select(actual.useSpotifyJamStore.getState()), actual.useSpotifyJamStore) }
})

const originalGame = useGameStore.getState()
const originalMedia = useMediaStore.getState()
const originalDj = useSpotifyJamStore.getState()
afterEach(() => {
  vi.unstubAllGlobals()
  useGameStore.setState(originalGame)
  useMediaStore.setState(originalMedia)
  useSpotifyJamStore.setState(originalDj)
})

describe('DJ player and participant menu volume', () => {
  it('renders the same 16 percent player volume in both controls', () => {
    vi.stubGlobal('window', { innerWidth: 1200, innerHeight: 900 })
    useGameStore.setState({
      localPlayer: { ...originalGame.localPlayer, id: 'owner', currentZoneId: 'room' },
      remotePlayers: { 'dj-room': { ...originalGame.localPlayer, id: 'dj-room', name: 'DJ', isDjBot: true, djOwnerId: 'owner', currentZoneId: 'room' } },
    })
    useSpotifyJamStore.setState({ isDjModeActive: true, isSideDisplayMinimized: false, volume: 16, isMuted: false })
    useMediaStore.setState({ participantVolumes: { 'dj-room': 100 } })
    const menu = renderToStaticMarkup(<ParticipantContextMenu user={{ id: 'dj-room', name: 'DJ', isDjBot: true, stream: null }} x={0} y={0} onClose={() => {}} />)
    const panel = renderToStaticMarkup(<SpotifyJamSideDisplay />)
    expect(menu).toContain('value="16"')
    expect(menu).toContain('16%')
    expect(panel).toContain('value="16"')
    expect(panel).toContain('16%')
  })
})
