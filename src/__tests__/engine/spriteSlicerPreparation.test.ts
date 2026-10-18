import { afterEach, describe, expect, it, vi } from 'vitest'
import { prepareAssetForSlicer } from '../../utils/avatarAssetOrigin'
import type { CustomAsset } from '../../types/customAsset'

const { load, encode, draw, canvas } = vi.hoisted(() => ({
  load: vi.fn(), encode: vi.fn(), draw: vi.fn(), canvas: { width: 0, height: 0, getContext: vi.fn() },
}))
vi.mock('../../utils/loadRasterImage', () => ({ loadRasterImage: load }))
vi.mock('../../utils/canvasPng', () => ({ canvasToPngDataUrl: encode }))
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks() })

const asset: CustomAsset = {
  id: 'franklin_sliced', name: 'Franklin', type: 'avatar', avatarSlot: 'other', category: 'Avatares',
  creationSource: 'studio', frames: ['down.png', 'up.png', 'left.png', 'right.png'],
  directionalFrames: { down: ['down.png', 'step.png'], up: ['up.png'], left: ['left.png'], right: ['right.png'] },
  width: 2, height: 2, pixelWidth: 40, pixelHeight: 48, isObstacle: false, createdAt: 1,
  sourceSheets: [{ id: 'old', name: 'old.png', src: 'old.png', width: 512, height: 512 }],
}

describe('opening existing sprites in the slicer', () => {
  it('waits for every current frame and rebuilds matching sheet coordinates after studio edits', async () => {
    canvas.getContext.mockReturnValue({ drawImage: draw, imageSmoothingEnabled: true })
    vi.stubGlobal('document', { createElement: () => canvas })
    let finish!: (value: any) => void
    load.mockImplementation(src => src === 'step.png'
      ? new Promise(resolve => { finish = resolve }) : Promise.resolve({ src, naturalWidth: 40, naturalHeight: 48 }))
    encode.mockResolvedValue('data:image/png;base64,rebuilt')
    const pending = prepareAssetForSlicer(asset)
    await vi.waitFor(() => expect(load).toHaveBeenCalledWith('step.png'))
    expect(encode).not.toHaveBeenCalled()
    finish({ src: 'step.png', naturalWidth: 40, naturalHeight: 48 })
    const prepared = await pending
    expect(draw).toHaveBeenCalledTimes(5)
    expect(canvas).toMatchObject({ width: 80, height: 192 })
    expect(prepared.imageSrc).toBe('data:image/png;base64,rebuilt')
    expect(prepared.asset.slicerPresets[0].directions.down[1]).toMatchObject({ x: 40, y: 0, w: 40, h: 48, dataUrl: 'step.png' })
    expect(prepared.asset.slicerPresets[0].directions.up[0]).toMatchObject({ x: 0, y: 48 })
    expect(prepared.asset.sourceSheets).toEqual([expect.objectContaining({ src: prepared.imageSrc, width: 80, height: 192 })])
    expect(prepared.asset.id).toBe(asset.id)
    expect(asset.sourceSheets?.[0].src).toBe('old.png')
  })

  it('keeps yawning and sleeping frames editable when rebuilding a studio sprite', async () => {
    canvas.getContext.mockReturnValue({ drawImage: draw, imageSmoothingEnabled: true })
    vi.stubGlobal('document', { createElement: () => canvas })
    load.mockImplementation(src => Promise.resolve({ src, naturalWidth: 40, naturalHeight: 48 }))
    encode.mockResolvedValue('data:image/png;base64,activities')
    const activityAnimations = {
      yawn: ['yawn.png'],
      sleep: ['sleep-a.png', 'sleep-b.png', 'sleep-c.png'],
    }

    const prepared = await prepareAssetForSlicer({ ...asset, activityAnimations })

    expect(prepared.asset.slicerPresets[0].animations).toEqual({
      yawn: [expect.objectContaining({ x: 0, y: 192, w: 40, h: 48, dataUrl: 'yawn.png' })],
      sleep: activityAnimations.sleep.map((dataUrl, index) => expect.objectContaining({
        x: index * 40, y: 240, w: 40, h: 48, dataUrl,
      })),
    })
    expect(canvas).toMatchObject({ width: 120, height: 288 })
    expect(draw).toHaveBeenCalledTimes(9)
    expect(draw).toHaveBeenCalledWith(expect.objectContaining({ src: 'sleep-c.png' }), 80, 240, 40, 48)
    expect(prepared.asset.activityAnimations).toEqual(activityAnimations)
  })

  it('preserves the original sheet and cuts for imported sprites', async () => {
    load.mockResolvedValue({ naturalWidth: 400, naturalHeight: 400 })
    const imported = { ...asset, creationSource: 'slicer' as const, sourceImageSrc: 'gengar.png', sourceSheets: undefined,
      slicerPresets: [{ name: 'Gengar', directions: { down: [{ x: 40, y: 80, w: 40, h: 48, dataUrl: 'down.png' }] } }] }
    const prepared = await prepareAssetForSlicer(imported)
    expect(prepared.imageSrc).toBe('gengar.png')
    expect(prepared.asset.slicerPresets).toEqual(imported.slicerPresets)
    expect(encode).not.toHaveBeenCalled()
  })

  it('reports missing frame images instead of opening a blank sheet', async () => {
    canvas.getContext.mockReturnValue({ drawImage: draw })
    vi.stubGlobal('document', { createElement: () => canvas })
    load.mockRejectedValue(new Error('Imagem ausente'))
    await expect(prepareAssetForSlicer(asset)).rejects.toThrow('Imagem ausente')
    expect(encode).not.toHaveBeenCalled()
  })
})
