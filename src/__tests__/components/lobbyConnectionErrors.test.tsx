import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LobbyModal } from '../../components/LobbyModal'
import { PeerManager } from '../../p2p/PeerManager'
import { MediaManager } from '../../media/MediaManager'
import { useGameStore } from '../../store/useGameStore'

const captured = vi.hoisted(() => ({ props: {} as any, state: [] as unknown[] }))
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>()
  return { ...actual, useState: (initial: unknown) => {
    const [value, setValue] = actual.useState(initial === 'connect' ? 'available_rooms' : initial)
    return [value, (next: unknown) => { captured.state.push(next); setValue(next) }]
  } }
})
vi.mock('../../components/lobby/PublicRoomsTab', () => ({
  PublicRoomsTab: (props: unknown) => { captured.props = props; return null },
}))
vi.mock('../../store/useGameStore', async importOriginal => {
  const actual = await importOriginal<typeof import('../../store/useGameStore')>()
  return { ...actual, useGameStore: Object.assign(
    (selector?: (state: ReturnType<typeof actual.useGameStore.getState>) => unknown) =>
      selector ? selector(actual.useGameStore.getState()) : actual.useGameStore.getState(),
    actual.useGameStore,
  ) }
})

const originalGame = useGameStore.getState()
const message = 'Não foi possível estabelecer conexão com o anfitrião. A rede pode estar bloqueando a conexão.'

beforeEach(() => {
  captured.state = []
  useGameStore.setState({ localPlayer: { ...originalGame.localPlayer, name: 'Guest' } })
  vi.spyOn(PeerManager.getInstance(), 'joinRoom').mockRejectedValue(new Error(message))
  vi.spyOn(MediaManager.getInstance(), 'startMedia').mockResolvedValue(undefined)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.restoreAllMocks(); useGameStore.setState(originalGame) })

describe('joining a space from the lobby', () => {
  it.each(['public room', 'room code'])('preserves the connection diagnosis for a %s', async entry => {
    const onJoined = vi.fn()
    renderToStaticMarkup(<LobbyModal onJoined={onJoined} onOpenAvatarCustomizer={() => {}} />)
    if (entry === 'public room') {
      await captured.props.handleJoinPublicRoom({ code: 'ROOM', name: 'Test space' })
    } else {
      await captured.props.handleJoinByCode('ROOM')
    }
    expect(PeerManager.getInstance().joinRoom).toHaveBeenCalledOnce()
    expect(captured.state).toContain(message)
    expect(onJoined).not.toHaveBeenCalled()
  })
})
