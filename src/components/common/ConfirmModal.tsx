import React, { useEffect } from 'react'
import { LogOut, X, AlertTriangle } from 'lucide-react'

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
  // Close on ESC key
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="relative w-full max-w-md bg-[#12151d] border border-[#2a3142] rounded-3xl shadow-2xl overflow-hidden p-6 space-y-5 animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Decorative Glow Background */}
        <div className="absolute -top-24 -right-24 w-48 h-48 bg-rose-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* Top Header & Close */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3.5">
            <div
              className={`w-12 h-12 rounded-2xl flex items-center justify-center border shadow-lg ${
                activeVariant === 'danger'
                  ? 'bg-rose-500/15 border-rose-500/30 text-rose-400 shadow-rose-500/10'
                  : 'bg-amber-500/15 border-amber-500/30 text-amber-400 shadow-amber-500/10'
              }`}
            >
              {icon === 'logout' ? (
                <LogOut className="w-6 h-6" />
              ) : (
                <AlertTriangle className="w-6 h-6" />
              )}
            </div>

            <div>
              <h3 className="text-base font-bold text-slate-100">{title}</h3>
              <p className="text-xs text-slate-400 mt-0.5 font-medium">Confirmação de Ação</p>
            </div>
          </div>

          <button
            onClick={onCancel}
            className="p-1.5 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800/60 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Description Body */}
        <div className="p-3.5 bg-[#181c26]/90 border border-[#2a3142] rounded-2xl">
          <p className="text-xs text-slate-300 leading-relaxed">{message}</p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-2.5 pt-1">
          <button
            onClick={onCancel}
            className="px-4 py-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white font-bold text-xs border border-slate-700 transition-all active:scale-95"
          >
            {cancelText}
          </button>

          <button
            onClick={onConfirm}
            className={`px-5 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 text-white shadow-lg transition-all active:scale-95 ${
              activeVariant === 'danger'
                ? 'bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 shadow-rose-600/30 border border-rose-500/40'
                : 'bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 shadow-indigo-600/30 border border-indigo-500/40'
            }`}
          >
            {icon === 'logout' && <LogOut className="w-3.5 h-3.5" />}
            <span>{confirmText}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
