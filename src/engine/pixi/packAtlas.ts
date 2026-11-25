import { Rectangle, Texture } from 'pixi.js'

const VILLAGE_RECTS = {
  grass: [48, 48, 16, 16],
  cobble1: [96, 16, 16, 16],
  cobble2: [112, 16, 16, 16],
  cobbleMoss: [128, 16, 16, 16],
  grassBlob: [16, 16, 80, 80],
  woodLedge: [104, 48, 32, 15],
  stoneLedge: [102, 80, 36, 15],
  fence: [169, 19, 30, 13],
  villageLamp: [164, 36, 21, 42],
  bench: [208, 25, 32, 23],
  crateStack: [240, 43, 15, 21],
  vase: [193, 67, 14, 12],
  crate1: [208, 64, 16, 16],
  crate2: [224, 64, 16, 16],
  crate3: [240, 64, 16, 16],
  waterBucket: [193, 82, 14, 14],
  flowerYellow: [212, 82, 9, 14],
  flowerBlue: [228, 82, 9, 14],
  marketStall: [19, 120, 43, 40],
  houseRed: [68, 123, 72, 101],
  houseBlue: [148, 155, 115, 69],
} as const

const HALLOWEEN_RECTS = {
  spookyGrass1: [48, 48, 16, 16],
  spookyGrass2: [176, 48, 16, 16],
  spookyStone: [72, 232, 16, 16],
  spookyGrassPatch: [23, 24, 66, 65],
  spookyStonePatch: [41, 200, 78, 80],
  spookyCliff: [17, 100, 78, 75],
  cauldron0: [240, 24, 32, 35],
  cauldron1: [272, 24, 32, 35],
  cauldron2: [304, 24, 32, 35],
  tombstone1: [256, 80, 16, 16],
  tombstone2: [273, 82, 15, 14],
  tombstoneCandles: [288, 73, 16, 19],
  spookyLamp: [309, 76, 21, 36],
  graveFence1: [242, 101, 14, 10],
  graveFence2: [258, 100, 9, 10],
  graveFence3: [273, 100, 8, 10],
  graveFence4: [288, 100, 17, 11],
  pumpkinPile: [256, 147, 80, 75],
  jackLarge: [261, 229, 54, 42],
  jackMed: [322, 245, 28, 25],
  jackTall: [356, 244, 25, 28],
  pumpkinRedBig: [52, 290, 54, 46],
  pumpkinRedMed: [113, 311, 27, 25],
  pumpkinRedSmall: [112, 289, 16, 15],
  pumpkinBeigeBig: [212, 290, 54, 46],
  pumpkinBeigeMed: [273, 311, 27, 25],
  pumpkinOrangeBig: [52, 354, 54, 46],
  pumpkinOrangeMed: [113, 375, 27, 25],
  pumpkinOrangeSmall: [112, 353, 16, 15],
  pumpkinOrangeTall: [179, 368, 25, 32],
  pumpkinGreenBig: [212, 354, 54, 46],
  pumpkinGreenMed: [273, 375, 27, 25],
  pumpkinGreenTall: [339, 368, 25, 32],
  houseWitch: [356, 34, 121, 188],
} as const

const INTERIORS_RECTS = {
  woodPlank1: [48, 32, 16, 16],
  woodPlank2: [48, 48, 16, 16],
  wallCream: [96, 48, 16, 16],
  wallTrimCream: [96, 44, 16, 20],
  fireplace: [144, 52, 16, 12],
  rugOvalBeige: [162, 65, 27, 14],
  rugRectTan: [128, 80, 32, 16],
  rugOvalBlue: [162, 81, 27, 14],
  rugLargeTeal: [133, 101, 36, 22],
  bedGreen: [16, 96, 23, 32],
  bedBlue: [16, 128, 23, 32],
  table: [49, 107, 30, 21],
  stoolSmall: [83, 103, 11, 9],
  stoolMed: [83, 118, 11, 10],
  nightstand: [99, 115, 12, 13],
  plant: [49, 140, 12, 20],
  books: [66, 131, 10, 13],
  lamp: [68, 148, 9, 12],
  sofa: [82, 131, 44, 26],
  chairBack: [129, 147, 14, 13],
  chairFront: [145, 142, 14, 18],
  chairSide: [161, 141, 13, 19],
} as const

export type VillageTextures = Record<keyof typeof VILLAGE_RECTS, Texture>
export type HalloweenTextures = Record<keyof typeof HALLOWEEN_RECTS, Texture>
export type InteriorTextures = Record<keyof typeof INTERIORS_RECTS, Texture>

export interface PackAtlases {
  village: VillageTextures
  halloween: HalloweenTextures
  interiors: InteriorTextures
  cauldronFrames: Texture[]
}

function resolvePackUrl(fileName: string): string {
  const base = typeof document !== 'undefined' ? document.baseURI : window.location.href
  return new URL(`assets/packs/${fileName}`, base).toString()
}

async function loadImageTexture(url: string): Promise<Texture> {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error(`Failed to load pack image: ${url}`))
    img.src = url
  })
  return Texture.from(img)
}

function sliceMap<T extends Record<string, readonly [number, number, number, number]>>(
  baseTex: Texture,
  rectMap: T
): Record<keyof T, Texture> {
  const out = {} as Record<keyof T, Texture>
  for (const key of Object.keys(rectMap) as Array<keyof T>) {
    const [x, y, w, h] = rectMap[key]
    out[key] = new Texture({
      source: baseTex.source,
      frame: new Rectangle(x, y, w, h),
    })
  }
  return out
}

let cachedPromise: Promise<PackAtlases> | null = null

/** Loads and slices the Village, Halloween, and Interiors pixel art packs once. */
export function loadPackAtlases(): Promise<PackAtlases> {
  if (!cachedPromise) {
    cachedPromise = Promise.all([
      loadImageTexture(resolvePackUrl('village.png')),
      loadImageTexture(resolvePackUrl('halloween.png')),
      loadImageTexture(resolvePackUrl('interiors.png')),
    ]).then(([villageBase, halloweenBase, interiorsBase]) => {
      const village = sliceMap(villageBase, VILLAGE_RECTS)
      const halloween = sliceMap(halloweenBase, HALLOWEEN_RECTS)
      const interiors = sliceMap(interiorsBase, INTERIORS_RECTS)
      return {
        village,
        halloween,
        interiors,
        cauldronFrames: [halloween.cauldron0, halloween.cauldron1, halloween.cauldron2],
      }
    }).catch((err) => {
      cachedPromise = null
      throw err
    })
  }
  return cachedPromise
}
