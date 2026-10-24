import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SpotifyJamSideDisplay } from '../../components/spotify/SpotifyJamSideDisplay'
import { stopDjForEveryone } from '../../services/stopDjForEveryone'

const state = vi.hoisted(() => ({
  login: { ready: false, state: { pending: false, confirmed: false, browserOpen: false }, busy: null, error: null, act: vi.fn() },
  spotify: {
    jamsByZone: { room: { isActive: true, jamUrl: 'https://spotify.link/example', zoneName: 'Jam antiga' } },
    sharedTracksByZone: { room: [{ id: 'track', title: 'Faixa recomendada', url: 'https://open.spotify.com/track/example' }] },
    djStateByZone: { room: { isDjActive: true, djName: 'Pessoa', playback: { playing: true, buttons: [], track: { title: 'Música compartilhada', artist: 'Artista' }, seek: { value: 25, position: 60, duration: 240 } } } },
    isDjModeActive: true,
    isSideDisplayMinimized: false,
    volume: 80,
    isMuted: false,
    toggleSideDisplayMinimized: vi.fn(), setModalOpen: vi.fn(), setDjStateInZone: vi.fn(),
    setVolume: vi.fn(), toggleMute: vi.fn(), stopJamInZone: vi.fn(), shareTrackInZone: vi.fn(), removeSharedTrack: vi.fn(),
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

function spotifyButton(label = 'Abrir Spotify') {
  let tree: React.ReactNode
  function Probe() { tree = SpotifyJamSideDisplay({}); return null }
  renderToStaticMarkup(<Probe />)
  const buttons: React.ReactElement[] = []
  function visit(node: React.ReactNode) {
    React.Children.forEach(node, (child) => {
      if (!React.isValidElement(child)) return
      if (child.type === 'button') buttons.push(child)
      visit((child.props as any).children)
    })
  }
  visit(tree!)
  return buttons.find(button => (button.props as any)['aria-label'] === label)
}

describe('Spotify DJ side display', () => {
  it.each([false, true])('offers listeners a global stop action when minimized=%s', async minimized => {
    state.spotify.isDjModeActive = false
    state.spotify.isSideDisplayMinimized = minimized
    expect(renderToStaticMarkup(<SpotifyJamSideDisplay />)).toContain('aria-label="Encerrar DJ para todos"')
    await (spotifyButton('Encerrar DJ para todos')!.props as any).onClick()
    expect(stopDjForEveryone).toHaveBeenCalledExactlyOnceWith('room')
  })
  beforeEach(() => {
    vi.clearAllMocks()
    state.spotify.isDjModeActive = true
    state.spotify.djStateByZone.room.isDjActive = true
    state.spotify.isSideDisplayMinimized = false
    state.player.currentZoneId = 'room'
    state.login.ready = false
  })
  afterEach(() => vi.unstubAllGlobals())

  it.each([false, true])('offers the owner one Spotify restore button when the panel is minimized=%s', (minimized) => {
    state.spotify.isSideDisplayMinimized = minimized
    const html = renderToStaticMarkup(<SpotifyJamSideDisplay />)
    expect(html.match(/aria-label="Abrir Spotify"/g)).toHaveLength(1)
    expect(spotifyButton()).toBeDefined()
  })

  it.each([false, true])('does not offer listeners the owner Spotify window when minimized=%s', (minimized) => {
    state.spotify.isDjModeActive = false
    state.spotify.isSideDisplayMinimized = minimized
    expect(renderToStaticMarkup(<SpotifyJamSideDisplay />)).not.toContain('aria-label="Abrir Spotify"')
  })

  it.each([false, true])('restores the existing Spotify player without changing the song or expanding the DJ panel when minimized=%s', async (minimized) => {
    state.spotify.isSideDisplayMinimized = minimized
    const openSpotifyPlayer = vi.fn(async () => ({ ok: true }))
    vi.stubGlobal('window', { electronAPI: { openSpotifyPlayer } })
    const button = spotifyButton()
    expect(button).toBeDefined()
    await (button!.props as any).onClick()
    expect(openSpotifyPlayer).toHaveBeenCalledExactlyOnceWith(undefined)
    expect(state.spotify.toggleSideDisplayMinimized).not.toHaveBeenCalled()
    expect(state.spotify.setModalOpen).not.toHaveBeenCalled()
    expect(state.spotify.setDjStateInZone).not.toHaveBeenCalled()
  })

  it('shows DJ controls without old Jam, player shortcuts or recommendation options', () => {
    const html = renderToStaticMarkup(<SpotifyJamSideDisplay />)
    expect(html).toContain('aria-label="DJ"')
    expect(html).not.toContain('Spotify DJ')
    expect(html).toContain('min="0" max="200"')
    expect(html).toContain('Parar DJ')
    expect(html).toContain('aria-label="Reprodução do Spotify"')
    expect(html).toContain('Sala privada')
    expect(html).toContain('type="range"')
    expect(html).not.toMatch(/Ouvir Jam|Recomendar Faixa|Faixa recomendada|Fila Compartilhada|Fila da Sala|Copiar Link|Trocar link|Abrir Player Integrado|Jam antiga/)
    expect(html).not.toContain('<form')
    expect(html).not.toContain('<iframe')
  })

  it('makes the DJ button full width with the same large Spotify icon as the modal', () => {
    const html = renderToStaticMarkup(<SpotifyJamSideDisplay />)
    const button = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g)?.find((item) => item.includes('Parar DJ'))
    expect(button).toBeDefined()
    expect(button).toContain('w-full')
    expect(button).toContain('py-4')
    expect(button).toContain('width="24"')
    expect(button).toContain('viewBox="0 0 24 24"')
  })

  it('shows the shared player and personal volume without login or transmission actions for listeners', () => {
    state.spotify.isDjModeActive = false
    const html = renderToStaticMarkup(<SpotifyJamSideDisplay />)
    expect(html).not.toContain('Transmitir DJ')
    expect(html).not.toContain('Entrar pelo navegador')
    expect(html).toContain('Parar DJ')
    expect(html).toContain('aria-label="Reprodução do Spotify"')
    expect(html).toContain('aria-label="Volume do DJ"')
    expect(html).toContain('Música compartilhada')
    expect(html).toContain('1:00')
    expect(html).toContain('4:00')
    expect(html).toContain('aria-label="Posição da música"')
  })

  it('keeps stop available for the broadcaster without a new login', () => {
    const button = renderToStaticMarkup(<SpotifyJamSideDisplay />).match(/<button\b[^>]*>[\s\S]*?<\/button>/g)?.find(item => item.includes('Parar DJ'))
    expect(button).not.toContain('disabled=""')
  })

  it('does not show a panel for legacy Jam or recommendations alone', () => {
    state.spotify.isDjModeActive = false
    state.spotify.djStateByZone.room.isDjActive = false
    expect(renderToStaticMarkup(<SpotifyJamSideDisplay />)).toBe('')
  })

  it('keeps a compact Spotify DJ panel when minimized', () => {
    state.spotify.isSideDisplayMinimized = true
    const html = renderToStaticMarkup(<SpotifyJamSideDisplay />)
    expect(html).toContain('aria-label="DJ minimizado"')
    expect(html).not.toContain('Spotify DJ')
    expect(html).toContain('Sala privada')
    expect(html).toContain('Expandir painel')
    expect(html).not.toContain('Recomendar')
    expect(html).not.toContain('type="range"')
  })

  it('does not render outside a room', () => {
    state.player.currentZoneId = null
    expect(renderToStaticMarkup(<SpotifyJamSideDisplay />)).toBe('')
  })
})
