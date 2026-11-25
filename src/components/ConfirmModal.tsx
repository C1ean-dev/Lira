import React, { useEffect } from 'react'
import { LogOut, X, AlertTriangle } from 'lucide-react'
import { Button } from './ui/Button'

interface ConfirmModalProps {
  isOpen: boolean
  title?: string
  message?: string
  confirmText?: string
  cancelText?: string
  variant?: 'danger' | 'warning' | 'primary'
  confirmVariant?: 'danger' | 'warning' | 'primary'
  icon?: 'logout' | 'alert'
  onConfirm: () => void
  onCancel: () => void
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title = 'Sair do Espaço?',
  message = 'Você será desconectado da sessão atual, suas transmissões de áudio/vídeo serão encerradas e você retornará ao lobby inicial.',
  confirmText = 'Sim, Desconectar',
  cancelText = 'Cancelar',
  variant,
  confirmVariant = 'danger',
  icon = 'alert',
  onConfirm,
  onCancel,
}) => {
  const activeVariant = variant || confirmVariant

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel()
      } else if (e.key === 'Enter') {
        onConfirm()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onCancel, onConfirm])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-lira-ground/80"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
      onClick={onCancel}
    >
      <div
        className="relative w-full max-w-md bg-lira-panel border border-dashed border-lira-rule rounded-[12px] overflow-hidden p-5 space-y-4 text-lira-ink"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between pb-3 border-b border-dashed border-lira-quiet">
          <div className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-[8px] flex items-center justify-center border shrink-0 ${
                activeVariant === 'danger'
                  ? 'bg-lira-error/15 border-lira-error/40 text-lira-error'
                  : activeVariant === 'warning'
                  ? 'bg-lira-amber/15 border-lira-amber/40 text-lira-amber'
                  : 'bg-lira-surface border-lira-rule text-lira-accent'
              }`}
            >
              {icon === 'logout' ? (
                <LogOut className="w-5 h-5" />
              ) : (
                <AlertTriangle className="w-5 h-5" />
              )}
            </div>

            <div>
              <h3
                id="confirm-modal-title"
                className="font-display text-lg font-bold text-lira-accent leading-tight"
              >
                {title}
              </h3>
              <p className="text-[11px] font-mono text-lira-muted mt-0.5">Confirmação de Ação</p>
            </div>
          </div>

          <Button
            variant="icon"
            size="icon"
            onClick={onCancel}
            aria-label="Fechar"
            className="h-8 w-8"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="p-3.5 bg-lira-ground border border-lira-quiet rounded-[8px]">
          <p className="text-xs font-mono text-lira-ink leading-relaxed">{message}</p>
        </div>

        <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-dashed border-lira-quiet">
          <Button variant="quiet" size="md" onClick={onCancel}>
            {cancelText}
          </Button>

          <Button
            variant={activeVariant === 'danger' ? 'destructive' : 'primary'}
            size="md"
            onClick={onConfirm}
          >
            {icon === 'logout' && <LogOut className="w-3.5 h-3.5" />}
            <span>{confirmText}</span>
          </Button>
        </div>
      </div>
    </div>
  )
}
