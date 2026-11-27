import React from 'react'
import { Lock, LockOpen, Shield, ShieldAlert, ShieldCheck } from 'lucide-react'
import type { PeerSecurityStatus } from '../../store/useSecurityStore'

interface SecurityBadgeProps {
  status: PeerSecurityStatus | 'idle'
  mediaEncrypted?: boolean
  compact?: boolean
  labelOverride?: string
  title?: string
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void
  className?: string
}

interface BadgeStyleConfig {
  label: string
  compactLabel: string
  tooltip: string
  className: string
  Icon: React.ComponentType<{ className?: string }>
}

function getBadgeConfig(status: PeerSecurityStatus | 'idle', mediaEncrypted?: boolean): BadgeStyleConfig {
  switch (status) {
    case 'verified':
      return {
        label: mediaEncrypted ? 'Verificado • Mídia E2EE' : 'Verificado',
        compactLabel: 'OK',
        tooltip: 'Identidade verificada via número de segurança (E2EE). Clique para inspecionar.',
        className: 'bg-lira-online/15 text-lira-online border-lira-online/40 hover:bg-lira-online/25',
        Icon: ShieldCheck,
      }
    case 'encrypted':
      return {
        label: mediaEncrypted ? 'E2EE Mídia' : 'E2EE',
        compactLabel: 'E2EE',
        tooltip: 'Sessão criptografada ponta a ponta (TOFU). Clique para verificar o número de segurança.',
        className: 'bg-lira-surface text-lira-online border-lira-online/30 hover:border-lira-online',
        Icon: Lock,
      }
    case 'key_changed':
      return {
        label: 'Chave Alterada',
        compactLabel: 'Chave!',
        tooltip: 'A chave de identidade deste contato mudou! Clique para revisar antes de confiar.',
        className: 'bg-lira-amber/15 text-lira-amber border-lira-amber/50 hover:bg-lira-amber/25 animate-pulse',
        Icon: ShieldAlert,
      }
    case 'mitm_blocked':
      return {
        label: 'MITM Bloqueado',
        compactLabel: 'MITM',
        tooltip: 'Conexão bloqueada por falha na verificação criptográfica anti-MITM. Clique para detalhes.',
        className: 'bg-lira-error/15 text-lira-error border-lira-error/50 hover:bg-lira-error/25 animate-pulse',
        Icon: ShieldAlert,
      }
    case 'idle':
      return {
        label: 'E2EE Ativo',
        compactLabel: 'E2EE',
        tooltip: 'Criptografia ponta a ponta ativa neste espaço. Clique para inspecionar sua chave.',
        className: 'bg-lira-surface text-lira-muted border-lira-quiet hover:border-lira-accent hover:text-lira-ink',
        Icon: Shield,
      }
    case 'legacy':
    case 'pending':
    default:
      return {
        label: 'Não verificado',
        compactLabel: 'Pendente',
        tooltip: 'Sessão E2EE pendente ou aguardando handshake. Clique para inspecionar.',
        className: 'bg-lira-ground text-lira-muted border-lira-quiet hover:border-lira-rule',
        Icon: LockOpen,
      }
  }
}

export const SecurityBadge: React.FC<SecurityBadgeProps> = ({
  status,
  mediaEncrypted,
  compact = false,
  labelOverride,
  title,
  onClick,
  className = '',
}) => {
  const cfg = getBadgeConfig(status, mediaEncrypted)
  const Icon = cfg.Icon
  const text = labelOverride ?? (compact ? cfg.compactLabel : cfg.label)
  const baseClass = `inline-flex items-center gap-1 rounded-[6px] border font-mono font-semibold transition-colors shrink-0 ${
    compact ? 'px-1.5 py-0.5 text-[9px]' : 'px-2 py-0.5 text-[10px]'
  } ${cfg.className} ${className}`

  if (!onClick) {
    return (
      <span className={baseClass} title={title || cfg.tooltip} data-security-status={status}>
        <Icon className="w-3 h-3 shrink-0" />
        <span>{text}</span>
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={`${baseClass} cursor-pointer`}
      title={title || cfg.tooltip}
      aria-label={title || cfg.tooltip}
      data-security-status={status}
    >
      <Icon className="w-3 h-3 shrink-0" />
      <span>{text}</span>
    </button>
  )
}
