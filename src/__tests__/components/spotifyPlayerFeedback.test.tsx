import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SpotifyPlayerFeedback } from '../../components/spotify/SpotifyPlayerFeedback'

describe('integrated Spotify player feedback', () => {
  it('shows progress and explains that login uses the user Spotify account', () => {
    const html = renderToStaticMarkup(<SpotifyPlayerFeedback opening error={null} />)
    expect(html).toContain('role="status"')
    expect(html).toContain('Abrindo o player')
    expect(html).toContain('Compartilhar áudio da aba')
    expect(html).toContain('sua conta Spotify')
  })
  it('shows a startup error with an accessible alert', () => {
    const html = renderToStaticMarkup(<SpotifyPlayerFeedback opening={false} error="Download indisponível" />)
    expect(html).toContain('role="alert"')
    expect(html).toContain('Download indisponível')
  })
  it('shows nothing when there is no pending opening or error', () => {
    expect(renderToStaticMarkup(<SpotifyPlayerFeedback opening={false} error={null} />)).toBe('')
  })
})
