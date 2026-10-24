import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TopNavBar } from '../../components/TopNavBar'
import { useGameStore } from '../../store/useGameStore'
import { PublicRoomsService } from '../../services/publicRoomsService'

vi.mock('../../hooks/useRoomPublication', () => ({ useRoomPublication: () => [] }))
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>()
  // Render the mobile menu too, without starting an app or browser.
  return { ...actual, useState: (initial: unknown) => actual.useState(initial === false ? true : initial) }
})
vi.mock('../../store/useGameStore', async importOriginal => {
  const actual = await importOriginal<typeof import('../../store/useGameStore')>()
  return { ...actual, useGameStore: Object.assign(
    (selector: (state: ReturnType<typeof actual.useGameStore.getState>) => unknown) => selector(actual.useGameStore.getState()),
    actual.useGameStore,
  ) }
})

function privacyButtons() {
  let tree: React.ReactNode
  function Probe() { tree = TopNavBar({ onOpenAvatarModal: () => {} }); return null }
  renderToStaticMarkup(<Probe />)
  const buttons: React.ReactElement<any>[] = []
  function visit(node: React.ReactNode) {
    React.Children.forEach(node, child => {
      if (!React.isValidElement(child)) return
      const props = child.props as any
      if (child.type === 'button' && (/Sala (Pública|Privada)|Esta sala está/.test(props.title ?? '') ||
        React.Children.toArray(props.children).some((c: any) => React.isValidElement(c) && JSON.stringify((c.props as any).children)?.includes('Privacidade da Sala')))) buttons.push(child)
      visit(props.children)
    })
  }
  visit(tree!)
  return buttons
}

describe('room privacy permissions', () => {
  afterEach(() => vi.restoreAllMocks())
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(PublicRoomsService, 'getInstance').mockReturnValue({ startHosting: vi.fn(), stopHosting: vi.fn() } as any)
    useGameStore.setState({ roomId: 'PRIVACY-TEST', isRoomPublic: false, isOwner: false, isHost: true })
  })

  it('lets the current host who did not create the room change privacy from desktop and mobile', () => {
    const buttons = privacyButtons()
    expect(buttons).toHaveLength(2)
    for (const button of buttons) {
      useGameStore.setState({ isRoomPublic: false })
      expect(button.props.disabled).not.toBe(true)
      expect(button.props.onClick).toBeTypeOf('function')
      button.props.onClick()
      expect(useGameStore.getState().isRoomPublic).toBe(true)
      button.props.onClick()
      expect(useGameStore.getState().isRoomPublic).toBe(false)
    }
  })

  it.each([false, true])('does not offer changes to a non-host, including a former owner=%s', isOwner => {
    useGameStore.setState({ isHost: false, isOwner })
    const buttons = privacyButtons()
    expect(buttons).toHaveLength(1)
    expect(buttons[0].props.disabled).toBe(true)
    expect(buttons[0].props.onClick).toBeUndefined()
    useGameStore.getState().toggleRoomPrivacy()
    expect(useGameStore.getState().isRoomPublic).toBe(false)
  })
})
