import { existsSync, readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { addBuiltInFurniture } from '../../assets/builtInFurniture'
import { readSpriteFrame } from '../../assets/spriteFrame'
import { createVillagePackAssets } from '../../assets/villagePackAssets'
import { AURA_OPTIONS } from '../../engine/avatarEffects/presets'
import { checkCollision, isPlayerInZone } from '../../engine/physics/collision'
import { mapAuraSpecToShaderPreset } from '../../engine/pixi/PixiAuraSystem'
import { buildPlayerPersonalLights, extractMapLights } from '../../engine/pixi/PixiLightingSystem'
import { parseColorAlpha, parseHexColor } from '../../engine/pixi/PixiTextureCache'
import { furnitureDrawOrder, pickEditorFurniture } from '../../engine/rendering/furnitureLayers'
import { useCustomAssetsStore } from '../../store/useCustomAssetsStore'
import { houseZoneIdForFurniture, useMapStore } from '../../store/useMapStore'
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

  it('auto-links placed houses to PrivateZones, handles doorway collision, and prioritizes interior furniture in editor', () => {
    const packAssets = createVillagePackAssets('./')
    useCustomAssetsStore.setState({ customAssets: packAssets })

    const houseAsset = packAssets.find((a) => a.id === 'lira_house_village_red_v1')!
    const sofaAsset = packAssets.find((a) => a.id === 'lira_int_sofa_v1')!

    useMapStore.getState().addFurniture({ id: 'h-1', defId: houseAsset.id, x: 10, y: 10 })
    const linkedZoneId = houseZoneIdForFurniture('h-1')
    let map = useMapStore.getState().mapData
    let zone = map.zones.find((z) => z.id === linkedZoneId)
    expect(zone).toMatchObject({ id: linkedZoneId, x: 10, y: 10, width: 7, height: 6, hasWalls: false })

    // Doorway column 1 (x=11, y=15) is walkable; solid facade wall (x=13, y=15) blocks; interior (13, 13) triggers Zone
    expect(checkCollision(11, 15, map)).toBe(false)
    expect(checkCollision(13, 15, map)).toBe(true)
    expect(isPlayerInZone(13, 13, zone!, map)).toBe(true)

    // Placing a sofa inside the house does not drag the house shell
    expect(pickEditorFurniture(map.furniture, packAssets, 12.5, 12.5, sofaAsset)).toBeUndefined()
    useMapStore.getState().addFurniture({ id: 's-1', defId: sofaAsset.id, x: 12, y: 12 })
    map = useMapStore.getState().mapData
    const ordered = furnitureDrawOrder(map.furniture, packAssets)
    expect(ordered.map((f) => f.id)).toEqual(['h-1', 's-1'])

    // Moving the house updates its linked zone position
    useMapStore.getState().updateFurniture('h-1', { x: 14, y: 8 })
    zone = useMapStore.getState().mapData.zones.find((z) => z.id === linkedZoneId)
    expect(zone).toMatchObject({ x: 14, y: 8 })

    // Erasing on the sofa tile removes only the sofa, leaving the house intact
    useMapStore.getState().removeFurnitureAt(12.5, 12.5)
    expect(useMapStore.getState().mapData.furniture.map((f) => f.id)).toEqual(['h-1'])

    // Deleting the house removes its linked zone too
    useMapStore.getState().removeFurnitureById('h-1')
    expect(useMapStore.getState().mapData.zones.some((z) => z.id === linkedZoneId)).toBe(false)

    // Map serialization preserves placed house + zone cleanly
    useMapStore.getState().addFurniture({ id: 'h-2', defId: houseAsset.id, x: 6, y: 6 })
    const hydrated = hydrateMapData(compressMapDataForStorage(useMapStore.getState().mapData))
    expect(hydrated.furniture.some((f) => f.id === 'h-2')).toBe(true)
    expect(hydrated.zones.some((z) => z.id === houseZoneIdForFurniture('h-2'))).toBe(true)
  })

  it('maps every Lira AvatarAuraStyle preset into a GPU shader preset', () => {
    expect(mapAuraSpecToShaderPreset(null)).toBeNull()
    expect(mapAuraSpecToShaderPreset({ style: 'none' })).toBeNull()

    for (const option of AURA_OPTIONS) {
      if (option.id === 'none') continue
      const mapped = mapAuraSpecToShaderPreset({ style: option.id })
      expect(mapped).not.toBeNull()
      expect(mapped!.colorA).toHaveLength(3)
      expect(mapped!.colorB).toHaveLength(3)
      expect(mapped!.speed).toBeGreaterThan(0)
    }
  })

  it('extracts automatic 2D point lights from placed cauldron, Jack-o-lanterns, lamps, and houses', () => {
    const packAssets = createVillagePackAssets('./')
    useCustomAssetsStore.setState({ customAssets: packAssets })
    useMapStore.getState().addFurniture({ id: 'h-1', defId: 'lira_house_village_red_v1', x: 8, y: 8 })
    useMapStore.getState().addFurniture({ id: 'c-1', defId: 'lira_pack_cauldron_v1', x: 18, y: 14 })
    useMapStore.getState().addFurniture({ id: 'j-1', defId: 'lira_pack_jack_large_v1', x: 16, y: 14 })
    useMapStore.getState().addFurniture({ id: 'l-1', defId: 'lira_pack_spooky_lamp_v1', x: 20, y: 12 })

    const lights = extractMapLights(useMapStore.getState().mapData)
    expect(lights.some((l) => l.name === 'Caldeirão Mágico' && l.flicker)).toBe(true)
    expect(lights.some((l) => l.name === 'Abóbora Iluminada' && l.flicker)).toBe(true)
    expect(lights.some((l) => l.name === 'Lampião Assombrado')).toBe(true)
    expect(lights.some((l) => l.zoneId === houseZoneIdForFurniture('h-1'))).toBe(true)
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

  it('builds personal player lights and resolves CustomAsset / PlacedFurniture light overrides', () => {
    const local = { ...useGameStore.getState().localPlayer, id: 'local', x: 10, y: 12, currentZoneId: null }
    const visibleRemote = { ...local, id: 'remote-1', x: 14, y: 12, currentZoneId: null }
    const hiddenRemote = { ...local, id: 'remote-2', x: 5, y: 5, currentZoneId: 'closed-house' }
    const personal = buildPlayerPersonalLights(local, { [visibleRemote.id]: visibleRemote, [hiddenRemote.id]: hiddenRemote }, new Set(['closed-house']))
    expect(personal.some((l) => l.name === 'Luz do Jogador' && l.x === 10.5 * 32 && l.radius >= 120)).toBe(true)
    expect(personal.some((l) => l.name === 'Luz de Jogador' && l.x === 14.5 * 32)).toBe(true)
    expect(personal.some((l) => l.x === 5.5 * 32)).toBe(false)

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
})
