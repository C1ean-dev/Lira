import React, { useEffect, useId, useRef, useState } from 'react'
import { Search, Trash2 } from 'lucide-react'
import { useSpotifyJamStore } from '../../store/useSpotifyJamStore'
import { useLocalPlayerDetails } from '../../hooks/usePlayerDetails'
import { MAX_DJ_SONG_QUERY_LENGTH, MAX_DJ_SONG_REQUESTS } from '../../types/spotifyDjRequests'
import { openDjSongRequest, removeDjSongRequest, requestDjSong } from '../../services/spotifyDjRequests'
import { searchDjSongs } from '../../services/spotifyDjSearch'
import { createSpotifySearchSession, emptySpotifySearch, type SpotifySearchView } from '../../services/spotifySearchSession'
import type { SpotifySearchTrack } from '../../types/spotifySearch'

export function SpotifySongSearchResults({ view, disabled, onSelect, blockedTracks }: {
  view: SpotifySearchView; disabled: boolean; onSelect(track: SpotifySearchTrack): void; blockedTracks?: ReadonlyMap<string, 'adding' | 'uncertain'>
}) {
  if (view.query.length < 2) return null
  if (view.loading) return <p role="status" className="text-xs text-slate-400">Buscando no Spotify…</p>
  if (view.error) return <p role="alert" className="text-xs text-amber-300">{view.error}</p>
  if (!view.tracks.length) return <p role="status" className="text-xs text-slate-400">Nenhuma música encontrada no Spotify.</p>
  return (
    <ul aria-label="Resultados do Spotify" className="max-h-56 overflow-y-auto rounded-lg border border-slate-700 bg-[#0e1118] divide-y divide-slate-800">
      {view.tracks.map(track => <li key={track.id}>
        <button type="button" disabled={disabled || blockedTracks?.has(track.id)} onClick={() => onSelect({ ...track, searchQuery: view.query })}
          aria-label={`Adicionar ${track.title}${track.artist ? ` de ${track.artist}` : ''} à fila do DJ`}
          className="w-full flex items-center gap-2 p-2 text-left hover:bg-emerald-500/10 disabled:opacity-50 disabled:cursor-not-allowed">
          {track.coverUrl && <img src={track.coverUrl} alt="" referrerPolicy="no-referrer" loading="lazy" className="h-8 w-8 shrink-0 rounded object-cover" />}
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-medium text-slate-100 truncate">{track.title}</span>
            {track.artist && <span className="block text-[10px] text-slate-400 truncate">{track.artist}</span>}
          </span>
          <span className="shrink-0 text-[10px] text-emerald-300">{blockedTracks?.get(track.id) === 'uncertain' ? 'Confira a fila' : blockedTracks?.has(track.id) ? 'Adicionando…' : 'Adicionar'}</span>
        </button>
      </li>)}
    </ul>
  )
}

export function SpotifyDjRequests({ zoneId }: { zoneId: string }) {
  const dj = useSpotifyJamStore(state => state.djStateByZone[zoneId])
  const isDjModeActive = useSpotifyJamStore(state => state.isDjModeActive)
  const local = useLocalPlayerDetails()
  const inputId = useId()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<SpotifySearchView>(emptySpotifySearch)
  const searchSession = useRef<ReturnType<typeof createSpotifySearchSession> | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const pending = useRef(false)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    const session = createSpotifySearchSession(query => searchDjSongs(zoneId, query), setSuggestions)
    searchSession.current = session
    setSuggestions(emptySpotifySearch)
    return () => { session.dispose(); searchSession.current = null }
  }, [zoneId, dj?.djPeerId, dj?.startedAt, local.currentZoneId])
  if (!dj?.isDjActive || local.currentZoneId !== zoneId) return null
  const requests = dj.requests || []
  const isOwner = isDjModeActive && dj.djPeerId === local.id
  const pendingCount = requests.filter(request => request.status !== 'queued' && request.status !== 'error').length
  const full = pendingCount >= MAX_DJ_SONG_REQUESTS
  const blockedTracks = new Map(requests.flatMap(request => request.track && (request.status === 'adding' || request.status === 'uncertain')
    ? [[request.track.id, request.status] as const] : []))

  const sendSong = async (text: string, input: HTMLInputElement | null, track: SpotifySearchTrack) => {
    if (pending.current) return
    if (!text.trim()) return
    pending.current = true
    setBusy('send'); setError(null); setFeedback(null)
    try {
      const result = await requestDjSong(zoneId, text, track)
      if (!alive.current) return
      if (result.ok) {
        if (input) input.value = ''
        searchSession.current?.setQuery('')
        setFeedback('Música adicionada à fila do DJ.')
      } else setError(result.error || 'Não foi possível enviar o pedido.')
    } catch { if (alive.current) setError('Não foi possível enviar o pedido. Tente novamente.') }
    finally { pending.current = false; if (alive.current) setBusy(null) }
  }
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const input = event.currentTarget.elements.namedItem('songQuery') as HTMLInputElement | null
    searchSession.current?.setQuery(input?.value || '')
  }
  const search = async (requestId: string) => {
    if (pending.current) return
    pending.current = true
    setBusy(requestId); setError(null); setFeedback(null)
    try {
      const result = await openDjSongRequest(zoneId, requestId)
      if (!alive.current) return
      if (result.ok) setFeedback('Busca da faixa aberta no Spotify.')
      else setError(result.error || 'Não foi possível abrir a busca no Spotify.')
    } catch { if (alive.current) setError('Não foi possível abrir a busca no Spotify. Tente novamente.') }
    finally { pending.current = false; if (alive.current) setBusy(null) }
  }
  const remove = (requestId: string) => {
    const result = removeDjSongRequest(zoneId, requestId)
    setError(result.ok ? null : result.error || 'Não foi possível remover o pedido.')
    setFeedback(result.ok ? 'Pedido removido da lista.' : null)
  }

  return (
    <section aria-label="Pedidos de música" className="space-y-3 rounded-2xl border border-slate-800 bg-[#141721] p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-slate-200">Pedidos da sala</h3>
        <span className="text-[10px] text-slate-400 tabular-nums">{pendingCount}/{MAX_DJ_SONG_REQUESTS} pendentes</span>
      </div>
      <form onSubmit={submit} className="space-y-2">
        <label htmlFor={inputId} className="text-xs text-slate-400">Música ou artista</label>
        <div className="flex gap-2">
          <input ref={inputRef} id={inputId} name="songQuery" type="search" maxLength={MAX_DJ_SONG_QUERY_LENGTH} required
            placeholder="Nome da música e artista" autoComplete="off" disabled={busy !== null || full}
            onChange={event => { setError(null); setFeedback(null); searchSession.current?.setQuery(event.currentTarget.value) }}
            className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-[#0e1118] px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 disabled:opacity-50" />
          <button type="submit" disabled={busy !== null || full} aria-busy={busy === 'send'}
            className="shrink-0 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed">
            {busy === 'send' ? 'Adicionando…' : 'Buscar'}
          </button>
        </div>
      </form>
      <SpotifySongSearchResults view={suggestions} disabled={busy !== null || full} blockedTracks={blockedTracks}
        onSelect={track => { void sendSong([track.title, track.artist].filter(Boolean).join(' — ').slice(0, MAX_DJ_SONG_QUERY_LENGTH), inputRef.current, track) }} />
      <p className="text-[11px] text-slate-400">{full ? 'Há muitos pedidos em processamento. Aguarde algumas inclusões terminarem.' : 'Selecione uma música para adicioná-la à fila do DJ.'}</p>
      {requests.length ? (
        <ol className="max-h-48 overflow-y-auto divide-y divide-slate-800">
          {requests.map(request => (
            <li key={request.id} className="flex items-center gap-2 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-xs text-slate-200 break-words">{request.track?.title || request.query}</p>
                {request.track?.artist && <p className="text-[10px] text-slate-400 truncate">{request.track.artist}</p>}
                <p className="text-[10px] text-slate-500 truncate">Pedido por {request.requestedByName}</p>
                {request.status && <p className={`text-[10px] ${request.status === 'queued' ? 'text-emerald-300' : request.status === 'adding' ? 'text-slate-400' : 'text-amber-300'}`}>
                  {request.status === 'queued' ? 'Adicionada ao Spotify' : request.status === 'adding' ? 'Adicionando ao Spotify…' : request.status === 'uncertain' ? 'Confira a fila no Spotify' : 'Falha ao adicionar'}
                </p>}
                {request.error && <p className="text-[10px] text-amber-300 break-words">{request.error}</p>}
              </div>
              {isOwner && <div className="flex shrink-0 items-center gap-1">
                {(!request.status || request.status === 'error' || request.status === 'uncertain') && <button type="button" onClick={() => search(request.id)} disabled={busy !== null}
                  aria-label={`Buscar no Spotify: ${request.query}`} title="Buscar no Spotify"
                  className="p-2 rounded-lg text-emerald-300 hover:bg-emerald-500/15 disabled:opacity-50">
                  <Search aria-hidden="true" className="h-4 w-4" />
                </button>}
                <button type="button" onClick={() => remove(request.id)} disabled={busy !== null || request.status === 'adding'}
                  aria-label={`Remover pedido: ${request.query}`} title="Remover pedido atendido"
                  className="p-2 rounded-lg text-slate-400 hover:text-rose-300 hover:bg-rose-500/10 disabled:opacity-50">
                  <Trash2 aria-hidden="true" className="h-4 w-4" />
                </button>
              </div>}
            </li>
          ))}
        </ol>
      ) : <p className="text-xs text-slate-500">Os pedidos aparecerão aqui.</p>}
      {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
      {feedback && <p role="status" aria-live="polite" className="text-xs text-emerald-300">{feedback}</p>}
    </section>
  )
}
