import React from 'react'

export function SpotifyPlayerFeedback({ opening, error }: { opening: boolean; error: string | null }) {
  if (error) {
    return <div role="alert" className="text-xs font-mono text-lira-error bg-lira-error/15 p-3 rounded-xl border border-lira-error/40">{error}</div>
  }
  if (!opening) return null
  return (
    <div role="status" aria-live="polite" className="text-xs font-mono text-lira-online bg-lira-online/10 p-3 rounded-xl border border-lira-online/30">
      <p>Abrindo o player… A primeira abertura pode levar alguns instantes.</p>
      <p className="mt-1 text-lira-ink">Você entrará diretamente com sua conta Spotify.</p>
      <p className="mt-1 text-lira-ink">No navegador, selecione a aba do Spotify e marque Compartilhar áudio da aba. O som será ouvido pelo DJ na sala.</p>
    </div>
  )
}
