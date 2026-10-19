import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installRtcTransportPriority, DIRECT_ATTEMPT_MS, RELAY_ATTEMPT_MS } from '../../p2p/rtcTransportPriority'

const stun = [{ urls: 'stun:discovery.example:3478' }]
const cloudflare = [{ urls: 'turn:turn.cloudflare.com:3478?transport=udp', username: 'temporary', credential: 'credential' }]
const metered = [{ urls: 'turn:global.relay.metered.ca:80', username: 'metered', credential: 'credential' }]

class Connection extends EventTarget {
  connectionState = 'new'; iceConnectionState = 'new'; signalingState = 'stable'
  localDescription: any = null; remoteDescription: any = { type: 'answer', sdp: 'initial' }
  setConfiguration = vi.fn()
  getConfiguration = () => ({ iceServers: stun, iceTransportPolicy: 'all' })
  createOffer = vi.fn(async () => ({ type: 'offer', sdp: 'restart-offer' }))
  createAnswer = vi.fn(async () => ({ type: 'answer', sdp: 'restart-answer' }))
  setLocalDescription = vi.fn(async (sdp) => { this.localDescription = sdp })
  setRemoteDescription = vi.fn(async (sdp) => { this.remoteDescription = sdp })
  change(state: string) {
    this.iceConnectionState = state
    this.dispatchEvent(new Event('iceconnectionstatechange'))
  }
}

function fixture(incoming = false) {
  const pc = new Connection()
  const events = new Map<string, (() => void)[]>()
  const conn: any = { peer: 'remote', connectionId: 'dc_test', type: 'data', peerConnection: pc,
    metadata: { existing: true }, options: incoming ? { _payload: { liraIcePriorityVersion: 1 } } : {},
    on: (name, fn) => { events.set(name, [...events.get(name) || [], fn]) },
  }
  const normalHandle = vi.fn()
  const send = vi.fn()
  const peer: any = { socket: { send }, getConnection: () => conn,
    _handleMessage: normalHandle, _addConnection: vi.fn(), on: vi.fn() }
  const load = vi.fn(async () => cloudflare)
  installRtcTransportPriority(peer, { cloudflare: load, metered, discovery: stun })
  peer._addConnection('remote', conn)
  return { pc, conn, peer, load, send, normalHandle, close: () => events.get('close')?.forEach(fn => fn()) }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })
describe('P2P, Cloudflare, then Metered transport selection', () => {
  it('allows direct ICE first, then negotiates Cloudflare and Metered separately on the same connection', async () => {
    const f = fixture()
    expect(f.load).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(DIRECT_ATTEMPT_MS)
    expect(f.pc.setConfiguration).toHaveBeenLastCalledWith(expect.objectContaining({ iceServers: [...stun, ...cloudflare], iceTransportPolicy: 'all' }))
    expect(f.pc.createOffer).toHaveBeenCalledWith({ iceRestart: true })
    expect(f.send).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'OFFER', payload: expect.objectContaining({ connectionId: 'dc_test', liraIceRestart: 'cloudflare' }) }))
    await vi.advanceTimersByTimeAsync(RELAY_ATTEMPT_MS)
    expect(f.pc.setConfiguration).toHaveBeenLastCalledWith(expect.objectContaining({ iceServers: [...stun, ...metered] }))
    expect(f.pc.createOffer).toHaveBeenCalledTimes(2)
  })

  it('never allocates relay credentials when direct ICE succeeds', async () => {
    const f = fixture()
    f.pc.change('connected')
    await vi.advanceTimersByTimeAsync(30000)
    expect(f.load).not.toHaveBeenCalled()
    expect(f.pc.createOffer).not.toHaveBeenCalled()
  })

  it('keeps a working Cloudflare connection instead of trying Metered', async () => {
    const f = fixture()
    await vi.advanceTimersByTimeAsync(DIRECT_ATTEMPT_MS)
    f.pc.change('completed')
    await vi.advanceTimersByTimeAsync(30000)
    expect(f.pc.createOffer).toHaveBeenCalledTimes(1)
  })

  it('skips unavailable Cloudflare credentials and cancels work on close', async () => {
    const f = fixture()
    f.load.mockResolvedValue([])
    await vi.advanceTimersByTimeAsync(DIRECT_ATTEMPT_MS)
    expect(f.pc.setConfiguration).toHaveBeenLastCalledWith(expect.objectContaining({ iceServers: [...stun, ...metered] }))
    f.close()
    await vi.advanceTimersByTimeAsync(30000)
    expect(f.pc.createOffer).toHaveBeenCalledTimes(1)
  })

  it('answers a restart offer without letting PeerJS close and replace the existing connection', async () => {
    const f = fixture(true)
    await vi.advanceTimersByTimeAsync(10000)
    expect(f.pc.createOffer).not.toHaveBeenCalled()
    await f.peer._handleMessage({ type: 'OFFER', src: 'remote', payload: { connectionId: 'dc_test', liraIceRestart: 'cloudflare', sdp: { type: 'offer', sdp: 'remote-restart' } } })
    expect(f.pc.setRemoteDescription).toHaveBeenCalledWith({ type: 'offer', sdp: 'remote-restart' })
    expect(f.pc.setConfiguration).toHaveBeenCalledWith(expect.objectContaining({ iceServers: [...stun, ...cloudflare] }))
    expect(f.send).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'ANSWER', payload: expect.objectContaining({ connectionId: 'dc_test', sdp: { type: 'answer', sdp: 'restart-answer' } }) }))
  })

  it('suppresses terminal handlers while a fallback is being negotiated', async () => {
    const f = fixture()
    const terminal = vi.fn()
    f.pc.addEventListener('iceconnectionstatechange', terminal)
    f.pc.change('failed')
    await vi.advanceTimersByTimeAsync(0)
    expect(terminal).not.toHaveBeenCalled()
    expect(f.pc.createOffer).toHaveBeenCalledTimes(1)
  })

  it('does not revive closed connections when credentials arrive late', async () => {
    const f = fixture()
    let finish!: (servers: any) => void
    f.load.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    await vi.advanceTimersByTimeAsync(DIRECT_ATTEMPT_MS)
    f.close()
    finish(cloudflare)
    await vi.advanceTimersByTimeAsync(0)
    expect(f.pc.createOffer).not.toHaveBeenCalled()
  })

  it('waits for the initial answer before restarting ICE', async () => {
    const f = fixture()
    f.pc.remoteDescription = null
    f.pc.signalingState = 'have-local-offer'
    await vi.advanceTimersByTimeAsync(DIRECT_ATTEMPT_MS + 500)
    expect(f.pc.createOffer).not.toHaveBeenCalled()
    f.pc.remoteDescription = { type: 'answer', sdp: 'initial-answer' }
    f.pc.signalingState = 'stable'
    f.pc.dispatchEvent(new Event('signalingstatechange'))
    await vi.advanceTimersByTimeAsync(250)
    expect(f.pc.createOffer).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(DIRECT_ATTEMPT_MS - 250)
    expect(f.pc.createOffer).toHaveBeenCalledTimes(1)
  })

  it('queues candidates while the responder loads credentials for the new ICE generation', async () => {
    const f = fixture(true)
    let finish!: (servers: any) => void
    f.load.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const answer = f.peer._handleMessage({ type: 'OFFER', src: 'remote', payload: { connectionId: 'dc_test', liraIceRestart: 'cloudflare', sdp: { type: 'offer', sdp: 'new-generation' } } })
    const candidate = { type: 'CANDIDATE', src: 'remote', payload: { connectionId: 'dc_test', candidate: { candidate: 'new-candidate' } } }
    f.peer._handleMessage(candidate)
    // The old candidate handler must not receive the candidate before the new SDP.
    expect(f.normalHandle).not.toHaveBeenCalled()
    expect(f.pc.setRemoteDescription).not.toHaveBeenCalled()
    finish(cloudflare)
    await answer
    expect(f.pc.setRemoteDescription).toHaveBeenCalledTimes(1)
    expect(f.normalHandle).toHaveBeenCalledWith(candidate)
  })

  it('lets terminal ICE failure propagate after the last configured provider', async () => {
    const f = fixture()
    await vi.advanceTimersByTimeAsync(DIRECT_ATTEMPT_MS + RELAY_ATTEMPT_MS)
    const terminal = vi.fn()
    f.pc.addEventListener('iceconnectionstatechange', terminal)
    f.pc.change('failed')
    expect(terminal).toHaveBeenCalledOnce()
  })

  it('forwards candidates arriving after the restart SDP was applied while the answer is being created', async () => {
    const f = fixture(true)
    let finish!: (sdp: any) => void
    f.pc.createAnswer.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const pending = f.peer._handleMessage({ type: 'OFFER', src: 'remote', payload: { connectionId: 'dc_test', liraIceRestart: 'cloudflare', sdp: { type: 'offer', sdp: 'new-generation' } } })
    await vi.advanceTimersByTimeAsync(0)
    const candidate = { type: 'CANDIDATE', src: 'remote', payload: { connectionId: 'dc_test', candidate: { candidate: 'late-candidate' } } }
    f.peer._handleMessage(candidate)
    expect(f.normalHandle).toHaveBeenCalledWith(candidate)
    finish({ type: 'answer', sdp: 'answer' })
    await pending
  })

  it('does not send custom restarts to an older peer that lacks restart support', async () => {
    const f = fixture()
    f.peer._handleMessage({ type: 'ANSWER', src: 'remote', payload: { connectionId: 'dc_test', sdp: { type: 'answer', sdp: 'legacy-answer' } } })
    await vi.advanceTimersByTimeAsync(10000)
    expect(f.pc.createOffer).not.toHaveBeenCalled()
  })

  it('advertises restart support in signaling without modifying call metadata', () => {
    const f = fixture()
    f.peer.socket.send({ type: 'OFFER', payload: { metadata: f.conn.metadata } })
    expect(f.send).toHaveBeenCalledWith({ type: 'OFFER', payload: { metadata: { existing: true }, liraIcePriorityVersion: 1 } })
    expect(f.conn.metadata).toEqual({ existing: true })
  })
})
