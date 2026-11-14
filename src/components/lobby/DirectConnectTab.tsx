import React, { useId } from 'react'
import { User, PlusCircle, LogIn, Sparkles, Clipboard } from 'lucide-react'
import { useMediaStore } from '../../store/useMediaStore'
import { DirectConnectionPanel } from './DirectConnectionPanel'
import { normalizeSpaceInvite } from '../../utils/spaceInviteLink'

interface Props {
  userName: string
  setUserName: (name: string) => void
  onOpenAvatarCustomizer: () => void
  createRoomName: string
  setCreateRoomName: (name: string) => void
  roomInput: string
  setRoomInput: (code: string) => void
  directFallback?: string
  error: string | null
  loading: boolean
  onCreate: () => void
  onJoin: (code: string) => void
  onJoined: () => void
  beginDirectJoin: () => boolean
  endDirectJoin: () => void
}

const inputClass = 'min-w-0 w-full rounded-xl border border-[#2a3142] bg-[#12151d] px-3 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-400'
const actionClass = 'min-h-10 rounded-xl px-3 py-2 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-300'
const rowClass = 'grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem] sm:items-end'

export const DirectConnectTab: React.FC<Props> = ({
  userName, setUserName, onOpenAvatarCustomizer, createRoomName, setCreateRoomName,
  roomInput, setRoomInput, directFallback, error, loading, onCreate, onJoin, onJoined, beginDirectJoin, endDirectJoin,
}) => {
  const fieldId = useId()
  let code = roomInput.trim()
  // A direct offer must still use the existing answer exchange panel.
  try { code = normalizeSpaceInvite(code) } catch { /* The join action displays validation errors. */ }
  const directInvite = code.startsWith('LIRA-DIRECT:') ? code : directFallback

  return (
    <div className="space-y-4 overflow-y-auto p-4 sm:p-6">
      <div>
        <label htmlFor={`${fieldId}-name`} className="mb-1.5 block text-xs font-semibold text-slate-300">Seu Nickname</label>
        <div className="flex gap-2">
          <input
            id={`${fieldId}-name`}
            type="text"
            value={userName}
            onChange={event => setUserName(event.target.value)}
            placeholder="Ex: Lucas, Carol..."
            className={inputClass}
            maxLength={32}
          />
          <button
            type="button"
            onClick={onOpenAvatarCustomizer}
            className={`${actionClass} shrink-0 border border-[#2a3142] bg-[#12151d] text-indigo-300 hover:bg-slate-800`}
            title="Personalizar Avatar Pixel Art"
          >
            <User className="h-4 w-4" />
            Avatar
          </button>
        </div>
      </div>

      <form className="space-y-3 border-t border-[#2a3142] pt-4" onSubmit={event => {
        event.preventDefault()
        if (!loading && code && !directInvite) onJoin(code)
      }}>
        <div className={rowClass}>
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <label htmlFor={`${fieldId}-code`} className="text-xs font-semibold text-slate-300">Código da sala</label>
              <button
                type="button"
                disabled={loading && !directInvite}
                onClick={async () => {
                  try {
                    const text = await navigator.clipboard.readText()
                    if (text) setRoomInput(text.trim())
                  } catch {
                    document.getElementById(`${fieldId}-code`)?.focus()
                  }
                }}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-300 hover:underline disabled:opacity-50"
              >
                <Clipboard className="h-3.5 w-3.5" />
                Colar código
              </button>
            </div>
            <input
              id={`${fieldId}-code`}
              type="text"
              value={roomInput}
              onChange={event => setRoomInput(event.target.value)}
              placeholder="Cole o código, convite ou link"
              className={inputClass}
              autoCapitalize="off"
              spellCheck={false}
              readOnly={loading && !directInvite}
            />
          </div>
          {!directInvite && (
            <button type="submit" disabled={loading || !code} className={`${actionClass} bg-indigo-600 text-white enabled:hover:bg-indigo-500`}>
              <LogIn className="h-4 w-4" />
              Entrar na sala
            </button>
          )}
        </div>
        {directFallback && <p className="text-sm text-slate-300">As outras rotas não conectaram. O Lira vai preparar uma resposta direta.</p>}
        {directInvite && (
          <DirectConnectionPanel
            key={directInvite}
            role="guest"
            invite={directInvite}
            guestName={userName}
            onJoined={onJoined}
            beginJoin={beginDirectJoin}
            endJoin={endDirectJoin}
          />
        )}
      </form>

      <form className={`${rowClass} border-t border-[#2a3142] pt-4`} onSubmit={event => {
        event.preventDefault()
        if (!loading) onCreate()
      }}>
        <div>
          <label htmlFor={`${fieldId}-space`} className="mb-1.5 block text-xs font-semibold text-slate-300">Nome do espaço</label>
          <input
            id={`${fieldId}-space`}
            type="text"
            value={createRoomName}
            onChange={event => setCreateRoomName(event.target.value)}
            placeholder="Ex: Reunião de Equipe"
            className={inputClass}
            maxLength={35}
          />
        </div>
        <button type="submit" disabled={loading} className={`${actionClass} border border-indigo-500/40 text-indigo-200 enabled:hover:bg-indigo-500/15`}>
          <PlusCircle className="h-4 w-4" />
          Criar espaço
        </button>
      </form>

      {loading && !directInvite && <p role="status" className="text-sm text-indigo-300">Conectando ao espaço…</p>}
      {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-[#2a3142] pt-3 text-xs text-slate-400">
        <span className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 shrink-0 text-indigo-400" />
          Supressor de Ruído DSP &amp; Anti-Eco ativados
        </span>
        <button
          type="button"
          onClick={() => useMediaStore.getState().setSettingsModalOpen(true)}
          className="py-1 font-semibold text-indigo-300 underline"
        >
          Configurar Áudio
        </button>
      </div>
    </div>
  )
}
