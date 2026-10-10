import fs from 'fs'
import { packImages, packImagesAsync, unpackImages } from '../src/utils/imageTable'
import { createLatestWriter } from './latestWriter'
import { optimizePngDataUrl } from './pngOptimizer'

export interface WriteOptions {
  optimize?: boolean
}

export function serializeNativeData(data: Record<string, unknown>): string {
  return JSON.stringify(packImages(data, { transform: optimizePngDataUrl }), null, 2)
}

export function writeNativeDataFile(filePath: string, data: Record<string, unknown>): void {
  fs.writeFileSync(filePath, serializeNativeData(data), 'utf-8')
}

const pauseForEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve))

export async function serializeNativeDataAsync(data: Record<string, unknown>, options: WriteOptions = {}): Promise<string> {
  const packed = await packImagesAsync(data, {
    transform: options.optimize === false ? undefined : optimizePngDataUrl,
    pause: pauseForEventLoop,
  })
  return JSON.stringify(packed, null, 2)
}

export async function writeNativeDataFileAsync(
  filePath: string,
  data: Record<string, unknown>,
  options: WriteOptions = {}
): Promise<void> {
  await fs.promises.writeFile(filePath, await serializeNativeDataAsync(data, options), 'utf-8')
}

const latest = createLatestWriter<{ data: Record<string, unknown>; options: WriteOptions }>((filePath, job) =>
  writeNativeDataFileAsync(filePath, job.data, job.options)
)

export function writeNativeDataFileLatest(
  filePath: string,
  data: Record<string, unknown>,
  options: WriteOptions = {}
): Promise<void> {
  return latest(filePath, { data, options })
}

export function readNativeDataFile(filePath: string): Record<string, unknown> {
  return unpackImages(JSON.parse(fs.readFileSync(filePath, 'utf-8')))
}
