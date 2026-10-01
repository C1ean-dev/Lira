import { describe, it, expect, beforeEach } from 'vitest'
import { CameraManager } from '../engine/camera/CameraManager'
import { useGameStore } from '../store/useGameStore'

/**
 * Regressão: "câmera volta ao estado inicial toda hora" — o zoom morava só
 * na memória do engine e qualquer fitToScreen (focus/resize/troca de modo)
 * zerava o zoom do usuário. Agora o zoom é persistido e restaurado.
 */
describe('CameraManager - zoom persistente', () => {
  beforeEach(() => {
    useGameStore.setState({ mapViewMode: 'immersive', isManualSimplified: false })
    useGameStore.getState().setCameraZoom(null)
  })

  const wheelEvent = (deltaY: number) =>
    ({ preventDefault: () => {}, deltaY }) as unknown as WheelEvent

  it('setZoom aplica clamp e persiste na store', () => {
    const camera = new CameraManager()
    camera.setZoom(2.5)
    expect(camera.zoom).toBe(2.5)
    expect(useGameStore.getState().cameraZoom).toBe(2.5)

    camera.setZoom(99)
    expect(camera.zoom).toBe(4.0)
    expect(useGameStore.getState().cameraZoom).toBe(4.0)

    camera.setZoom(-5)
    expect(camera.zoom).toBe(0.4)
    expect(useGameStore.getState().cameraZoom).toBe(0.4)
  })

  it('scroll do usuário persiste o zoom (não se perde no focus/resize)', () => {
    const camera = new CameraManager()
    camera.zoom = 1.6
    camera.handleWheel(wheelEvent(-100)) // scroll up = zoom in
    expect(camera.zoom).toBe(1.75)
    expect(useGameStore.getState().cameraZoom).toBe(1.75)

    camera.handleWheel(wheelEvent(100)) // scroll down = zoom out
    expect(camera.zoom).toBe(1.6)
    expect(useGameStore.getState().cameraZoom).toBe(1.6)
  })

  it('fitToScreen (enquadramento explícito) persiste o resultado', () => {
    const camera = new CameraManager()
    const canvas = { width: 1920, height: 1080 } as HTMLCanvasElement
    camera.fitToScreen(canvas, 0.95)
    expect(useGameStore.getState().cameraZoom).toBe(camera.zoom)
  })

  it('nova instância restaura o zoom persistido em vez do 1.6 padrão', () => {
    useGameStore.getState().setCameraZoom(2.2)
    const camera = new CameraManager()
    expect(camera.zoom).toBe(2.2)
  })

  it('sem zoom persistido, nova instância usa o padrão 1.6 (fit inicial decide)', () => {
    expect(useGameStore.getState().cameraZoom).toBeNull()
    const camera = new CameraManager()
    expect(camera.zoom).toBe(1.6)
  })

  it('store rejeita zoom salvo inválido e normaliza set inválido', () => {
    // Valores fora da faixa são normalizados, nunca quebram a câmera.
    useGameStore.getState().setCameraZoom(10)
    expect(useGameStore.getState().cameraZoom).toBe(4.0)
    useGameStore.getState().setCameraZoom(0)
    expect(useGameStore.getState().cameraZoom).toBe(0.4)
    useGameStore.getState().setCameraZoom(null)
    expect(useGameStore.getState().cameraZoom).toBeNull()
  })
})
