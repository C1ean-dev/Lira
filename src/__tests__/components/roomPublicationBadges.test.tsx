import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

const renderBar = () => renderToStaticMarkup(<TopNavBar onOpenAvatarModal={() => {}} />)

describe('room publication in the navigation bar', () => {
  beforeEach(() => {
    useGameStore.setState({ roomId: 'TEST', isRoomPublic: true, isOwner: true, signalingTier: 'render' })
    publication.servers = []
  })

  it('shows every service advertising the public room instead of the P2P signaling tier', () => {
    publication.servers = [
      { name: 'EMQX', host: 'broker.emqx.io' },
      { name: 'HiveMQ', host: 'broker.hivemq.com' },
      { name: 'Render', host: 'lira-signaling.onrender.com' },
      { name: 'RabbitMQ', host: 'jaragua.lmq.cloudamqp.com' },
    ]
    const html = renderBar()
    for (const server of publication.servers) {
      expect(html).toContain(`aria-label="Sala publicada em ${server.name}"`)
      expect(html).toContain(`title="${server.host}"`)
    }
    expect(html).not.toContain('Servidor de sinalização P2P ativo')
  })

  it('shows a pending state when the room has no active publication', () => {
    expect(renderBar()).toContain('Aguardando publicação')
  })

  it('hides publication services when the room becomes private or is left', () => {
    publication.servers = [{ name: 'Render', host: 'lira-signaling.onrender.com' }]
    useGameStore.setState({ isRoomPublic: false })
    expect(renderBar()).not.toContain('Sala publicada em')
    expect(renderBar()).not.toContain('Aguardando publicação')
    useGameStore.setState({ roomId: null, isRoomPublic: true })
    expect(renderBar()).not.toContain('Sala publicada em')
  })
})
