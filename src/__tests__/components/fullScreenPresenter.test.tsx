import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FullScreenGrid } from '../../components/FullScreenGrid'
import { useGameStore } from '../../store/useGameStore'
import { useMediaStore } from '../../store/useMediaStore'

const theaterState = vi.hoisted(() => ({ hook: 0, user: null as any }))
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react')
  return { ...actual, useState: (initial: unknown) => actual.useState(theaterState.hook++ === 2 ? theaterState.user : initial) }
})

vi.mock('../../data/nativeAssets.json', () => ({ default: { categories: [], assets: [] } }))
vi.mock('../../p2p/PeerManager', () => ({ PeerManager: {} }))
vi.mock('../../media/MediaManager', () => ({ MediaManager: {} }))
vi.mock('../../components/ScreenShareModal', () => ({ ScreenShareModal: () => null }))
vi.mock('../../components/grid/CallControlsBar', () => ({ CallControlsBar: () => null }))
vi.mock('../../components/grid/FullScreenLiveOverlay', () => ({ FullScreenLiveOverlay: () => <div data-theater="open" /> }))
vi.mock('../../components/grid/ParticipantContextMenu', () => ({ ParticipantContextMenu: () => null }))
vi.mock('../../components/grid/GridParticipantTile', () => ({
  GridParticipantTile: ({ user, isSidebar, mediaKind }: any) => (
    <div data-peer={user.id} data-position={isSidebar ? 'sidebar' : 'stage'} data-media={mediaKind || 'auto'} />
  ),
}))
vi.mock('../../store/useMapStore', () => ({ useMapStore: () => ({ mapData: { zones: [] } }) }))
vi.mock('../../store/useGameStore', async () => {
  const actual = await vi.importActual<typeof import('../../store/useGameStore')>('../../store/useGameStore')
  return { ...actual, useGameStore: Object.assign(() => actual.useGameStore.getState(), actual.useGameStore) }
})
vi.mock('../../store/useMediaStore', async () => {
  const actual = await vi.importActual<typeof import('../../store/useMediaStore')>('../../store/useMediaStore')
  return { ...actual, useMediaStore: Object.assign((select: any) => select(actual.useMediaStore.getState()), actual.useMediaStore) }
})

const originalGame = useGameStore.getState()
const originalMedia = useMediaStore.getState()
afterEach(() => {
  theaterState.user = null
  theaterState.hook = 0
  useGameStore.setState(originalGame)
  useMediaStore.setState(originalMedia)
})

function setup(localSharing = false) {
  theaterState.hook = 0
  const local = { ...originalGame.localPlayer, id: 'local', currentZoneId: 'room', isScreenSharing: localSharing }
  useGameStore.setState({
    localPlayer: local,
    remotePlayers: { remote: { ...local, id: 'remote', name: 'Presenter', isScreenSharing: !localSharing } },
    friendProfiles: {}, callStates: {},
  })
  useMediaStore.setState({ isGridCallOpen: true, localScreenStream: null, peerScreenStreams: {}, peerStreams: {} })
}

describe('presenter beside the live in the expanded call', () => {
  it('closes the theater when the presenter stops sharing instead of keeping their camera fullscreen', () => {
    setup()
    theaterState.user = { id: 'remote', name: 'Presenter', isScreenSharing: true }
    expect(renderToStaticMarkup(<FullScreenGrid />)).toContain('data-theater="open"')
    useGameStore.setState({ remotePlayers: { remote: { ...useGameStore.getState().remotePlayers.remote, isScreenSharing: false } } })
    theaterState.hook = 0
    expect(renderToStaticMarkup(<FullScreenGrid />)).not.toContain('data-theater="open"')
  })

  it('closes the theater when the presenter leaves the call', () => {
    setup()
    theaterState.user = { id: 'remote', name: 'Presenter', isScreenSharing: true }
    useGameStore.setState({ remotePlayers: {} })
    expect(renderToStaticMarkup(<FullScreenGrid />)).not.toContain('data-theater="open"')
  })

  it('places transcription immediately beside Jam without starting capture automatically', () => {
    setup()
    const html = renderToStaticMarkup(<FullScreenGrid />)
    const buttons = [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)]
      .map(match => match[1].replace(/<[^>]*>/g, '').trim())
    expect(buttons[buttons.indexOf('Jam') + 1]).toBe('Transcrição')
    expect(html).toContain('aria-expanded="false" aria-controls="call-transcript"')
    expect(html).not.toContain('aria-label="Transcrição da chamada"')
  })

  it.each([false, true])('keeps the presenter in the participant sidebar (local sharing: %s)', (localSharing) => {
    setup(localSharing)
    const presenterId = localSharing ? 'local' : 'remote'
    const html = renderToStaticMarkup(<FullScreenGrid />)
    expect(html).toContain(`data-peer="${presenterId}" data-position="stage"`)
    expect(html).toContain(`data-peer="${presenterId}" data-position="sidebar" data-media="participant"`)
    expect(html.match(/data-position="sidebar"/g)).toHaveLength(2)
    expect(html).toContain('Participantes (2)')
  })

  it('keeps the regular layout when nobody is sharing', () => {
    setup()
    useGameStore.setState({ remotePlayers: { remote: { ...useGameStore.getState().remotePlayers.remote, isScreenSharing: false } } })
    const html = renderToStaticMarkup(<FullScreenGrid />)
    expect(html.match(/data-position="stage"/g)).toHaveLength(1)
    expect(html.match(/data-position="sidebar"/g)).toHaveLength(1)
    expect(html).toContain('Participantes (1)')
  })
})
