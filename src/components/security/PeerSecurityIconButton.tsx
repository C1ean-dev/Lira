import React from 'react'
import { Lock, ShieldAlert, ShieldCheck } from 'lucide-react'
import {
  resolvePeerSecurity,
  useSecurityStore,
  type PeerSecurityStatus,
} from '../../store/useSecurityStore'
import { useGameStore } from '../../store/useGameStore'
import { findFriendKey } from '../../utils/userId'

export interface PeerSecurityIconButtonProps {
  peerId: string
  displayName: string
  candidateIds?: Array<string | undefined | null>
  size?: 'xs' | 'sm'
  className?: string
}

function getIconMeta(status: PeerSecurityStatus): {
  Icon: React.ComponentType<{ className?: string }>
  colorClass: string
  tooltip: string
} {
  switch (status) {
    case 'verified':
      return {
        Icon: ShieldCheck,
        colorClass: 'text-lira-online hover:bg-lira-online/15',
        tooltip: 'Identidade verificada (E2EE) — clique para inspecionar',
      }
    case 'key_changed':
      return {
        Icon: ShieldAlert,
        colorClass: 'text-lira-amber hover:bg-lira-amber/15 animate-pulse',
        tooltip: 'Chave de identidade alterada — clique para revisar',
      }
    case 'mitm_blocked':
      return {
        Icon: ShieldAlert,
        colorClass: 'text-lira-error hover:bg-lira-error/15 animate-pulse',
        tooltip: 'Conexão bloqueada (anti-MITM) — clique para detalhes',
      }
    case 'encrypted':
      return {
        Icon: Lock,
        colorClass: 'text-lira-online/85 hover:bg-lira-online/15',
        tooltip: 'Criptografado ponta a ponta (ainda não confirmado) — clique para verificar',
      }
    case 'legacy':
    case 'pending':
    default:
      return {
        Icon: Lock,
        colorClass: 'text-lira-muted hover:text-lira-ink hover:bg-lira-surface',
        tooltip: 'Criptografia ainda não confirmada — clique para verificar',
      }
  }
}

export const PeerSecurityIconButton: React.FC<PeerSecurityIconButtonProps> = ({
  peerId,
  displayName,
  candidateIds = [],
  size = 'sm',
  className = '',
}) => {
  const peers = useSecurityStore((s) => s.peers)
  const openInspection = useSecurityStore((s) => s.openInspection)
  const friends = useGameStore((s) => s.friends)
  const friendProfiles = useGameStore((s) => s.friendProfiles)

  const ids = Array.from(new Set([peerId, ...candidateIds].filter((id): id is string => Boolean(id))))
  const peerSec = resolvePeerSecurity(peers, ids)
  const friendKey = findFriendKey(friends, friendProfiles, ids)
  const friendProfile = friendKey ? friendProfiles[friendKey] : undefined

  const effectiveStatus: PeerSecurityStatus = peerSec
    ? peerSec.status === 'encrypted' && friendProfile?.identityKeyVerified
      ? 'verified'
      : peerSec.status
    : friendProfile?.identityKeyVerified
    ? 'verified'
    : friendProfile?.identityKey
    ? 'encrypted'
    : 'pending'

  const { Icon, colorClass, tooltip } = getIconMeta(effectiveStatus)
  const sizeClass = size === 'xs' ? 'p-0.5' : 'p-1'
  const iconSizeClass = size === 'xs' ? 'w-3 h-3' : 'w-3.5 h-3.5'

  return (
    <button
      type="button"
      data-security-icon={effectiveStatus}
      onClick={(e) => {
        e.stopPropagation()
        openInspection({
          peerId: peerSec?.peerId || peerId,
          displayName,
          candidateIds: ids,
        })
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      title={tooltip}
      aria-label={tooltip}
      className={`inline-flex items-center justify-center rounded-[6px] transition-colors shrink-0 cursor-pointer ${sizeClass} ${colorClass} ${className}`}
    >
      <Icon className={iconSizeClass} />
    </button>
  )
}
