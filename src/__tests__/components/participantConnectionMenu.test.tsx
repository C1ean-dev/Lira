import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ParticipantContextMenu } from '../../components/grid/ParticipantContextMenu'
import type { ParticipantData } from '../../components/grid/GridParticipantTile'
import { useNetworkQualityStore } from '../../store/useNetworkQualityStore'
import { useGameStore } from '../../store/useGameStore'

const peerManagerMock = {
  hasActiveMediaCall: vi.fn(() => true),
  refreshPeerConnectionStats: vi.fn(),
  switchPeerConnectionTransport: vi.fn(async () => ({ ok: true })),
  sendUserAudioIsolation: vi.fn(),
  sendAdminMuteParticipant: vi.fn(),
  sendAdminDeafenParticipant: vi.fn(),
}

vi.mock('../../data/nativeAssets.json', () => ({ default: { categories: [], assets: [] } }))
vi.mock('../../p2p/PeerManager', () => ({
  PeerManager: { getInstance: () => peerManagerMock },
}))
vi.mock('../../media/MediaManager', () => ({
  MediaManager: { getInstance: () => ({ setDjVolume: vi.fn() }) },
}))
vi.mock('../../store/useMapStore', () => ({
  useMapStore: (select: any) => select({ mapData: { zones: [] } }),
}))
vi.mock('../../store/useGameStore', async () => {
  const actual = await vi.importActual<typeof import('../../store/useGameStore')>('../../store/useGameStore')
  return { ...actual, useGameStore: Object.assign((select: any) => select(actual.useGameStore.getState()), actual.useGameStore) }
})
vi.mock('../../store/useNetworkQualityStore', async () => {
  const actual = await vi.importActual<typeof import('../../store/useNetworkQualityStore')>('../../store/useNetworkQualityStore')
  return {
    ...actual,
    useNetworkQualityStore: Object.assign((select: any) => select(actual.useNetworkQualityStore.getState()), actual.useNetworkQualityStore),
    useUserNetworkQuality: (peerId?: string, isLocal?: boolean) =>
      actual.getUserNetworkQuality(actual.useNetworkQualityStore.getState(), peerId, isLocal),
  }
})

const originalGame = useGameStore.getState()

afterEach(() => {
  useNetworkQualityStore.getState().clearAll()
  useGameStore.setState(originalGame)
  vi.clearAllMocks()
  peerManagerMock.hasActiveMediaCall.mockReturnValue(true)
  peerManagerMock.switchPeerConnectionTransport.mockResolvedValue({ ok: true })
  vi.unstubAllGlobals()
})

function capture(render: () => React.ReactElement) {
  let tree: React.ReactElement
  function Probe() { tree = render(); return null }
  renderToStaticMarkup(<Probe />)
  const elements: React.ReactElement[] = []
  function visit(node: React.ReactNode) {
    React.Children.forEach(node, (child) => {
      if (!React.isValidElement(child)) return
      elements.push(child)
      visit((child.props as any).children)
    })
  }
  visit(tree!)
  return elements
}

const remoteUser: ParticipantData = {
  id: 'peer-alice',
  name: 'Alice',
  stream: null,
  isLocal: false,
}

describe('ParticipantContextMenu connection status and manual TURN switch', () => {
  it('shows current Direct P2P connection details and allows switching manually to TURN', async () => {
    vi.stubGlobal('window', { innerWidth: 1200, innerHeight: 900 })
    useNetworkQualityStore.getState().setPeerQuality('peer-alice', {
      pingMs: 28,
      lossPct: 1,
      jitterMs: 6,
      route: 'direct',
      protocol: 'udp',
      transportPreference: 'auto',
      isSwitchingTransport: false,
    })

    const onClose = vi.fn()
    const html = renderToStaticMarkup(<ParticipantContextMenu user={remoteUser} x={100} y={100} onClose={onClose} />)
    expect(html).toContain('P2P Direta')
    expect(html).toContain('28ms')
    expect(html).toContain('1% perda')
    expect(html).toContain('UDP')
    expect(html).toContain('Automático')
    expect(html).not.toContain('Voltar para automático')

    const elements = capture(() => ParticipantContextMenu({ user: remoteUser, x: 100, y: 100, onClose }))
    const turnButton = elements.find((el) => el.type === 'button' && el.props['data-testid'] === 'connection-switch-turn')!
    expect(turnButton.props.disabled).toBe(false)

    await turnButton.props.onClick({ stopPropagation() {} })
    expect(peerManagerMock.switchPeerConnectionTransport).toHaveBeenCalledWith('peer-alice', 'turn')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('shows TURN provider, manual mode, and supports switching back to Direct or Auto', async () => {
    vi.stubGlobal('window', { innerWidth: 1200, innerHeight: 900 })
    useNetworkQualityStore.getState().setPeerQuality('peer-alice', {
      pingMs: 64,
      lossPct: 0,
      jitterMs: 8,
      route: 'turn',
      turnProvider: 'cloudflare',
      protocol: 'tcp',
      transportPreference: 'turn',
      isSwitchingTransport: false,
    })

    const html = renderToStaticMarkup(<ParticipantContextMenu user={remoteUser} x={100} y={100} onClose={() => {}} />)
    expect(html).toContain('TURN (Cloudflare)')
    expect(html).toContain('64ms')
    expect(html).toContain('Manual')
    expect(html).toContain('Voltar para automático')

    const elements = capture(() => ParticipantContextMenu({ user: remoteUser, x: 100, y: 100, onClose() {} }))
    const directBtn = elements.find((el) => el.type === 'button' && el.props['data-testid'] === 'connection-switch-direct')!
    const turnBtn = elements.find((el) => el.type === 'button' && el.props['data-testid'] === 'connection-switch-turn')!
    const autoBtn = elements.find((el) => el.type === 'button' && el.props['data-testid'] === 'connection-switch-auto')!

    expect(directBtn.props.disabled).toBe(false)
    expect(turnBtn.props.disabled).toBe(true)

    await directBtn.props.onClick({ stopPropagation() {} })
    expect(peerManagerMock.switchPeerConnectionTransport).toHaveBeenCalledWith('peer-alice', 'direct')

    await autoBtn.props.onClick({ stopPropagation() {} })
    expect(peerManagerMock.switchPeerConnectionTransport).toHaveBeenCalledWith('peer-alice', 'auto')
  })

  it('displays Relay (Host) and Switching state while disabling buttons during transition', () => {
    vi.stubGlobal('window', { innerWidth: 1200, innerHeight: 900 })
    useNetworkQualityStore.getState().setPeerQuality('peer-alice', {
      pingMs: 40,
      lossPct: 0,
      route: 'super-peer',
      transportPreference: 'auto',
      isSwitchingTransport: false,
    })
    const superPeerHtml = renderToStaticMarkup(<ParticipantContextMenu user={remoteUser} x={0} y={0} onClose={() => {}} />)
    expect(superPeerHtml).toContain('Relay (Host)')

    useNetworkQualityStore.getState().setPeerQuality('peer-alice', {
      isSwitchingTransport: true,
    })
    const switchingHtml = renderToStaticMarkup(<ParticipantContextMenu user={remoteUser} x={0} y={0} onClose={() => {}} />)
    expect(switchingHtml).toContain('Trocando rota...')

    const elements = capture(() => ParticipantContextMenu({ user: remoteUser, x: 0, y: 0, onClose() {} }))
    const directBtn = elements.find((el) => el.type === 'button' && el.props['data-testid'] === 'connection-switch-direct')!
    const turnBtn = elements.find((el) => el.type === 'button' && el.props['data-testid'] === 'connection-switch-turn')!
    expect(directBtn.props.disabled).toBe(true)
    expect(turnBtn.props.disabled).toBe(true)
  })

  it('hides connection controls for local user and DJ bot', () => {
    vi.stubGlobal('window', { innerWidth: 1200, innerHeight: 900 })
    const localHtml = renderToStaticMarkup(
      <ParticipantContextMenu user={{ ...remoteUser, isLocal: true }} x={0} y={0} onClose={() => {}} />
    )
    const djHtml = renderToStaticMarkup(
      <ParticipantContextMenu user={{ id: 'dj-room', name: 'DJ', isDjBot: true, stream: null }} x={0} y={0} onClose={() => {}} />
    )

    expect(localHtml).not.toContain('connection-current-route')
    expect(djHtml).not.toContain('connection-current-route')
  })
})
