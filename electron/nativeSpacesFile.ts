import fs from 'fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createLatestWriter } from './latestWriter'

function temporaryPath(filePath: string): string {
  return path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`)
}

function replaceFileSync(temporary: string, filePath: string): void {
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(temporary, filePath)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (attempt >= 10 || !['EBUSY', 'EPERM', 'EACCES'].includes(code || '')) {
        try {
          fs.unlinkSync(temporary)
        } catch {}
        throw error
      }
      const waitMs = 25 * (attempt + 1)
      const start = Date.now()
      while (Date.now() - start < waitMs) {
        // short busy-wait for sync Windows lock release
      }
    }
  }
}

async function replaceFileAsync(temporary: string, filePath: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.promises.rename(temporary, filePath)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (attempt >= 10 || !['EBUSY', 'EPERM', 'EACCES'].includes(code || '')) {
        await fs.promises.unlink(temporary).catch(() => {})
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)))
    }
  }
}

export function writeNativeSpacesFile(filePath: string, spaces: any[]): void {
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  const content = JSON.stringify(Array.isArray(spaces) ? spaces : [], null, 2) + '\n'
  const temporary = temporaryPath(filePath)
  try {
    fs.writeFileSync(temporary, content, { encoding: 'utf-8', flag: 'wx' })
    replaceFileSync(temporary, filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      try {
        fs.unlinkSync(temporary)
      } catch {}
    }
    throw error
  }
}

export async function writeNativeSpacesFileAsync(filePath: string, spaces: any[]): Promise<void> {
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) {
    await fs.promises.mkdir(dir, { recursive: true })
  }
  const content = JSON.stringify(Array.isArray(spaces) ? spaces : [], null, 2) + '\n'
  const temporary = temporaryPath(filePath)
  try {
    await fs.promises.writeFile(temporary, content, { encoding: 'utf-8', flag: 'wx' })
    await replaceFileAsync(temporary, filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      await fs.promises.unlink(temporary).catch(() => {})
    }
    throw error
  }
}

const latestSpacesWriter = createLatestWriter<{ spaces: any[] }>((filePath, job) =>
  writeNativeSpacesFileAsync(filePath, job.spaces)
)

export function writeNativeSpacesFileLatest(filePath: string, spaces: any[]): Promise<void> {
  return latestSpacesWriter(filePath, { spaces })
}

export function ensureNativeSpacesFile(filePath: string): boolean {
  try {
    if (!fs.existsSync(filePath)) {
      writeNativeSpacesFile(filePath, [])
      return true
    }

    const raw = fs.readFileSync(filePath, 'utf-8')
    if (!raw || raw.trim() === '') {
      writeNativeSpacesFile(filePath, [])
      return true
    }

    try {
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) {
        writeNativeSpacesFile(filePath, [])
        return true
      }
      return false
    } catch {
      writeNativeSpacesFile(filePath, [])
      return true
    }
  } catch (err) {
    console.warn('[NativeSpaces] ensureNativeSpacesFile error:', err)
    try {
      writeNativeSpacesFile(filePath, [])
      return true
    } catch {
      return false
    }
  }
}

export function readNativeSpacesFile(filePath: string): any[] {
  ensureNativeSpacesFile(filePath)
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    writeNativeSpacesFile(filePath, [])
    return []
  }
}
