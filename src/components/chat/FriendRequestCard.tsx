import React from 'react'
import {
  UserPlus,
  UserCheck,
  Check,
  X,
  Clock,
  Sparkles,
  CheckCircle2,
  XCircle,
} from 'lucide-react'
import { ChatMessage, FriendRequestData } from '../../types/chat'
import { useGameStore } from '../../store/useGameStore'
import { isSameParticipant } from '../../utils/userId'

interface Props {
  message: ChatMessage
  onAccept: (requestId: string) => void
  onDecline: (requestId: string) => void
}

export const FriendRequestCard: React.FC<Props> = ({
  message,
  onAccept,
  onDecline,
}) => {
  const localPlayer = useGameStore((s) => s.localPlayer)
  const friends = useGameStore((s) => s.friends)
  const friendProfiles = useGameStore((s) => s.friendProfiles)
  const req = message.friendRequest

  if (!req) return null

  // 1. Is the local player the original sender of this request?
  const isSender = isSameParticipant(localPlayer, req.fromUserId, req.fromUserName)

  // 2. Is the other person already a friend in useGameStore?
  const peerId = isSender ? req.toUserId : req.fromUserId
  const peerName = isSender ? req.toUserName : req.fromUserName
  const isAlreadyFriend = friends.some((key) =>
    isSameParticipant(friendProfiles[key] || { id: key }, peerId, peerName)
  )

  // 3. Effective status: if already in friends list, never show pending buttons!
  const effectiveStatus = isAlreadyFriend ? 'accepted' : req.status

  const isPending = effectiveStatus === 'pending'
  const isAccepted = effectiveStatus === 'accepted'
  const isDeclined = effectiveStatus === 'declined'

  const targetName = isSender ? req.toUserName : req.fromUserName

  return (
    <div
      className={`rounded-2xl border p-4 max-w-sm w-full transition-all shadow-lg select-none ${
        isPending
          ? 'bg-gradient-to-b from-[#1b2130] to-[#141824] border-indigo-500/40 shadow-indigo-950/30'
          : isAccepted
          ? 'bg-gradient-to-b from-emerald-950/30 to-[#121620] border-emerald-500/30 shadow-emerald-950/20'
          : 'bg-gradient-to-b from-slate-900/60 to-[#121620] border-slate-700/50 text-slate-400'
      }`}
    >
      {/* Top Banner */}
      <div className="flex items-center gap-2.5 mb-2.5">
        <div
          className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border ${
            isPending
              ? 'bg-indigo-600/20 border-indigo-500/30 text-indigo-400'
              : isAccepted
              ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400'
              : 'bg-slate-800 border-slate-700 text-slate-400'
          }`}
        >
          {isPending ? (
            <UserPlus className="w-4 h-4" />
          ) : isAccepted ? (
            <UserCheck className="w-4 h-4" />
          ) : (
            <XCircle className="w-4 h-4" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-bold text-slate-200">
              {isPending
                ? isSender
                  ? 'Solicitação de Amizade Enviada'
                  : 'Solicitação de Amizade Recebida'
                : isAccepted
                ? 'Amizade Confirmada'
                : 'Solicitação Recusada'}
            </span>
            {isPending && (
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            )}
          </div>
          <p className="text-[11px] text-slate-400 truncate">
            {isSender ? `Para: ${req.toUserName}` : `De: ${req.fromUserName}`}
          </p>
        </div>
      </div>

      {/* Body Message */}
      <div className="text-xs text-slate-300 mb-3 bg-[#0d1017]/50 rounded-xl p-2.5 border border-white/5">
        {isPending ? (
          isSender ? (
            <div className="flex items-center gap-2 text-indigo-300">
              <Clock className="w-3.5 h-3.5 shrink-0 animate-spin text-amber-400" />
              <span>Aguardando resposta no chat...</span>
            </div>
          ) : (
            <div>
              <strong className="text-indigo-300">{req.fromUserName}</strong>{' '}
              gostaria de adicionar você à lista de amigos!
            </div>
          )
        ) : isAccepted ? (
          <div className="flex items-center gap-2 text-emerald-300">
            <Sparkles className="w-4 h-4 shrink-0 text-emerald-400" />
            <span>
              {isSender
                ? `${targetName} aceitou sua solicitação! Vocês agora são amigos.`
                : `Você aceitou a solicitação de ${req.fromUserName}! Vocês agora são amigos.`}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-slate-400">
            <XCircle className="w-4 h-4 shrink-0 text-rose-400" />
            <span>
              {isSender
                ? `${targetName} recusou a solicitação de amizade.`
                : 'Você recusou a solicitação de amizade.'}
            </span>
          </div>
        )}
      </div>

      {/* Recipient Interactive Action Buttons (Pending only) */}
      {!isSender && isPending && (
        <div className="flex items-center gap-2 pt-0.5">
          <button
            type="button"
            onClick={() => onAccept(req.requestId)}
            className="flex-1 py-2 px-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 active:scale-95 text-white font-bold text-xs rounded-xl shadow-md shadow-emerald-950/50 flex items-center justify-center gap-1.5 transition-all"
            title="Aceitar amizade"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Aceitar</span>
          </button>

          <button
            type="button"
            onClick={() => onDecline(req.requestId)}
            className="py-2 px-3 bg-slate-800/80 hover:bg-rose-950/60 hover:text-rose-300 hover:border-rose-500/40 text-slate-300 border border-slate-700 active:scale-95 font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 transition-all"
            title="Recusar solicitação"
          >
            <X className="w-3.5 h-3.5" />
            <span>Recusar</span>
          </button>
        </div>
      )}

      {/* Resolved Status Badges */}
      {isAccepted && (
        <div className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-400 pt-0.5">
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>Amizade ativa</span>
        </div>
      )}

      {isDeclined && (
        <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 pt-0.5">
          <X className="w-3.5 h-3.5 text-rose-400" />
          <span>Solicitação encerrada</span>
        </div>
      )}
    </div>
  )
}
