import React from 'react'
import type { SpotifyLoginView } from '../../services/spotifyLogin'

export function SpotifyLoginControls({ login, disabled = false }: {
  login: SpotifyLoginView & { act(complete: boolean): unknown }
  disabled?: boolean
}) {
  const { state, busy, error } = login
  const pending = !!state?.pending
  const completed = !!state?.confirmed && !pending
  const message = busy === 'opening' ? 'Abrindo o navegador para entrar no Spotify…'
    : busy === 'completing' ? 'Verificando o login e preparando o player…'
    : pending ? (state?.browserOpen
      ? 'Faça login na janela do navegador que abriu. Depois, feche essa janela e clique em Concluir login.'
      : 'Navegador fechado. Clique em Concluir login para verificar sua conta e preparar o player.')
    : completed ? 'Login concluído. Escolha uma música no Spotify e clique em Transmitir DJ.'
    : !state && !error ? 'Verificando login do Spotify…'
    : 'Entre no Spotify pelo navegador antes de transmitir. Você pode usar sua conta Google.'

  return (
    <div className={`rounded-xl border p-3 space-y-2 text-xs font-mono ${completed && !error ? 'border-lira-online/40 bg-lira-online/10' : 'border-lira-quiet bg-lira-surface'}`}>
      <p role="status" aria-live="polite" className={completed && !error ? 'text-emerald-200 text-lira-online' : 'text-lira-ink'}>{message}</p>
      {error && <p role="alert" className="text-lira-error">{error}</p>}
      <button type="button" onClick={() => login.act(pending)} disabled={disabled || !!busy} aria-busy={!!busy}
        className="w-full rounded-lg px-3 py-2 font-semibold bg-lira-ground hover:border-lira-accent border border-lira-rule text-lira-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
        {busy ? 'Aguarde…' : pending ? 'Concluir login' : completed ? 'Trocar conta' : 'Entrar pelo navegador'}
      </button>
      {pending && <button type="button" onClick={() => login.act(false)} disabled={disabled || !!busy}
        className="text-lira-muted hover:text-lira-ink underline underline-offset-2 disabled:opacity-50">Refazer login pelo navegador</button>}
    </div>
  )
}
