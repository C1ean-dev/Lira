import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installRtcTransportPriority, observeVoiceRoute, DIRECT_ATTEMPT_MS, RELAY_ATTEMPT_MS, forceDegradedUpgrade } from '../../p2p/rtcTransportPriority'
import { MediaCallHandler } from '../../p2p/mediaCalls'
import { appTrail } from '../../utils/breadcrumbs'

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

function fixture(incoming = false, relays = metered, type = 'data') {
  const pc = new Connection()
  const events = new Map<string, (() => void)[]>()
  const conn: any = { peer: 'remote', connectionId: 'dc_test', type, peerConnection: pc, close: vi.fn(),
    metadata: { existing: true }, options: incoming ? { _payload: { liraIcePriorityVersion: 1 } } : {},
    on: (name, fn) => { events.set(name, [...events.get(name) || [], fn]) },
  }
  const normalHandle = vi.fn()
  const send = vi.fn()
  const peer: any = { socket: { send }, getConnection: () => conn,
    _handleMessage: normalHandle, _addConnection: vi.fn(), on: vi.fn() }
  const load = vi.fn(async () => cloudflare)
  installRtcTransportPriority(peer, { cloudflare: load, metered: relays, discovery: stun })
  peer._addConnection('remote', conn)
  return { pc, conn, peer, load, send, normalHandle, close: () => events.get('close')?.forEach(fn => fn()) }
}

beforeEach(() => { vi.useFakeTimers(); appTrail.clear() })
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })
describe('P2P, Cloudflare, then Metered transport selection', () => {
  it('leaves direct ICE running when all relay services are unavailable', async () => {
    const f = fixture(false, [])
    f.load.mockResolvedValue([])
    // A deployment without a Metered credential must still exhaust direct ICE.
    f.conn.close = vi.fn()
    await vi.advanceTimersByTimeAsync(DIRECT_ATTEMPT_MS)
    expect(f.conn.close).not.toHaveBeenCalled()
    expect(f.pc.connectionState).toBe('new')
  })

  it('still tries Metered if loading Cloudflare credentials rejects', async () => {
    const f = fixture()
    f.load.mockRejectedValue(new Error('provider offline'))
    await vi.advanceTimersByTimeAsync(DIRECT_ATTEMPT_MS + 1)
    expect(f.pc.setConfiguration).toHaveBeenLastCalledWith(expect.objectContaining({ iceServers: [...stun, ...metered] }))
  })
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
    const fallback = appTrail.list().filter(entry => entry.event === 'rtc.fallback-attempt')
    expect(fallback.map(entry => entry.data)).toEqual([
      expect.objectContaining({ connectionId: 'dc_test', tier: 'cloudflare', role: 'offerer' }),
      expect.objectContaining({ connectionId: 'dc_test', tier: 'metered', role: 'offerer' }),
    ])
    expect(JSON.stringify(fallback)).not.toContain('credential')
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
    expect(appTrail.list()).toContainEqual(expect.objectContaining({
      event: 'rtc.fallback-trigger',
      data: expect.objectContaining({ connectionId: 'dc_test', iceState: 'failed', role: 'offerer' }),
    }))
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

  it('allows forced degraded upgrade to Cloudflare TURN with relay policy even when connected', async () => {
    const f = fixture()
    f.pc.change('connected')
    await vi.advanceTimersByTimeAsync(5000)
    expect(f.pc.createOffer).not.toHaveBeenCalled()

    const upgraded = await forceDegradedUpgrade(f.pc, 'sustained_packet_loss_or_jitter')
    expect(upgraded).toBe(true)
    expect(f.pc.setConfiguration).toHaveBeenLastCalledWith(expect.objectContaining({
      iceServers: cloudflare,
      iceTransportPolicy: 'relay',
    }))
    expect(f.pc.createOffer).toHaveBeenCalledWith({ iceRestart: true })
    expect(f.send).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'OFFER',
      payload: expect.objectContaining({
        connectionId: 'dc_test',
        liraIceRestart: 'cloudflare',
        liraIceForceRelay: 1,
      }),
    }))

    // Verifies cooldown & session limit
    const secondAttempt = await forceDegradedUpgrade(f.pc, 'immediate_second_attempt')
    expect(secondAttempt).toBe(false)
    expect(f.pc.createOffer).toHaveBeenCalledTimes(1)
  })

  it('signals the originator when forceDegradedUpgrade is called on incoming non-originator connection', async () => {
    const f = fixture(true)
    f.pc.change('connected')

    const upgraded = await forceDegradedUpgrade(f.pc, 'callee_degraded')
    expect(upgraded).toBe(true)
    expect(f.pc.createOffer).not.toHaveBeenCalled()
    expect(f.send).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'CANDIDATE',
      dst: 'remote',
      payload: expect.objectContaining({
        connectionId: 'dc_test',
        liraRestartRequest: true,
        reason: 'callee_degraded',
      }),
    }))
  })

  it('originator handles CANDIDATE with liraRestartRequest from remote callee by executing ice restart offer', async () => {
    const f = fixture(false)
    f.pc.change('connected')

    f.peer._handleMessage({
      type: 'CANDIDATE',
      src: 'remote',
      payload: { connectionId: 'dc_test', liraRestartRequest: true, reason: 'remote_callee_bad_link' },
    })

    await vi.advanceTimersByTimeAsync(0)

    expect(f.pc.createOffer).toHaveBeenCalledWith({ iceRestart: true })
    expect(f.pc.setConfiguration).toHaveBeenLastCalledWith(expect.objectContaining({
      iceTransportPolicy: 'relay',
    }))
    expect(f.send).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'OFFER',
      payload: expect.objectContaining({
        connectionId: 'dc_test',
        liraIceRestart: 'cloudflare',
        liraIceForceRelay: 1,
      }),
    }))
  })
})

describe('automatic relay for sustained voice packet loss', () => {
  async function sample(f: ReturnType<typeof fixture>, index: number, lost: number, options: {
    pairId?: string; relayed?: boolean; direction?: 'inbound' | 'outbound'; packets?: number; rttMs?: number; timestamp?: number
  } = {}) {
    if (index > 0) await vi.advanceTimersByTimeAsync(10_000)
    observeVoiceRoute(f.conn, {
      pairId: options.pairId ?? 'direct',
      relayed: options.relayed ?? false,
      rttMs: options.rttMs ?? 26,
      [options.direction ?? 'inbound']: {
        id: 'audio', timestamp: options.timestamp ?? Date.now(), packets: options.packets ?? 500 * index, lost,
      },
    })
    await vi.advanceTimersByTimeAsync(0)
  }

  it.each(['inbound', 'outbound'] as const)('forces TURN on the existing call after three bad %s windows', async (direction) => {
    const f = fixture(false, metered, 'media')
    f.pc.change('connected')
    await sample(f, 0, 0, { direction })
    await sample(f, 1, 85, { direction })
    await sample(f, 2, 170, { direction })
    expect(f.load).not.toHaveBeenCalled()

    await sample(f, 3, 255, { direction })
    expect(f.pc.setConfiguration).toHaveBeenLastCalledWith({ iceServers: cloudflare, iceTransportPolicy: 'relay' })
    expect(f.pc.createOffer).toHaveBeenCalledExactlyOnceWith({ iceRestart: true })
    expect(f.send).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'OFFER', payload: expect.objectContaining({ connectionId: 'dc_test', liraIceRestart: 'cloudflare' }),
    }))
    expect(f.conn.close).not.toHaveBeenCalled()
    f.pc.signalingState = 'have-local-offer'
    const answer = { type: 'ANSWER', src: 'remote', payload: {
      connectionId: 'dc_test', liraIceRestart: 'cloudflare', sdp: { type: 'answer', sdp: 'relay-answer' },
    } }
    f.peer._handleMessage(answer)
    expect(f.normalHandle).toHaveBeenCalledWith(answer)
    f.pc.signalingState = 'stable'

    await sample(f, 4, 255, { direction, pairId: 'new-pair', relayed: true, rttMs: 42 })
    await sample(f, 5, 260, { direction, pairId: 'new-pair', relayed: true, rttMs: 43 })
    expect(f.pc.createOffer).toHaveBeenCalledTimes(1)
    expect(appTrail.list()).toContainEqual(expect.objectContaining({
      event: 'rtc.voice-route-recovery',
      data: expect.objectContaining({ result: 'relay-selected' }),
    }))
    expect(appTrail.list()).toContainEqual(expect.objectContaining({
      event: 'rtc.voice-route-recovery',
      data: expect.objectContaining({
        result: 'relay-quality', direction, directLossPct: 17, directRttMs: 26, relayLossPct: 1, relayRttMs: 43,
      }),
    }))
  })

  it('resets the loss streak on healthy windows and when the selected pair changes', async () => {
    const f = fixture(false, metered, 'media')
    f.pc.change('connected')
    await sample(f, 0, 0)
    await sample(f, 1, 80)
    await sample(f, 2, 80)
    await sample(f, 3, 160)
    await sample(f, 4, 240)
    await sample(f, 5, 320, { pairId: 'other' })
    await sample(f, 6, 400, { pairId: 'other' })
    await sample(f, 7, 480, { pairId: 'other' })
    expect(f.pc.createOffer).not.toHaveBeenCalled()
    await sample(f, 8, 560, { pairId: 'other' })
    expect(f.pc.createOffer).toHaveBeenCalledOnce()
  })

  it('ignores a tiny sample, counters that restart, and loss on a route already using a relay', async () => {
    const f = fixture(false, metered, 'media')
    f.pc.change('connected')
    await sample(f, 0, 0)
    await sample(f, 1, 5, { packets: 10 })
    await sample(f, 2, 6, { packets: 20 })
    await sample(f, 3, 8, { packets: 30 })
    await sample(f, 4, 80)
    await sample(f, 5, 160)
    await sample(f, 6, 1, { packets: 50 })
    await sample(f, 7, 85, { relayed: true })
    await sample(f, 8, 170, { relayed: true })
    await sample(f, 9, 255, { relayed: true })
    expect(f.pc.createOffer).not.toHaveBeenCalled()
  })

  it('does not use a stale remote report as a fresh sample of sent audio', async () => {
    const f = fixture(false, metered, 'media')
    f.pc.change('connected')
    for (let index = 0; index <= 3; index++) {
      await sample(f, index, index * 85, { direction: 'outbound', timestamp: 1 })
    }
    expect(f.pc.createOffer).not.toHaveBeenCalled()
  })

  it.each(['data', 'legacy', 'closed'])('leaves %s sessions alone', async (kind) => {
    const f = fixture(false, metered, kind === 'data' ? 'data' : 'media')
    f.pc.change('connected')
    if (kind === 'legacy') f.peer._handleMessage({ type: 'ANSWER', src: 'remote', payload: { connectionId: 'dc_test' } })
    if (kind === 'closed') f.close()
    for (let index = 0; index <= 3; index++) await sample(f, index, index * 85)
    expect(f.load).not.toHaveBeenCalled()
    expect(f.pc.createOffer).not.toHaveBeenCalled()
  })

  it('tries Metered if Cloudflare has no TURN credentials', async () => {
    const f = fixture(false, metered, 'media')
    f.pc.change('connected')
    f.load.mockResolvedValue([])
    for (let index = 0; index <= 3; index++) await sample(f, index, index * 85)
    expect(f.pc.setConfiguration).toHaveBeenLastCalledWith({ iceServers: metered, iceTransportPolicy: 'relay' })
  })

  it('preserves the direct configuration if no relay is available', async () => {
    const f = fixture(false, [], 'media')
    f.pc.change('connected')
    f.load.mockResolvedValue([])
    for (let index = 0; index <= 5; index++) await sample(f, index, index * 85)
    expect(f.load).toHaveBeenCalledOnce()
    expect(f.pc.setConfiguration).not.toHaveBeenCalled()
    expect(f.conn.close).not.toHaveBeenCalled()
  })

  it('can use a relay that becomes available after the initial connection attempts', async () => {
    const f = fixture(false, [], 'media')
    f.load.mockResolvedValueOnce([])
    await vi.advanceTimersByTimeAsync(DIRECT_ATTEMPT_MS)
    expect(f.pc.createOffer).not.toHaveBeenCalled()
    f.pc.change('connected')
    for (let index = 0; index <= 3; index++) await sample(f, index, index * 85)
    expect(f.pc.setConfiguration).toHaveBeenLastCalledWith({ iceServers: cloudflare, iceTransportPolicy: 'relay' })
  })

  it('redials an incoming call over TURN after sustained direct loss without sending an incompatible restart offer', async () => {
    const f = fixture(true, metered, 'media')
    f.pc.change('connected')
    for (let index = 0; index <= 3; index++) await sample(f, index, index * 235)
    expect(f.conn.close).toHaveBeenCalledOnce()
    expect(f.pc.createOffer).not.toHaveBeenCalled()
    f.close()
    const nextPc = new Connection()
    const replacement = { ...f.conn, connectionId: 'relay-replacement', options: {}, peerConnection: nextPc }
    f.peer._addConnection('remote', replacement)
    expect(nextPc.setConfiguration).toHaveBeenLastCalledWith({ iceServers: cloudflare, iceTransportPolicy: 'relay' })
    expect(appTrail.list()).toContainEqual(expect.objectContaining({ event: 'rtc.voice-route-recovery',
      data: expect.objectContaining({ result: 'redial-relay', directLossPct: 47 }) }))
  })

  it('keeps an incoming call intact when there are no relay credentials', async () => {
    const f = fixture(true, [], 'media')
    f.load.mockResolvedValue([])
    f.pc.change('connected')
    for (let index = 0; index <= 3; index++) await sample(f, index, index * 235)
    expect(f.conn.close).not.toHaveBeenCalled()
    expect(f.pc.setConfiguration).not.toHaveBeenCalled()
  })

  it('releases a pinned relay after it fails so recovery can return to direct ICE', async () => {
    const f = fixture(true, metered, 'media')
    f.pc.change('connected')
    for (let index = 0; index <= 3; index++) await sample(f, index, index * 235)
    f.close()
    const relayPc = new Connection()
    f.peer._addConnection('remote', { ...f.conn, options: {}, peerConnection: relayPc })
    expect(relayPc.setConfiguration).toHaveBeenCalled()
    relayPc.change('failed')
    const retryPc = new Connection()
    f.peer._addConnection('remote', { ...f.conn, options: {}, peerConnection: retryPc })
    expect(retryPc.setConfiguration).not.toHaveBeenCalled()
  })

  it('restores the previous policy when the relay never becomes the selected route', async () => {
    const f = fixture(false, metered, 'media')
    f.pc.change('connected')
    f.pc.setLocalDescription.mockImplementation(async (sdp) => {
      f.pc.localDescription = sdp
      f.pc.signalingState = sdp.type === 'rollback' ? 'stable' : 'have-local-offer'
    })
    for (let index = 0; index <= 5; index++) await sample(f, index, index * 85)
    expect(f.pc.setConfiguration).toHaveBeenLastCalledWith({ iceServers: stun, iceTransportPolicy: 'all' })
    expect(f.pc.setLocalDescription).toHaveBeenLastCalledWith({ type: 'rollback' })
    expect(f.pc.createOffer).toHaveBeenCalledTimes(1)
    expect(f.conn.close).not.toHaveBeenCalled()

    f.peer._handleMessage({ type: 'ANSWER', src: 'remote', payload: {
      connectionId: 'dc_test', liraIceRestart: 'cloudflare', sdp: { type: 'answer', sdp: 'late-answer' },
    } })
    expect(f.normalHandle).not.toHaveBeenCalled()
  })

  it('keeps regular ICE recovery available while fetching credentials for the voice relay', async () => {
    const f = fixture(false, metered, 'media')
    f.pc.change('connected')
    let provideCredentials!: (servers: typeof cloudflare) => void
    const pending = new Promise<typeof cloudflare>(resolve => { provideCredentials = resolve })
    f.load.mockReturnValue(pending)
    for (let index = 0; index <= 3; index++) await sample(f, index, index * 85)
    f.pc.change('failed')
    provideCredentials(cloudflare)
    await vi.advanceTimersByTimeAsync(0)
    expect(f.pc.setConfiguration).toHaveBeenLastCalledWith({
      iceServers: [...stun, ...cloudflare], iceTransportPolicy: 'all',
    })
    expect(f.pc.createOffer).toHaveBeenCalledOnce()
  })

  it('does not immediately repeat the relay trial when the same peer is redialed', async () => {
    const f = fixture(false, metered, 'media')
    f.pc.change('connected')
    for (let index = 0; index <= 3; index++) await sample(f, index, index * 85)
    f.close()

    const pc = new Connection()
    const conn = { ...f.conn, connectionId: 'replacement', peerConnection: pc }
    f.peer._addConnection('remote', conn)
    pc.change('connected')
    for (let index = 0; index <= 3; index++) await sample({ ...f, pc, conn }, index, index * 85)
    expect(pc.createOffer).not.toHaveBeenCalled()

    for (let index = 4; index <= 12; index++) await sample({ ...f, pc, conn }, index, index * 85)
    expect(pc.createOffer).toHaveBeenCalledOnce()
  })

  it.each(['inbound', 'outbound'])('uses the periodic WebRTC %s voice counters for the selected pair', async (direction) => {
    const f = fixture(false, metered, 'media')
    f.pc.change('connected')
    let index = 0
    Object.assign(f.pc, { getStats: async () => new Map<string, object>([
      ['transport', { type: 'transport', selectedCandidatePairId: 'pair' }],
      ['pair', { type: 'candidate-pair', localCandidateId: 'local', remoteCandidateId: 'remote' }],
      ['local', { candidateType: 'srflx' }],
      ['remote', { candidateType: 'srflx' }],
      ['in', { id: 'in', type: 'inbound-rtp', kind: 'audio', timestamp: Date.now(),
        packetsReceived: index * (direction === 'inbound' ? 415 : 500), packetsLost: direction === 'inbound' ? 85 * index : 0 }],
      ['out', { id: 'out', type: 'outbound-rtp', kind: 'audio', packetsSent: 500 * index }],
      ['rtcp', { id: 'rtcp', type: 'remote-inbound-rtp', kind: 'audio', localId: 'out',
        timestamp: Date.now(), packetsLost: direction === 'outbound' ? 85 * index : 0 }],
      ['video', { id: 'video', type: 'inbound-rtp', kind: 'video', packetsReceived: 200, packetsLost: 0 }],
    ]) })
    for (; index <= 3; index++) {
      await vi.advanceTimersByTimeAsync(10_000)
      await MediaCallHandler.logReceiverSnapshot(f.conn, 'remote', 'periodic', () => true)
    }
    await vi.advanceTimersByTimeAsync(0)
    expect(f.pc.createOffer).toHaveBeenCalledOnce()
  })
})
