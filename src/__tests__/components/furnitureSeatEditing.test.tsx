import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CustomElementModal } from '../../editor/CustomElementModal'
import { CompositionStudio } from '../../editor/custom-element/CompositionStudio'
import type { CustomAsset } from '../../types/customAsset'

const mocks = vi.hoisted(() => ({
  store: {} as Record<string, any>, update: vi.fn(async () => {}),
  useState: vi.fn(), useRef: vi.fn(), useEffect: vi.fn(),
}))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState: mocks.useState, useRef: mocks.useRef, useEffect: mocks.useEffect,
}))
vi.mock('../../store/useCustomAssetsStore', () => ({ useCustomAssetsStore: () => mocks.store }))
vi.mock('../../store/useMapStore', () => ({ useMapStore: () => ({ setSelectedFurnitureDefId: vi.fn(), setActiveTool: vi.fn() }) }))
vi.mock('../../utils/imageResize', async importOriginal => ({
  ...await importOriginal<typeof import('../../utils/imageResize')>(),
  bakeLayersToDataUrl: vi.fn(async () => 'frame'), bakeLayersToDataUrlSync: vi.fn(() => 'frame'),
}))

let slots: any[]
let cursor: number
let dirty: boolean
let effects: Array<() => void>
let tree: React.ReactNode

// Execute the real editor callbacks and effects without opening an app or browser.
function render() {
  for (let pass = 0; pass < 20; pass++) {
    cursor = 0; dirty = false; effects = []
    tree = CustomElementModal({})
    effects.forEach(effect => effect())
    if (!dirty) return
  }
  throw new Error('Editor did not settle')
}
function elements(node: React.ReactNode): React.ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!React.isValidElement(node)) return []
  return [node, ...elements((node.props as any).children)]
}
const studio = () => elements(tree).find(element => element.type === CompositionStudio)!.props as React.ComponentProps<typeof CompositionStudio>
const event = (clientX: number, clientY = 16) => ({ clientX, clientY } as React.MouseEvent<HTMLCanvasElement>)
async function save() {
  const button = elements(tree).find(element => element.type === 'button' && elements((element.props as any).children).some(child => child.props.children === 'Salvar Elemento no Catálogo'))!
  await (button.props as any).onClick()
  return mocks.update.mock.calls.at(-1)![1] as CustomAsset
}

beforeEach(() => {
  slots = []; mocks.update.mockClear()
  vi.useFakeTimers()
  vi.stubGlobal('window', new EventTarget())
  vi.stubGlobal('Image', class { src = ''; complete = true; naturalWidth = 64; naturalHeight = 64 })
  mocks.useState.mockImplementation((initial: any) => {
    const index = cursor++
    if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial
    return [slots[index], (value: any) => {
      const next = typeof value === 'function' ? value(slots[index]) : value
      if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true }
    }]
  })
  mocks.useRef.mockImplementation((initial: any) => {
    const index = cursor++
    return slots[index] ?? (slots[index] = { current: initial })
  })
  mocks.useEffect.mockImplementation((effect: () => unknown, deps?: unknown[]) => {
    const index = cursor++
    const previous = slots[index]
    if (!previous || !deps || deps.some((value, i) => !Object.is(value, previous[i]))) {
      slots[index] = deps
      effects.push(() => { effect() })
    }
  })
  const asset: CustomAsset = { id: 'bench', name: 'Banco', type: 'furniture', category: 'Geral', width: 2, height: 2, isObstacle: false, frames: ['frame'], createdAt: 1 }
  mocks.store = {
    isCustomModalOpen: true, editingAssetId: asset.id, initialStudioMode: 'compose',
    getAssetById: () => asset, getAllCategories: () => ['Geral'],
    updateCustomAsset: mocks.update, setCustomModalOpen: vi.fn(),
  }
  render()
  studio().composeCanvasRef.current = { getBoundingClientRect: () => ({ left: 0, top: 0 }), getContext: () => null } as unknown as HTMLCanvasElement
})

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('furniture seat authoring', () => {
  it('paints and erases seats by dragging, keeps each direction separate, and saves the grids', async () => {
    studio().setComposeTool('seat'); render()
    studio().onComposeMouseDown(event(16)); render()
    studio().onComposeMouseMove(event(80)); render()
    studio().onComposeMouseUp(); render()
    studio().onComposeMouseDown(event(16)); render()
    studio().onComposeMouseUp(); render()
    studio().onSelectDirection!('left'); render()
    studio().onComposeMouseDown(event(16)); render()
    studio().onComposeMouseUp(); render()
    const saved = await save()
    expect(saved.seatGrid).toEqual([[false, true], [false, false]])
    expect(saved.directionalSeatGrids?.down).toEqual(saved.seatGrid)
    expect(saved.directionalSeatGrids?.left).toEqual([[true, false], [false, false]])
  })

  it('loads existing seat hitboxes, retains them when resized and clears them on request', async () => {
    mocks.store.editingAssetId = 'other-bench'
    mocks.store.getAssetById = () => ({ id: 'other-bench', type: 'furniture', name: 'Banco', category: 'Geral', width: 2, height: 2, frames: ['frame'], seatGrid: [[true, false], [false, false]], directionalSeatGrids: { down: [[true, false], [false, false]] } })
    render()
    studio().setBoardSizeInTiles(3, 2); render()
    expect((await save()).seatGrid).toEqual([[true, false, false], [false, false, false]])
    studio().onClearSeats!(); render()
    expect((await save()).seatGrid).toEqual([[false, false, false], [false, false, false]])
  })
})
