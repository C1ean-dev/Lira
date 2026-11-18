import type { Display, Screen } from 'electron'

export function findCaptureDisplay<T extends Pick<Display, 'id'>>(
  sourceId: string,
  sources: readonly { id: string; display_id: string }[],
  displays: readonly T[],
): T | undefined {
  if (!sourceId.startsWith('screen:')) return
  const displayId = sources.find(source => source.id === sourceId)?.display_id
  return displayId ? displays.find(display => String(display.id) === displayId) : undefined
}

export function getCaptureDisplayPoint(
  display: Pick<Display, 'id' | 'bounds'>,
  screen: Pick<Screen, 'dipToScreenPoint' | 'screenToDipPoint' | 'getDisplayNearestPoint'>,
) {
  const { x, y, width, height } = display.bounds
  const point = screen.dipToScreenPoint({ x: x + Math.floor(width / 2), y: y + Math.floor(height / 2) })
  return screen.getDisplayNearestPoint(screen.screenToDipPoint(point)).id === display.id ? point : null
}
