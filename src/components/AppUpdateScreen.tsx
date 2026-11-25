import React from 'react'
import { LiraLogo } from './LiraLogo'
import { useUpdateStore } from '../store/useUpdateStore'
import { AlertCircle, Download, ExternalLink, RotateCcw, X } from 'lucide-react'

import { UpdateInfo, UpdateProgress } from '../services/updateService'
import { UpdateStatus } from '../store/useUpdateStore'
import { Button, Badge, Card } from './ui'

export interface AppUpdateScreenProps {
  updateInfo?: UpdateInfo | null
  status?: UpdateStatus
  progress?: UpdateProgress
  error?: string | null
  onManualDownload?: () => void
  onRetry?: () => void
  onClose?: () => void
}

export const AppUpdateScreen: React.FC<AppUpdateScreenProps> = (props) => {
  const storeUpdateInfo = useUpdateStore((s) => s.updateInfo)
  const storeStatus = useUpdateStore((s) => s.status)
  const storeProgress = useUpdateStore((s) => s.progress)
  const storeError = useUpdateStore((s) => s.error)
  const lastCheckFailed = useUpdateStore((s) => s.lastCheckFailed)
  const setIsUpdateScreenOpen = useUpdateStore((s) => s.setIsUpdateScreenOpen)
  const checkForUpdatesAndDownload = useUpdateStore((s) => s.checkForUpdatesAndDownload)
  const openManualDownload = useUpdateStore((s) => s.openManualDownload)
  const applyUpdate = useUpdateStore((s) => s.applyUpdate)

  const updateInfo = props.updateInfo !== undefined ? props.updateInfo : storeUpdateInfo
  const status = props.status !== undefined ? props.status : storeStatus
  const progress = props.progress !== undefined ? props.progress : storeProgress
  const error = props.error !== undefined ? props.error : storeError

  const handleManualDownload = props.onManualDownload || openManualDownload
  const handleRetry = props.onRetry || checkForUpdatesAndDownload
  const handleClose = props.onClose || (() => setIsUpdateScreenOpen(false))

  const isInstalling = status === 'installing'
  const isDownloading = status === 'downloading'
  const isError = status === 'error'
  const isReady = status === 'ready'
  const isIdle = status === 'idle'
  const canInstall = isReady || (isIdle && updateInfo?.hasUpdate && !lastCheckFailed)
  const showProgress = isDownloading || isInstalling

  const percent = Math.min(100, Math.max(0, Math.round(progress?.percent || (isInstalling ? 100 : 0))))
  const downloadedMB = progress?.downloaded ? (progress.downloaded / (1024 * 1024)).toFixed(1) : null
  const totalMB = progress?.total ? (progress.total / (1024 * 1024)).toFixed(1) : null
  const targetVer = updateInfo?.latestVersion || ''

  return (
    <div className="fixed inset-0 z-[9999] bg-lira-ground flex flex-col items-center justify-center select-none overflow-hidden text-lira-ink font-mono p-4">
      <Card variant="dashed" className="flex flex-col items-center text-center max-w-md w-full p-6">
        <div className="relative mb-6">
          <div className="relative w-28 h-28 rounded-[12px] bg-lira-surface border border-lira-rule flex items-center justify-center">
            <LiraLogo size={80} />
          </div>
        </div>

        <h1 className="font-display text-2xl font-bold tracking-tight text-lira-accent flex items-center gap-2">
          <span>LIRA</span>
          {targetVer && (
            <Badge variant="default">
              {targetVer}
            </Badge>
          )}
        </h1>

        <div className="mt-2 min-h-[48px] flex flex-col items-center justify-center">
          {isDownloading && (
            <>
              <p className="text-sm font-semibold text-lira-ink">
                Baixando nova atualização...
              </p>
              <p className="text-xs text-lira-muted mt-0.5">
                Transferindo os arquivos necessários em alta velocidade.
              </p>
            </>
          )}

          {isInstalling && (
            <>
              <p className="text-sm font-semibold text-lira-online">
                Iniciando instalador da nova versão...
              </p>
              <p className="text-xs text-lira-muted mt-0.5">
                O instalador fechará o programa, aplicará a atualização e abrirá o aplicativo atualizado.
              </p>
            </>
          )}

          {isError && (
            <div className="flex items-center gap-2 text-lira-error bg-lira-error/15 px-3 py-1.5 rounded-[8px] border border-lira-error/40">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <p className="text-xs font-semibold">{error || 'Ocorreu um erro ao atualizar.'}</p>
            </div>
          )}

          {isReady && (
            <p className="text-sm font-semibold text-lira-online">Atualização pronta para instalar</p>
          )}

          {status === 'checking' && <p role="status" className="text-sm font-semibold text-lira-ink">Verificando atualizações...</p>}
          {isIdle && <p role="status" className="text-sm font-semibold text-lira-ink">
            {lastCheckFailed ? 'Não foi possível verificar atualizações.' : canInstall ? 'Atualização disponível' : 'Nenhuma atualização disponível'}
          </p>}
        </div>

        {showProgress && (
          <div className="w-full mt-6 space-y-2">
            <div className="w-full h-3 bg-lira-surface rounded-full p-0.5 border border-lira-rule overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300 ease-out bg-lira-accent"
                style={{ width: `${Math.min(100, Math.max(percent, isInstalling ? 100 : 5))}%` }}
              />
            </div>

            <div className="flex items-center justify-between text-xs text-lira-muted px-1 font-mono">
              <span className="font-bold text-lira-ink">{percent}%</span>
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

        {isError && (
          <div className="flex flex-col items-center gap-3 mt-6 w-full max-w-xs">
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={() => {
                handleManualDownload()
              }}
              className="w-full cursor-pointer"
            >
              <Download className="w-4 h-4 shrink-0" />
              <span>Baixar pelo Navegador</span>
              <ExternalLink className="w-3.5 h-3.5 shrink-0 opacity-80" />
            </Button>

            <div className="flex items-center gap-2 w-full">
              <Button
                type="button"
                variant="secondary"
                size="md"
                onClick={() => {
                  handleRetry()
                }}
                className="flex-1 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                <span>Tentar Novamente</span>
              </Button>
              <Button
                type="button"
                variant="quiet"
                size="md"
                onClick={() => handleClose()}
                className="flex-1 cursor-pointer"
              >
                <X className="w-3.5 h-3.5 shrink-0" />
                <span>Fechar</span>
              </Button>
            </div>
          </div>
        )}

        {!showProgress && !isError && (
          <div className="flex items-center gap-2 mt-6">
            {canInstall && (
              <Button
                type="button"
                variant="primary"
                size="md"
                onClick={() => applyUpdate()}
                className="cursor-pointer"
              >
                Atualizar agora
              </Button>
            )}
            {isIdle && lastCheckFailed && (
              <Button
                type="button"
                variant="secondary"
                size="md"
                onClick={() => handleRetry()}
                className="cursor-pointer"
              >
                Tentar novamente
              </Button>
            )}
            <Button
              type="button"
              variant="quiet"
              size="md"
              onClick={handleClose}
              className="cursor-pointer"
            >
              Fechar
            </Button>
          </div>
        )}

        {showProgress && (
          <p className="text-[11px] text-lira-muted mt-8 tracking-wide">
            Por favor, não feche o aplicativo enquanto a atualização é concluída.
          </p>
        )}
      </Card>
    </div>
  )
}
