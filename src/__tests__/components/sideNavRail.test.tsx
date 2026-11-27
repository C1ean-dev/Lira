// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TopNavBar } from '../../components/TopNavBar'
import { CurrentLocationPill } from '../../components/CurrentLocationPill'
import { useGameStore } from '../../store/useGameStore'
import { useMediaStore } from '../../store/useMediaStore'
import { useChatStore } from '../../store/useChatStore'
import { useMapStore } from '../../store/useMapStore'
import { useProfileModalStore } from '../../store/useProfileModalStore'

vi.mock('../../hooks/useRoomPublication', () => ({ useRoomPublication: () => [] }))

const initialGame = useGameStore.getState()
const initialMedia = useMediaStore.getState()
const initialChat = useChatStore.getState()
const initialMap = useMapStore.getState()
const initialProfileModal = useProfileModalStore.getState()

const AVATAR_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

describe('side navigation icon rail', () => {
  beforeEach(() => {
    useGameStore.setState({
      ...initialGame,
      roomId: 'ROOM-1',
      isHost: true,
      isRoomPublic: false,
      isOnlineUsersOpen: false,
      remotePlayers: {},
      localPlayer: {
        ...initialGame.localPlayer,
        id: 'local',
        name: 'Alice',
        profilePicture: AVATAR_DATA_URL,
        statusText: 'Online',
        currentZoneId: 'zone-1',
      },
    })
    useMapStore.setState({
      ...initialMap,
      isEditorOpen: false,
      mapData: {
        ...initialMap.mapData,
        zones: [{ ...initialMap.mapData.zones[0], id: 'zone-1', name: 'Sala Principal', color: '#3b82f6' } as any],
      },
    })
    useMediaStore.setState({ ...initialMedia, isGridCallOpen: false, isSettingsModalOpen: false })
    useChatStore.setState({ ...initialChat, isChatOpen: false })
    useProfileModalStore.setState({ ...initialProfileModal, isOpen: false, target: null, mode: 'view', editorSection: null })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    useGameStore.setState(initialGame)
    useMediaStore.setState(initialMedia)
    useChatStore.setState(initialChat)
    useMapStore.setState(initialMap)
    useProfileModalStore.setState(initialProfileModal)
  })

  it('renders an icon-only left navigation rail without text labels inside buttons', () => {
    render(<TopNavBar onOpenAvatarModal={() => {}} onDisconnect={() => {}} />)
    const rail = screen.getByRole('complementary', { name: 'Barra de navegação lateral' })
    const buttons = Array.from(rail.querySelectorAll('button'))
    expect(buttons.length).toBeGreaterThanOrEqual(10)

    for (const button of buttons) {
      const clone = button.cloneNode(true) as HTMLElement
      clone.querySelectorAll('.sr-only').forEach((node) => node.remove())
      const visibleText = (clone.textContent || '').trim()
      expect(visibleText === '' || /^\d+$/.test(visibleText), `button "${button.getAttribute('aria-label')}" had visible text "${visibleText}"`).toBe(true)
    }
  })

  it('returns to the 2D map when clicking Mapa 2D by closing call grid, chat, and users menu', () => {
    useMediaStore.setState({ isGridCallOpen: true })
    useChatStore.setState({ isChatOpen: true })
    useGameStore.setState({ isOnlineUsersOpen: true })

    render(<TopNavBar onOpenAvatarModal={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Mapa 2D' }))

    expect(useMediaStore.getState().isGridCallOpen).toBe(false)
    expect(useChatStore.getState().isChatOpen).toBe(false)
    expect(useGameStore.getState().isOnlineUsersOpen).toBe(false)
  })

  it('triggers chat, online users, editor, settings, profile, report issue, and disconnect actions', () => {
    const onOpenAvatarModal = vi.fn()
    const onDisconnect = vi.fn()
    render(<TopNavBar onOpenAvatarModal={onOpenAvatarModal} onDisconnect={onDisconnect} />)

    useGameStore.setState({ isOnlineUsersOpen: true })
    fireEvent.click(screen.getByRole('button', { name: 'Abrir Chat e Canais' }))
    expect(useChatStore.getState().isChatOpen).toBe(true)
    expect(useGameStore.getState().isOnlineUsersOpen).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Participantes Online' }))
    expect(useGameStore.getState().isOnlineUsersOpen).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Editar Espaço' }))
    expect(useMapStore.getState().isEditorOpen).toBe(true)
    expect(useChatStore.getState().isChatOpen).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Configurações de Áudio e Chamada' }))
    expect(useMediaStore.getState().isSettingsModalOpen).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Ver / Editar perfil: Alice' }))
    expect(useProfileModalStore.getState().isOpen).toBe(true)
    expect(useProfileModalStore.getState().target?.isLocal).toBe(true)
    expect(useProfileModalStore.getState().mode).toBe('view')

    const reportBtn = screen.getByRole('button', { name: 'Reportar erro' })
    fireEvent.click(reportBtn)
    expect(screen.getByRole('dialog', { name: 'Reportar problema' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('dialog', { name: 'Reportar problema' })).toBeNull()
    expect(document.activeElement).toBe(reportBtn)

    fireEvent.click(screen.getByRole('button', { name: 'Sair / Desconectar deste espaço' }))
    expect(onDisconnect).toHaveBeenCalledOnce()
  })

  it('opens the room and invites popover with zone, invites, and privacy, and dismisses on Escape', () => {
    render(<TopNavBar onOpenAvatarModal={() => {}} />)
    const trigger = screen.getByRole('button', { name: 'Sala e convites' })
    fireEvent.click(trigger)

    const popover = screen.getByRole('region', { name: 'Sala e convites' })
    expect(popover.textContent).not.toContain('Local Atual:')
    expect(screen.getByRole('button', { name: 'Copiar link do convite' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copiar ID do espaço' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Copiar convite completo' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Convites individuais' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Sala (Pública|Privada)/ })).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('region', { name: 'Sala e convites' })).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('displays the current zone or Corredor Geral in CurrentLocationPill', () => {
    const { rerender } = render(<CurrentLocationPill />)
    expect(screen.getByRole('status', { name: 'Local atual' }).textContent).toContain('Sala Principal')

    useGameStore.setState({
      localPlayer: { ...useGameStore.getState().localPlayer, currentZoneId: null },
    })
    rerender(<CurrentLocationPill />)
    expect(screen.getByRole('status', { name: 'Local atual' }).textContent).toContain('Corredor Geral')
  })
})
