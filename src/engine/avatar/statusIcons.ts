import { TERRA_IMAGE_DATA_URL } from '../../generated/terraImage'
import { LUA_ROXA_IMAGE_DATA_URL } from '../../generated/luaRoxaImage'
import { AUSENTE_IMAGE_DATA_URL } from '../../generated/ausenteImage'
import { MARTE_IMAGE_DATA_URL } from '../../generated/marteImage'

const SRC_BY_STATUS: Record<string, string> = {
  available: TERRA_IMAGE_DATA_URL,
  focusing: LUA_ROXA_IMAGE_DATA_URL,
  away: AUSENTE_IMAGE_DATA_URL,
  busy: MARTE_IMAGE_DATA_URL,
}

const imageCache = new Map<string, HTMLImageElement>()

export function getStatusIconSrc(status: string): string | null {
  return SRC_BY_STATUS[status] ?? null
}

export function getStatusIconImage(status: string): HTMLImageElement | null {
  const src = getStatusIconSrc(status)
  if (!src || typeof Image === 'undefined') return null
  let image = imageCache.get(status)
  if (!image) {
    image = new Image()
    image.src = src
    imageCache.set(status, image)
  }
  return image.complete && image.naturalWidth > 0 ? image : null
}
