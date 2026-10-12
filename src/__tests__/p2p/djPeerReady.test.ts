import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { waitForDjPeerReady } from '../../p2p/djPeerReady'

describe('DJ signaling readiness', () => {
  afterEach(() => vi.useRealTimers())
  it('resolves only after signaling opens', async () => {
    const peer = new EventEmitter()
    const pending = waitForDjPeerReady(peer)
    peer.emit('open')
    await expect(pending).resolves.toBeUndefined()
    expect(peer.listenerCount('open')).toBe(0)
    expect(peer.listenerCount('error')).toBe(0)
  })
  it('rejects errors instead of announcing a connected DJ', async () => {
    const peer = new EventEmitter()
    const pending = waitForDjPeerReady(peer)
    peer.emit('error', new Error('offline'))
    await expect(pending).rejects.toThrow('offline')
  })
  it('rejects timeout instead of announcing a connected DJ', async () => {
    vi.useFakeTimers()
    const pending = waitForDjPeerReady(new EventEmitter(), 100)
    const check = expect(pending).rejects.toThrow(/DJ/)
    await vi.advanceTimersByTimeAsync(100)
    await check
  })
})
