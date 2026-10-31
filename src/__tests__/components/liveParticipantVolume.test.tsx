import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ParticipantContextMenu } from '../../components/grid/ParticipantContextMenu'
import { GridParticipantTile, ParticipantData } from '../../components/grid/GridParticipantTile'
import { RemoteAudio } from '../../components/common/RemoteAudio'
import { LiveTransmissionInfo } from '../../components/grid/LiveTransmissionInfo'
import { useMediaStore } from '../../store/useMediaStore'

vi.mock('../../data/nativeAssets.json', () => ({ default: { categories: [], assets: [] } }))
vi.mock('../../p2p/PeerManager', () => ({ PeerManager: {} }))
vi.mock('../../media/MediaManager', () => ({ MediaManager: { getInstance: () => ({ setDjVolume: vi.fn() }) } }))
vi.mock('../../store/useMapStore', () => ({ useMapStore: (select: any) => select({ mapData: { zones: [] } }) }))
vi.mock('../../hooks/useLiveGate', () => ({ useLiveGate: () => ({ needsClick: false, watching: true }) }))
vi.mock('../../hooks/useLiveViewBox', () => ({ useLiveViewBox: () => {} }))
vi.mock('../../store/useNetworkQualityStore', () => ({ useUserNetworkQuality: () => ({ rating: 'good', pingMs: 10, lossPct: 0 }) }))
vi.mock('../../store/useMediaStore', async () => {
  const actual = await vi.importActual<typeof import('../../store/useMediaStore')>('../../store/useMediaStore')
  return { ...actual, useMediaStore: Object.assign((select: any) => select(actual.useMediaStore.getState()), actual.useMediaStore) }
})

const originalMedia = useMediaStore.getState()
afterEach(() => {
  useMediaStore.setState(originalMedia)
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

const stream = { getVideoTracks: () => [] } as unknown as MediaStream
const user: ParticipantData = { id: 'peer', name: 'Player', stream, screenStream: stream, isScreenSharing: true }

function setup() {
  vi.stubGlobal('window', { innerWidth: 1200, innerHeight: 900 })
  useMediaStore.setState({ participantVolumes: { peer: 127 }, liveStreamVolume: 35, outputVolume: 80, isDeafened: false, silencedUsers: {}, mutuallySilencedBy: {} })
}

describe('independent voice and live controls', () => {
  it('offers local capture settings inside transmission information', () => {
    setup()
    const onOpenScreenShareSettings = vi.fn()
    const elements = capture(() => GridParticipantTile({ user: { ...user, isLocal: true }, onOpenScreenShareSettings }))
    const info = elements.find(el => el.type === LiveTransmissionInfo)
    expect(info).toBeDefined()
    info!.props.onOpenSettings()
    expect(onOpenScreenShareSettings).toHaveBeenCalledOnce()
  })

  it('does not offer local capture settings on another participant’s transmission or on camera tiles', () => {
    setup()
    for (const props of [
      { user },
      { user: { ...user, isLocal: true }, mediaKind: 'participant' as const },
    ]) {
      const elements = capture(() => GridParticipantTile({ ...props, onOpenScreenShareSettings: vi.fn() }))
      const info = elements.find(el => el.type === LiveTransmissionInfo)
      expect(info?.props.onOpenSettings).toBeUndefined()
    }
  })

  it('offers separate menu sliders and presets without changing the other volume', () => {
    setup()
    const elements = capture(() => ParticipantContextMenu({ user, x: 0, y: 0, onClose() {} }))
    const ranges = elements.filter((el) => el.type === 'input')
    expect(ranges).toHaveLength(2)
    expect(ranges.map((el) => el.props['aria-label'])).toEqual(['Volume da voz', 'Volume da live'])
    expect(ranges.map((el) => el.props.value)).toEqual([127, 35])
    ranges[1].props.onChange({ target: { value: '60' } })
    expect(useMediaStore.getState().liveStreamVolume).toBe(60)
    expect(useMediaStore.getState().participantVolumes.peer).toBe(127)
    ranges[0].props.onChange({ target: { value: '20' } })
    expect(useMediaStore.getState().participantVolumes.peer).toBe(20)
    expect(useMediaStore.getState().liveStreamVolume).toBe(60)
    const buttons = elements.filter((el) => el.type === 'button')
    const livePresets = buttons.slice(3, 6)
    for (const [index, value] of [0, 100, 200].entries()) {
      livePresets[index].props.onClick({ stopPropagation() {} })
      expect(useMediaStore.getState().liveStreamVolume).toBe(value)
      expect(useMediaStore.getState().participantVolumes.peer).toBe(20)
    }
  })

  it('keeps only the voice control when the participant has no live', () => {
    setup()
    const elements = capture(() => ParticipantContextMenu({ user: { ...user, screenStream: null, isScreenSharing: false }, x: 0, y: 0, onClose() {} }))
    expect(elements.filter((el) => el.type === 'input')).toHaveLength(1)
  })

  it('uses the live volume for grid playback, its slider and mute button', () => {
    setup()
    const elements = capture(() => GridParticipantTile({ user }))
    const audio = elements.find((el) => el.type === RemoteAudio)!
    expect(audio.props.volume).toBeCloseTo(0.28)
    const slider = elements.find((el) => el.type === 'input')!
    expect(slider.props.value).toBe(35)
    slider.props.onChange({ target: { value: '55' } })
    expect(useMediaStore.getState().liveStreamVolume).toBe(55)
    expect(useMediaStore.getState().participantVolumes.peer).toBe(127)
    const mute = elements.find((el) => el.type === 'button' && el.props.title === 'Mutar transmissão')!
    mute.props.onClick({ stopPropagation() {} })
    expect(useMediaStore.getState().liveStreamVolume).toBe(0)
    expect(useMediaStore.getState().participantVolumes.peer).toBe(127)
  })

  it('keeps camera playback and its slider on the voice volume', () => {
    setup()
    const elements = capture(() => GridParticipantTile({ user: { ...user, screenStream: null, isScreenSharing: false } }))
    expect(elements.find((el) => el.type === RemoteAudio)!.props.volume).toBeCloseTo(1.016)
    const slider = elements.find((el) => el.type === 'input')!
    expect(slider.props.value).toBe(127)
    slider.props.onChange({ target: { value: '40' } })
    expect(useMediaStore.getState().participantVolumes.peer).toBe(40)
    expect(useMediaStore.getState().liveStreamVolume).toBe(35)
  })

  it.each([
    { voice: 0, live: 75, muted: false },
    { voice: 127, live: 0, muted: true },
  ])('sets live playback mute independently for voice=$voice and live=$live', ({ voice, live, muted }) => {
    setup()
    useMediaStore.setState({ participantVolumes: { peer: voice }, liveStreamVolume: live })
    const elements = capture(() => GridParticipantTile({ user }))
    const audio = elements.find((el) => el.type === RemoteAudio)!
    expect(audio.props.muted).toBe(muted)
    expect(audio.props.volume).toBeCloseTo(0.8 * live / 100)
  })

  it('shows the presenter sidebar as their own camera and voice instead of the live', () => {
    setup()
    const camera = { getVideoTracks: () => [{ readyState: 'live', enabled: true }] } as unknown as MediaStream
    const elements = capture(() => GridParticipantTile({ user: { ...user, stream: camera, isCameraOff: false }, isSidebar: true, mediaKind: 'participant' }))
    const audio = elements.find((el) => el.type === RemoteAudio)!
    expect(audio.props.stream).toBe(camera)
    expect(audio.props.volume).toBeCloseTo(1.016)
    expect(elements.some((el) => el.type === 'span' && el.props.children === 'AO VIVO')).toBe(false)
    expect(elements.some((el) => el.type === 'span' && el.props.children === 'Player')).toBe(true)
  })

  it('shows an avatar without replaying the combined screen stream in the presenter sidebar', () => {
    setup()
    const elements = capture(() => GridParticipantTile({ user, isSidebar: true, mediaKind: 'participant' }))
    expect(elements.some((el) => el.type === RemoteAudio)).toBe(false)
    expect(elements.some((el) => typeof el.type !== 'string' && el.props.name === 'Player' && el.props.size === 'lg')).toBe(true)
  })
})
