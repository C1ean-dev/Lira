import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SpotifyDjRequests, SpotifySongSearchResults } from '../../components/spotify/SpotifyDjRequests'
import { useGameStore } from '../../store/useGameStore'
import { useSpotifyJamStore } from '../../store/useSpotifyJamStore'
import { openDjSongRequest, removeDjSongRequest, requestDjSong } from '../../services/spotifyDjRequests'

vi.mock('../../services/spotifyDjRequests', () => ({ requestDjSong: vi.fn(async () => ({ ok: true })),
  openDjSongRequest: vi.fn(async () => ({ ok: true })), removeDjSongRequest: vi.fn(() => ({ ok: true })) }))
vi.mock('../../p2p/PeerManager', () => ({ PeerManager: { getInstance: () => ({}) } }))
const game = useGameStore.getState()
const spotify = useSpotifyJamStore.getState()
beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(React, 'useSyncExternalStore').mockImplementation((_subscribe, getSnapshot) => getSnapshot())
  useGameStore.setState({ localPlayer: { ...game.localPlayer, id: 'listener', currentZoneId: 'room' } })
  useSpotifyJamStore.setState({ isDjModeActive: false, djStateByZone: { room: {
    zoneId: 'room', isDjActive: true, djPeerId: 'owner', djName: 'DJ', startedAt: 1, requestsRevision: 1,
    requests: [{ id: 'request', query: 'Nome da música', requestedById: 'listener', requestedByName: 'Ana', requestedAt: 1 }],
  } } })
})
afterEach(() => { vi.restoreAllMocks(); useGameStore.setState(game); useSpotifyJamStore.setState(spotify) })
function tree() {
  let result: React.ReactNode
  function Probe() { result = SpotifyDjRequests({ zoneId: 'room' }); return null }
  renderToStaticMarkup(<Probe />)
  const elements: React.ReactElement<any>[] = []
  const visit = (node: React.ReactNode) => React.Children.forEach(node, child => {
    if (React.isValidElement(child)) { elements.push(child); visit((child.props as any).children) }
  })
  visit(result!)
  return elements
}

describe('DJ request panel', () => {
  it('shows Spotify track results with artist and cover, and lets the user select the exact result', async () => {
    const track = { id: '4uLU6hMCjMI75M1A2tKUQC', title: 'Never Gonna Give You Up', artist: 'Rick Astley',
      url: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC', coverUrl: 'https://i.scdn.co/image/cover' }
    const select = vi.fn()
    const view = { query: 'rick', loading: false, tracks: [track], error: null }
    const html = renderToStaticMarkup(<SpotifySongSearchResults view={view} disabled={false} onSelect={select} />)
    expect(html.includes(track.title)).toBe(true)
    expect(html.includes(track.artist)).toBe(true)
    expect(html.includes(track.coverUrl)).toBe(true)
    let result: React.ReactNode
    function Probe() { result = SpotifySongSearchResults({ view, disabled: false, onSelect: select }); return null }
    renderToStaticMarkup(<Probe />)
    const buttons: React.ReactElement<any>[] = []
    const visit = (node: React.ReactNode) => React.Children.forEach(node, child => {
      if (!React.isValidElement(child)) return
      if (child.type === 'button') buttons.push(child)
      visit((child.props as any).children)
    })
    visit(result!)
    buttons[0].props.onClick()
    expect(select).toHaveBeenCalledExactlyOnceWith({ ...track, searchQuery: 'rick' })
  })
  it('shows the shared requests and a 120-character song input to listeners, with management reserved for the DJ', () => {
    const html = renderToStaticMarkup(<SpotifyDjRequests zoneId="room" />)
    expect(html).toContain('Pedidos da sala')
    expect(html).toContain('maxLength="120"')
    expect(html).toContain('Buscar')
    expect(html).toContain('Nome da música')
    expect(html).toContain('Ana')
    expect(html).not.toContain('Buscar no Spotify')
    expect(html).not.toContain('Remover pedido')
  })
  it('does not queue an unselected search query when submitting the search form', async () => {
    const form = tree().find(element => element.type === 'form')!
    const input = { value: 'Nome da música e artista' }
    const event = { preventDefault: vi.fn(), currentTarget: { elements: { namedItem: () => input } } }
    await form.props.onSubmit(event)
    expect(requestDjSong).not.toHaveBeenCalled()
    expect(input.value).toBe('Nome da música e artista')
  })
  it('lets the DJ search and remove individual requests', async () => {
    useGameStore.setState({ localPlayer: { ...game.localPlayer, id: 'owner', currentZoneId: 'room' } })
    useSpotifyJamStore.setState({ isDjModeActive: true })
    const elements = tree()
    const search = elements.find(element => element.type === 'button' && element.props['aria-label']?.startsWith('Buscar no Spotify'))!
    const remove = elements.find(element => element.type === 'button' && element.props['aria-label']?.startsWith('Remover pedido'))!
    await search.props.onClick()
    remove.props.onClick()
    expect(openDjSongRequest).toHaveBeenCalledExactlyOnceWith('room', 'request')
    expect(removeDjSongRequest).toHaveBeenCalledExactlyOnceWith('room', 'request')
  })
  it('hides the panel outside the DJ room or after the transmission ends', () => {
    useGameStore.setState({ localPlayer: { ...game.localPlayer, currentZoneId: 'other' } })
    expect(renderToStaticMarkup(<SpotifyDjRequests zoneId="room" />)).toBe('')
    useGameStore.setState({ localPlayer: { ...game.localPlayer, currentZoneId: 'room' } })
    useSpotifyJamStore.setState({ djStateByZone: {} })
    expect(renderToStaticMarkup(<SpotifyDjRequests zoneId="room" />)).toBe('')
  })
})
