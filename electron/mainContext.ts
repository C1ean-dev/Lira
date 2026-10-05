import { normalizeFramePath } from '../src/utils/stackFrames'

/**
 * What the main process says about itself in an error report and at the start
 * of a session: the app and runtime versions, the machine, the process and the
 * state of each window. Pure: everything it needs is passed in.
 */

interface WindowLike {
  id: number
  isDestroyed(): boolean
  isVisible(): boolean
  isFocused(): boolean
  isMinimized(): boolean
  isFullScreen(): boolean
  webContents: { isLoading(): boolean; isCrashed(): boolean; getURL(): string }
}

export interface MainContextInput {
  version: string
  packaged: boolean
  instance: string
  versions: { electron?: string; chrome?: string; node?: string }
  platform: string
  arch: string
  osRelease: string
  locale?: string
  uptimeSec: number
  memory: { rss: number; heapUsed: number }
  windows: WindowLike[]
  /** State of the main process that is worth a line (helpers running, pending captures...). */
  extra?: Record<string, unknown>
}

/** The page a window shows, without the room in the query or the folders of the user. */
function pageOf(url: string): string {
  if (/^https?:\/\//i.test(url)) return url.replace(/[?#].*$/, '')
  return normalizeFramePath(url)
}

export function summarizeWindow(win: WindowLike): Record<string, unknown> {
  try {
    if (win.isDestroyed()) return { id: win.id, destroyed: true }
    return {
      id: win.id,
      visible: win.isVisible(),
      focused: win.isFocused(),
      minimized: win.isMinimized(),
      fullscreen: win.isFullScreen(),
      loading: win.webContents.isLoading(),
      crashed: win.webContents.isCrashed(),
      page: pageOf(win.webContents.getURL()),
    }
  } catch (error) {
    return { id: win?.id, error: error instanceof Error ? error.message : String(error) }
  }
}

const hex = (value: unknown) => (typeof value === 'number' ? `0x${value.toString(16).padStart(4, '0')}` : undefined)

/**
 * The graphics adapters and the GPU features that are not plainly enabled
 * (`app.getGPUInfo('basic')` and `app.getGPUFeatureStatus()`): what matters
 * for a black screen share or a video that does not decode.
 */
export function summarizeGpu(info: unknown, features: unknown): Record<string, unknown> {
  const raw = info && typeof info === 'object' ? (info as Record<string, unknown>) : {}
  const devices = Array.isArray(raw.gpuDevice) ? raw.gpuDevice : []
  const adapters = devices
    .filter((device): device is Record<string, unknown> => !!device && typeof device === 'object')
    .slice(0, 4)
    .map((device) => ({
      vendorId: hex(device.vendorId),
      deviceId: hex(device.deviceId),
      ...(typeof device.driverVendor === 'string' && device.driverVendor ? { driverVendor: device.driverVendor } : {}),
      ...(typeof device.driverVersion === 'string' && device.driverVersion ? { driverVersion: device.driverVersion } : {}),
      active: device.active === true,
    }))
  const renderer = (raw.auxAttributes as Record<string, unknown> | undefined)?.glRenderer

  const notEnabled: Record<string, string> = {}
  if (features && typeof features === 'object') {
    for (const [name, status] of Object.entries(features as Record<string, unknown>)) {
      if (typeof status === 'string' && status !== 'enabled') notEnabled[name] = status
    }
  }
  return { adapters, ...(typeof renderer === 'string' && renderer ? { renderer } : {}), notEnabled }
}

export function buildMainContext(input: MainContextInput): Record<string, unknown> {
  return {
    app: {
      version: input.version,
      packaged: input.packaged,
      instance: input.instance,
      ...(input.versions.electron ? { electron: input.versions.electron } : {}),
      ...(input.versions.chrome ? { chrome: input.versions.chrome } : {}),
      ...(input.versions.node ? { node: input.versions.node } : {}),
      platform: input.platform,
      arch: input.arch,
      osRelease: input.osRelease,
      ...(input.locale ? { locale: input.locale } : {}),
    },
    process: {
      uptimeSec: Math.round(input.uptimeSec),
      rssMb: Math.round(input.memory.rss / 1048576),
      heapMb: Math.round(input.memory.heapUsed / 1048576),
    },
    windows: input.windows.map(summarizeWindow),
    ...(input.extra ? { main: input.extra } : {}),
  }
}
