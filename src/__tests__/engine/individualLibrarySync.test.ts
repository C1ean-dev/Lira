import { describe, expect, it, vi } from 'vitest'
import { IndividualLibrarySync } from '../../assets/individualLibrarySync'
import { buildLibrary } from '../../assets/individualLibrary'
const asset = { id: 'hero', name: 'Hero', type: 'avatar' as const, category: 'People', frames: ['data:image/png;base64,aGVybw=='], width: 1, height: 1, createdAt: 1 }
describe('individual library peer synchronization', () => {
  it('requests only missing images, verifies them and publishes a complete document', async () => {
    const sender = new IndividualLibrarySync()
    const receiver = new IndividualLibrarySync(() => undefined)
    const fromSender: any[] = []; const fromReceiver: any[] = []
    const commit = vi.fn(async () => {})
    await sender.offer({ assets: [asset], categories: ['People'] }, message => fromSender.push(message))
    expect(fromSender[0].kind).toBe('offer')
    expect(JSON.stringify(fromSender[0])).not.toContain('data:image')
    await receiver.receive(fromSender.shift(), message => fromReceiver.push(message), commit)
    expect(fromReceiver[0]).toMatchObject({ kind: 'request', names: [expect.stringMatching(/\.png$/)] })
    await sender.receive(fromReceiver.shift(), message => fromSender.push(message), commit)
    for (const message of fromSender) await receiver.receive(message, message => fromReceiver.push(message), commit)
    expect(commit).toHaveBeenCalledOnce()
    expect(commit.mock.calls[0][0].assets[0].frames).toEqual(asset.frames)
    const packet = await buildLibrary({ assets: [asset], categories: [] })
    const cached = new IndividualLibrarySync(name => packet.images[name])
    const request = vi.fn()
    await cached.receive({ kind: 'offer', id: 'cached', catalog: packet.catalog }, request, commit)
    expect(request).not.toHaveBeenCalled()
    expect(commit).toHaveBeenCalledTimes(2)
  })
  it('rejects altered images and never publishes an incomplete library', async () => {
    const receiver = new IndividualLibrarySync(() => undefined)
    const packet = await buildLibrary({ assets: [asset], categories: [] })
    const commit = vi.fn(async () => {})
    await receiver.receive({ kind: 'offer', id: 'bad', catalog: packet.catalog }, () => {}, commit)
    await expect(receiver.receive({ kind: 'image', id: 'bad', name: packet.catalog.images[0], index: 0, total: 1, data: 'data:image/png;base64,YmFk' }, () => {}, commit)).rejects.toThrow()
    expect(commit).not.toHaveBeenCalled()
  })
})
