import fs from 'fs'
import { packImages, packImagesAsync, unpackImages } from '../src/utils/imageTable'
import { createLatestWriter } from './latestWriter'
import { optimizePngDataUrl } from './pngOptimizer'

// How src/data/nativeAssets.json is written and read. The app hands over the data
// with every picture written out wherever it is used; on disk each distinct picture
// is kept once, re-encoded to fewer bytes, in an "images" table (see
// src/utils/imageTable.ts). Reading gives the full data back, and still understands
// a file in the old format.

export interface WriteOptions {
  /**
   * Re-encode the pictures to fewer bytes (default). Recoding a whole file takes a couple of seconds, so
   * the installed app turns it off: it never reads this file back.
   */
  optimize?: boolean
}

export function serializeNativeData(data: Record<string, unknown>): string {
  return JSON.stringify(packImages(data, { transform: optimizePngDataUrl }), null, 2)
}

export function writeNativeDataFile(filePath: string, data: Record<string, unknown>): void {
  fs.writeFileSync(filePath, serializeNativeData(data), 'utf-8')
}

const pauseForEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve))

/** serializeNativeData in time slices: the process keeps answering while the pictures are recoded. */
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

/**
 * What the app uses to save: one write at a time, and when saves pile up only the last one is written.
 * Resolves when the file has what was asked for (or something newer).
 */
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
