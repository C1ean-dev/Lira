import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatDrawer } from '../../components/ChatDrawer'
import { MiniCallOverlay } from '../../components/MiniCallOverlay'
import { PetSelectorPanel } from '../../components/avatar-customizer/PetSelectorPanel'
import { useGameStore } from '../../store/useGameStore'
import { useMediaStore } from '../../store/useMediaStore'
import { useChatStore } from '../../store/useChatStore'

vi.mock('../../p2p/PeerManager', () => ({ PeerManager: { getInstance: () => ({}) } }))
const game = useGameStore.getState()
const media = useMediaStore.getState()
const chat = useChatStore.getState()
beforeEach(() => {
  vi.spyOn(React, 'useSyncExternalStore').mockImplementation((_subscribe, snapshot) => snapshot())
  useGameStore.setState({ roomId: 'ROOM', isOwner: true, localPlayer: { ...game.localPlayer, name: 'Ana', currentZoneId: 'zone', avatar: { ...game.localPlayer.avatar!, pet: { type: 'custom', customAssetId: 'p', name: 'Mingau' } } }, remotePlayers: {} })
  useMediaStore.setState({ isGridCallOpen: false })
  useChatStore.setState({ isChatOpen: true })
})
afterEach(() => { vi.restoreAllMocks(); useGameStore.setState(game); useMediaStore.setState(media); useChatStore.setState(chat) })

describe('pet feature in existing interfaces', () => {
  it('offers pet interaction only through mentions in the main chat', () => {
    const html = renderToStaticMarkup(<ChatDrawer />)
    expect(html).toContain('aria-autocomplete="list"')
    expect(html).not.toContain('Pets na sala')
    expect(html).not.toContain('Perguntar ao pet')
    expect(html).not.toContain('Escolher pet')
  })
  it('offers the API settings next to Jam only to the room owner', () => {
    const owner = renderToStaticMarkup(<MiniCallOverlay />)
    expect(owner).toContain('Jam')
    expect(owner).toContain('Pet IA')
    useGameStore.setState({ isOwner: false })
    expect(renderToStaticMarkup(<MiniCallOverlay />)).not.toContain('Pet IA')
  })
  it('shows the personality editor for the selected pet', () => {
    const html = renderToStaticMarkup(<PetSelectorPanel avatar={useGameStore.getState().localPlayer.avatar!} onChangeAvatar={vi.fn()} />)
    expect(html).toContain('Personalidade do pet')
  })
})
