import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OnlineUsersMenu } from '../../components/OnlineUsersMenu'
import { useGameStore } from '../../store/useGameStore'

vi.mock('../../components/common/PlayerAvatar', () => ({ PlayerAvatar: () => <span /> }))
const controls = vi.hoisted(() => ({ index: 0, pending: null as string | null, failure: null as string | null }))
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>()
  const useState = (initial: any) => {
    const slot = controls.index++
    const value = slot === 2 ? Object.keys(useGameStore.getState().remotePlayers)[0]
      : slot === 5 ? controls.pending : slot === 6 ? controls.failure : typeof initial === 'function' ? initial() : initial
    return [value, vi.fn()]
  }
  return { ...actual, useState, default: { ...actual.default, useState } }
})
vi.mock('../../store/useGameStore', async importOriginal => {
  const actual = await importOriginal<typeof import('../../store/useGameStore')>()
  const hook = Object.assign((selector?: (state: ReturnType<typeof actual.useGameStore.getState>) => unknown) =>
    selector ? selector(actual.useGameStore.getState()) : actual.useGameStore.getState(), actual.useGameStore)
  return { ...actual, useGameStore: hook }
})
const HOST = 'lira-ROOM-host'
const TARGET = 'lira-ROOM-peer-target'
const original = useGameStore.getState()

beforeEach(() => {
  vi.spyOn(console, 'debug').mockImplementation(() => {})
  controls.pending = null; controls.failure = null
  const base = { ...original.localPlayer, x: 0, y: 0, isOwner: false, isHost: false, role: 'member' as const }
  useGameStore.setState({
    isOnlineUsersOpen: true, isOwner: true, isHost: true, connectionHostId: HOST,
    localPlayer: { ...base, id: HOST, gameId: 'owner', name: 'Owner', isOwner: true, isHost: true, role: 'owner' },
    remotePlayers: { [TARGET]: { ...base, id: TARGET, gameId: 'target', name: 'Target' } },
  })
})
afterEach(() => { useGameStore.setState(original); vi.restoreAllMocks() })
const render = () => { controls.index = 0; return renderToStaticMarkup(<OnlineUsersMenu />) }
const transferButton = (html: string) => (html.match(/<button\b[^>]*>.*?<\/button>/gs) || []).find(button => /Tornar Host|Transferindo|Host de Conexão Ativo/.test(button))!

describe('manual host transfer controls', () => {
  it('shows the pending transfer without announcing an active host or allowing duplicate requests', () => {
    controls.pending = TARGET
    const html = render()
    const button = transferButton(html)
    expect(button).toContain('Transferindo')
    expect(button).toContain('disabled=""')
    expect(html).not.toContain('Host de Conexão Ativo')
  })

  it('shows a failed transfer and keeps the original host indicator', () => {
    controls.failure = 'O participante não confirmou a transferência.'
    const html = render()
    expect(html).toContain('role="alert"')
    expect(html).toContain(controls.failure)
    expect(transferButton(html)).toContain('Tornar Host de Conexão')
    expect(html).not.toContain('Host de Conexão Ativo')
  })

  it('keeps the room owner separate from the confirmed connection host on both screens', () => {
    const owner = { ...useGameStore.getState().localPlayer, id: 'lira-ROOM-peer-owner', isHost: false }
    const target = { ...useGameStore.getState().remotePlayers[TARGET], id: HOST, isHost: true, role: 'host' as const }
    useGameStore.setState({ localPlayer: owner, isHost: false, remotePlayers: { [HOST]: target } })
    const html = render()
    expect(html.match(/>Dono<\//g)).toHaveLength(1)
    expect(html).toContain('Host de Conexão')
    expect(transferButton(html)).toContain('disabled=""')
  })
})
