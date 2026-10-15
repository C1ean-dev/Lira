import { afterEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { useGameStore } from '../../store/useGameStore'
import { useChatStore } from '../../store/useChatStore'
import { ChatDrawer } from '../../components/ChatDrawer'
import { MiniCallOverlay } from '../../components/MiniCallOverlay'
import { MapControlsWidget } from '../../components/MapControlsWidget'
import { AvatarCustomizerModal } from '../../components/AvatarCustomizerModal'
import { DoorKnockNotification } from '../../components/DoorKnockNotification'
import { SpotifyJamModal } from '../../components/spotify/SpotifyJamModal'
import { SpotifyJamSideDisplay } from '../../components/spotify/SpotifyJamSideDisplay'

const original = useGameStore.getState()
const originalChat = useChatStore.getState()

afterEach(() => {
  vi.restoreAllMocks()
  useGameStore.setState(original)
  useChatStore.setState(originalChat)
})

// Capture the real snapshots consumed by each component without a browser or DOM.
function captureSnapshots(element: React.ReactElement) {
  const snapshots: Array<() => unknown> = []
  vi.spyOn(React, 'useSyncExternalStore').mockImplementation((_subscribe, getSnapshot) => {
    snapshots.push(getSnapshot)
    return getSnapshot()
  })
  renderToStaticMarkup(element)
  return snapshots
}

describe('interface subscriptions during player movement', () => {
  it.each([
    ['call panel', () => <MiniCallOverlay />],
    ['map controls', () => <MapControlsWidget onZoomIn={() => {}} onZoomOut={() => {}} onFitScreen={() => {}} />],
    ['closed avatar editor', () => <AvatarCustomizerModal isOpen={false} onClose={() => {}} />],
    ['knock notifications', () => <DoorKnockNotification />],
    ['Spotify modal', () => <SpotifyJamModal />],
    ['Spotify side display', () => <SpotifyJamSideDisplay />],
  ])('%s does not invalidate its subscriptions on movement', (_label, element) => {
    useGameStore.setState({ localPlayer: { ...original.localPlayer, currentZoneId: 'test-zone' } })
    const snapshots = captureSnapshots(element())
    const before = snapshots.map((get) => get())
    const local = useGameStore.getState().localPlayer
    useGameStore.getState().setLocalPosition(local.x + 1, local.y + 1, 'left', true)

    expect(snapshots.length).toBeGreaterThan(0)
    expect(snapshots.map((get, i) => Object.is(get(), before[i])).every(Boolean)).toBe(true)
  })

  it('still invalidates the call panel when the player changes zones, profile or mute status', () => {
    useGameStore.setState({ localPlayer: { ...original.localPlayer, currentZoneId: 'test-zone' } })
    const snapshots = captureSnapshots(<MiniCallOverlay />)
    for (const change of [{ currentZoneId: 'other-zone' }, { name: 'Renamed' }, { isMutedByAdmin: true }]) {
      const before = snapshots.map((get) => get())
      useGameStore.getState().setLocalPlayer(change)
      expect(snapshots.some((get, i) => !Object.is(get(), before[i]))).toBe(true)
    }
  })

  it('ignores remote movement but still updates remote participant details and zone membership', () => {
    useGameStore.setState({
      localPlayer: { ...original.localPlayer, currentZoneId: 'test-zone' },
      remotePlayers: { peer: { ...original.localPlayer, id: 'peer', name: 'Peer', currentZoneId: 'test-zone', isMuted: false, isScreenSharing: false } },
    })
    const snapshots = captureSnapshots(<MiniCallOverlay />)
    const before = snapshots.map((get) => get())
    useGameStore.getState().updateRemotePlayerPosition('peer', 42, 43, 'left', true)
    expect(snapshots.every((get, i) => Object.is(get(), before[i]))).toBe(true)

    for (const change of [{ name: 'Bob' }, { isMuted: true }, { isScreenSharing: true }, { currentZoneId: 'other-zone' }]) {
      const previous = snapshots.map((get) => get())
      const peer = useGameStore.getState().remotePlayers.peer
      useGameStore.setState({ remotePlayers: { peer: { ...peer, ...change } } })
      expect(snapshots.some((get, i) => !Object.is(get(), previous[i])), JSON.stringify(change)).toBe(true)
    }
  })

  it('keeps the open chat stable during local and remote movement, while updating participant profiles', () => {
    useChatStore.setState({ isChatOpen: true, messages: [] })
    useGameStore.setState({
      localPlayer: { ...original.localPlayer, currentZoneId: 'test-zone' },
      remotePlayers: { peer: { ...original.localPlayer, id: 'peer', name: 'Peer', currentZoneId: 'other-zone' } },
      friends: [], friendProfiles: {},
    })
    const snapshots = captureSnapshots(<ChatDrawer />)
    const before = snapshots.map((get) => get())
    const local = useGameStore.getState().localPlayer
    useGameStore.getState().setLocalPosition(local.x + 1, local.y + 1, 'left', true)
    useGameStore.getState().updateRemotePlayerPosition('peer', 42, 43, 'left', true)
    expect(snapshots.every((get, i) => Object.is(get(), before[i]))).toBe(true)

    const previous = snapshots.map((get) => get())
    const peer = useGameStore.getState().remotePlayers.peer
    useGameStore.setState({ remotePlayers: { peer: { ...peer, name: 'Renamed peer' } } })
    expect(snapshots.some((get, i) => !Object.is(get(), previous[i]))).toBe(true)
  })
})
