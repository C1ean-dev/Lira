import '../helpers/mockAssetPersistence'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { BedInteractionPrompt } from '../../components/BedInteractionPrompt'
import { useGameStore } from '../../store/useGameStore'
import { useBedStore, type BedSession } from '../../store/useBedStore'
const controls = vi.hoisted(() => ({ respondToBedInvitation: vi.fn(), handleBedInteractionKey: vi.fn(), cancelBedInteraction: vi.fn() }))
vi.mock('../../store/useGameStore', async importOriginal => {
  const original = await importOriginal<typeof import('../../store/useGameStore')>()
  return { ...original, useGameStore: Object.assign((select: any) => select(original.useGameStore.getState()), original.useGameStore) }
})
vi.mock('../../store/useBedStore', async importOriginal => {
  const original = await importOriginal<typeof import('../../store/useBedStore')>()
  return { ...original, useBedStore: Object.assign((select: any) => select(original.useBedStore.getState()), original.useBedStore) }
})
vi.mock('../../services/bedInteraction', () => ({ ...controls,
  getLocalBed: () => ({ furniture: { id: 'bed' } }), startBedInteractionLifecycle: () => () => {},
}))
const game = useGameStore.getState()
const session = (change = {}): BedSession => ({ id: 'invite', roomId: 'space', furnitureId: 'bed', initiatorId: 'a', targetId: 'b', createdAt: Date.now(), stage: 'invited', ...change })
beforeEach(() => {
  vi.clearAllMocks()
  useGameStore.setState({ localPlayer: { ...game.localPlayer, id: 'b' }, remotePlayers: { a: { ...game.localPlayer, id: 'a', name: 'Ana' } } })
  useBedStore.setState({ sessions: { bed: session() } })
})
afterEach(() => { useGameStore.setState(game); useBedStore.setState({ sessions: {} }) })
function buttons() {
  let tree: React.ReactNode
  function Probe() { tree = BedInteractionPrompt(); return null }
  renderToStaticMarkup(<Probe />)
  const result: React.ReactElement[] = []
  function visit(node: React.ReactNode) { React.Children.forEach(node, child => {
    if (!React.isValidElement(child)) return
    if (child.type === 'button') result.push(child)
    visit((child.props as any).children)
  }) }
  visit(tree!)
  return result
}
it('shows a personal invitation with explicit accept and decline buttons', () => {
  const html = renderToStaticMarkup(<BedInteractionPrompt />)
  expect(html).toContain('Ana')
  expect(html).toContain('Aceitar')
  expect(html).toContain('Recusar')
  const choices = buttons()
  choices.forEach(button => (button.props as any).onClick())
  expect(controls.respondToBedInvitation.mock.calls).toEqual([[true], [false]])
})
it('lets either participant stop the scene and shows the waiting state to its sender', () => {
  useBedStore.setState({ sessions: { bed: session({ stage: 'active', acceptedAt: Date.now() }) } })
  expect(renderToStaticMarkup(<BedInteractionPrompt />)).toContain('Encerrar')
  ;(buttons()[0].props as any).onClick()
  expect(controls.cancelBedInteraction).toHaveBeenCalledOnce()
  useGameStore.setState({ localPlayer: { ...game.localPlayer, id: 'a' } })
  useBedStore.setState({ sessions: { bed: session() } })
  const html = renderToStaticMarkup(<BedInteractionPrompt />)
  expect(html).toContain('Aguardando')
  expect(html).not.toContain('Aceitar')
})
