import type { CustomAsset, HouseShellConfig } from '../types/customAsset'
import { buildHouseCollisionGrid } from '../engine/houseInterior'
import { spriteFrame } from './spriteFrame'

const CREATED_AT = 1793000000000

function resolveAssetBase(base = import.meta.env.BASE_URL): string {
  return base === '/' && typeof window !== 'undefined' && window.location?.protocol === 'file:' ? './' : base
}

/**
 * Built-in Village, Halloween, Interiors, and placeable Portal House assets
 * sliced directly from `public/assets/packs/{village,halloween,interiors}.png`.
 */
export function createVillagePackAssets(base = import.meta.env.BASE_URL): CustomAsset[] {
  const assetBase = resolveAssetBase(base)
  const villageSheet = `${assetBase}assets/packs/village.png`
  const halloweenSheet = `${assetBase}assets/packs/halloween.png`
  const interiorsSheet = `${assetBase}assets/packs/interiors.png`

  const floorAsset = (
    id: string,
    name: string,
    sheet: string,
    x: number,
    y: number,
    w: number,
    h: number,
    iconColor: string
  ): CustomAsset => {
    const frame = spriteFrame(sheet, x, y, w, h)
    return {
      id,
      name,
      type: 'floor',
      category: 'Vila & Halloween',
      width: 1,
      height: 1,
      isObstacle: false,
      frames: [frame],
      thumbnail: frame,
      iconColor,
      createdAt: CREATED_AT,
    }
  }

  const propAsset = (
    id: string,
    name: string,
    category: string,
    sheet: string,
    rects: readonly [number, number, number, number][],
    opts: {
      width: number
      height: number
      isObstacle?: boolean
      isTabletopDecoration?: boolean
      isFloorRug?: boolean
      seatGrid?: boolean[][]
      collisionGrid?: boolean[][]
      frameRateMs?: number
      iconColor: string
    }
  ): CustomAsset => {
    const frames = rects.map(([x, y, w, h]) => spriteFrame(sheet, x, y, w, h))
    return {
      id,
      name,
      type: 'furniture',
      category,
      width: opts.width,
      height: opts.height,
      pixelWidth: opts.width * 32,
      pixelHeight: opts.height * 32,
      isObstacle: opts.isObstacle ?? true,
      ...(opts.isTabletopDecoration ? { isTabletopDecoration: true } : {}),
      ...(opts.isFloorRug ? { isFloorRug: true } : {}),
      ...(opts.seatGrid ? { seatGrid: opts.seatGrid } : {}),
      ...(opts.collisionGrid ? { collisionGrid: opts.collisionGrid } : {}),
      ...(opts.frameRateMs ? { frameRateMs: opts.frameRateMs } : {}),
      frames,
      thumbnail: frames[0],
      iconColor: opts.iconColor,
      createdAt: CREATED_AT,
    }
  }

  const houseAsset = (
    id: string,
    name: string,
    sheet: string,
    rect: readonly [number, number, number, number],
    width: number,
    height: number,
    houseShell: HouseShellConfig,
    iconColor: string
  ): CustomAsset => {
    const frame = spriteFrame(sheet, rect[0], rect[1], rect[2], rect[3])
    return {
      id,
      name,
      type: 'furniture',
      category: 'Casas',
      width,
      height,
      pixelWidth: width * 32,
      pixelHeight: height * 32,
      isObstacle: true,
      collisionGrid: buildHouseCollisionGrid(width, height, houseShell),
      houseShell,
      frames: [frame],
      thumbnail: frame,
      iconColor,
      createdAt: CREATED_AT,
    }
  }

  const floors: CustomAsset[] = [
    floorAsset('lira_floor_village_grass_v1', 'Grama da Vila', villageSheet, 48, 48, 16, 16, '#65a30d'),
    floorAsset('lira_floor_village_cobble_v1', 'Calçamento de Pedra', villageSheet, 96, 16, 16, 16, '#a8a29e'),
    floorAsset('lira_floor_village_cobble_moss_v1', 'Pedra com Musgo', villageSheet, 128, 16, 16, 16, '#84cc16'),
    floorAsset('lira_floor_halloween_grass_v1', 'Grama Halloween', halloweenSheet, 48, 48, 16, 16, '#134e4a'),
    floorAsset('lira_floor_halloween_stone_v1', 'Estrada Sombria', halloweenSheet, 72, 232, 16, 16, '#78716c'),
    floorAsset('lira_floor_interior_wood_v1', 'Assoalho Madeira', interiorsSheet, 48, 32, 16, 16, '#b45309'),
  ]

  const houses: CustomAsset[] = [
    houseAsset('lira_house_village_red_v1', 'Casa da Vila', villageSheet, [68, 123, 72, 101], 7, 6, {
      doorCols: [1, 2],
      doorCells: [{ col: 1, row: 5 }, { col: 2, row: 5 }],
      overhangPx: 122,
      defaultInteriorWidth: 14,
      defaultInteriorHeight: 11,
      defaultInteriorFloor: 'wood_parquet',
      defaultInteriorWall: 'wood_panel',
      defaultZoneColor: '#f97316',
    }, '#ea580c'),
    houseAsset('lira_house_village_blue_v1', 'Pousada da Vila', villageSheet, [148, 155, 115, 69], 10, 5, {
      doorCols: [2, 3],
      doorCells: [{ col: 2, row: 4 }, { col: 3, row: 4 }],
      overhangPx: 32,
      defaultInteriorWidth: 18,
      defaultInteriorHeight: 13,
      defaultInteriorFloor: 'wood_parquet',
      defaultInteriorWall: 'brick_red',
      defaultZoneColor: '#38bdf8',
    }, '#2563eb'),
    houseAsset('lira_house_witch_tower_v1', 'Torre da Bruxa', halloweenSheet, [356, 34, 121, 188], 8, 6, {
      doorCols: [2, 3],
      doorCells: [{ col: 2, row: 5 }, { col: 3, row: 5 }],
      overhangPx: 218,
      defaultInteriorWidth: 12,
      defaultInteriorHeight: 12,
      defaultInteriorFloor: 'wood_parquet',
      defaultInteriorWall: 'stone_dark',
      interiorTint: 0xcbd5f5,
      wallTint: 0x94a3b8,
      defaultZoneColor: '#a855f7',
    }, '#7e22ce'),
  ]

  const halloweenProps: CustomAsset[] = [
    propAsset('lira_pack_cauldron_v1', 'Caldeirão Mágico', 'Halloween', halloweenSheet, [
      [240, 24, 32, 35],
      [272, 24, 32, 35],
      [304, 24, 32, 35],
    ], { width: 2, height: 2, frameRateMs: 160, iconColor: '#4ade80' }),
    propAsset('lira_pack_jack_large_v1', 'Abóbora Iluminada Grande', 'Halloween', halloweenSheet, [[261, 229, 54, 42]], {
      width: 2, height: 2, iconColor: '#f97316',
    }),
    propAsset('lira_pack_jack_med_v1', 'Abóbora Iluminada Média', 'Halloween', halloweenSheet, [[322, 245, 28, 25]], {
      width: 1, height: 1, iconColor: '#fb923c',
    }),
    propAsset('lira_pack_jack_tall_v1', 'Abóbora Iluminada Alta', 'Halloween', halloweenSheet, [[356, 244, 25, 28]], {
      width: 1, height: 1, iconColor: '#ea580c',
    }),
    propAsset('lira_pack_pumpkin_pile_v1', 'Monte de Abóboras', 'Halloween', halloweenSheet, [[256, 147, 80, 75]], {
      width: 3, height: 3, iconColor: '#d97706',
    }),
    propAsset('lira_pack_pumpkin_orange_v1', 'Abóbora Laranja', 'Halloween', halloweenSheet, [[52, 354, 54, 46]], {
      width: 2, height: 2, iconColor: '#f97316',
    }),
    propAsset('lira_pack_pumpkin_red_v1', 'Abóbora Vermelha', 'Halloween', halloweenSheet, [[52, 290, 54, 46]], {
      width: 2, height: 2, iconColor: '#dc2626',
    }),
    propAsset('lira_pack_pumpkin_green_v1', 'Abóbora Verde', 'Halloween', halloweenSheet, [[212, 354, 54, 46]], {
      width: 2, height: 2, iconColor: '#65a30d',
    }),
    propAsset('lira_pack_pumpkin_beige_v1', 'Abóbora Creme', 'Halloween', halloweenSheet, [[212, 290, 54, 46]], {
      width: 2, height: 2, iconColor: '#d6d3d1',
    }),
    propAsset('lira_pack_spooky_lamp_v1', 'Lampião Assombrado', 'Halloween', halloweenSheet, [[309, 76, 21, 36]], {
      width: 1, height: 2, collisionGrid: [[false], [true]], iconColor: '#fbbf24',
    }),
    propAsset('lira_pack_tombstone_1_v1', 'Lápide Clássica', 'Halloween', halloweenSheet, [[256, 80, 16, 16]], {
      width: 1, height: 1, iconColor: '#64748b',
    }),
    propAsset('lira_pack_tombstone_2_v1', 'Lápide Antiga', 'Halloween', halloweenSheet, [[273, 82, 15, 14]], {
      width: 1, height: 1, iconColor: '#475569',
    }),
    propAsset('lira_pack_tombstone_candles_v1', 'Lápide com Velas', 'Halloween', halloweenSheet, [[288, 73, 16, 19]], {
      width: 1, height: 1, iconColor: '#fb923c',
    }),
    propAsset('lira_pack_grave_fence_v1', 'Cerca de Cemitério', 'Halloween', halloweenSheet, [[288, 100, 17, 11]], {
      width: 1, height: 1, iconColor: '#78350f',
    }),
  ]

  const villageProps: CustomAsset[] = [
    propAsset('lira_pack_market_stall_v1', 'Barraquinha de Feira', 'Vila', villageSheet, [[19, 120, 43, 40]], {
      width: 3, height: 2, iconColor: '#38bdf8',
    }),
    propAsset('lira_pack_village_lamp_v1', 'Poste da Vila', 'Vila', villageSheet, [[164, 36, 21, 42]], {
      width: 1, height: 2, collisionGrid: [[false], [true]], iconColor: '#fde047',
    }),
    propAsset('lira_pack_bench_v1', 'Banco de Praça', 'Vila', villageSheet, [[208, 25, 32, 23]], {
      width: 2, height: 1, seatGrid: [[true, true]], iconColor: '#b45309',
    }),
    propAsset('lira_pack_fence_v1', 'Cerca de Madeira', 'Vila', villageSheet, [[169, 19, 30, 13]], {
      width: 2, height: 1, iconColor: '#92400e',
    }),
    propAsset('lira_pack_crate_stack_v1', 'Pilha de Caixas', 'Vila', villageSheet, [[240, 43, 15, 21]], {
      width: 1, height: 1, iconColor: '#a16207',
    }),
    propAsset('lira_pack_crate_v1', 'Caixa de Madeira', 'Vila', villageSheet, [[208, 64, 16, 16]], {
      width: 1, height: 1, iconColor: '#92400e',
    }),
    propAsset('lira_pack_water_bucket_v1', 'Balde com Água', 'Vila', villageSheet, [[193, 82, 14, 14]], {
      width: 1, height: 1, iconColor: '#0284c7',
    }),
    propAsset('lira_pack_vase_v1', 'Vaso Cerâmico', 'Vila', villageSheet, [[193, 67, 14, 12]], {
      width: 1, height: 1, iconColor: '#6366f1',
    }),
    propAsset('lira_pack_flower_yellow_v1', 'Flor Amarela', 'Vila', villageSheet, [[212, 82, 9, 14]], {
      width: 1, height: 1, isObstacle: false, iconColor: '#facc15',
    }),
    propAsset('lira_pack_flower_blue_v1', 'Flor Azul', 'Vila', villageSheet, [[228, 82, 9, 14]], {
      width: 1, height: 1, isObstacle: false, iconColor: '#3b82f6',
    }),
  ]

  const interiorProps: CustomAsset[] = [
    propAsset('lira_int_sofa_v1', 'Sofá Vinho', 'Interiores', interiorsSheet, [[82, 131, 44, 26]], {
      width: 3, height: 2, seatGrid: [[false, false, false], [true, true, true]], iconColor: '#be123c',
    }),
    propAsset('lira_int_bed_green_v1', 'Cama Verde', 'Interiores', interiorsSheet, [[16, 96, 23, 32]], {
      width: 2, height: 2, seatGrid: [[false, false], [true, true]], iconColor: '#65a30d',
    }),
    propAsset('lira_int_bed_blue_v1', 'Cama Azul', 'Interiores', interiorsSheet, [[16, 128, 23, 32]], {
      width: 2, height: 2, seatGrid: [[false, false], [true, true]], iconColor: '#2563eb',
    }),
    propAsset('lira_int_table_v1', 'Mesa de Madeira', 'Interiores', interiorsSheet, [[49, 107, 30, 21]], {
      width: 2, height: 1, iconColor: '#b45309',
    }),
    propAsset('lira_int_chair_front_v1', 'Cadeira (Frente)', 'Interiores', interiorsSheet, [[145, 142, 14, 18]], {
      width: 1, height: 1, seatGrid: [[true]], iconColor: '#92400e',
    }),
    propAsset('lira_int_chair_back_v1', 'Cadeira (Costas)', 'Interiores', interiorsSheet, [[129, 147, 14, 13]], {
      width: 1, height: 1, seatGrid: [[true]], iconColor: '#92400e',
    }),
    propAsset('lira_int_chair_side_v1', 'Cadeira (Lado)', 'Interiores', interiorsSheet, [[161, 141, 13, 19]], {
      width: 1, height: 1, seatGrid: [[true]], iconColor: '#92400e',
    }),
    propAsset('lira_int_stool_v1', 'Banquinho', 'Interiores', interiorsSheet, [[83, 118, 11, 10]], {
      width: 1, height: 1, seatGrid: [[true]], iconColor: '#78350f',
    }),
    propAsset('lira_int_nightstand_v1', 'Criado-mudo', 'Interiores', interiorsSheet, [[99, 115, 12, 13]], {
      width: 1, height: 1, iconColor: '#78350f',
    }),
    propAsset('lira_int_fireplace_v1', 'Estante / Lareira', 'Interiores', interiorsSheet, [[144, 52, 16, 12]], {
      width: 1, height: 1, iconColor: '#f97316',
    }),
    propAsset('lira_int_plant_v1', 'Planta de Interior', 'Interiores', interiorsSheet, [[49, 140, 12, 20]], {
      width: 1, height: 1, iconColor: '#22c55e',
    }),
    propAsset('lira_int_lamp_v1', 'Abajur', 'Interiores', interiorsSheet, [[68, 148, 9, 12]], {
      width: 1, height: 1, isObstacle: false, isTabletopDecoration: true, iconColor: '#fde047',
    }),
    propAsset('lira_int_books_v1', 'Pilha de Livros', 'Interiores', interiorsSheet, [[66, 131, 10, 13]], {
      width: 1, height: 1, isObstacle: false, isTabletopDecoration: true, iconColor: '#ef4444',
    }),
    propAsset('lira_int_rug_teal_v1', 'Tapete Turquesa', 'Interiores', interiorsSheet, [[133, 101, 36, 22]], {
      width: 3, height: 2, isObstacle: false, isFloorRug: true, iconColor: '#14b8a6',
    }),
    propAsset('lira_int_rug_tan_v1', 'Tapete Caramelo', 'Interiores', interiorsSheet, [[128, 80, 32, 16]], {
      width: 2, height: 1, isObstacle: false, isFloorRug: true, iconColor: '#d97706',
    }),
    propAsset('lira_int_rug_beige_v1', 'Tapete Oval Bege', 'Interiores', interiorsSheet, [[162, 65, 27, 14]], {
      width: 2, height: 1, isObstacle: false, isFloorRug: true, iconColor: '#d6d3d1',
    }),
    propAsset('lira_int_rug_blue_v1', 'Tapete Oval Azul', 'Interiores', interiorsSheet, [[162, 81, 27, 14]], {
      width: 2, height: 1, isObstacle: false, isFloorRug: true, iconColor: '#60a5fa',
    }),
  ]

  return [...floors, ...houses, ...halloweenProps, ...villageProps, ...interiorProps]
}
