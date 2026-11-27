import { afterEach, describe, expect, it, vi } from 'vitest'
import { ALM_CONTROL_VERSION, AlmLive, type AlmEdge, type AlmLiveDeps } from '../../p2p/almLive'
import { AlmTree } from '../../p2p/almTree'
import { packetizeFrame, type AlmFrame } from '../../p2p/almPackets'

class FakePeerConnection {
  connectionState = 'connected'
  getConfiguration() { return {} }
  setConfiguration = vi.fn()
  close = vi.fn()
  createDataChannel() { return { readyState: 'connecting', close: vi.fn() } }
  async createOffer() { return { type: 'offer', sdp: 'test' } }
  async setLocalDescription() {}
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

async function harness() {
  vi.stubGlobal('RTCPeerConnection', FakePeerConnection)
  const deps: AlmLiveDeps = {
    id: () => 'relay', peers: () => [], eligible: () => true, watching: () => true,
    send: vi.fn(), ice: async () => ({}), stream: vi.fn(), rtp: vi.fn(), log: vi.fn(),
  }
  const live = new AlmLive(deps)
  // Exercise the native channel handlers without opening a browser or codecs.
  const internal = live as any
  const session = internal.makeSession('presenter', 'epoch', { codec: 'vp8', codedWidth: 1920, codedHeight: 1080, temporalLayers: 3 })
  internal.sessions.set(session.root, session)
  session.queue = { push: vi.fn(), reset: vi.fn() }
  session.audioQueue = { push: vi.fn(), reset: vi.fn() }
  async function link(edge: AlmEdge, bufferedAmount = 0) {
    session.edges.push(edge)
    const result = await internal.createLink(session, edge, false)
    const channel = {
      readyState: 'open', bufferedAmount, send: vi.fn(), close: vi.fn(),
      onmessage: null as ((event: { data: ArrayBuffer }) => void) | null,
    }
    internal.attachChannel(session, result, channel)
    return { link: result, channel }
  }
  const incoming = await link({ id: 'input', parent: 'presenter', child: 'relay', maxLayer: 2 })
  const child = await link({ id: 'child', parent: 'relay', child: 'viewer', maxLayer: 2 })
  return { live, deps, internal, session, incoming, child, link }
}

async function presenter() {
  const result = await harness()
  const { internal, session } = result
  internal.sessions.delete(session.root)
  session.root = 'relay'
  internal.sessions.set(session.root, session)
  session.edges = session.edges.filter((edge: AlmEdge) => edge.id !== 'input')
  session.links.delete('input')
  session.tree = new AlmTree('relay')
  session.tree.add('viewer')
  session.source = { requestKey: vi.fn() }
  session.viewers.set('viewer', Date.now())
  session.playing.add('viewer')
  return result
}

const video = (sequence = 0, key = true, temporalLayer = 0): AlmFrame => ({
  sequence, timestamp: sequence * 33_333, key, temporalLayer,
  layerSequences: [sequence, sequence, sequence], data: new Uint8Array(25_000),
})

describe('ALM live delivery over native channel handlers', () => {
  it('forwards undisplayed layers without copying their payloads into a contiguous buffer', async () => {
    const { incoming, child, session } = await harness()
    for (const packet of packetizeFrame(video())) incoming.channel.onmessage!({ data: packet })
    session.localLayer = 0
    session.queue.push.mockClear()
    child.channel.send.mockClear()
    const packets = packetizeFrame(video(1, false, 2))
    const copy = vi.spyOn(Uint8Array.prototype, 'set')
    for (const packet of packets) incoming.channel.onmessage!({ data: packet })
    expect(copy.mock.calls.length).toBe(0)
    expect(session.queue.push).not.toHaveBeenCalled()
    expect(child.channel.send).toHaveBeenCalledTimes(packets.length)
    expect(child.channel.send.mock.calls[0][0]).toBe(packets[0])
  })

  it('defers copying through the playback queue and remaps its sequence without altering forwarded headers', async () => {
    const { incoming, child, session } = await harness()
    session.localLayer = 0
    const source = { ...video(9), layerSequences: [2, 5, 9] }, packets = packetizeFrame(source)
    const copy = vi.spyOn(Uint8Array.prototype, 'set')
    for (const packet of packets) incoming.channel.onmessage!({ data: packet })
    expect(copy.mock.calls.length).toBe(0)
    const queued = session.queue.push.mock.calls[0][0] as AlmFrame
    expect(queued.sequence).toBe(2)
    expect(new DataView(child.channel.send.mock.calls[0][0]).getUint32(4)).toBe(9)
    expect(queued.data).toEqual(source.data)
    expect(copy.mock.calls.length).toBe(packets.length)
  })

  it('forwards the original validated packet buffers to every child and still assembles for local playback', async () => {
    const { session, incoming, child, link } = await harness()
    const sibling = await link({ id: 'sibling', parent: 'relay', child: 'other', maxLayer: 2 })
    const frame = video(), packets = packetizeFrame(frame)
    incoming.channel.onmessage!({ data: packets[2] })
    incoming.channel.onmessage!({ data: packets[0] })
    expect(child.channel.send).not.toHaveBeenCalled()
    incoming.channel.onmessage!({ data: packets[1] })
    expect(session.queue.push).toHaveBeenCalledWith(frame)
    for (const output of [child.channel, sibling.channel]) {
      expect(output.send).toHaveBeenCalledTimes(packets.length)
      packets.forEach((packet, index) => expect(output.send.mock.calls[index][0]).toBe(packet))
    }
  })

  it('keeps a congested edge from blocking siblings or audio, and waits for a keyframe to repair it', async () => {
    const { internal, session, child, link, deps } = await harness()
    const sibling = await link({ id: 'sibling', parent: 'relay', child: 'other', maxLayer: 2 })
    child.channel.bufferedAmount = 195_000
    internal.forward(session, video(1, false))
    expect(child.channel.send).not.toHaveBeenCalled()
    expect(child.link.blocked).toBe(1)
    expect(sibling.channel.send).toHaveBeenCalledTimes(3)
    expect(deps.send).toHaveBeenCalledWith('presenter', expect.objectContaining({ kind: 'key' }))
    const audio = { ...video(0), media: 'audio', data: new Uint8Array([1, 2]) }
    internal.forward(session, audio)
    expect(child.channel.send).toHaveBeenCalledOnce()
    child.channel.bufferedAmount = 0
    internal.forward(session, video(2, false))
    expect(child.channel.send).toHaveBeenCalledOnce()
    internal.forward(session, video(3, true))
    expect(child.channel.send).toHaveBeenCalledTimes(4)
    internal.forward(session, video(4, false))
    expect(child.channel.send).toHaveBeenCalledTimes(7)
  })

  it('preserves temporal filtering while forwarding the audio packets unchanged', async () => {
    const { incoming, child } = await harness()
    child.link.edge.maxLayer = 0
    for (const packet of packetizeFrame(video())) incoming.channel.onmessage!({ data: packet })
    child.channel.send.mockClear()
    for (const packet of packetizeFrame(video(1, false, 2))) incoming.channel.onmessage!({ data: packet })
    expect(child.channel.send).not.toHaveBeenCalled()
    const audio = packetizeFrame({ ...video(), media: 'audio', data: new Uint8Array([4, 5]) })[0]
    incoming.channel.onmessage!({ data: audio })
    expect(child.channel.send).toHaveBeenCalledOnce()
    expect(child.channel.send.mock.calls[0][0]).toBe(audio)
  })

  it('coalesces recovery keyframe requests from multiple congested children at the source', async () => {
    const { internal, session, child, link } = await harness()
    session.tree = new AlmTree('relay')
    session.source = { requestKey: vi.fn() }
    child.channel.bufferedAmount = 195_000
    await link({ id: 'sibling', parent: 'relay', child: 'other', maxLayer: 2 }, 195_000)
    internal.forward(session, video(1, false))
    expect(session.source.requestKey).toHaveBeenCalledOnce()
  })

  it('sizes each edge from its own fresh receipt and ignores stale delivery samples', async () => {
    const { internal, session, child, link } = await harness()
    const sibling = await link({ id: 'sibling', parent: 'relay', child: 'other', maxLayer: 2 }, 60_000)
    child.channel.bufferedAmount = 60_000
    child.link.deliveredBps = sibling.link.deliveredBps = 2_000_000
    child.link.receiptAt = Date.now()
    sibling.link.receiptAt = Date.now() - 6001
    internal.forward(session, video(1, false))
    expect(child.channel.send).not.toHaveBeenCalled()
    expect(sibling.channel.send).toHaveBeenCalledTimes(3)
  })

  it('requests selective RTP fallback once when a relay cannot admit a recovery keyframe', async () => {
    const { internal, session, child, deps, link } = await harness()
    const sibling = await link({ id: 'sibling', parent: 'relay', child: 'other', maxLayer: 2 })
    child.link.deliveredBps = 2_000_000
    child.link.receiptAt = Date.now()
    const frame = { ...video(), data: new Uint8Array(120_000) }
    internal.forward(session, frame)
    internal.forward(session, frame)
    expect(child.channel.send.mock.calls.length).toBe(0)
    expect(vi.mocked(deps.send).mock.calls.filter(([, msg]) => msg.kind === 'edge-fallback')).toHaveLength(1)
    expect(deps.send).toHaveBeenCalledWith('presenter', expect.objectContaining({ kind: 'edge-fallback', edge: 'child' }))
    expect(sibling.channel.send).toHaveBeenCalledTimes(20)
  })

  it('restores RTP for the oversized edge at the source and retains the healthy sibling', async () => {
    const { internal, session, child, deps, link } = await presenter()
    const sibling = await link({ id: 'sibling', parent: 'relay', child: 'other', maxLayer: 2 })
    session.tree.add('other')
    child.link.deliveredBps = 2_000_000
    child.link.receiptAt = Date.now()
    internal.forward(session, { ...video(), data: new Uint8Array(120_000) })
    expect(child.channel.send.mock.calls.length).toBe(0)
    expect(deps.rtp).toHaveBeenCalledWith('viewer', false)
    expect(deps.rtp).not.toHaveBeenCalledWith('other', false)
    expect(deps.send).toHaveBeenCalledWith('viewer', expect.objectContaining({ kind: 'stop' }))
    expect(session.tree.parents.has('viewer')).toBe(false)
    expect(session.tree.parents.get('other')).toBe('relay')
    expect(sibling.channel.send).toHaveBeenCalledTimes(10)
    expect(child.link.pc.close).toHaveBeenCalledOnce()
  })

  it('keeps the affected viewer on RTP through renewals and delayed ready messages after a recovery rejection', async () => {
    const { live, internal, session, child, deps } = await presenter()
    child.link.deliveredBps = 2_000_000
    child.link.receiptAt = Date.now()
    internal.forward(session, { ...video(), data: new Uint8Array(120_000) })
    vi.mocked(deps.send).mockClear()
    vi.mocked(deps.rtp).mockClear()

    const envelope = { v: ALM_CONTROL_VERSION, root: 'relay', epoch: 'epoch' }
    for (let retry = 0; retry < 3; retry++) {
      await live.receive('viewer', { ...envelope, kind: 'join', h: 4320 })
      await live.receive('viewer', { ...envelope, kind: 'ready' })
    }
    await live.receive('viewer', { ...envelope, kind: 'playing', edge: 'child' })
    expect(session.tree.parents.has('viewer')).toBe(false)
    expect(deps.send).not.toHaveBeenCalledWith('viewer', expect.objectContaining({ kind: 'config' }))
    expect(deps.rtp).not.toHaveBeenCalledWith('viewer', true)

    await live.receive('legacy-viewer', { ...envelope, v: 2, kind: 'join', h: 4320 })
    expect(deps.send).not.toHaveBeenCalledWith('legacy-viewer', expect.objectContaining({ kind: 'config' }))
    await live.receive('new-viewer', { ...envelope, kind: 'join', h: 4320 })
    expect(deps.send).toHaveBeenCalledWith('new-viewer', expect.objectContaining({ kind: 'config' }))
  })

  it('exposes playback health on the counters of the ALM stream shown to the viewer', async () => {
    const { live, session, incoming } = await harness()
    const stream = {} as MediaStream
    session.sink = { stream }
    session.confirmedInput = incoming.link.edge.id
    incoming.link.videoBytes = 20_000
    expect(live.transmissionCounters(stream, false)?.rows[0]).toMatchObject({
      freezeCount: 0, freezeDurationSec: 0, droppedFrames: 0,
    })
  })

  it('authenticates relay fallback reports against the current parent and reconnects its children', async () => {
    const { live, session, deps } = await presenter()
    session.tree.add('parent')
    session.tree.add('leaf')
    session.tree.parents.set('viewer', 'parent')
    session.tree.parents.set('leaf', 'viewer')
    session.edges = [
      { id: 'parent-viewer', parent: 'parent', child: 'viewer', maxLayer: 2 },
      { id: 'viewer-leaf', parent: 'viewer', child: 'leaf', maxLayer: 2 },
      { id: 'root-parent', parent: 'relay', child: 'parent', maxLayer: 2 },
    ]
    const report = { v: ALM_CONTROL_VERSION, root: 'relay', epoch: 'epoch', kind: 'edge-fallback', edge: 'parent-viewer' }
    await live.receive('leaf', report)
    await live.receive('parent', { ...report, epoch: 'old' })
    await live.receive('parent', { ...report, edge: 'retired-edge' })
    expect(deps.rtp).not.toHaveBeenCalled()
    await live.receive('parent', report)
    expect(deps.rtp).toHaveBeenCalledWith('viewer', false)
    expect(deps.rtp).not.toHaveBeenCalledWith('leaf', false)
    expect(session.tree.parents.has('viewer')).toBe(false)
    expect(session.tree.parents.has('leaf')).toBe(true)
    expect(session.tree.parents.get('leaf')).not.toBe('viewer')
  })

  it.each([
    { width: 1280, height: 720, frameRate: 60 },
    { width: 1920, height: 1080, frameRate: 30 },
  ])('still restarts capture on dimension/FPS changes with the same bitrate: %j', async settings => {
    const { internal, session } = await harness()
    const track = { getSettings: () => settings }
    session.capture = { track, fps: 60, hardware: true }
    const start = vi.spyOn(internal, 'start').mockResolvedValue(undefined)
    internal.updateBitrate(8_000_000)
    expect(start).toHaveBeenCalledWith(track, 8_000_000, settings.frameRate, true, undefined)
  })
})
