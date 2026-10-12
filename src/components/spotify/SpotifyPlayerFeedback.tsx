import React from 'react'

export function SpotifyPlayerFeedback({ opening, error }: { opening: boolean; error: string | null }) {
  if (error) {
    return <div role="alert" className="text-xs text-rose-300 bg-rose-500/10 p-3 rounded-xl border border-rose-500/20">{error}</div>
  }
  if (!opening) return null
  return (
    <div role="status" aria-live="polite" className="text-xs text-emerald-200 bg-emerald-500/10 p-3 rounded-xl border border-emerald-500/20">
      <p>Abrindo o player… A primeira abertura pode levar alguns instantes.</p>
      <p className="mt-1 text-slate-300">Você entrará diretamente com sua conta Spotify.</p>
      <p className="mt-1 text-slate-300">No navegador, selecione a aba do Spotify e marque Compartilhar áudio da aba. O som será ouvido pelo DJ na sala.</p>
    </div>
  )
}
