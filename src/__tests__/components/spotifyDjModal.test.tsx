import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SpotifyJamModal } from '../../components/spotify/SpotifyJamModal'
import { MediaManager } from '../../media/MediaManager'
import { stopDjForEveryone } from '../../services/stopDjForEveryone'

const state = vi.hoisted(() => ({
  login: { ready: false, state: { pending: false, confirmed: false, browserOpen: false }, busy: null, error: null, act: vi.fn() },
  spotify: {
    isModalOpen: true,
    activeZoneIdForModal: 'room',
    jamsByZone: { room: { isActive: true, jamUrl: 'https://open.spotify.com/playlist/example', startedBy: 'Pessoa' } },
    sharedTracksByZone: { room: [{ id: 'track', title: 'Faixa recomendada', url: 'https://open.spotify.com/track/example' }] },
    djStateByZone: {},
    isDjModeActive: false,
    volume: 80,
    isMuted: false,
    setModalOpen: vi.fn(), setDjStateInZone: vi.fn(), setVolume: vi.fn(), toggleMute: vi.fn(),
    startJamInZone: vi.fn(), stopJamInZone: vi.fn(), shareTrackInZone: vi.fn(), removeSharedTrack: vi.fn(),
  },
  player: { id: 'local', name: 'Pessoa', currentZoneId: 'room' as string | null },
}))

vi.mock('../../store/useSpotifyJamStore', () => ({ useSpotifyJamStore: (select: any) => select(state.spotify) }))
vi.mock('../../store/useGameStore', () => ({ useGameStore: (select: any) => select({ localPlayer: state.player }) }))
vi.mock('../../store/useMapStore', () => ({ useMapStore: (select: any) => select({ mapData: { zones: [{ id: 'room', name: 'Sala privada' }] } }) }))
vi.mock('../../services/spotifyDjPlayback', () => ({ commandDjPlayback: vi.fn() }))
vi.mock('../../media/MediaManager', () => ({ MediaManager: { getInstance: vi.fn() } }))
vi.mock('../../hooks/useSpotifyLogin', () => ({ useSpotifyLogin: () => state.login }))
vi.mock('../../services/stopDjForEveryone', () => ({ stopDjForEveryone: vi.fn() }))

describe('Spotify DJ modal', () => {
  afterEach(() => vi.unstubAllGlobals())

  beforeEach(() => {
    vi.clearAllMocks()
    state.spotify.isModalOpen = true
    state.spotify.isDjModeActive = false
    state.spotify.djStateByZone = {}
    state.spotify.activeZoneIdForModal = 'room'
    state.player.currentZoneId = 'room'
    state.login.ready = false
  })

  it('shows only DJ controls even when an old Jam and recommendations exist', () => {
    const html = renderToStaticMarkup(<SpotifyJamModal />)
    expect(html).toMatch(/<h2[^>]*>DJ<\/h2>/)
    expect(html).not.toContain('Spotify DJ')
    expect(html).toContain('min="0" max="200"')
    expect(html).toContain('Transmitir DJ')
    expect(html).toContain('Entrar pelo navegador')
    expect(html).toContain('type="range"')
    expect(html).not.toMatch(/Spotify Jam|Link do Spotify Jam|Iniciar Jam|Jam ativo|Recomendar Faixa|Faixa recomendada|Fila Compartilhada|Fila da Sala|Abrir Spotify/)
    expect(html).not.toContain('<form')
  })

  it('makes the main transmission button full width with a large Spotify icon', () => {
    const html = renderToStaticMarkup(<SpotifyJamModal />)
    const button = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g)?.find((item) => item.includes('Transmitir DJ'))
    expect(button).toBeDefined()
    expect(button).toContain('w-full')
    expect(button).toContain('py-4')
    expect(button).toContain('width="24"')
    expect(button).toContain('viewBox="0 0 24 24"')
  })

  it('keeps a stop action when broadcasting is active', () => {
    state.spotify.isDjModeActive = true
    const html = renderToStaticMarkup(<SpotifyJamModal />)
    expect(html).toContain('Parar DJ')
    expect(html).not.toContain('Transmitir DJ')
    expect(html).not.toContain('Entrar pelo navegador')
    expect(html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g)?.find(button => button.includes('Parar DJ'))).not.toContain('disabled=""')
  })

  it('keeps song requests in the side panel while the DJ modal shows transmission controls', () => {
    state.spotify.djStateByZone = { room: { isDjActive: true } }
    const html = renderToStaticMarkup(<SpotifyJamModal />)
    expect(html).toContain('Parar DJ')
    expect(html.includes('aria-label="Pedidos de música"')).toBe(false)
    expect(html.includes('Pedir música')).toBe(false)
  })

  it.each([
    ['owner', 'X'], ['owner', 'Fechar'],
    ['listener', 'X'], ['listener', 'Fechar'],
    ['inactive', 'X'], ['inactive', 'Fechar'],
  ])('only hides the %s dialog through %s, preserving audio and Spotify', async (mode, control) => {
    state.spotify.isDjModeActive = mode === 'owner'
    state.spotify.djStateByZone = mode === 'listener' ? { room: { isDjActive: true } } : {}
    const stopDjAudio = vi.fn(async () => {})
    const closeSpotifyPlayer = vi.fn(async () => ({ ok: true }))
    vi.stubGlobal('window', { electronAPI: { closeSpotifyPlayer } })
    vi.mocked(MediaManager.getInstance).mockReturnValue({ stopDjAudio } as any)
    state.spotify.setModalOpen.mockClear()
    let tree: React.ReactNode
    function Probe() { tree = SpotifyJamModal({}); return null }
    renderToStaticMarkup(<Probe />)
    let close: React.ReactElement<any> | undefined
    function visit(node: React.ReactNode) {
      React.Children.forEach(node, child => {
        if (!React.isValidElement(child)) return
        const props = child.props as any
        if (child.type === 'button' && (control === 'X'
          ? props['aria-label'] === 'Fechar DJ'
          : props.children === 'Fechar')) close = child
        visit(props.children)
      })
    }
    visit(tree!)
    await close!.props.onClick()
    expect(state.spotify.setModalOpen).toHaveBeenCalledExactlyOnceWith(false)
    expect(stopDjAudio).not.toHaveBeenCalled()
    expect(closeSpotifyPlayer).not.toHaveBeenCalled()
    expect(state.spotify.setDjStateInZone).not.toHaveBeenCalled()
    expect(state.spotify.isDjModeActive).toBe(mode === 'owner')
  })

  it('still stops broadcasting through the explicit Parar DJ action', async () => {
    state.spotify.isDjModeActive = true
    const stopDjAudio = vi.fn(async () => {})
    vi.mocked(MediaManager.getInstance).mockReturnValue({ stopDjAudio } as any)
    let tree: React.ReactNode
    function Probe() { tree = SpotifyJamModal({}); return null }
    renderToStaticMarkup(<Probe />)
    let stop: React.ReactElement<any> | undefined
    function visit(node: React.ReactNode) {
      React.Children.forEach(node, child => {
        if (!React.isValidElement(child)) return
        const props = child.props as any
        if (child.type === 'button' && 'aria-busy' in props) stop = child
        visit(props.children)
      })
    }
    visit(tree!)
    await stop!.props.onClick()
    expect(stopDjAudio).toHaveBeenCalledOnce()
    expect(state.spotify.setDjStateInZone).toHaveBeenCalledExactlyOnceWith('room', null, true)
    expect(state.spotify.setModalOpen).not.toHaveBeenCalled()
  })

  it('lets a listener stop the active room DJ through the same Parar DJ button without login', async () => {
    state.spotify.djStateByZone = { room: { isDjActive: true } }
    const html = renderToStaticMarkup(<SpotifyJamModal />)
    expect(html).toContain('Parar DJ')
    expect(html).not.toContain('Transmitir DJ')
    let tree: React.ReactNode
    function Probe() { tree = SpotifyJamModal({}); return null }
    renderToStaticMarkup(<Probe />)
    let stop: React.ReactElement<any> | undefined
    function visit(node: React.ReactNode) {
      React.Children.forEach(node, child => {
        if (!React.isValidElement(child)) return
        const props = child.props as any
        if (child.type === 'button' && 'aria-busy' in props) stop = child
        visit(props.children)
      })
    }
    visit(tree!)
    expect(stop).toBeDefined()
    expect(stop!.props.disabled).toBe(false)
    await stop!.props.onClick()
    expect(stopDjForEveryone).toHaveBeenCalledExactlyOnceWith('room')
    expect(MediaManager.getInstance).not.toHaveBeenCalled()
    expect(state.spotify.setModalOpen).not.toHaveBeenCalled()
  })

  it('enables broadcasting only after login confirmation', () => {
    const transmit = () => renderToStaticMarkup(<SpotifyJamModal />).match(/<button\b[^>]*>[\s\S]*?<\/button>/g)?.find(button => button.includes('Transmitir DJ'))
    expect(transmit()).toContain('disabled=""')
    state.login.ready = true
    expect(transmit()).not.toContain('disabled=""')
  })

  it('requires a room and uses DJ wording in the corridor', () => {
    state.spotify.activeZoneIdForModal = ''
    state.player.currentZoneId = null
    const html = renderToStaticMarkup(<SpotifyJamModal />)
    expect(html).toContain('Você está no corredor')
    expect(html).not.toContain('Transmitir DJ')
    expect(html).not.toContain('sessão de Jam')
  })

  it('renders nothing when closed', () => {
    state.spotify.isModalOpen = false
    expect(renderToStaticMarkup(<SpotifyJamModal />)).toBe('')
  })
})
