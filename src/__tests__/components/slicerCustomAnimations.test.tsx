import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AvatarSpritesheetSlicerModal } from '../../components/avatar-customizer/AvatarSpritesheetSlicerModal'
import { CharacterAnimationTabs } from '../../components/avatar-customizer/CharacterAnimationTabs'
import { AvatarPixelArtModal } from '../../editor/avatar/AvatarPixelArtModal'
import { avatarAnimationOptions } from '../../utils/avatarAnimationOptions'
import type { CustomAsset } from '../../types/customAsset'
const mocks = vi.hoisted(() => ({ state: vi.fn(), ref: vi.fn(), update: vi.fn(), asset: {} as CustomAsset }))
vi.mock('react', async original => ({ ...await original<typeof import('react')>(), useState: mocks.state, useRef: mocks.ref, useEffect: () => {}, useCallback: (fn: any) => fn }))
vi.mock('../../store/useCustomAssetsStore', () => ({ useCustomAssetsStore: { getState: () => ({ updateCustomAsset: mocks.update, customAssets: [mocks.asset] }) } }))
vi.mock('../../store/useGameStore', () => ({ useGameStore: { getState: () => ({ localPlayer: { avatar: {} }, setLocalPlayer: vi.fn() }) } }))
vi.mock('../../engine/avatar/avatarBakeService', () => ({ cropContentDataUrl: async () => 'thumb' }))
let slots: any[], cursor: number, tree: React.ReactNode
const complete = vi.fn()
const slot = (url: string) => ({ x: 0, y: 0, w: 16, h: 32, dataUrl: url })
function elements(node: React.ReactNode): React.ReactElement[] { return Array.isArray(node) ? node.flatMap(elements) : React.isValidElement(node) ? [node, ...elements(node.props.children)] : [] }
const tabs = () => elements(tree).find(node => node.type === CharacterAnimationTabs)!.props as React.ComponentProps<typeof CharacterAnimationTabs>
function render() { cursor = 0; tree = AvatarSpritesheetSlicerModal({ isOpen: true, imageSrc: 'sheet.png', category: 'other', editingAsset: mocks.asset, onClose: vi.fn(), onSaveComplete: complete }) }
async function save() { const button = elements(tree).find(node => node.type === 'button' && elements(node.props.children).some(child => typeof child.props.children === 'string' && child.props.children.startsWith('Salvar Alterações')))!
  await button.props.onClick(); return mocks.update.mock.calls.at(-1)![1] }
beforeEach(() => {
  vi.useFakeTimers(); slots = []; mocks.update.mockClear(); complete.mockClear()
  mocks.asset = { id: 'hero', name: 'Hero', type: 'avatar', avatarSlot: 'other', category: 'Geral', width: 1, height: 1, frames: ['walking'], isObstacle: false, createdAt: 1,
    slicerPresets: [{ id: 'hero', name: 'Hero', directions: { down: [slot('walking')], up: [], left: [], right: [] }, animations: { yawn: [slot('yawn')] } }] }
  mocks.state.mockImplementation((initial: any) => { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], (value: any) => { slots[i] = typeof value === 'function' ? value(slots[i]) : value }] })
  mocks.ref.mockImplementation((initial: any) => { const i = cursor++; return slots[i] ?? (slots[i] = { current: initial }) })
  render()
})
afterEach(() => vi.useRealTimers())
it('saves a named custom sequence, exposes it in the mini display, and reopens its editable frames', async () => {
  tabs().onChange({ ...tabs().preset, animations: { ...tabs().preset.animations, custom: [slot('wave1'), slot('wave2')] }, animationNames: { custom: 'Acenar oi! 👋' } }); render()
  tabs().onSelect('custom'); render()
  expect(elements(tree).some(node => node.props.children === 'Frames de Acenar oi! 👋:')).toBe(true)
  const change = await save()
  expect(change.activityAnimations).toEqual({ yawn: ['yawn'], custom: ['wave1', 'wave2'] })
  expect(change.activityAnimationNames).toEqual({ custom: 'Acenar oi! 👋' })
  expect(avatarAnimationOptions({ customAvatarId: 'hero' } as any, [{ ...mocks.asset, ...change }])).toContainEqual({ id: 'custom', label: 'Acenar oi! 👋', emoji: '🎭' })
  mocks.asset = { ...mocks.asset, ...JSON.parse(JSON.stringify(change)) }; slots = []; render()
  expect(tabs().preset.animations!.custom.map(frame => frame.dataUrl)).toEqual(['wave1', 'wave2'])
  expect(tabs().preset.animationNames!.custom).toBe('Acenar oi! 👋')
})

it('paints a custom sequence without losing its name or other animations', async () => {
  tabs().onChange({ ...tabs().preset, animations: { ...tabs().preset.animations, custom: [slot('old-wave')] }, animationNames: { custom: 'Minha dança 💃' } }); render()
  tabs().onSelect('custom'); render()
  elements(tree).find(node => node.props.title === 'Pintar e editar os pixels deste personagem no Estúdio Pixel Art')!.props.onClick(); render()
  const studio = elements(tree).find(node => node.type === AvatarPixelArtModal)!.props
  expect(studio.singleSequence).toBe(true)
  await studio.onSave({ down: ['painted1', 'painted2'], up: [], left: [], right: [] }, 'Hero', { pixelWidth: 16, pixelHeight: 32 })
  const change = mocks.update.mock.calls.at(-1)![1]
  expect(change.activityAnimations).toEqual({ yawn: ['yawn'], custom: ['painted1', 'painted2'] })
  expect(change.activityAnimationNames).toEqual({ custom: 'Minha dança 💃' })
  expect(change.slicerPresets[0].animationNames).toEqual(change.activityAnimationNames)
})
it('retains new animations and names when saving walking pixels from the nested editor', async () => {
  tabs().onChange({ ...tabs().preset, animations: { custom: [slot('wave')] }, animationNames: { custom: 'Acenar!' } }); render()
  elements(tree).find(node => node.props.title === 'Pintar e editar os pixels deste personagem no Estúdio Pixel Art')!.props.onClick(); render()
  const studio = elements(tree).find(node => node.type === AvatarPixelArtModal)!.props
  await studio.onSave({ down: ['new-walk'], up: [], left: [], right: [] }, 'Hero', { pixelWidth: 16, pixelHeight: 32 })
  const change = mocks.update.mock.calls.at(-1)![1]
  expect(change.activityAnimationNames).toEqual({ custom: 'Acenar!' })
  expect(change.activityAnimations).toEqual({ custom: ['wave'] })
  expect(change.slicerPresets[0].directions.down[0].dataUrl).toBe('new-walk')
})
