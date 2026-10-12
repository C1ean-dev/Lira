import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { SpotifyPlaybackFrame } from '../../components/spotify/SpotifyPlaybackCrop'

const frame = {
  playing: false,
  buttons: ['shuffle', 'previous', 'playpause', 'next', 'repeat'].map((id, i) => ({
    id, label: ['Aleatório', 'Anterior', 'Reproduzir', 'Próxima', 'Repetir'][i],
    active: i === 0, disabled: false,
  })),
  seek: { value: 20, position: 48, duration: 240 },
}

describe('Spotify playback frame', () => {
  it('does not show a queue button or upcoming tracks', () => {
    const tracks = Array.from({ length: 8 }, (_, i) => ({ title: `Faixa ${i + 1}`, artist: 'Artista' }))
    const html = renderToStaticMarkup(<SpotifyPlaybackFrame frame={{ ...frame, queue: { available: true, open: true, tracks } } as any} onCommand={vi.fn()} busy={false} />)
    expect(html).not.toContain('Ver fila de músicas')
    expect(html).not.toContain('Próximas músicas')
    expect(html).not.toContain('Faixa 1')
  })
  it('keeps track title and artist without showing the queue', () => {
    const html = renderToStaticMarkup(<SpotifyPlaybackFrame frame={{ ...frame, track: { title: 'Minha música', artist: 'Artista' }, queue: { available: true, open: true, tracks: [{ title: 'Próxima faixa', artist: 'Outro artista' }] } } as any} onCommand={vi.fn()} busy={false} />)
    expect(html).toContain('Minha música')
    expect(html).toContain('Artista')
    expect(html).not.toContain('aria-label="Ver fila de músicas"')
    expect(html).not.toContain('Próxima faixa')
    expect(html).not.toContain('Próximas músicas')
  })
  it('renders stable controls and a timeline without changing screenshot images', () => {
    const html = renderToStaticMarkup(<SpotifyPlaybackFrame frame={frame as any} onCommand={vi.fn()} busy={false} />)
    expect(html).not.toContain('<img')
    expect(html).toContain('0:48')
    expect(html).toContain('4:00')
    expect(html).toContain('aria-pressed="true"')
    for (const label of ['Aleatório', 'Anterior', 'Reproduzir', 'Próxima', 'Repetir', 'Posição da música']) expect(html).toContain(`aria-label="${label}"`)
    expect(html).toContain('type="range"')
    expect(html).not.toContain('iframe')
  })
  it('disables all controls while a command is pending', () => {
    const html = renderToStaticMarkup(<SpotifyPlaybackFrame frame={frame as any} onCommand={vi.fn()} busy />)
    expect((html.match(/disabled=""/g) || []).length).toBe(6)
  })
  it('keeps every control visible while Spotify temporarily omits some buttons or its timeline', () => {
    const partial = { ...frame, buttons: [frame.buttons[3]], seek: null }
    const html = renderToStaticMarkup(<SpotifyPlaybackFrame frame={partial as any} onCommand={vi.fn()} busy={false} />)
    for (const label of ['Aleatório', 'Anterior', 'Reproduzir', 'Próxima', 'Repetir', 'Posição da música']) expect(html).toContain(`aria-label="${label}"`)
    expect((html.match(/disabled=""/g) || []).length).toBe(5)
  })
})
