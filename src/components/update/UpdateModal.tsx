import React, { useState } from 'react'
import {
  Download,
  ExternalLink,
  AlertCircle,
  RefreshCw,
  Rocket,
} from 'lucide-react'
import { UpdateInfo, UpdateService, UpdateProgress } from '../../services/updateService'
import { UpdateStatus } from '../../store/useUpdateStore'

interface Props {
  updateInfo: UpdateInfo | null
  isOpen: boolean
  onClose: (dismiss?: boolean) => void
  status?: UpdateStatus
  progress?: UpdateProgress
  error?: string | null
  onApplyUpdate?: () => void
}

export const UpdateModal: React.FC<Props> = ({
  updateInfo,
  isOpen,
  onClose,
  status = 'ready',
  progress = { percent: 0, downloaded: 0, total: 0 },
  error: propsError = null,
  onApplyUpdate,
}) => {
  const [localInstalling, setLocalInstalling] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  if (!isOpen || !updateInfo || !updateInfo.hasUpdate) return null

  const isDownloading = status === 'downloading'
  const isInstalling = status === 'installing' || localInstalling
  const activeError = propsError || localError

  const handleApplyUpdate = async () => {
    setLocalInstalling(true)
    setLocalError(null)

    try {
      if (onApplyUpdate) {
        await onApplyUpdate()
      } else {
        const success = await UpdateService.applyUpdate(updateInfo.releaseUrl)
        if (!success) {
          setLocalError('Não foi possível iniciar o instalador automaticamente.')
          setLocalInstalling(false)
        }
      }
    } catch (err: any) {
      console.error(err)
      setLocalError('Erro ao aplicar atualização. Abra o GitHub para baixar manualmente.')
      setLocalInstalling(false)
    }
  }

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes <= 0) return '0 MB'
    const mb = bytes / (1024 * 1024)
    return mb.toFixed(1) + ' MB'
  }

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 select-none animate-in fade-in duration-200">
      <div className="bg-[#1b202c] border border-indigo-500/40 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl flex flex-col animate-in zoom-in-95 duration-200">
        {/* Header with gradient badge */}
        <div className="bg-gradient-to-br from-indigo-600 via-indigo-700 to-purple-800 p-6 text-center relative overflow-hidden">
          <div className="absolute -top-10 -right-10 w-28 h-28 rounded-full bg-white/10 blur-xl" />
          <div className="relative z-10 flex flex-col items-center">
            <div className="w-12 h-12 rounded-2xl bg-white/15 backdrop-blur-md border border-white/25 flex items-center justify-center text-white shadow-xl mb-2">
              <Rocket className="w-6 h-6 text-indigo-200 animate-bounce" />
            </div>
            <h2 className="text-lg font-extrabold text-white tracking-tight">Nova Atualização Disponível!</h2>
            <div className="mt-1 flex items-center gap-2 text-xs font-semibold bg-black/20 px-3 py-1 rounded-full text-indigo-100 border border-white/10">
              <span className="opacity-75">Atual: v{updateInfo.currentVersion}</span>
              <span>➔</span>
              <span className="text-emerald-300 font-bold">{updateInfo.latestVersion}</span>
            </div>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-4">
          {/* Release Notes Preview */}
          {updateInfo.releaseNotes && (
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">
                Novidades & Melhorias:
              </label>
              <div className="bg-[#12151d] border border-[#2a3142] rounded-2xl p-3.5 text-xs text-slate-300 max-h-32 overflow-y-auto whitespace-pre-wrap leading-relaxed">
                {updateInfo.releaseNotes}
              </div>
            </div>
          )}

          {/* Download Progress Bar (only if actively downloading when opened) */}
          {isDownloading && (
            <div className="space-y-2 bg-[#12151d] p-4 rounded-2xl border border-indigo-500/30">
              <div className="flex items-center justify-between text-xs font-bold text-slate-200">
                <span className="flex items-center gap-1.5 text-indigo-300">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Baixando atualização em segundo plano...
                </span>
                <span className="text-emerald-400">{progress.percent}%</span>
              </div>

              {/* Progress track */}
              <div className="w-full h-2.5 bg-[#1b202c] rounded-full overflow-hidden border border-[#2a3142]">
                <div
                  className="h-full bg-gradient-to-r from-indigo-500 to-emerald-400 transition-all duration-300 rounded-full"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>

              {progress.total > 0 && (
                <div className="text-[10px] text-slate-400 text-right font-mono">
                  {formatBytes(progress.downloaded)} / {formatBytes(progress.total)}
                </div>
              )}
            </div>
          )}

          {/* Installing status */}
          {isInstalling && (
            <div className="p-4 rounded-2xl bg-[#12151d] border border-indigo-500/40 text-center space-y-2">
              <RefreshCw className="w-6 h-6 animate-spin text-indigo-400 mx-auto" />
              <div className="text-xs font-bold text-slate-200">
                Iniciando instalador e reiniciando aplicativo...
              </div>
              <p className="text-[11px] text-slate-400">
                Aguarde um momento enquanto a nova versão é iniciada.
              </p>
            </div>
          )}

          {/* Error display */}
          {activeError && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{activeError}</span>
            </div>
          )}

          {/* Actions */}
          <div className="space-y-2 pt-1">
            {!isInstalling ? (
              <button
                type="button"
                onClick={handleApplyUpdate}
                className="w-full py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm shadow-xl shadow-indigo-600/30 transition-all active:scale-98 flex items-center justify-center gap-2"
              >
                <Download className="w-4 h-4" />
                <span>Atualizar Agora</span>
              </button>
            ) : (
              <div className="text-center text-[11px] text-slate-400 py-1">
                O aplicativo será reiniciado automaticamente com a nova versão.
              </div>
            )}

            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={() => UpdateService.installUpdate(null, updateInfo.releaseUrl)}
                className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold flex items-center gap-1 hover:underline"
              >
                <span>Ver no GitHub</span>
                <ExternalLink className="w-3 h-3" />
              </button>

              <button
                type="button"
                onClick={() => onClose(true)}
                disabled={isInstalling}
                className="text-xs text-slate-400 hover:text-slate-200 font-medium py-1 px-3 rounded-lg hover:bg-[#12151d] transition-colors disabled:opacity-50"
              >
                Lembrar Mais Tarde
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
