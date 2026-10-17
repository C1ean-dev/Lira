import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildAtlas, readAtlas } from '../../assets/atlasService'

let worker: any
function installWorker() {
  vi.stubGlobal('document', { createElement: vi.fn(() => { throw new Error('PNG work reached the renderer') }) })
  vi.stubGlobal('Worker', class {
    onmessage: any; onerror: any; terminate = vi.fn(); postMessage = vi.fn()
    constructor() { worker = this }
  })
}
afterEach(() => { worker?.onerror?.({ message: 'test cleanup' }); vi.unstubAllGlobals() })
describe('atlas image work stays off the renderer', () => {
  it('routes atlas generation and decoding through a worker and preserves results', async () => {
    installWorker()
    const building = buildAtlas([], [])
    const request = worker.postMessage.mock.calls[0][0]
    expect(request.method).toBe('build')
    const pair = { xml: '<atlas/>', png: 'data:image/png;base64,AA' }
    worker.onmessage({ data: { id: request.id, result: pair } })
    expect(await building).toEqual(pair)
    const reading = readAtlas(pair)
    const second = worker.postMessage.mock.calls[1][0]
    expect(second.method).toBe('read')
    const doc = { assets: [], categories: [] }
    worker.onmessage({ data: { id: second.id, result: doc } })
    expect(await reading).toEqual(doc)
    expect(document.createElement).not.toHaveBeenCalled()
  })
  it('propagates worker failures without committing a partial atlas', async () => {
    installWorker()
    const result = buildAtlas([], []).catch(error => error)
    worker.onerror({ message: 'encoder failed' })
    expect((await result).message).toContain('encoder failed')
    expect(worker.terminate).toHaveBeenCalled()
  })
})