import fs from 'fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
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
  const content = serializeNativeData(data)
  const temporary = temporaryPath(filePath)
  try {
    fs.writeFileSync(temporary, content, { encoding: 'utf-8', flag: 'wx' })
    fs.renameSync(temporary, filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      try { fs.unlinkSync(temporary) } catch { /* A failed write may not have created the temporary file. */ }
    }
    throw error
  }
}

function temporaryPath(filePath: string): string {
  // Same directory permits replacement only after the entire JSON has been written and closed.
  return path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`)
}

async function replaceFile(temporary: string, filePath: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try { await fs.promises.rename(temporary, filePath); return }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (attempt >= 10 || !['EBUSY', 'EPERM', 'EACCES'].includes(code || '')) throw error
      await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1)))
    }
  }
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
  const content = await serializeNativeDataAsync(data, options)
  const temporary = temporaryPath(filePath)
  try {
    await fs.promises.writeFile(temporary, content, { encoding: 'utf-8', flag: 'wx' })
    await replaceFile(temporary, filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      await fs.promises.unlink(temporary).catch(() => {})
    }
    throw error
  }
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
