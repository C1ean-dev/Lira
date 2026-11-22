import React from 'react'
import { DoorOpen, LogIn, MapPin, XCircle } from 'lucide-react'
import { RoomInviteData } from '../../types/chat'
import { RoomInviteState } from '../../utils/roomInvite'

interface Props {
  invite: RoomInviteData
  state: RoomInviteState
  senderName: string
  recipientName?: string
  onJoin: () => void
}

export const RoomInviteCard: React.FC<Props> = ({ invite, state, senderName, recipientName, onJoin }) => {
  const isSent = state === 'sent'
  const isClosed = state === 'closed'

  return (
    <div
      className={`rounded-xl border p-4 max-w-sm w-full select-none font-mono ${
        isClosed
          ? 'bg-lira-panel border-lira-quiet text-lira-muted'
          : 'bg-lira-surface border-lira-rule'
      }`}
    >
      <div className="flex items-center gap-2.5 mb-2.5">
        <div
          className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border ${
            isClosed
              ? 'bg-lira-ground border-lira-quiet text-lira-muted'
              : 'bg-lira-ground border-lira-accent/40 text-lira-accent'
          }`}
        >
          {isClosed ? <XCircle className="w-4 h-4" /> : <DoorOpen className="w-4 h-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-display font-bold text-lira-ink">
            {isSent ? 'Convite enviado' : isClosed ? 'Convite encerrado' : 'Convite para um espaço'}
          </div>
          <p className="text-[11px] text-lira-muted truncate">{invite.roomName}</p>
        </div>
      </div>

      <div className="text-xs text-lira-ink bg-lira-ground rounded-lg p-2.5 border border-dashed border-lira-rule/60">
        {isSent ? (
          <span>
            Você convidou <strong className="text-lira-accent">{recipientName || 'seu amigo'}</strong> para{' '}
            <strong className="text-lira-ink">{invite.roomName}</strong>.
          </span>
        ) : isClosed ? (
          <span>{senderName} não está mais neste espaço.</span>
        ) : (
          <span>
            <strong className="text-lira-accent">{senderName}</strong> convidou você para{' '}
            <strong className="text-lira-ink">{invite.roomName}</strong>.
          </span>
        )}
      </div>

      {state === 'open' && (
        <button
          type="button"
          onClick={onJoin}
          className="mt-3 w-full py-2 px-3 bg-lira-accent hover:bg-lira-ink text-lira-ground border-2 border-lira-accent hover:border-lira-ink font-mono font-bold text-xs rounded-lg flex items-center justify-center gap-1.5 transition-colors"
        >
          <LogIn className="w-3.5 h-3.5" />
          <span>Entrar no espaço</span>
        </button>
      )}

      {state === 'here' && (
        <div className="mt-3 flex items-center gap-1.5 text-[11px] font-bold text-lira-online">
          <MapPin className="w-3.5 h-3.5" />
          <span>Você já está neste espaço</span>
        </div>
      )}
    </div>
  )
}
