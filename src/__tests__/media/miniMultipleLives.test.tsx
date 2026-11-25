// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MiniCallOverlay } from '../../components/MiniCallOverlay'
import { useGameStore } from '../../store/useGameStore'
import { useLiveWatchStore } from '../../store/useLiveWatchStore'
import { useMediaStore } from '../../store/useMediaStore'

vi.mock('../../components/common/RemoteAudio', () => ({ RemoteAudio: () => null }))
vi.mock('../../data/nativeAssets.json', () => ({ default: { categories: [], assets: [] } }))
vi.mock('../../components/ScreenShareModal', () => ({ ScreenShareModal: () => null }))
vi.mock('../../components/RoomSettingsModal', () => ({ RoomSettingsModal: () => null }))
vi.mock('../../components/common/PlayerAvatar', () => ({ PlayerAvatar: ({ name }: { name: string }) => <span>avatar {name}</span> }))
vi.mock('../../hooks/useLiveViewBox', () => ({ useLiveViewBox: () => {} }))
vi.mock('../../hooks/useLiveFrameFit', () => ({ useLiveFrameFit: () => undefined }))
vi.mock('../../media/attachVideoElement', () => ({ attachStreamToVideo: () => () => {} }))
vi.mock('../../store/useNetworkQualityStore', () => ({ useUserNetworkQuality: () => ({ rating: 'good', pingMs: 10, lossPct: 0 }) }))
vi.mock('../../store/useMapStore', () => ({ useMapStore: (select: any) => select({ mapData: { zones: [{ id: 'zone', name: 'Sala' }] } }) }))
vi.mock('../../hooks/usePlayerDetails', () => ({
  useLocalPlayerDetails: () => useGameStore((s) => s.localPlayer),
  useZonePeerDetails: () => {
    const remotePlayers = useGameStore((s) => s.remotePlayers)
    return Object.values(remotePlayers)
  },
}))

const originalGame = useGameStore.getState()
const originalMedia = useMediaStore.getState()

const track = (id: string, kind: 'audio' | 'video') => ({ id, kind, enabled: true, readyState: 'live' }) as MediaStreamTrack
const fakeStream = (...tracks: MediaStreamTrack[]) =>
  ({
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'),
    getVideoTracks: () => tracks.filter((t) => t.kind === 'video'),
  }) as unknown as MediaStream

afterEach(() => {
  cleanup()
  useLiveWatchStore.setState({ watching: {} })
  useGameStore.setState(originalGame)
  useMediaStore.setState(originalMedia, true)
  vi.restoreAllMocks()
})

function setupTwoRemoteLives(options: { localSharing?: boolean } = {}) {
  const local = { ...originalGame.localPlayer, id: 'viewer', name: 'Você', currentZoneId: 'zone' }
  const alice = { ...local, id: 'alice', name: 'Alice', isScreenSharing: true, liveOptIn: true }
  const bob = { ...local, id: 'bob', name: 'Bob', isScreenSharing: true, liveOptIn: true }
  const aliceLive = fakeStream(track('alice-screen', 'video'))
  const bobLive = fakeStream(track('bob-screen', 'video'))
  const localLive = fakeStream(track('local-screen', 'video'))

  useGameStore.setState({
    localPlayer: { ...local, isScreenSharing: !!options.localSharing },
    remotePlayers: { alice, bob },
    friendProfiles: {},
    callStates: {},
  })
  useMediaStore.setState({
    isGridCallOpen: false,
    isScreenSharing: !!options.localSharing,
    localScreenStream: options.localSharing ? localLive : null,
    peerStreams: { alice: aliceLive, bob: bobLive },
    peerVoiceStreams: {
      alice: fakeStream(track('alice-mic', 'audio')),
      bob: fakeStream(track('bob-mic', 'audio')),
    },
    peerScreenStreams: {},
  })
}

describe('multiple lives in MiniCallOverlay', () => {
  it('shows live invite on each presenter card instead of opening the floating preview before accepting', () => {
    setupTwoRemoteLives()
    render(<MiniCallOverlay />)

    expect(screen.queryByText('Tela de Alice')).toBeNull()
    expect(screen.queryByText('Tela de Bob')).toBeNull()

    expect(screen.getAllByText('Abriu live')).toHaveLength(2)
    expect(screen.getByTitle('Assistir à live de Alice')).toBeTruthy()
    expect(screen.getByTitle('Assistir à live de Bob')).toBeTruthy()
    expect(screen.getByText('Alice')).toBeTruthy()
    expect(screen.getByText('Bob')).toBeTruthy()
  })

  it('opens the accepted live above the mini display when clicking Assistir on a card without opening grid call', () => {
    setupTwoRemoteLives()
    render(<MiniCallOverlay />)

    fireEvent.click(screen.getByTitle('Assistir à live de Bob'))

    expect(useMediaStore.getState().isGridCallOpen).toBe(false)
    expect(useLiveWatchStore.getState().watching.bob).toBeTypeOf('number')
    expect(useLiveWatchStore.getState().watching.alice).toBeUndefined()

    expect(screen.getAllByText('Tela de Bob').length).toBeGreaterThan(0)
    expect(screen.queryByText('Tela de Alice')).toBeNull()

    // Alice's card still clearly shows her live invite.
    expect(screen.getAllByText('Abriu live')).toHaveLength(1)
    expect(screen.getByTitle('Assistir à live de Alice')).toBeTruthy()
  })

  it('switches between multiple watched lives and returns a card to Abriu live when stopping', () => {
    setupTwoRemoteLives()
    render(<MiniCallOverlay />)

    fireEvent.click(screen.getByTitle('Assistir à live de Bob'))
    fireEvent.click(screen.getByTitle('Assistir à live de Alice'))

    expect(screen.getAllByText('Tela de Alice').length).toBeGreaterThan(0)
    expect(screen.queryByText('Abriu live')).toBeNull()

    // Switch back to Bob using the preview switcher tab or Bob's card badge.
    fireEvent.click(screen.getByTitle('Mostrar live de Bob no mini display'))
    expect(screen.getAllByText('Tela de Bob').length).toBeGreaterThan(0)

    // Stop watching Bob -> falls back to Alice and restores Bob's invite card.
    fireEvent.click(screen.getByTitle('Parar de assistir'))
    expect(useLiveWatchStore.getState().watching.bob).toBeUndefined()
    expect(screen.getAllByText('Tela de Alice').length).toBeGreaterThan(0)
    expect(screen.getByTitle('Assistir à live de Bob')).toBeTruthy()

    // Stop watching Alice -> closes floating preview completely.
    fireEvent.click(screen.getByTitle('Parar de assistir'))
    expect(screen.queryByText('Tela de Alice')).toBeNull()
    expect(screen.getAllByText('Abriu live')).toHaveLength(2)
  })

  it('lets the local presenter see and watch remote lives while sharing their own screen', () => {
    setupTwoRemoteLives({ localSharing: true })
    render(<MiniCallOverlay />)

    // Own screen is shown in preview; both remote peers still show their live invites on their cards.
    expect(screen.getByText('Sua Tela')).toBeTruthy()
    expect(screen.getByTitle('Assistir à live de Alice')).toBeTruthy()
    expect(screen.getByTitle('Assistir à live de Bob')).toBeTruthy()

    fireEvent.click(screen.getByTitle('Assistir à live de Alice'))
    expect(screen.getAllByText('Tela de Alice').length).toBeGreaterThan(0)

    // Can switch back to own screen via card badge or preview tab.
    fireEvent.click(screen.getByTitle('Mostrar sua tela no mini display'))
    expect(screen.getAllByText('Sua Tela').length).toBeGreaterThan(0)
  })

  it('shows a pending lives badge in the header when the mini call panel is collapsed', () => {
    setupTwoRemoteLives()
    render(<MiniCallOverlay />)

    fireEvent.click(screen.getByTitle('Recolher painel de chamada'))
    const badge = screen.getByTitle('2 pessoas abriram live - Clique para ver')
    expect(badge.textContent).toContain('2 lives')

    fireEvent.click(badge)
    expect(screen.queryByTitle('2 pessoas abriram live - Clique para ver')).toBeNull()
  })
})
