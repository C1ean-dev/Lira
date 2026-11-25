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

  const isSender = isSameParticipant(localPlayer, req.fromUserId, req.fromUserName)

  const peerId = isSender ? req.toUserId : req.fromUserId
  const peerName = isSender ? req.toUserName : req.fromUserName
  const isAlreadyFriend = friends.some((key) =>
    isSameParticipant(friendProfiles[key] || { id: key }, peerId, peerName)
  )

  const effectiveStatus = isAlreadyFriend ? 'accepted' : req.status

  const isPending = effectiveStatus === 'pending'
  const isAccepted = effectiveStatus === 'accepted'
  const isDeclined = effectiveStatus === 'declined'

  const targetName = isSender ? req.toUserName : req.fromUserName

  return (
    <div
      className={`rounded-xl border p-4 max-w-sm w-full transition-colors select-none font-mono ${
        isPending
          ? 'bg-lira-surface border-lira-rule'
          : isAccepted
          ? 'bg-lira-surface border-lira-online/50'
          : 'bg-lira-panel border-lira-quiet text-lira-muted'
      }`}
    >
      <div className="flex items-center gap-2.5 mb-2.5">
        <div
          className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border ${
            isPending
              ? 'bg-lira-ground border-lira-accent/40 text-lira-accent'
              : isAccepted
              ? 'bg-lira-online/15 border-lira-online/40 text-lira-online'
              : 'bg-lira-ground border-lira-quiet text-lira-muted'
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
            <span className="text-xs font-display font-bold text-lira-ink">
              {isPending
                ? isSender
                  ? 'Solicitação de Amizade Enviada'
                  : 'Solicitação de Amizade Recebida'
                : isAccepted
                ? 'Amizade Confirmada'
                : 'Solicitação Recusada'}
            </span>
            {isPending && (
              <span className="w-2 h-2 rounded-full bg-lira-amber animate-pulse" />
            )}
          </div>
          <p className="text-[11px] text-lira-muted truncate">
            {isSender ? `Para: ${req.toUserName}` : `De: ${req.fromUserName}`}
          </p>
        </div>
      </div>

      <div className="text-xs text-lira-ink mb-3 bg-lira-ground rounded-lg p-2.5 border border-dashed border-lira-rule/60">
        {isPending ? (
          isSender ? (
            <div className="flex items-center gap-2 text-lira-accent">
              <Clock className="w-3.5 h-3.5 shrink-0 animate-spin text-lira-amber" />
              <span>Aguardando resposta no chat...</span>
            </div>
          ) : (
            <div>
              <strong className="text-lira-accent">{req.fromUserName}</strong>{' '}
              gostaria de adicionar você à lista de amigos!
            </div>
          )
        ) : isAccepted ? (
          <div className="flex items-center gap-2 text-lira-online">
            <Sparkles className="w-4 h-4 shrink-0 text-lira-online" />
            <span>
              {isSender
                ? `${targetName} aceitou sua solicitação! Vocês agora são amigos.`
                : `Você aceitou a solicitação de ${req.fromUserName}! Vocês agora são amigos.`}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-lira-muted">
            <XCircle className="w-4 h-4 shrink-0 text-lira-error" />
            <span>
              {isSender
                ? `${targetName} recusou a solicitação de amizade.`
                : 'Você recusou a solicitação de amizade.'}
            </span>
          </div>
        )}
      </div>

      {!isSender && isPending && (
        <div className="flex items-center gap-2 pt-0.5">
          <button
            type="button"
            onClick={() => onAccept(req.requestId)}
            className="flex-1 py-2 px-3 bg-lira-accent hover:bg-lira-ink text-lira-ground border-2 border-lira-accent hover:border-lira-ink font-mono font-bold text-xs rounded-lg flex items-center justify-center gap-1.5 transition-colors"
            title="Aceitar amizade"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Aceitar</span>
          </button>

          <button
            type="button"
            onClick={() => onDecline(req.requestId)}
            className="py-2 px-3 bg-lira-ground hover:bg-lira-error/15 hover:text-lira-error hover:border-lira-error/50 text-lira-ink border border-lira-rule font-mono font-bold text-xs rounded-lg flex items-center justify-center gap-1.5 transition-colors"
            title="Recusar solicitação"
          >
            <X className="w-3.5 h-3.5" />
            <span>Recusar</span>
          </button>
        </div>
      )}

      {isAccepted && (
        <div className="flex items-center gap-1.5 text-[11px] font-bold text-lira-online pt-0.5">
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>Amizade ativa</span>
        </div>
      )}

      {isDeclined && (
        <div className="flex items-center gap-1.5 text-[11px] font-bold text-lira-muted pt-0.5">
          <X className="w-3.5 h-3.5 text-lira-error" />
          <span>Solicitação encerrada</span>
        </div>
      )}
    </div>
  )
}
