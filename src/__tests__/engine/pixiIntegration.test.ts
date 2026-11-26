import { existsSync, readFileSync } from 'node:fs'
import { Container, type Application } from 'pixi.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { addBuiltInFurniture } from '../../assets/builtInFurniture'
import { readSpriteFrame } from '../../assets/spriteFrame'
import { createVillagePackAssets } from '../../assets/villagePackAssets'
import { AURA_OPTIONS } from '../../engine/avatarEffects/presets'
import { checkCollision } from '../../engine/physics/collision'
import { mapAuraSpecToShaderPreset, PixiAuraSystem } from '../../engine/pixi/PixiAuraSystem'
import { extractMapLights, PixiLightingSystem } from '../../engine/pixi/PixiLightingSystem'
import { parseColorAlpha, parseHexColor } from '../../engine/pixi/PixiTextureCache'
import { useCustomAssetsStore } from '../../store/useCustomAssetsStore'
import { useMapStore } from '../../store/useMapStore'
import { useSettingsStore } from '../../store/useSettingsStore'
import { DEFAULT_FURNITURE_LIGHT, type CustomAsset } from '../../types/customAsset'
import { useGameStore } from '../../store/useGameStore'
import { compressMapDataForStorage, hydrateMapData } from '../../utils/mapSerialization'

const originalSettings = useSettingsStore.getState()
const originalAssets = useCustomAssetsStore.getState()
const originalMap = useMapStore.getState().mapData

afterEach(() => {
  useSettingsStore.setState(originalSettings)
  useCustomAssetsStore.setState(originalAssets)
  useMapStore.getState().setActiveHouseId(null)
  useGameStore.getState().setCurrentHouseId(null)
  useMapStore.getState().setMapData(originalMap)
})

describe('PixiJS integration & buildable Village/Halloween/Interiors assets', () => {
  it('ships Village, Halloween, Interiors floors, props and 3 cutaway houses with valid PNG sprite bounds', () => {
    const packAssets = createVillagePackAssets('./')
    expect(packAssets.filter((a) => a.type === 'floor')).toHaveLength(6)
    expect(packAssets.filter((a) => a.houseShell)).toHaveLength(3)
    expect(packAssets.some((a) => a.category === 'Halloween')).toBe(true)
    expect(packAssets.some((a) => a.category === 'Vila')).toBe(true)
    expect(packAssets.some((a) => a.category === 'Interiores')).toBe(true)

    for (const asset of packAssets) {
      for (const frameStr of asset.frames) {
        const frame = readSpriteFrame(frameStr)!
        expect(frame.source).toMatch(/^\.\/assets\/packs\/(?:village|halloween|interiors)\.png$/)
        const png = readFileSync(`public/${frame.source.slice(2)}`)
        const w = png.readUInt32BE(16)
        const h = png.readUInt32BE(20)
        expect(frame.x + frame.width).toBeLessThanOrEqual(w)
        expect(frame.y + frame.height).toBeLessThanOrEqual(h)
      }
    }

    const merged = addBuiltInFurniture([])
    expect(merged.some((a) => a.id === 'lira_house_village_red_v1')).toBe(true)
    expect(merged.some((a) => a.id === 'lira_pack_cauldron_v1')).toBe(true)
    expect(merged.some((a) => a.id === 'lira_int_sofa_v1')).toBe(true)
  })

  it('auto-creates customizable houseInteriors for placed houses, handles portal door collision, and serializes interiors', () => {
    const packAssets = createVillagePackAssets('./')
    useCustomAssetsStore.setState({ customAssets: packAssets })

    const houseAsset = packAssets.find((a) => a.id === 'lira_house_village_red_v1')!

    useMapStore.getState().addFurniture({ id: 'h-1', defId: houseAsset.id, x: 10, y: 10 })
    let map = useMapStore.getState().mapData
    expect(map.zones).toHaveLength(0)
    expect(map.houseInteriors?.['h-1']).toMatchObject({
      houseId: 'h-1',
      defId: houseAsset.id,
      name: houseAsset.name,
      width: 14,
      height: 11,
    })

    // Doorway column 1 (x=11, y=15) is walkable portal threshold; solid house tiles (13, 15) & (13, 13) block
    expect(checkCollision(11, 15, map)).toBe(false)
    expect(checkCollision(13, 15, map)).toBe(true)
    expect(checkCollision(13, 13, map)).toBe(true)

    // Resizing/renaming the house interior updates both interior dimensions and exterior label
    useMapStore.getState().updateHouseInteriorConfig('h-1', {
      name: 'Casa Renovada',
      width: 20,
      height: 15,
    })
    map = useMapStore.getState().mapData
    expect(map.houseInteriors?.['h-1']).toMatchObject({ name: 'Casa Renovada', width: 20, height: 15 })
    expect(map.furniture.find((f) => f.id === 'h-1')?.houseName).toBe('Casa Renovada')

    // Deleting the house removes its interior space too
    useMapStore.getState().removeFurnitureById('h-1')
    expect(useMapStore.getState().mapData.houseInteriors?.['h-1']).toBeUndefined()

    // Map serialization preserves placed house + custom interior cleanly
    useMapStore.getState().addFurniture({ id: 'h-2', defId: houseAsset.id, x: 6, y: 6 })
    useMapStore.getState().updateHouseInteriorConfig('h-2', { width: 16, height: 12 })
    const hydrated = hydrateMapData(compressMapDataForStorage(useMapStore.getState().mapData))
    expect(hydrated.furniture.some((f) => f.id === 'h-2')).toBe(true)
    expect(hydrated.houseInteriors?.['h-2']).toMatchObject({ width: 16, height: 12 })
  })

  it('maps every Lira AvatarAuraStyle preset into a GPU shader preset with objects & ground circle config', () => {
    expect(mapAuraSpecToShaderPreset(null)).toBeNull()
    expect(mapAuraSpecToShaderPreset({ style: 'none' })).toBeNull()

    for (const option of AURA_OPTIONS) {
      if (option.id === 'none') continue
      const mapped = mapAuraSpecToShaderPreset({ style: option.id })
      expect(mapped).not.toBeNull()
      expect(mapped!.colorA).toHaveLength(3)
      expect(mapped!.colorB).toHaveLength(3)
      expect(mapped!.speed).toBeGreaterThan(0)
      expect(mapped!.shapes.length).toBeGreaterThan(0)
      expect(mapped!.groundCircle).toBe(Boolean(option.glowHalo))
    }

    const firePreset = mapAuraSpecToShaderPreset({ style: 'fire' })
    expect(firePreset?.groundCircle).toBe(true)
    expect(firePreset?.shapes).toContain('flame')

    const flowersPreset = mapAuraSpecToShaderPreset({ style: 'floral_stars' })
    expect(flowersPreset?.groundCircle).toBe(false)
    expect(flowersPreset?.shapes).toContain('flower')

    const customNoCircle = mapAuraSpecToShaderPreset({
      style: 'custom',
      color: '#ec4899',
      groundCircle: false,
      custom: {
        id: 'c-1',
        name: 'Corações',
        kind: 'aura',
        shapes: ['heart', 'star'],
        color: '#ec4899',
        motion: 'float',
        density: 'normal',
        groundCircle: false,
      },
    })
    expect(customNoCircle?.groundCircle).toBe(false)
    expect(customNoCircle?.shapes).toEqual(['heart', 'star'])

    const customCircleOnly = mapAuraSpecToShaderPreset({
      style: 'custom',
      color: '#38bdf8',
      groundCircle: true,
      groundCircleSize: 96,
      custom: {
        id: 'c-2',
        name: 'Anel Azul',
        kind: 'aura',
        shapes: [],
        color: '#38bdf8',
        motion: 'orbit',
        density: 'normal',
        groundCircle: true,
        groundCircleSize: 96,
      },
    })
    expect(customCircleOnly?.groundCircle).toBe(true)
    expect(customCircleOnly?.groundCircleSize).toBe(96)
    expect(customCircleOnly?.shapes).toEqual([])
  })

  it('toggles and resizes PixiAuraSystem ground circle sprites based on aura config', () => {
    const groundContainer = new Container()
    const overlayContainer = new Container()
    const auraSys = new PixiAuraSystem(groundContainer, overlayContainer)

    const lightsOff = auraSys.update(0.016, 1, [
      {
        id: 'p-1',
        px: 160,
        py: 160,
        aura: {
          style: 'floral_stars',
          color: '#a855f7',
          groundCircle: false,
        },
      },
    ])
    expect(lightsOff).toHaveLength(0)
    expect(groundContainer.children.every((c) => !c.visible)).toBe(true)

    const lightsOn = auraSys.update(0.016, 2, [
      {
        id: 'p-1',
        px: 160,
        py: 160,
        aura: {
          style: 'custom',
          color: '#38bdf8',
          groundCircle: true,
          groundCircleSize: 88,
          custom: {
            id: 'ring',
            name: 'Ring',
            kind: 'aura',
            shapes: [],
            color: '#38bdf8',
            motion: 'orbit',
            density: 'normal',
            groundCircle: true,
            groundCircleSize: 88,
          },
        },
      },
    ])
    expect(lightsOn).toHaveLength(1)
    expect(groundContainer.children).toHaveLength(1)
    const groundSprite = groundContainer.children[0]
    expect(groundSprite.visible).toBe(true)
    expect(groundSprite.width).toBe(88)
    expect(groundSprite.height).toBe(Math.round(88 * 0.64))

    const lightsBackOff = auraSys.update(0.016, 3, [
      {
        id: 'p-1',
        px: 160,
        py: 160,
        aura: {
          style: 'floral_stars',
          color: '#a855f7',
          groundCircle: false,
        },
      },
    ])
    expect(lightsBackOff).toHaveLength(0)
    expect(groundSprite.visible).toBe(false)

    auraSys.destroy()
  })

  it('extracts automatic 2D point lights from placed cauldron, Jack-o-lanterns, lamps, and houses without adding room lights', () => {
    const packAssets = createVillagePackAssets('./')
    useCustomAssetsStore.setState({ customAssets: packAssets })
    useMapStore.getState().addOrUpdateZone({
      id: 'zone-no-light',
      name: 'Sala Sem Luz',
      x: 2,
      y: 2,
      width: 6,
      height: 5,
      color: '#3b82f6',
    })
    useMapStore.getState().addFurniture({ id: 'h-1', defId: 'lira_house_village_red_v1', x: 8, y: 8 })
    useMapStore.getState().addFurniture({ id: 'c-1', defId: 'lira_pack_cauldron_v1', x: 18, y: 14 })
    useMapStore.getState().addFurniture({ id: 'j-1', defId: 'lira_pack_jack_large_v1', x: 16, y: 14 })
    useMapStore.getState().addFurniture({ id: 'l-1', defId: 'lira_pack_spooky_lamp_v1', x: 20, y: 12 })

    const lights = extractMapLights(useMapStore.getState().mapData)
    expect(lights.some((l) => l.name === 'Sala Sem Luz')).toBe(false)
    expect(lights.some((l) => l.name === 'Caldeirão Mágico' && l.flicker)).toBe(true)
    expect(lights.some((l) => l.name === 'Abóbora Iluminada' && l.flicker)).toBe(true)
    expect(lights.some((l) => l.name === 'Lampião Assombrado')).toBe(true)
    expect(lights.some((l) => l.name === 'Casa da Vila')).toBe(true)
  })

  it('persists lightingEnabled and lightingMode in useSettingsStore', () => {
    useSettingsStore.getState().setLightingEnabled(false)
    useSettingsStore.getState().setLightingMode('night')
    expect(useSettingsStore.getState().lightingEnabled).toBe(false)
    expect(useSettingsStore.getState().lightingMode).toBe('night')
  })

  it('uses 100% native PixiJS v8 engine with zero Canvas 2D world fallback', () => {
    expect(existsSync('src/engine/rendering/worldRenderer.ts')).toBe(false)
    expect(existsSync('src/engine/rendering/staticLayerCache.ts')).toBe(false)
    expect(existsSync('src/engine/rendering/zoneRenderer.ts')).toBe(false)

    const engineSrc = readFileSync('src/engine/CanvasEngine.ts', 'utf8')
    expect(engineSrc).not.toMatch(/\bWorldRenderer\b/)
    expect(engineSrc).not.toContain("getContext('2d'")

    const pixiWorldSrc = readFileSync('src/engine/pixi/PixiWorldRenderer.ts', 'utf8')
    expect(pixiWorldSrc).not.toMatch(/\bWorldRenderer\b/)
    expect(pixiWorldSrc).not.toContain('bufferCanvas')
    expect(pixiWorldSrc).not.toContain('Falling back to Canvas 2D')

    const viewportSrc = readFileSync('src/components/MapViewport.tsx', 'utf8')
    expect(viewportSrc).toContain('data-map-viewport="pixi"')
    expect(viewportSrc).not.toContain('canvasRef')

    expect(parseHexColor('#38bdf8')).toBe(0x38bdf8)
    expect(parseHexColor('#f0a')).toBe(0xff00aa)
    expect(parseColorAlpha('rgba(10, 20, 30, 0.55)')).toBeCloseTo(0.55)
  })

  it('resolves CustomAsset / PlacedFurniture light overrides', () => {
    const litAsset: CustomAsset = {
      id: 'custom_crystal',
      name: 'Cristal Brilhante',
      type: 'furniture',
      category: 'Geral',
      width: 2,
      height: 2,
      isObstacle: true,
      frames: [],
      createdAt: 1,
      light: { ...DEFAULT_FURNITURE_LIGHT, enabled: true, color: '#38bdf8', radius: 220, intensity: 0.9, flicker: true },
    }
    useCustomAssetsStore.setState({ customAssets: [litAsset] })
    useMapStore.getState().addFurniture({ id: 'c1', defId: 'custom_crystal', x: 4, y: 6 })
    useMapStore.getState().addFurniture({
      id: 'c2',
      defId: 'custom_crystal',
      x: 8,
      y: 6,
      light: { enabled: true, color: '#f472b6', radius: 180, intensity: 0.75, flicker: false },
    })
    useMapStore.getState().addFurniture({
      id: 'c3',
      defId: 'custom_crystal',
      x: 12,
      y: 6,
      light: { ...DEFAULT_FURNITURE_LIGHT, enabled: false },
    })

    const mapLights = extractMapLights(useMapStore.getState().mapData, [litAsset])
    // Multi-tile 2x2 centered at (x+1)*32, (y+1)*32
    expect(mapLights.some((l) => l.x === 5 * 32 && l.y === 7 * 32 && l.color === '#38bdf8' && l.radius === 220 && l.flicker)).toBe(true)
    // Placed instance override color/radius takes priority
    expect(mapLights.some((l) => l.x === 9 * 32 && l.y === 7 * 32 && l.color === '#f472b6' && l.radius === 180)).toBe(true)
    // Disabled instance override emits zero light
    expect(mapLights.some((l) => l.x === 13 * 32 && l.y === 7 * 32)).toBe(false)
  })

  it('resizes the 2D lighting overlaySprite bounds when app.screen dimensions change', () => {
    const screen = { width: 800, height: 600 }
    const mockApp = {
      screen,
      renderer: { render: vi.fn() },
    } as unknown as Application

    const lighting = new PixiLightingSystem(mockApp)
    expect(lighting.overlaySprite.texture.dynamic).toBe(true)

    lighting.update(true, 'night', 0.016, 1, 1, 0, 0, [], [], null)
    expect(lighting.overlaySprite.visible).toBe(true)
    lighting.overlaySprite.didViewUpdate = false

    screen.width = 1440
    screen.height = 900
    lighting.update(true, 'night', 0.016, 2, 1, 0, 0, [], [], null)

    expect(lighting.overlaySprite.didViewUpdate).toBe(true)
    expect(lighting.overlaySprite.texture.width).toBe(1440)
    expect(lighting.overlaySprite.texture.height).toBe(900)
    expect(lighting.overlaySprite.visualBounds.maxX).toBe(1440)
    expect(lighting.overlaySprite.visualBounds.maxY).toBe(900)
    expect(lighting.overlaySprite.width).toBe(1440)
    expect(lighting.overlaySprite.height).toBe(900)

    lighting.update(true, 'day', 0.016, 3, 1, 0, 0, [], [], null)
    expect(lighting.overlaySprite.visible).toBe(false)
    lighting.overlaySprite.didViewUpdate = false

    screen.width = 1920
    screen.height = 1080
    lighting.update(true, 'day', 0.016, 4, 1, 0, 0, [], [], null)
    expect(lighting.overlaySprite.visible).toBe(false)
    expect(lighting.overlaySprite.didViewUpdate).toBe(false)

    lighting.update(true, 'night', 0.016, 5, 1, 0, 0, [], [], null)
    expect(lighting.overlaySprite.visible).toBe(true)
    expect(lighting.overlaySprite.didViewUpdate).toBe(true)
    expect(lighting.overlaySprite.texture.width).toBe(1920)
    expect(lighting.overlaySprite.texture.height).toBe(1080)
    expect(lighting.overlaySprite.visualBounds.maxX).toBe(1920)
    expect(lighting.overlaySprite.visualBounds.maxY).toBe(1080)

    lighting.destroy()
  })
})
