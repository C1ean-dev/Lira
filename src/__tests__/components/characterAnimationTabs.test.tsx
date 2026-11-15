import React from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { CharacterAnimationTabs } from '../../components/avatar-customizer/CharacterAnimationTabs'
import type { SlicedPreset } from '../../components/avatar-customizer/AvatarSpritesheetSlicerModal'
const hooks = vi.hoisted(() => ({ state: vi.fn() }))
vi.mock('react', async original => ({ ...await original<typeof import('react')>(), useState: hooks.state }))
let slots: any[], cursor: number, preset: SlicedPreset, active: string, tree: React.ReactNode
function elements(node: React.ReactNode): React.ReactElement[] { return Array.isArray(node) ? node.flatMap(elements) : React.isValidElement(node) ? [node, ...elements(node.props.children)] : [] }
const find = (label: string) => elements(tree).find(node => node.props['aria-label'] === label)!
function render() { cursor = 0; tree = CharacterAnimationTabs({ preset, activeAnimation: active, onSelect: id => { active = id }, onChange: next => { preset = next } }) }
function name(value: string) { find('Nome da animação').props.onChange({ target: { value } }); render(); elements(tree).find(node => node.type === 'form')!.props.onSubmit({ preventDefault: vi.fn() }); render() }
beforeEach(() => {
  slots = []; active = 'walk'; preset = { id: 'one', name: 'Hero', directions: { down: [], up: [], left: [], right: [] } }
  hooks.state.mockImplementation((initial: any) => { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], (value: any) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value }] })
  render()
})
it('creates and renames a freely named activity, preserving its frames, then deletes it', () => {
  find('Nova animação').props.onClick(); render(); name('Acenar oi! 👋')
  const id = active
  expect(id).not.toBe('walk')
  expect(preset.animationNames![id]).toBe('Acenar oi! 👋')
  const frame = { x: 0, y: 0, w: 16, h: 32, dataUrl: 'wave' }
  preset.animations![id] = [frame]; render()
  find('Renomear animação').props.onClick(); render(); name('Olá & até logo!')
  expect(active).toBe(id)
  expect(preset.animationNames![id]).toBe('Olá & até logo!')
  expect(preset.animations![id]).toEqual([frame])
  find('Excluir animação').props.onClick(); render()
  expect(active).toBe('walk')
  expect(preset.animations![id]).toBeUndefined()
})
it('shows validation errors without modifying or losing the current sequence', () => {
  find('Nova animação').props.onClick(); render(); name('  ')
  expect(elements(tree).some(node => node.props.role === 'alert')).toBe(true)
  name('Dormir')
  expect(elements(tree).some(node => node.props.role === 'alert')).toBe(true)
  expect(active).toBe('walk')
  expect(preset.animations).toBeUndefined()
})
