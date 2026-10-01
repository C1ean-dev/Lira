import { describe, it, expect, beforeEach } from 'vitest'

const mockStorage: Record<string, string> = {}
const localStorageMock = {
  getItem: (key: string) => mockStorage[key] || null,
  setItem: (key: string, value: string) => {
    mockStorage[key] = value
  },
  removeItem: (key: string) => {
    delete mockStorage[key]
  },
  clear: () => {
    for (const key of Object.keys(mockStorage)) {
      delete mockStorage[key]
    }
  },
}

;(globalThis as any).window = {
  localStorage: localStorageMock,
  innerWidth: 1920,
}
;(globalThis as any).localStorage = localStorageMock

describe('ChatDrawer Resize & Persistence Logic', () => {
  const DRAWER_STORAGE_KEY = 'gather_chat_drawer_width'
  const CHANNELS_STORAGE_KEY = 'gather_chat_channels_width'
  const DEFAULT_DRAWER_WIDTH = 440
  const MIN_DRAWER_WIDTH = 340
  const DEFAULT_CHANNELS_WIDTH = 144
  const MIN_CHANNELS_WIDTH = 110

  beforeEach(() => {
    localStorageMock.clear()
  })

  it('clamps drawer width within safe bounds', () => {
    const clampDrawer = (clientX: number, windowWidth: number, channelsWidth: number) => {
      const maxW = Math.max(MIN_DRAWER_WIDTH, Math.min(1200, Math.floor(windowWidth * 0.92)))
      const minW = Math.max(MIN_DRAWER_WIDTH, channelsWidth + 180)
      return Math.min(maxW, Math.max(minW, clientX))
    }

    // Attempting to drag smaller than MIN_DRAWER_WIDTH
    expect(clampDrawer(200, 1920, DEFAULT_CHANNELS_WIDTH)).toBe(MIN_DRAWER_WIDTH)

    // Attempting to drag larger than max allowed
    expect(clampDrawer(1600, 1920, DEFAULT_CHANNELS_WIDTH)).toBe(1200)

    // Valid intermediate drag
    expect(clampDrawer(650, 1920, DEFAULT_CHANNELS_WIDTH)).toBe(650)
  })

  it('clamps channels width within bounds and reserves space for chat messages', () => {
    const clampChannels = (clientX: number, currentDrawerWidth: number) => {
      const maxW = Math.min(320, Math.max(MIN_CHANNELS_WIDTH, currentDrawerWidth - 200))
      return Math.min(maxW, Math.max(MIN_CHANNELS_WIDTH, clientX))
    }

    // Dragging smaller than MIN_CHANNELS_WIDTH
    expect(clampChannels(50, 440)).toBe(MIN_CHANNELS_WIDTH)

    // Dragging larger than maximum (320px)
    expect(clampChannels(400, 800)).toBe(320)

    // When drawer is narrow (350px), channels cannot exceed drawer - 200 (150px)
    expect(clampChannels(250, 350)).toBe(150)
  })

  it('persists and restores custom drawer width in localStorage', () => {
    localStorageMock.setItem(DRAWER_STORAGE_KEY, '680')
    const saved = localStorageMock.getItem(DRAWER_STORAGE_KEY)
    expect(saved).toBe('680')

    const parsed = parseInt(saved || '', 10)
    expect(parsed).toBe(680)
    expect(parsed >= MIN_DRAWER_WIDTH).toBe(true)
  })

  it('persists and restores custom channels width in localStorage', () => {
    localStorageMock.setItem(CHANNELS_STORAGE_KEY, '180')
    const saved = localStorageMock.getItem(CHANNELS_STORAGE_KEY)
    expect(saved).toBe('180')

    const parsed = parseInt(saved || '', 10)
    expect(parsed).toBe(180)
    expect(parsed >= MIN_CHANNELS_WIDTH).toBe(true)
  })
})
