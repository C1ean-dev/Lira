import type { CustomAsset } from '../types/customAsset'
import { spriteFrame, readSpriteFrame } from './spriteFrame'

// Each row has four manually advanced states, never a looping animation.
const groups = [
  { sheet: 'consumption-drinks.png', width: 1024, prefix: 'drink', ids: ['coffee', 'orange_juice', 'iced_water', 'soda', 'strawberry_milkshake', 'acai'], rows: [[0,248],[248,474],[474,706],[706,946],[946,1212],[1212,1536]] },
  { sheet: 'consumption-alcohol.png', width: 1024, prefix: 'drink', ids: ['draft_beer','red_wine','whisky','caipirinha','martini','gin_tonic','sparkling_wine','beer_bottle'], rows: [[0,180],[180,367],[367,530],[530,695],[695,895],[895,1100],[1100,1310],[1310,1536]] },
  { sheet: 'consumption-foods.png', width: 887, prefix: 'food', ids: ['pizza','burger','sushi','coxinhas','cheese_bread','fruit','cake','meal'], rows: [[65,245],[245,440],[450,617],[620,820],[835,1035],[1040,1255],[1255,1445],[1460,1610]] },
  { sheet: 'consumption-foods-2.png', width: 1024, prefix: 'food', ids: ['tacos','pasta','ramen','pancakes','brigadeiros','pudding'], rows: [[30,275],[295,510],[525,765],[785,1010],[1030,1255],[1270,1495]] },
  { sheet: 'consumption-corrections.png', width: 1448, prefix: 'drink', ids: ['soda'], rows: [[50,395]] },
  { sheet: 'consumption-corrections.png', width: 1448, prefix: 'food', ids: ['brigadeiros','ramen'], rows: [[410,705],[710,1065]] },
]
const caches = new Map<string, Map<string, string[]>>()
export function builtInConsumptionFrames(id: string, base = import.meta.env.BASE_URL): string[] | undefined {
  const assetBase = base === '/' && typeof window !== 'undefined' && window.location?.protocol === 'file:' ? './' : base
  let frames = caches.get(assetBase)
  if (!frames) {
    frames = new Map()
    for (const group of groups) group.ids.forEach((name, row) => {
      const [top, bottom] = group.rows[row]
      const width = Math.floor(group.width / 4)
      frames!.set(`lira_${group.prefix}_${name}_v1`, Array.from({ length: 4 }, (_, col) =>
        spriteFrame(`${assetBase}assets/furniture/${group.sheet}`, Math.round(col * group.width / 4), top, width, bottom - top)))
    })
    caches.set(assetBase, frames)
  }
  return frames.get(id)
}
export function consumptionFrames(asset?: CustomAsset): string[] | undefined {
  if (!asset) return undefined
  // Native definitions receive artwork fixes even in previously saved libraries.
  const source = asset.consumptionFrames?.[0] && readSpriteFrame(asset.consumptionFrames[0])?.source
  const base = source ? /^(.*)assets\/furniture\/consumption-[^/]+\.png$/.exec(source)?.[1] : undefined
  const frames = builtInConsumptionFrames(asset.id, base) ?? asset.consumptionFrames
  return frames?.length === 4 && frames.every(frame => typeof frame === 'string' && frame.length > 0) ? frames : undefined
}
export function consumptionStage(stage: unknown): 0 | 1 | 2 | 3 {
  return stage === 1 || stage === 2 || stage === 3 ? stage : 0
}
