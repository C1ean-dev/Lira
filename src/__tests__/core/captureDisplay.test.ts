import { expect, it, vi } from 'vitest'
import { findCaptureDisplay, getCaptureDisplayPoint } from '../../../electron/captureDisplay'

it('resolves the selected screen by Electron display identity even when its source number matches another display', () => {
  const sources = [{ id: 'screen:2:0', display_id: '47' }, { id: 'screen:0:0', display_id: '2' }]
  const displays = [{ id: 2 }, { id: 47 }]
  expect(findCaptureDisplay('screen:2:0', sources, displays)).toBe(displays[1])
  expect(findCaptureDisplay('screen:7:0', sources, displays)).toBeUndefined()
  expect(findCaptureDisplay('screen:2:0', sources, [{ id: 2 }])).toBeUndefined()
})

it('converts a negative-coordinate display with DPI scaling to its own physical center', () => {
  const display = { id: 47, bounds: { x: -1280, y: 0, width: 1280, height: 720 } }
  const screen = {
    dipToScreenPoint: vi.fn(() => ({ x: -960, y: 540 })),
    screenToDipPoint: vi.fn(() => ({ x: -640, y: 360 })),
    getDisplayNearestPoint: vi.fn().mockReturnValue(display),
  }
  expect(getCaptureDisplayPoint(display, screen)).toEqual({ x: -960, y: 540 })
  expect(screen.dipToScreenPoint).toHaveBeenCalledWith({ x: -640, y: 360 })
  expect(screen.screenToDipPoint).toHaveBeenCalledWith({ x: -960, y: 540 })
  screen.getDisplayNearestPoint.mockReturnValue({ id: 2 })
  expect(getCaptureDisplayPoint(display, screen)).toBeNull()
})
