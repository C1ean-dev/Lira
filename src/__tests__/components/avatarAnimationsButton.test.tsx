import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AvatarAnimationsButton } from '../../components/AvatarAnimationsButton'
import type { CustomAsset } from '../../types/customAsset'
const mocks = vi.hoisted(() => ({ state: vi.fn(), ref: vi.fn(), effect: vi.fn(), send: vi.fn(), player: {} as any, assets: [] as CustomAsset[] }))
vi.mock('react', async original => ({ ...await original<typeof import('react')>(), useState: mocks.state, useRef: mocks.ref, useEffect: mocks.effect }))
vi.mock('react-dom', () => ({ createPortal: (node: React.ReactNode) => node }))
vi.mock('../../store/useGameStore', () => ({ useGameStore: Object.assign((select: any) => select({ localPlayer: mocks.player }), { getState: () => ({ localPlayer: mocks.player, setLocalPlayer: (change: any) => Object.assign(mocks.player, change) }) }) }))
vi.mock('../../store/useCustomAssetsStore', () => ({ useCustomAssetsStore: Object.assign((select: any) => select({ customAssets: mocks.assets }), { getState: () => ({ customAssets: mocks.assets }) }) }))
vi.mock('../../p2p/PeerManager', () => ({ PeerManager: { getInstance: () => ({ sendPlayerUpdate: mocks.send }) } }))
let slots: any[], cursor: number, effects: Array<() => void>, tree: React.ReactNode
const cleanups: Array<() => void> = []
const buttonNode = { getBoundingClientRect: () => ({ left: 300, right: 332, top: 200, bottom: 232 }), focus: vi.fn(), contains: () => false }
function elements(node: React.ReactNode): React.ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  return React.isValidElement(node) ? [node, ...elements(node.props.children)] : []
}
const find = (label: string) => elements(tree).find(node => node.props['aria-label'] === label)!
function render() {
  cursor = 0; effects = []; tree = AvatarAnimationsButton({})
  for (const element of elements(tree)) {
    const ref = (element as any).ref
    if (ref) ref.current = element.type === 'button' ? buttonNode : { contains: () => false, querySelector: () => buttonNode }
  }
  effects.forEach(effect => effect())
}
beforeEach(() => {
  slots = []; cleanups.length = 0; mocks.send.mockClear()
  mocks.player = { avatar: { customAvatarId: 'hero', otherType: 'none' }, activityAnimation: 'none' }
  mocks.assets = [{ id: 'hero', type: 'avatar', activityAnimations: { sleep: ['sleep'], yawn: ['yawn'] } } as CustomAsset]
  mocks.state.mockImplementation((initial: any) => { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], (value: any) => { slots[i] = typeof value === 'function' ? value(slots[i]) : value }] })
  mocks.ref.mockImplementation((initial: any) => { const i = cursor++; return slots[i] ?? (slots[i] = { current: initial }) })
  mocks.effect.mockImplementation((effect: any, deps: any[]) => { const i = cursor++, previous = slots[i]; if (!previous || deps.some((value, index) => value !== previous[index])) { slots[i] = deps; effects.push(() => { const cleanup = effect(); if (cleanup) cleanups.push(cleanup) }) } })
  vi.stubGlobal('window', Object.assign(new EventTarget(), { innerWidth: 800, innerHeight: 600 }))
  vi.stubGlobal('document', Object.assign(new EventTarget(), { body: {} }))
  render()
})
afterEach(() => { cleanups.forEach(cleanup => cleanup()); vi.unstubAllGlobals() })
it('opens an emoji button with every available animation, selects an action and can stop it', () => {
  expect(find('Animações do personagem').props.children).toContain('🎭')
  expect(find('Animações do personagem').props['aria-expanded']).toBe(false)
  find('Animações do personagem').props.onClick(); render()
  expect(elements(tree).some(node => node.props.children === 'Dormir')).toBe(true)
  expect(elements(tree).some(node => node.props.children === 'Bocejar')).toBe(true)
  const sleep = elements(tree).find(node => node.type === 'button' && node.props['data-animation'] === 'sleep')!
  sleep.props.onClick(); render()
  expect(mocks.player.activityAnimation).toBe('sleep')
  expect(mocks.send).toHaveBeenLastCalledWith({ activityAnimation: 'sleep', activityAnimationStartedAt: expect.any(Number) })
  expect(find('Animações do personagem').props['aria-expanded']).toBe(false)
  find('Animações do personagem').props.onClick(); render()
  find('Parar animação').props.onClick(); render()
  expect(mocks.player.activityAnimation).toBe('none')
})
it('updates the open list when animations or the selected character change', () => {
  find('Animações do personagem').props.onClick(); render()
  mocks.assets = [{ ...mocks.assets[0], activityAnimations: { ...mocks.assets[0].activityAnimations, acenar: ['wave'] } }]
  render()
  expect(elements(tree).some(node => node.props['data-animation'] === 'acenar')).toBe(true)
  mocks.player.avatar = { customAvatarId: 'missing' }; render()
  expect(elements(tree).some(node => node.props['data-animation'] === 'sleep')).toBe(false)
  expect(elements(tree).some(node => typeof node.props.children === 'string' && node.props.children.includes('ainda não tem animações'))).toBe(true)
})
it('closes with Escape or an outside click', () => {
  find('Animações do personagem').props.onClick(); render()
  document.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' })); render()
  expect(find('Animações do personagem').props['aria-expanded']).toBe(false)
  find('Animações do personagem').props.onClick(); render()
  document.dispatchEvent(new Event('pointerdown')); render()
  expect(find('Animações do personagem').props['aria-expanded']).toBe(false)
})

it('keeps the menu inside a small viewport above the mini display', () => {
  window.innerWidth = 320; window.innerHeight = 250
  find('Animações do personagem').props.onClick(); render()
  const style = find('Escolher animação do personagem').props.style
  expect(style.left).toBeGreaterThanOrEqual(8)
  expect(style.left + style.width).toBeLessThanOrEqual(312)
  expect(style.bottom).toBe(58)
  expect(style.maxHeight).toBeLessThanOrEqual(184)
})
