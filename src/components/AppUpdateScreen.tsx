import React from 'react'
import { LiraLogo } from './LiraLogo'
import { useUpdateStore } from '../store/useUpdateStore'
import { AlertCircle, RotateCcw, X } from 'lucide-react'

export const AppUpdateScreen: React.FC = () => {
  const updateInfo = useUpdateStore((s) => s.updateInfo)
  const status = useUpdateStore((s) => s.status)
  const progress = useUpdateStore((s) => s.progress)
  const error = useUpdateStore((s) => s.error)
  const setIsUpdateScreenOpen = useUpdateStore((s) => s.setIsUpdateScreenOpen)
  const checkForUpdatesAndDownload = useUpdateStore((s) => s.checkForUpdatesAndDownload)
  const applyUpdate = useUpdateStore((s) => s.applyUpdate)

  const isInstalling = status === 'installing'
  const isDownloading = status === 'downloading'
  const isError = status === 'error'

  const percent = Math.min(100, Math.max(0, Math.round(progress?.percent || (isInstalling ? 100 : 0))))
  const downloadedMB = progress?.downloaded ? (progress.downloaded / (1024 * 1024)).toFixed(1) : null
  const totalMB = progress?.total ? (progress.total / (1024 * 1024)).toFixed(1) : null
  const targetVer = updateInfo?.latestVersion || ''

  return (
    <div className="fixed inset-0 z-[9999] bg-[#0c0e14] flex flex-col items-center justify-center select-none overflow-hidden text-slate-100 font-sans">
      {/* Ambient background glow */}
      <div className="absolute w-[600px] h-[600px] bg-indigo-600/15 rounded-full blur-[140px] pointer-events-none -z-10 animate-pulse" />
      <div className="absolute w-[400px] h-[400px] bg-emerald-500/10 rounded-full blur-[100px] pointer-events-none -z-10" />

      {/* Main Center Card */}
      <div className="flex flex-col items-center text-center max-w-md w-full px-6">
        {/* App Icon Centered with breathing pulse */}
        <div className="relative mb-6">
          <div className="absolute -inset-4 bg-gradient-to-r from-indigo-500/30 to-emerald-400/30 rounded-full blur-xl opacity-75 animate-pulse" />
          <div className="relative w-28 h-28 rounded-3xl bg-[#141824]/90 border border-indigo-500/30 shadow-2xl shadow-indigo-900/50 flex items-center justify-center backdrop-blur-md">
            <LiraLogo size={80} />
          </div>
        </div>

        {/* Brand & Update Title */}
        <h1 className="text-2xl font-black tracking-wider text-white flex items-center gap-2">
          <span>LIRA</span>
          {targetVer && (
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-semibold tracking-normal">
              {targetVer}
            </span>
          )}
        </h1>

        {/* Dynamic Status Text */}
        <div className="mt-2 min-h-[48px] flex flex-col items-center justify-center">
          {isDownloading && (
            <>
              <p className="text-sm font-semibold text-slate-200">
                Baixando nova atualização...
              </p>
              <p className="text-xs text-slate-400 mt-0.5">
                Transferindo os arquivos necessários em alta velocidade.
              </p>
            </>
          )}

          {isInstalling && (
            <>
              <p className="text-sm font-semibold text-emerald-300 animate-pulse">
                Instalando nova versão...
              </p>
              <p className="text-xs text-slate-400 mt-0.5">
                O aplicativo será reiniciado automaticamente em instantes.
              </p>
            </>
          )}

          {isError && (
            <div className="flex items-center gap-2 text-rose-400 bg-rose-500/10 px-3 py-1.5 rounded-xl border border-rose-500/20">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <p className="text-xs font-semibold">{error || 'Ocorreu um erro ao atualizar.'}</p>
            </div>
          )}

          {!isDownloading && !isInstalling && !isError && (
            <>
              <p className="text-sm font-semibold text-slate-200">
                Preparando atualização...
              </p>
              <p className="text-xs text-slate-400 mt-0.5">
                Aguarde um momento.
              </p>
            </>
          )}
        </div>

        {/* Progress Bar Container */}
        {!isError && (
          <div className="w-full mt-6 space-y-2">
            <div className="w-full h-3 bg-[#181d2a] rounded-full p-0.5 border border-[#2a3142] overflow-hidden shadow-inner">
              <div
                className={`h-full rounded-full transition-all duration-300 ease-out ${
                  isInstalling
                    ? 'bg-gradient-to-r from-indigo-500 via-emerald-400 to-indigo-500 animate-pulse'
                    : 'bg-gradient-to-r from-indigo-500 to-emerald-400'
                }`}
                style={{ width: `${Math.min(100, Math.max(percent, isInstalling ? 100 : 5))}%` }}
              />
            </div>

            {/* Progress percentage & file size */}
            <div className="flex items-center justify-between text-xs text-slate-400 px-1 font-mono">
              <span className="font-bold text-slate-300">{percent}%</span>
              <span>
                {downloadedMB && totalMB
                  ? `${downloadedMB} MB / ${totalMB} MB`
                  : isInstalling
                  ? 'Finalizando...'
                  : 'Aguarde...'}
              </span>
            </div>
          </div>
        )}

        {/* Error Actions */}
        {isError && (
          <div className="flex items-center gap-3 mt-6">
            <button
              onClick={() => {
                checkForUpdatesAndDownload()
              }}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center gap-2 shadow-lg transition-all"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Tentar Novamente</span>
            </button>
            <button
              onClick={() => setIsUpdateScreenOpen(false)}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs flex items-center gap-1.5 transition-all"
            >
              <X className="w-3.5 h-3.5" />
              <span>Fechar</span>
            </button>
          </div>
        )}

        {/* Subtle footer tip */}
        {!isError && (
          <p className="text-[11px] text-slate-500 mt-8 tracking-wide">
            Por favor, não feche o aplicativo enquanto a atualização é concluída.
          </p>
        )}
      </div>
    </div>
  )
}
