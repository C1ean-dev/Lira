import { MapData, FloorType, WallType } from '../../types/map'
import { TILE_SIZE } from '../../engine/Constants'

/**
 * Espaço em Branco / Workspace Vazio para Edição Livre
 * 100% editável, limpo e transitável.
 */
export function createEmptyWorkspace(): MapData {
  const width = 68
  const height = 40

  const floors: FloorType[][] = []
  for (let y = 0; y < height; y++) {
    const row: FloorType[] = []
    for (let x = 0; x < width; x++) {
      row.push('wood_parquet')
    }
    floors.push(row)
  }

  // Outer border walls
  const walls: (WallType | null)[][] = []
  for (let y = 0; y < height; y++) {
    const row: (WallType | null)[] = []
    for (let x = 0; x < width; x++) {
      if (y === 0 || y === height - 1 || x === 0 || x === width - 1) {
        row.push('drywall_white')
      } else {
        row.push(null)
      }
    }
    walls.push(row)
  }

  return {
    id: 'empty_workspace',
    name: 'Espaço de Trabalho',
    width,
    height,
    tileSize: TILE_SIZE,
    spawnPoint: { x: 34, y: 20 },
    floors,
    walls,
    furniture: [],
    zones: [],
  }
}

/**
 * Modelo Pronto de Forja Medieval / Oficina do Ferreiro (LPC Blacksmith Workshop)
 */
export function createBlacksmithWorkshopTemplate(): MapData {
  const width = 48
  const height = 32

  const floors: FloorType[][] = []
  for (let y = 0; y < height; y++) {
    const row: FloorType[] = []
    for (let x = 0; x < width; x++) {
      if (x < 18 && y < 16) {
        row.push('forge_soot_stone')
      } else if (x >= 18 && x < 32 && y < 16) {
        row.push('forge_iron_plates')
      } else {
        row.push('forge_cobblestone')
      }
    }
    floors.push(row)
  }

  const walls: (WallType | null)[][] = []
  for (let y = 0; y < height; y++) {
    const row: (WallType | null)[] = []
    for (let x = 0; x < width; x++) {
      if (y === 0 || y === height - 1 || x === 0 || x === width - 1) {
        row.push('forge_stone_wall')
      } else if (y === 16 && (x < 14 || x > 18)) {
        row.push('forge_dark_brick')
      } else {
        row.push(null)
      }
    }
    walls.push(row)
  }

  return {
    id: 'blacksmith_workshop',
    name: 'Forja Antiga & Oficina do Ferreiro',
    width,
    height,
    tileSize: TILE_SIZE,
    spawnPoint: { x: 24, y: 22 },
    floors,
    walls,
    furniture: [
      // Forjas e Fornalhas
      { id: 'f-1', defId: 'forge_smelter_large_anim', x: 4, y: 3 },
      { id: 'f-2', defId: 'forge_smelter_brick_anim', x: 10, y: 3 },
      { id: 'f-3', defId: 'forge_bellows_large', x: 2, y: 8 },
      { id: 'f-4', defId: 'forge_crucible_pot_anim', x: 14, y: 8 },

      // Bigornas & Têmpera
      { id: 'f-5', defId: 'forge_anvil_hot_iron', x: 6, y: 9 },
      { id: 'f-6', defId: 'forge_anvil_iron', x: 10, y: 9 },
      { id: 'f-7', defId: 'forge_water_trough', x: 8, y: 12 },
      { id: 'f-8', defId: 'forge_grindstone_wheel', x: 14, y: 12 },

      // Bancadas & Armamentos
      { id: 'f-9', defId: 'forge_workbench_tools', x: 22, y: 4 },
      { id: 'f-10', defId: 'forge_weapon_rack_swords', x: 28, y: 4 },
      { id: 'f-11', defId: 'forge_armor_display_stand', x: 34, y: 4 },
      { id: 'f-12', defId: 'forge_tool_rack_wall', x: 24, y: 1 },
      { id: 'f-13', defId: 'forge_hanging_sign', x: 20, y: 1 },

      // Depósito de Recursos
      { id: 'f-14', defId: 'forge_ingots_pyramid', x: 24, y: 9 },
      { id: 'f-15', defId: 'forge_coal_ore_crates', x: 30, y: 9 },
      { id: 'f-16', defId: 'forge_coal_ore_crates', x: 34, y: 9 },
    ],
    zones: [
      {
        id: 'zone-forge',
        name: 'Forja & Fundição Principal',
        color: '#fa5252',
        x: 2,
        y: 2,
        width: 15,
        height: 13,
        description: 'Área de alta temperatura com forjas de pedra e bigornas',
      },
      {
        id: 'zone-armory',
        name: 'Oficina de Armeiro & Projetos',
        color: '#4c6ef5',
        x: 20,
        y: 2,
        width: 17,
        height: 13,
        description: 'Bancadas de armaria, manequins de armadura e projetos',
      },
    ],
  }
}
