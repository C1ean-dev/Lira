import { afterEach, describe, expect, it, vi } from 'vitest'
import { ManualConnection } from '../../p2p/manualConnection'
import { decodeDirectInvite, encodeDirectInvite } from '../../p2p/directInvite'

class Channel extends EventTarget {
  readyState = 'connecting'
  send = vi.fn()
  close = vi.fn()
}
class PC extends EventTarget {
  localDescription: any
  remoteDescription: any
  iceGatheringState = 'complete'
  connectionState = 'new'
  channel = new Channel()
  close = vi.fn()
  createDataChannel = vi.fn(() => this.channel)
  createOffer = vi.fn(async () => ({ type: 'offer', sdp: 'v=0\r\no=offer' }))
  createAnswer = vi.fn(async () => ({ type: 'answer', sdp: 'v=0\r\no=answer' }))
  setLocalDescription = vi.fn(async (description) => { this.localDescription = { ...description, sdp: description.sdp + '\r\na=candidate:host' } })
  setRemoteDescription = vi.fn(async (description) => { this.remoteDescription = description })
}
afterEach(() => vi.useRealTimers())

describe('manual WebRTC bootstrap', () => {
  it('exchanges complete offers and answers, then binds the channel to the exact invited guest', async () => {
    const a = new PC(), b = new PC(), onLink = vi.fn()
    const host = new ManualConnection(() => a as any, onLink)
    const guest = new ManualConnection(() => b as any, vi.fn())
    const offer = await host.offer('ROOM')
    expect(decodeDirectInvite(offer).description.sdp).toContain('candidate:host')
    const answer = await guest.answer(offer)
    const wrong = { ...decodeDirectInvite(answer), session: 'another-session' }
    await expect(host.accept(encodeDirectInvite(wrong))).rejects.toThrow()
    expect(a.setRemoteDescription).not.toHaveBeenCalled()
    await host.accept(answer)
    expect(a.setRemoteDescription).toHaveBeenCalledWith(decodeDirectInvite(answer).description)
    a.channel.readyState = 'open'
    a.channel.dispatchEvent(new Event('open'))
    expect(onLink).toHaveBeenCalledWith(decodeDirectInvite(offer).guest, a.channel, a)
    host.close(); guest.close()
  })
  it('bounds gathering and expires an unanswered invitation, releasing its resources', async () => {
    vi.useFakeTimers()
    const pc = new PC()
    pc.iceGatheringState = 'gathering'
    const session = new ManualConnection(() => pc as any, vi.fn())
    const pending = session.offer('ROOM')
    await vi.advanceTimersByTimeAsync(10000)
    await expect(pending).resolves.toMatch(/^LIRA-DIRECT:/)
    await vi.advanceTimersByTimeAsync(10 * 60000)
    expect(pc.close).toHaveBeenCalled()
    session.close()
  })
  it('ignores late gathering after cancellation and cannot apply an answer twice', async () => {
    const pc = new PC(), host = new ManualConnection(() => pc as any, vi.fn())
    const offer = await host.offer('ROOM')
    const data = decodeDirectInvite(offer)
    const answer = encodeDirectInvite({ ...data, kind: 'answer', description: { type: 'answer', sdp: 'v=0\r\n' } })
    await host.accept(answer)
    await expect(host.accept(answer)).rejects.toThrow()
    host.close()
    await expect(host.accept(answer)).rejects.toThrow()
  })
  it('reports a failed bootstrap promptly instead of leaving a join waiting until expiry', async () => {
    const pc = new PC(), failed = vi.fn()
    const session = new ManualConnection(() => pc as any, vi.fn(), failed)
    await session.offer('ROOM')
    pc.connectionState = 'failed'
    pc.dispatchEvent(new Event('connectionstatechange'))
    expect(failed).toHaveBeenCalledWith(expect.any(Error))
    expect(pc.close).toHaveBeenCalled()
  })
})
