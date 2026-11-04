import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OnlineUsersMenu } from '../../components/OnlineUsersMenu'
import { useGameStore } from '../../store/useGameStore'

vi.mock('../../components/common/PlayerAvatar', () => ({ PlayerAvatar: () => <span data-testid="avatar" /> }))

// Helper to control useState for tabs
const stateControl = vi.hoisted(() => ({
  tab: 'all' as 'all' | 'friends' | 'roles',
}))

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  const useState = (initial: any) => {
    if (initial === 'all') {
      return [stateControl.tab, vi.fn()]
    }
    return actual.useState(initial)
  }
  return { ...actual, useState, default: { ...actual.default, useState } }
})

vi.mock('../../store/useGameStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../store/useGameStore')>()
  const hook = Object.assign(
    (selector?: (state: ReturnType<typeof actual.useGameStore.getState>) => unknown) =>
      selector ? selector(actual.useGameStore.getState()) : actual.useGameStore.getState(),
    actual.useGameStore
  )
  return { ...actual, useGameStore: hook }
})

const original = useGameStore.getState()

describe('OnlineUsersMenu - Friends Filtering and Count', () => {
  beforeEach(() => {
    stateControl.tab = 'all'
    const base = {
      ...original.localPlayer,
      x: 0,
      y: 0,
      isOwner: false,
      isHost: false,
      role: 'member' as const,
    }

    useGameStore.setState({
      isOnlineUsersOpen: true,
      friends: ['friend-1', 'friend-2', 'friend-3', 'friend-4'],
      friendProfiles: {
        'friend-1': { gameId: 'g-friend-1' },
        'friend-2': { gameId: 'g-friend-2' },
        'friend-3': { gameId: 'g-friend-3' },
        'friend-4': { gameId: 'g-friend-4' },
      },
      localPlayer: {
        ...base,
        id: 'local-clean',
        gameId: 'clean-game-id',
        name: 'clean',
        isOwner: true,
        isHost: true,
        role: 'owner',
      },
      remotePlayers: {},
    })
  })

  afterEach(() => {
    useGameStore.setState(original)
    vi.restoreAllMocks()
  })

  it('displays Amigos (0) instead of total friends count (4) when only the local player is in the space', () => {
    const html = renderToStaticMarkup(<OnlineUsersMenu />)

    expect(html).toContain('Todos (1)')
    // Must display 0 friends currently in room, NOT the total 4
    expect(html).toContain('Amigos (0)')
    expect(html).not.toContain('Amigos (4)')
  })

  it('does NOT display the local player in the Amigos tab when active', () => {
    stateControl.tab = 'friends'
    const html = renderToStaticMarkup(<OnlineUsersMenu />)

    // Local player name should not be listed as a friend in the list
    expect(html).not.toContain('clean')
    expect(html).toContain('Nenhum amigo nesta sala no momento')
  })

  it('correctly counts and displays remote friends currently in the room', () => {
    const base = {
      ...original.localPlayer,
      x: 0,
      y: 0,
      isOwner: false,
      isHost: false,
      role: 'member' as const,
    }

    useGameStore.setState({
      remotePlayers: {
        'remote-friend': {
          ...base,
          id: 'friend-1',
          gameId: 'g-friend-1',
          name: 'AmigoOnline',
        },
        'remote-stranger': {
          ...base,
          id: 'stranger-99',
          gameId: 'g-stranger',
          name: 'Estranho',
        },
      },
    })

    // In 'all' tab: 3 total participants, 1 friend in room
    stateControl.tab = 'all'
    const allHtml = renderToStaticMarkup(<OnlineUsersMenu />)
    expect(allHtml).toContain('Todos (3)')
    expect(allHtml).toContain('Amigos (1)')
    expect(allHtml).toContain('clean')
    expect(allHtml).toContain('AmigoOnline')
    expect(allHtml).toContain('Estranho')

    // In 'friends' tab: only the friend in the room is shown
    stateControl.tab = 'friends'
    const friendsHtml = renderToStaticMarkup(<OnlineUsersMenu />)
    expect(friendsHtml).toContain('AmigoOnline')
    expect(friendsHtml).not.toContain('clean')
    expect(friendsHtml).not.toContain('Estranho')
  })
})
