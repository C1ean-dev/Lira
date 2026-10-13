import React, { useEffect, useRef, useState } from 'react'
import { spotifyLoginAction, type SpotifyLoginAPI } from '../../services/spotifyLogin'

export function SpotifyLoginControls({ disabled = false }: { disabled?: boolean }) {
  const [pending, setPending] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [completed, setCompleted] = useState(false)
  const interacting = useRef(false)

  useEffect(() => {
    let mounted = true
    const api = (window as unknown as { electronAPI?: SpotifyLoginAPI }).electronAPI
    api?.getSpotifyLoginState?.().then(state => {
      if (mounted && !interacting.current) setPending(state.pending)
    }).catch(() => {})
    return () => { mounted = false }
  }, [disabled])

  const act = async (complete: boolean) => {
    if (busy || disabled) return
    interacting.current = true
    setBusy(true)
    setError(null)
    const api = (window as unknown as { electronAPI?: SpotifyLoginAPI }).electronAPI
    try {
      const result = await spotifyLoginAction(api, complete)
      if (!result.ok) { setError(result.error || 'Não foi possível abrir o Spotify.'); return }
      setCompleted(complete)
      setPending(!complete)
    } finally { setBusy(false) }
  }

  return (
    <div className="rounded-xl border border-slate-700 bg-[#141721] p-3 space-y-2 text-xs">
      <p className="text-slate-300">
        {pending
          ? 'Faça login na janela do navegador que abriu. Depois, feche essa janela e clique em Concluir login.'
          : completed ? 'Player pronto. Escolha uma música e clique em Transmitir DJ.'
          : 'Entre no Spotify pelo navegador antes de transmitir. Você pode usar sua conta Google.'}
      </p>
      {error && <p role="alert" className="text-rose-300">{error}</p>}
      <button type="button" onClick={() => act(pending)} disabled={disabled || busy} aria-busy={busy}
        className="w-full rounded-lg px-3 py-2 font-semibold bg-slate-800 hover:bg-slate-700 text-slate-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
        {busy ? 'Aguarde…' : pending ? 'Concluir login' : 'Entrar pelo navegador'}
      </button>
      {pending && <button type="button" onClick={() => act(false)} disabled={disabled || busy}
        className="text-slate-400 hover:text-white underline underline-offset-2 disabled:opacity-50">Refazer login pelo navegador</button>}
    </div>
  )
}
