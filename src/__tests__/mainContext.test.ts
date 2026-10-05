import { describe, it, expect } from 'vitest'
import { buildMainContext, summarizeGpu, summarizeWindow } from '../../electron/mainContext'

const makeWindow = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  isDestroyed: () => false,
  isVisible: () => true,
  isFocused: () => false,
  isMinimized: () => false,
  isFullScreen: () => false,
  webContents: { isLoading: () => false, isCrashed: () => false, getURL: () => 'http://localhost:5173/?room=SECRET#x' },
  ...overrides,
})

describe('summarizeWindow', () => {
  it('says what state a window is in', () => {
    expect(summarizeWindow(makeWindow())).toEqual({
      id: 1,
      visible: true,
      focused: false,
      minimized: false,
      fullscreen: false,
      loading: false,
      crashed: false,
      page: 'http://localhost:5173/',
    })
  })

  it('writes the page of the installed app without the folders of the user', () => {
    const win = makeWindow({
      webContents: { isLoading: () => false, isCrashed: () => false, getURL: () => 'file:///C:/Users/ana/AppData/Local/Programs/Lira/resources/app.asar/dist/index.html' },
    })
    expect(summarizeWindow(win).page).toBe('dist/index.html')
  })

  it('says only that a destroyed window is gone', () => {
    const win = makeWindow({
      isDestroyed: () => true,
      isVisible: () => {
        throw new Error('Object has been destroyed')
      },
    })
    expect(summarizeWindow(win)).toEqual({ id: 1, destroyed: true })
  })

  it('survives a window that throws', () => {
    const win = makeWindow({
      isFocused: () => {
        throw new Error('Object has been destroyed')
      },
    })
    expect(summarizeWindow(win)).toEqual({ id: 1, error: 'Object has been destroyed' })
  })
})

describe('summarizeGpu', () => {
  it('keeps the adapters and what is not plainly enabled', () => {
    expect(
      summarizeGpu(
        {
          gpuDevice: [
            { vendorId: 4098, deviceId: 5567, driverVendor: 'AMD', driverVersion: '31.0.21912.14', active: true, extra: 'x' },
            { vendorId: 32902, deviceId: 39745, active: false },
          ],
          auxAttributes: { glRenderer: 'ANGLE (AMD Radeon)' },
        },
        { gpu_compositing: 'enabled', video_decode: 'enabled', video_encode: 'disabled_software', webgl: 'enabled', vulkan: 'disabled_off' }
      )
    ).toEqual({
      adapters: [
        { vendorId: '0x1002', deviceId: '0x15bf', driverVendor: 'AMD', driverVersion: '31.0.21912.14', active: true },
        { vendorId: '0x8086', deviceId: '0x9b41', active: false },
      ],
      renderer: 'ANGLE (AMD Radeon)',
      notEnabled: { video_encode: 'disabled_software', vulkan: 'disabled_off' },
    })
  })

  it('survives missing information', () => {
    expect(summarizeGpu(undefined, undefined)).toEqual({ adapters: [], notEnabled: {} })
    expect(summarizeGpu({ gpuDevice: 'nope' }, 'nope')).toEqual({ adapters: [], notEnabled: {} })
  })
})

describe('buildMainContext', () => {
  it('describes the app, the process and its windows', () => {
    expect(
      buildMainContext({
        version: '1.1.81',
        packaged: false,
        instance: '2',
        versions: { electron: '33.2.0', chrome: '130.0.6723.59', node: '20.18.0' },
        platform: 'win32',
        arch: 'x64',
        osRelease: '10.0.19045',
        locale: 'pt-BR',
        uptimeSec: 125.7,
        memory: { rss: 157286400, heapUsed: 31457280 },
        windows: [makeWindow()],
        extra: { screenShareHelper: 'idle' },
      })
    ).toEqual({
      app: {
        version: '1.1.81',
        packaged: false,
        instance: '2',
        electron: '33.2.0',
        chrome: '130.0.6723.59',
        node: '20.18.0',
        platform: 'win32',
        arch: 'x64',
        osRelease: '10.0.19045',
        locale: 'pt-BR',
      },
      process: { uptimeSec: 126, rssMb: 150, heapMb: 30 },
      windows: [
        { id: 1, visible: true, focused: false, minimized: false, fullscreen: false, loading: false, crashed: false, page: 'http://localhost:5173/' },
      ],
      main: { screenShareHelper: 'idle' },
    })
  })

  it('leaves out what it was not given', () => {
    const context = buildMainContext({
      version: '1.0.0',
      packaged: true,
      instance: '1',
      versions: {},
      platform: 'win32',
      arch: 'x64',
      osRelease: '10.0',
      uptimeSec: 1,
      memory: { rss: 0, heapUsed: 0 },
      windows: [],
    })
    expect(context).not.toHaveProperty('main')
    expect(context.windows).toEqual([])
  })
})
