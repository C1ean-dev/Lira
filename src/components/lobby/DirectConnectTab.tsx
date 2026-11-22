import React, { useId } from 'react'
import { User, PlusCircle, LogIn, Sparkles, Clipboard } from 'lucide-react'
import { useMediaStore } from '../../store/useMediaStore'
import { DirectConnectionPanel } from './DirectConnectionPanel'
import { normalizeSpaceInvite } from '../../utils/spaceInviteLink'
import { Button, Input } from '../ui'

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

const rowClass = 'grid gap-2 sm:grid-cols-[minmax(0,1fr)_11.5rem] sm:items-end'

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
    <div className="space-y-4 overflow-y-auto p-4 sm:p-6 font-mono text-lira-ink bg-lira-panel">
      <div>
        <label htmlFor={`${fieldId}-name`} className="mb-1.5 block text-xs font-semibold text-lira-muted">Seu Nickname</label>
        <div className="flex gap-2">
          <Input
            id={`${fieldId}-name`}
            type="text"
            value={userName}
            onChange={event => setUserName(event.target.value)}
            placeholder="Ex: Lucas, Carol..."
            className="h-10 text-sm"
            maxLength={32}
          />
          <Button
            type="button"
            variant="quiet"
            size="md"
            onClick={onOpenAvatarCustomizer}
            title="Personalizar Avatar Pixel Art"
          >
            <User className="h-4 w-4" />
            Avatar
          </Button>
        </div>
      </div>

      <form className="space-y-3 border-t border-dashed border-lira-rule/60 pt-4" onSubmit={event => {
        event.preventDefault()
        if (!loading && code && !directInvite) onJoin(code)
      }}>
        <div className={rowClass}>
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <label htmlFor={`${fieldId}-code`} className="text-xs font-semibold text-lira-muted">Código da sala</label>
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
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-lira-accent hover:underline disabled:opacity-50"
              >
                <Clipboard className="h-3.5 w-3.5" />
                Colar código
              </button>
            </div>
            <Input
              id={`${fieldId}-code`}
              type="text"
              value={roomInput}
              onChange={event => setRoomInput(event.target.value)}
              placeholder="Cole o código, convite ou link"
              className="h-10 text-sm"
              autoCapitalize="off"
              spellCheck={false}
              readOnly={loading && !directInvite}
            />
          </div>
          {!directInvite && (
            <Button type="submit" variant="primary" size="md" disabled={loading || !code}>
              <LogIn className="h-4 w-4" />
              Entrar na sala
            </Button>
          )}
        </div>
        {directFallback && <p className="text-sm text-lira-muted">As outras rotas não conectaram. O Lira vai preparar uma resposta direta.</p>}
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

      <form className={`${rowClass} border-t border-dashed border-lira-rule/60 pt-4`} onSubmit={event => {
        event.preventDefault()
        if (!loading) onCreate()
      }}>
        <div>
          <label htmlFor={`${fieldId}-space`} className="mb-1.5 block text-xs font-semibold text-lira-muted">Nome do espaço</label>
          <Input
            id={`${fieldId}-space`}
            type="text"
            value={createRoomName}
            onChange={event => setCreateRoomName(event.target.value)}
            placeholder="Ex: Reunião de Equipe"
            className="h-10 text-sm"
            maxLength={35}
          />
        </div>
        <Button type="submit" variant="secondary" size="md" disabled={loading}>
          <PlusCircle className="h-4 w-4" />
          Criar espaço
        </Button>
      </form>

      {loading && !directInvite && <p role="status" className="text-sm text-lira-accent">Conectando ao espaço…</p>}
      {error && <p role="alert" className="text-sm text-lira-error">{error}</p>}

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-dashed border-lira-rule/60 pt-3 text-xs text-lira-muted">
        <span className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 shrink-0 text-lira-accent" />
          Supressor de Ruído DSP &amp; Anti-Eco ativados
        </span>
        <button
          type="button"
          onClick={() => useMediaStore.getState().setSettingsModalOpen(true)}
          className="py-1 font-semibold text-lira-accent underline hover:text-lira-ink"
        >
          Configurar Áudio
        </button>
      </div>
    </div>
  )
}
