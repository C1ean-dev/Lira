import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SpotifyJamModal } from '../../components/spotify/SpotifyJamModal'

const state = vi.hoisted(() => ({
  spotify: {
    isModalOpen: true,
    activeZoneIdForModal: 'room',
    jamsByZone: { room: { isActive: true, jamUrl: 'https://open.spotify.com/playlist/example', startedBy: 'Pessoa' } },
    sharedTracksByZone: { room: [{ id: 'track', title: 'Faixa recomendada', url: 'https://open.spotify.com/track/example' }] },
    djStateByZone: {} as Record<string, any>,
    playbackByZone: { room: { frame: { playing: true, track: { title: 'How Sweet', artist: 'NewJeans' }, buttons: [], seek: null }, error: null } },
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
vi.mock('../../media/MediaManager', () => ({ MediaManager: { getInstance: vi.fn() } }))
vi.mock('../../p2p/PeerManager', () => ({ PeerManager: { getInstance: vi.fn() } }))

describe('Spotify DJ modal', () => {
  beforeEach(() => {
    state.spotify.isModalOpen = true
    state.spotify.isDjModeActive = false
    state.spotify.djStateByZone = {}
    state.spotify.activeZoneIdForModal = 'room'
    state.player.currentZoneId = 'room'
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
  })

  it('shares room playback instead of opening another player when someone is already the DJ', () => {
    state.spotify.djStateByZone.room = { isDjActive: true, djPeerId: 'owner', djName: 'owner' }
    const html = renderToStaticMarkup(<SpotifyJamModal />)
    expect(html).toContain('How Sweet')
    expect(html).toContain('aria-label="Pausar"')
    expect(html).not.toContain('Transmitir DJ')
    expect(html).not.toContain('Entrar pelo navegador')
    expect(html).not.toContain('Parar DJ')
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
