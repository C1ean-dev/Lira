import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * Saved data lives under `lira_` keys and app events under the `lira:` prefix.
 * Nothing is read from, or announced under, any other name.
 */

let readKeys: string[]
let dispatched: { type: string; detail: unknown }[]

const installFakeWindow = () => {
  readKeys = []
  dispatched = []
  const localStorage = {
    getItem: (key: string) => {
      readKeys.push(key)
      return null
    },
    setItem: () => {},
    removeItem: () => {},
  }
  vi.stubGlobal('localStorage', localStorage)
  vi.stubGlobal('window', {
    localStorage,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: (event: { type: string; detail?: unknown }) => {
      dispatched.push({ type: event.type, detail: event.detail })
      return true
    },
  })
}

describe('lira storage keys and events', () => {
  beforeEach(() => {
    vi.resetModules()
    installFakeWindow()
    vi.spyOn(console, 'info').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('reads only lira_ keys when the stores load with nothing saved', async () => {
    await import('../store/useGameStore')
    await import('../store/useChatStore')
    await import('../store/useMediaStore')
    await import('../store/useSettingsStore')
    await import('../store/useMapStore')
    await import('../store/useSavedSpacesStore')
    await import('../store/useCustomAssetsStore')
    await import('../media/hardwareCodec')

    expect(readKeys).toEqual(expect.arrayContaining([
      'lira_user_profile',
      'lira_friends_list',
      'lira_saved_dms',
      'lira_audio_settings',
      'lira_graphics_settings',
      'lira_custom_map',
      'lira_saved_spaces',
      'lira_custom_user_assets',
      'lira_hw_acceleration_enabled',
    ]))
    expect(readKeys.filter((key) => !key.startsWith('lira_'))).toEqual([])
  })

  it('announces a hardware acceleration change once, under the lira: prefix', async () => {
    const { setHardwareAccelerationEnabled } = await import('../media/hardwareCodec')

    setHardwareAccelerationEnabled(false)

    expect(dispatched).toEqual([{ type: 'lira:hw-acceleration-changed', detail: { enabled: false } }])
  })

  it('announces a live buffer change once, under the lira: prefix', async () => {
    const { useMediaStore } = await import('../store/useMediaStore')

    useMediaStore.getState().setLiveBufferDelay(1500)

    expect(dispatched).toEqual([{ type: 'lira:live-buffer-changed', detail: 1500 }])
  })
})
