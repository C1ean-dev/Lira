// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TopNavBar } from '../../components/TopNavBar'
import { useGameStore } from '../../store/useGameStore'

const publication = vi.hoisted(() => ({ servers: [] as { name: string; host: string }[] }))
vi.mock('../../hooks/useRoomPublication', () => ({ useRoomPublication: () => publication.servers }))
vi.mock('../../store/useGameStore', async importOriginal => {
  const actual = await importOriginal<typeof import('../../store/useGameStore')>()
  return { ...actual, useGameStore: Object.assign(
    (selector: (state: ReturnType<typeof actual.useGameStore.getState>) => unknown) => selector(actual.useGameStore.getState()),
    actual.useGameStore,
  ) }
})

function openRoomPopover() {
  render(<TopNavBar onOpenAvatarModal={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: 'Sala e convites' }))
}

describe('room publication in the navigation rail', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    useGameStore.setState({ roomId: 'TEST', isRoomPublic: true, isOwner: true, signalingTier: 'render' })
    publication.servers = []
  })

  it('shows every service advertising the public room instead of the P2P signaling tier', () => {
    publication.servers = [
      { name: 'EMQX', host: 'broker.emqx.io' },
      { name: 'HiveMQ', host: 'broker.hivemq.com' },
      { name: 'Lira', host: 'p01--lira--tj9yvq5j5cgs.code.run' },
    ]
    openRoomPopover()
    for (const server of publication.servers) {
      const badge = screen.getByLabelText(`Sala publicada em ${server.name}`)
      expect(badge.getAttribute('title')).toBe(server.host)
    }
    expect(document.body.textContent).not.toContain('Servidor de sinalização P2P ativo')
  })

  it('shows a pending state when the room has no active publication', () => {
    openRoomPopover()
    expect(screen.getByText('Aguardando publicação')).toBeTruthy()
  })

  it('shows publication badges inside the room popover cleanly', () => {
    publication.servers = [{ name: 'Lira', host: 'p01--lira--tj9yvq5j5cgs.code.run' }]
    openRoomPopover()
    const container = screen.getByLabelText('Servidores de publicação')
    const badge = screen.getByLabelText('Sala publicada em Lira')
    expect(container).toBeTruthy()
    expect(badge.className).not.toContain('hidden')
    expect(badge.className).not.toContain('min-[1800px]')

    cleanup()
    publication.servers = []
    openRoomPopover()
    const pending = screen.getByText('Aguardando publicação')
    expect(pending.className).not.toContain('min-[1800px]')
  })

  it('hides publication services when the room becomes private or is left', () => {
    publication.servers = [{ name: 'Lira', host: 'p01--lira--tj9yvq5j5cgs.code.run' }]
    useGameStore.setState({ isRoomPublic: false })
    openRoomPopover()
    expect(screen.queryByLabelText(/Sala publicada em/)).toBeNull()
    expect(screen.queryByText('Aguardando publicação')).toBeNull()

    cleanup()
    useGameStore.setState({ roomId: null, isRoomPublic: true })
    openRoomPopover()
    expect(screen.queryByLabelText(/Sala publicada em/)).toBeNull()
    expect(screen.queryByText('Aguardando publicação')).toBeNull()
  })
})
