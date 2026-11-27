import React from 'react'
import { ShieldAlert, X } from 'lucide-react'
import { useSecurityStore } from '../../store/useSecurityStore'

function alertTitleForReason(reason: string): { title: string; isWarning: boolean } {
  switch (reason) {
    case 'call_e2ee_legacy_peer':
    case 'call_e2ee_unavailable':
      return { title: 'Chamada criptografada indisponível', isWarning: true }
    case 'local_dm_sync_unavailable':
      return { title: 'Sincronização local de DMs indisponível', isWarning: true }
    case 'pinned_key_changed':
      return { title: 'Chave de identidade alterada', isWarning: true }
    case 'dtls_mismatch':
      return { title: 'Possível ataque MITM detectado (DTLS)', isWarning: false }
    case 'host_key_mismatch':
      return { title: 'Chave do host da sala inválida', isWarning: false }
    case 'plaintext_downgrade':
      return { title: 'Downgrade sem criptografia bloqueado', isWarning: false }
    case 'invalid_signature':
      return { title: 'Assinatura criptográfica inválida', isWarning: false }
    default:
      return { title: 'Alerta de segurança E2EE', isWarning: false }
  }
}

export const SecurityAlertBanner: React.FC = () => {
  const alerts = useSecurityStore((s) => s.alerts)
  const dismissAlert = useSecurityStore((s) => s.dismissAlert)
  const openInspection = useSecurityStore((s) => s.openInspection)

  if (alerts.length === 0) return null

  const visibleAlerts = alerts.slice(-3).reverse()

  return (
    <div
      className="fixed top-3 right-3 z-[95] flex flex-col gap-2 max-w-sm w-[calc(100vw-24px)] pointer-events-none font-mono"
      aria-live="assertive"
    >
      {visibleAlerts.map((alert) => {
        const meta = alertTitleForReason(alert.reason)
        const cardStyle = meta.isWarning
          ? 'border-lira-amber/60 bg-lira-panel text-lira-amber'
          : 'border-lira-error/60 bg-lira-panel text-lira-error'

        return (
          <div
            key={alert.id}
            role="alert"
            className={`pointer-events-auto rounded-[12px] border p-3 shadow-xl backdrop-blur-md space-y-2 ${cardStyle}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-bold">
                <ShieldAlert className="w-4 h-4 shrink-0" />
                <span>{meta.title}</span>
              </div>
              <button
                type="button"
                onClick={() => dismissAlert(alert.id)}
                aria-label="Dispensar alerta"
                className="p-0.5 rounded-[4px] text-lira-muted hover:text-lira-ink transition-colors shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className="text-[11px] text-lira-ink leading-relaxed break-words">{alert.message}</p>
            {alert.reason !== 'local_dm_sync_unavailable' && <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => openInspection({ peerId: alert.peerId })}
                className="px-2.5 py-1 rounded-[6px] bg-lira-surface border border-lira-rule text-lira-ink hover:border-lira-accent text-[10px] font-bold transition-colors"
              >
                Inspecionar
              </button>
            </div>}
          </div>
        )
      })}
    </div>
  )
}
