import { describe, it, expect, beforeEach } from 'vitest'
import { CameraManager } from '../engine/camera/CameraManager'
import { useGameStore } from '../store/useGameStore'

describe('CameraManager - Zoom Minimum and Return to Immersive Mode', () => {
  beforeEach(() => {
    useGameStore.setState({ mapViewMode: 'immersive', isManualSimplified: false })
  })

  it('should remain in immersive mode when zoom is above minimum (> 0.4)', () => {
    const camera = new CameraManager()
    camera.zoom = 1.0

    const mockWheelEvent = {
      deltaY: 100, // zoom out
      preventDefault: () => {},
    } as unknown as WheelEvent

    camera.handleWheel(mockWheelEvent)
    expect(camera.zoom).toBe(0.85)
    expect(useGameStore.getState().mapViewMode).toBe('immersive')
  })

  it('should automatically switch from immersive to simplified when zoom reaches minimum (<= 0.4)', () => {
    const camera = new CameraManager()
    camera.zoom = 0.5

    const mockWheelEvent = {
      deltaY: 100, // zoom out
      preventDefault: () => {},
    } as unknown as WheelEvent

    camera.handleWheel(mockWheelEvent)
    expect(camera.zoom).toBeLessThanOrEqual(0.4)
    expect(useGameStore.getState().mapViewMode).toBe('simplified')
    expect(useGameStore.getState().isManualSimplified).toBe(false)
  })

  it('should automatically return to immersive mode when adding zoom if simplified was auto-triggered by zoom', () => {
    const camera = new CameraManager()
    useGameStore.setState({ mapViewMode: 'simplified', isManualSimplified: false })

    const mockWheelEvent = {
      deltaY: -100, // zoom in
      preventDefault: () => {},
    } as unknown as WheelEvent

    camera.handleWheel(mockWheelEvent)
    expect(useGameStore.getState().mapViewMode).toBe('immersive')
  })

  it('should NOT return to immersive mode when adding zoom if user manually clicked the simplified button', () => {
    const camera = new CameraManager()
    useGameStore.setState({ mapViewMode: 'simplified', isManualSimplified: true })

    const mockWheelEvent = {
      deltaY: -100, // zoom in
      preventDefault: () => {},
    } as unknown as WheelEvent

    camera.handleWheel(mockWheelEvent)
    expect(useGameStore.getState().mapViewMode).toBe('simplified')
  })
})
