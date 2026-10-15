import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { readBundledImageFrom } from '../../../electron/bundledImageReader'

const bytes = Buffer.from('an exact image fixture')
const hash = createHash('sha256').update(bytes).digest('hex')
const manifest = { version: 1, aliases: {}, images: { [hash]: { path: `assets/images/${hash}.png`, mime: 'image/png' } } }

describe('restricted bundled image reader', () => {
  it('reads a registered image without modifying its bytes', async () => {
    const read = vi.fn(async () => bytes)
    expect(await readBundledImageFrom('C:/app/dist', manifest, hash, read)).toBe(`data:image/png;base64,${bytes.toString('base64')}`)
    expect(read).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/dist[\\/]assets[\\/]images[\\/]/))
  })
  it.each(['../settings.json', 'f'.repeat(64), '', hash.toUpperCase()])('rejects unknown or invalid hashes before touching the filesystem: %s', async invalid => {
    const read = vi.fn()
    await expect(readBundledImageFrom('C:/app/dist', manifest, invalid, read)).rejects.toThrow()
    expect(read).not.toHaveBeenCalled()
  })
  it('rejects a forged manifest path and altered bytes', async () => {
    const read = vi.fn(async () => bytes)
    await expect(readBundledImageFrom('C:/app/dist', { ...manifest, images: { [hash]: { path: '../settings.json', mime: 'image/png' } } }, hash, read)).rejects.toThrow()
    expect(read).not.toHaveBeenCalled()
    await expect(readBundledImageFrom('C:/app/dist', manifest, hash, async () => Buffer.from('changed'))).rejects.toThrow()
  })
})
