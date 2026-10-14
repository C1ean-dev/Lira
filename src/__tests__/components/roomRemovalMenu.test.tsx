import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ParticipantContextMenu } from '../../components/grid/ParticipantContextMenu'
import { useGameStore } from '../../store/useGameStore'
import { useMapStore } from '../../store/useMapStore'
import { OnlineUsersMenu } from '../../components/OnlineUsersMenu'

vi.mock('../../store/useGameStore', async importOriginal => {
  const original = await importOriginal<typeof import('../../store/useGameStore')>()
  const hook = Object.assign((select?: any) => select ? select(original.useGameStore.getState()) : original.useGameStore.getState(), original.useGameStore)
  return { ...original, useGameStore: hook }
})
vi.mock('../../store/useMapStore', async importOriginal => {
  const original = await importOriginal<typeof import('../../store/useMapStore')>()
  const hook = Object.assign((select?: any) => select ? select(original.useMapStore.getState()) : original.useMapStore.getState(), original.useMapStore)
  return { ...original, useMapStore: hook }
})

vi.mock('../../p2p/PeerManager', () => ({ PeerManager: { getInstance: vi.fn() } }))
vi.mock('../../media/MediaManager', () => ({ MediaManager: { getInstance: vi.fn() } }))
const user = { id: 'target', name: 'Participante', isLocal: false, shirtColor: '#fff' } as any

describe('remove room participant menu', () => {
  beforeEach(() => {
    const local = useGameStore.getState().localPlayer
    useGameStore.setState({ localPlayer: { ...local, id: 'local', role: 'admin', isOwner: false, currentZoneId: 'room' }, remotePlayers: { target: { ...local, id: 'target', role: 'member', isOwner: false, isHost: false, currentZoneId: 'room' } } })
    useMapStore.setState({ mapData: { ...useMapStore.getState().mapData, zones: [{ id: 'room', name: 'Sala', x: 3, y: 3, width: 5, height: 5, color: '#fff' }] } })
    vi.stubGlobal('window', { innerWidth: 1000, innerHeight: 800 })
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
  const render = () => renderToStaticMarkup(<ParticipantContextMenu user={user} x={10} y={10} onClose={vi.fn()} />)
  it('offers corridor removal to an administrator', () => {
    expect(render()).toContain('Remover da sala')
    expect(render()).toContain('Move este participante para o corredor')
  })
  it('does not offer removal to ordinary members or for the space owner', () => {
    useGameStore.getState().setLocalPlayer({ role: 'member' })
    expect(render()).not.toContain('Remover da sala')
    useGameStore.getState().setLocalPlayer({ role: 'admin' })
    useGameStore.getState().updateRemotePlayer('target', { role: 'owner' })
    expect(render()).not.toContain('Remover da sala')
  })

  it('also lets administrators remove a participant through the online people list', () => {
    useGameStore.setState({ isOnlineUsersOpen: true })
    const html = renderToStaticMarkup(<OnlineUsersMenu />)
    expect(html).toContain('title="Remover da sala"')
    expect(html).not.toContain('será desconectado imediatamente')
  })
})
