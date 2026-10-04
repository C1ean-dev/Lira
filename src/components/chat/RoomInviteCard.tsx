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

/** An invite to a space, as shown inside a private conversation. */
export const RoomInviteCard: React.FC<Props> = ({ invite, state, senderName, recipientName, onJoin }) => {
  const isSent = state === 'sent'
  const isClosed = state === 'closed'

  return (
    <div
      className={`rounded-2xl border p-4 max-w-sm w-full shadow-lg select-none ${
        isClosed
          ? 'bg-gradient-to-b from-slate-900/60 to-[#121620] border-slate-700/50 text-slate-400'
          : 'bg-gradient-to-b from-[#1b2130] to-[#141824] border-indigo-500/40 shadow-indigo-950/30'
      }`}
    >
      <div className="flex items-center gap-2.5 mb-2.5">
        <div
          className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border ${
            isClosed
              ? 'bg-slate-800 border-slate-700 text-slate-400'
              : 'bg-indigo-600/20 border-indigo-500/30 text-indigo-400'
          }`}
        >
          {isClosed ? <XCircle className="w-4 h-4" /> : <DoorOpen className="w-4 h-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-bold text-slate-200">
            {isSent ? 'Convite enviado' : isClosed ? 'Convite encerrado' : 'Convite para um espaço'}
          </div>
          <p className="text-[11px] text-slate-400 truncate">{invite.roomName}</p>
        </div>
      </div>

      <div className="text-xs text-slate-300 bg-[#0d1017]/50 rounded-xl p-2.5 border border-white/5">
        {isSent ? (
          <span>
            Você convidou <strong className="text-indigo-300">{recipientName || 'seu amigo'}</strong> para{' '}
            <strong className="text-slate-100">{invite.roomName}</strong>.
          </span>
        ) : isClosed ? (
          <span>{senderName} não está mais neste espaço.</span>
        ) : (
          <span>
            <strong className="text-indigo-300">{senderName}</strong> convidou você para{' '}
            <strong className="text-slate-100">{invite.roomName}</strong>.
          </span>
        )}
      </div>

      {state === 'open' && (
        <button
          type="button"
          onClick={onJoin}
          className="mt-3 w-full py-2 px-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 active:scale-95 text-white font-bold text-xs rounded-xl shadow-md shadow-emerald-950/50 flex items-center justify-center gap-1.5 transition-all"
        >
          <LogIn className="w-3.5 h-3.5" />
          <span>Entrar no espaço</span>
        </button>
      )}

      {state === 'here' && (
        <div className="mt-3 flex items-center gap-1.5 text-[11px] font-bold text-emerald-400">
          <MapPin className="w-3.5 h-3.5" />
          <span>Você já está neste espaço</span>
        </div>
      )}
    </div>
  )
}
