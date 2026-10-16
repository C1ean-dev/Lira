import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { SpotifyLoginControls } from '../../components/spotify/SpotifyLoginControls'
import type { SpotifyLoginView } from '../../services/spotifyLogin'

function render(view: Partial<SpotifyLoginView> = {}) {
  return renderToStaticMarkup(<SpotifyLoginControls login={{
    state: null, busy: null, error: null, ...view, act: vi.fn(),
  }} />)
}

describe('Spotify login status in Lira', () => {
  it('announces the initial check and progress for both login actions', () => {
    expect(render()).toContain('Verificando login')
    expect(render({ busy: 'opening' })).toContain('Abrindo o navegador')
    expect(render({ busy: 'completing' })).toContain('Verificando o login e preparando o player')
    expect(render()).toContain('role="status"')
    expect(render()).toContain('aria-live="polite"')
  })

  it('explains how to return from browser login and confirms closure without claiming success', () => {
    const state = { pending: true, confirmed: false, browserOpen: true }
    expect(render({ state })).toContain('feche essa janela')
    const closed = render({ state: { ...state, browserOpen: false } })
    expect(closed).toContain('Navegador fechado')
    expect(closed).toContain('Concluir login')
    expect(closed).not.toContain('Login concluído')
  })

  it('keeps success visible and offers signing in with another account', () => {
    const html = render({ state: { pending: false, confirmed: true, browserOpen: false } })
    expect(html).toContain('Login concluído')
    expect(html).toContain('Transmitir DJ')
    expect(html).toContain('Trocar conta')
    expect(html).toContain('text-emerald')
  })

  it('shows an accessible failure before attempting to broadcast', () => {
    const html = render({ error: 'Não foi possível verificar o login.' })
    expect(html).toContain('role="alert"')
    expect(html).toContain('Não foi possível verificar o login.')
  })
})
