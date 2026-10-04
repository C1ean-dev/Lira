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

/** The planet/moon image of a presence status, or null for offline/unknown. */
export function getStatusIconSrc(status: string): string | null {
  return SRC_BY_STATUS[status] ?? null
}

/**
 * The status image ready to draw on a canvas, or null while it is still
 * decoding (the first frames after startup) or when the status has none.
 * Images are created once per status and reused every frame.
 */
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
