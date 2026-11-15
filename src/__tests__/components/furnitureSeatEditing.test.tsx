import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CustomElementModal } from '../../editor/CustomElementModal'
import { CompositionStudio } from '../../editor/custom-element/CompositionStudio'
import { AssetDrawingStudio } from '../../editor/custom-element/AssetDrawingStudio'
import { AnimationTimeline } from '../../editor/custom-element/AnimationTimeline'
import { AssetPropertiesForm } from '../../editor/custom-element/AssetPropertiesForm'
import { bakeLayersToDataUrl } from '../../utils/imageResize'
import { resizeDrawingLayer } from '../../editor/custom-element/resizeDrawingLayer'
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
vi.mock('../../editor/custom-element/resizeDrawingLayer', () => ({ resizeDrawingLayer: vi.fn(async (_source, width, height) => ({ dataUrl: 'resized-raster', width, height })) }))

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

afterEach(() => { vi.mocked(bakeLayersToDataUrl).mockImplementation(async () => 'frame'); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('furniture seat authoring', () => {
  it('changes the final map size without changing the drawing resolution or source pixels', async () => {
    const properties = () => elements(tree).find(element => element.type === AssetPropertiesForm)!.props as React.ComponentProps<typeof AssetPropertiesForm>
    expect(properties().canvasWidth).toBe(64)
    properties().onSetPixelSize(128, 192); render()
    expect(properties().canvasWidth).toBe(64)
    expect(properties().canvasHeight).toBe(64)
    elements(tree).find(element => element.props.role === 'tab' && (element.props.children as any[]).includes('Desenhar'))!.props.onClick(); render()
    const drawing = elements(tree).find(element => element.type === AssetDrawingStudio)!.props
    expect(drawing.width).toBe(64)
    expect(drawing.source).toBe('frame')
    const saved = await save()
    expect(saved.pixelWidth).toBe(128)
    expect(saved.pixelHeight).toBe(192)
    expect((saved.frameLayers?.[0][0] as any).origWidth).toBe(64)
  })
  it('changes the drawing canvas independently and preserves its size when reopened', async () => {
    const properties = () => elements(tree).find(element => element.type === AssetPropertiesForm)!.props as React.ComponentProps<typeof AssetPropertiesForm>
    await properties().onSetCanvasSize(96, 128); render()
    expect(properties().canvasWidth).toBe(96)
    expect(properties().canvasHeight).toBe(128)
    expect(properties().pixelWidth).toBe(64)
    expect(properties().pixelHeight).toBe(64)
    expect(resizeDrawingLayer).toHaveBeenCalledWith('frame', 96, 128, undefined)
    const saved = await save()
    expect(saved.frameLayers?.[0][0]).toMatchObject({ dataUrl: 'resized-raster', origWidth: 96, origHeight: 128 })
    expect(saved.frameLayers?.[0][0]).toMatchObject({ width: 48, height: 64 })
    mocks.store.editingAssetId = 'reopened'
    mocks.store.getAssetById = () => ({ ...saved, id: 'reopened' })
    render()
    expect(properties().canvasWidth).toBe(96)
    expect(properties().pixelWidth).toBe(64)
  })
  it('saves the full raster per layer and restores it when resizing a reopened drawing', async () => {
    const properties = () => elements(tree).find(element => element.type === AssetPropertiesForm)!.props as React.ComponentProps<typeof AssetPropertiesForm>
    const preservedRaster = { dataUrl: 'full-original', width: 64, height: 64, x: 0, y: 0 }
    vi.mocked(resizeDrawingLayer).mockResolvedValueOnce({ dataUrl: 'cropped', width: 16, height: 24, preservedRaster })
    await properties().onSetCanvasSize(16, 24); render()
    const saved = await save()
    expect(saved.frameLayers?.[0][0]).toMatchObject({ dataUrl: 'cropped', preservedRaster })
    mocks.store.editingAssetId = 'reopened'
    mocks.store.getAssetById = () => ({ ...JSON.parse(JSON.stringify(saved)), id: 'reopened' })
    render()
    elements(tree).find(element => element.props.role === 'tab' && (element.props.children as any[]).includes('Desenhar'))!.props.onClick(); render()
    expect(elements(tree).find(element => element.type === AssetDrawingStudio)!.props.preservedRaster).toEqual(preservedRaster)
    await properties().onSetCanvasSize(64, 64); render()
    expect(resizeDrawingLayer).toHaveBeenLastCalledWith('cropped', 64, 64, preservedRaster)
  })
  it('keeps the existing image and both sizes when resizing the canvas fails', async () => {
    vi.mocked(resizeDrawingLayer).mockRejectedValueOnce(new Error('Sem memória para redimensionar a tela.'))
    const properties = () => elements(tree).find(element => element.type === AssetPropertiesForm)!.props as React.ComponentProps<typeof AssetPropertiesForm>
    await properties().onSetCanvasSize(128, 128); render()
    expect(properties().canvasWidth).toBe(64)
    expect(properties().pixelWidth).toBe(64)
    expect(elements(tree).find(element => element.props.role === 'alert')?.props.children).toContain('Sem memória')
    expect((await save()).frameLayers?.[0][0].dataUrl).toBe('frame')
  })
  it('keeps pixel edits in the selected animation frame while preserving layers and directional seat/collision metadata', async () => {
    const base = (id: string, dataUrl: string) => ({ id, clipId: id, name: id, dataUrl, x: 0, y: 0, width: 29, height: 27, flipH: false, opacity: 1 })
    mocks.store.editingAssetId = 'layered'
    mocks.store.getAssetById = () => ({ id: 'layered', name: 'Pedra', type: 'furniture', category: 'Geral', width: 29 / 32, height: 27 / 32,
      pixelWidth: 29, pixelHeight: 27, frames: ['first', 'second'], frameLayers: [[base('base1', 'first')], [base('base2', 'second')]],
      directionalFrames: { down: ['first', 'second'], left: ['left'] },
      collisionGrid: [[true]], directionalCollisionGrids: { down: [[true]], left: [[true]] }, seatGrid: [[true]], directionalSeatGrids: { down: [[true]], left: [[true]] }, frameRateMs: 320,
    })
    render()
    const timeline = () => elements(tree).find(element => element.type === AnimationTimeline)!.props as React.ComponentProps<typeof AnimationTimeline>
    timeline().setSelectedFrameIdx(1); render()
    const drawTab = elements(tree).find(element => element.props.role === 'tab' && elements(element.props.children).some(child => child.type === 'svg') === false && (element.props.children as any[]).includes('Desenhar'))!
    drawTab.props.onClick(); render()
    const drawing = () => elements(tree).find(element => element.type === AssetDrawingStudio)!.props as React.ComponentProps<typeof AssetDrawingStudio>
    expect(drawing().source).toBe('second')
    drawing().onChange({ dataUrl: 'painted-second', width: 29, height: 27 }); render()
    timeline().setSelectedFrameIdx(0); render()
    expect(drawing().source).toBe('first')
    const saved = await save()
    expect(saved.frameLayers?.[0][0].dataUrl).toBe('first')
    expect(saved.frameLayers?.[1][0].dataUrl).toBe('painted-second')
    expect(saved.directionalFrameLayers?.left?.[0][0].dataUrl).toBe('left')
    expect(saved.seatGrid).toEqual([[true]])
    expect(saved.collisionGrid).toEqual([[true]])
    expect(saved.frameRateMs).toBe(320)
    expect(saved.pixelWidth).toBe(29)
  })
  it('preserves the obstacle behavior of older assets without explicit collision grids', async () => {
    mocks.store.editingAssetId = 'old-obstacle'
    mocks.store.getAssetById = () => ({ id: 'old-obstacle', name: 'Parede de pedra', type: 'furniture', category: 'Geral', width: 1, height: 1, pixelWidth: 29, pixelHeight: 27, isObstacle: true, frames: ['stone'] })
    render()
    expect((await save()).isObstacle).toBe(true)
  })
  it('uses the first drawn direction as the base size when no front frame exists', async () => {
    mocks.store.editingAssetId = 'left-only'
    mocks.store.getAssetById = () => ({ id: 'left-only', name: 'Planta', type: 'furniture', category: 'Geral', width: 2, height: 2, frames: [] })
    render()
    studio().onSelectDirection!('left'); render()
    elements(tree).find(element => element.type === AssetPropertiesForm)!.props.onSetPixelSize(23, 27); render()
    elements(tree).find(element => element.props.role === 'tab' && (element.props.children as any[]).includes('Desenhar'))!.props.onClick(); render()
    elements(tree).find(element => element.type === AssetDrawingStudio)!.props.onChange({ dataUrl: 'left-drawing', width: 23, height: 27 }); render()
    const saved = await save()
    expect(saved.pixelWidth).toBe(23)
    expect(saved.pixelHeight).toBe(27)
  })
  it('keeps front collision active when saving from a different direction with no blocked tiles', async () => {
    mocks.store.editingAssetId = 'direction-collision'
    mocks.store.getAssetById = () => ({ id: 'direction-collision', name: 'Cadeira', type: 'furniture', category: 'Geral', width: 1, height: 1,
      frames: ['front'], directionalFrames: { down: ['front'], left: ['left'] }, collisionGrid: [[true]], directionalCollisionGrids: { down: [[true]], left: [[false]] } })
    render()
    studio().onSelectDirection!('left'); render()
    const saved = await save()
    expect(saved.isObstacle).toBe(true)
    expect(saved.collisionGrid).toEqual([[true]])
    expect(saved.directionalCollisionGrids?.left).toEqual([[false]])
  })
  it('saves the new drawing even when the composition image cache still holds the old raster', async () => {
    vi.stubGlobal('Image', class {
      src = ''; complete = true; naturalWidth = 29; naturalHeight = 27
      set onload(callback: () => void) { if (this.src === 'old-raster') callback() }
    })
    vi.mocked(bakeLayersToDataUrl).mockImplementation(async (_w, _h, layers, cache) => cache?.[layers[0]?.id || '']?.src || layers[0]?.dataUrl || '')
    mocks.store.editingAssetId = 'cache-case'
    mocks.store.getAssetById = () => ({ id: 'cache-case', name: 'Pedra', type: 'furniture', category: 'Geral', width: 1, height: 1, frames: ['old-raster'] })
    render()
    elements(tree).find(element => element.props.role === 'tab' && (element.props.children as any[]).includes('Desenhar'))!.props.onClick(); render()
    const drawing = elements(tree).find(element => element.type === AssetDrawingStudio)!.props as React.ComponentProps<typeof AssetDrawingStudio>
    drawing.onChange({ dataUrl: 'new-raster', width: 29, height: 27 }); render()
    expect((await save()).frames[0]).toBe('new-raster')
    vi.mocked(bakeLayersToDataUrl).mockImplementation(async () => 'frame')
  })
  it('keeps pixel and tile dimensions consistent for sizes smaller than one tile', async () => {
    const properties = () => elements(tree).find(element => element.type === AssetPropertiesForm)!.props as React.ComponentProps<typeof AssetPropertiesForm>
    properties().onSetPixelSize(29, 27); render()
    expect(properties().tileWidth).toBe(29 / 32)
    expect(properties().tileHeight).toBe(27 / 32)
    properties().onSetBoardSizeInTiles(23 / 32, 27 / 32); render()
    expect(properties().pixelWidth).toBe(23)
    expect((await save()).pixelWidth).toBe(23)
  })
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
