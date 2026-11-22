import React, { useState } from 'react'
import {
  Download,
  ExternalLink,
  AlertCircle,
  RefreshCw,
  Rocket,
} from 'lucide-react'
import { UpdateInfo, UpdateService, UpdateProgress } from '../services/updateService'
import { UpdateStatus } from '../store/useUpdateStore'
import { Button, Badge, Card } from './ui'

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
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-lira-ground/85 p-4 select-none font-mono text-lira-ink">
      <Card variant="dashed" className="w-full max-w-md overflow-hidden flex flex-col">
        <div className="bg-lira-surface border-b border-dashed border-lira-rule/60 p-6 text-center relative overflow-hidden">
          <div className="relative z-10 flex flex-col items-center">
            <div className="w-12 h-12 rounded-[12px] bg-lira-ground border border-lira-rule flex items-center justify-center text-lira-accent mb-2">
              <Rocket className="w-6 h-6 text-lira-accent" />
            </div>
            <h2 className="font-display text-lg font-bold text-lira-accent tracking-tight">Nova Atualização Disponível!</h2>
            <Badge variant="default" className="mt-1 gap-2 px-3 py-1">
              <span className="text-lira-muted">Atual: v{updateInfo.currentVersion}</span>
              <span>➔</span>
              <span className="text-lira-online font-bold">{updateInfo.latestVersion}</span>
            </Badge>
          </div>
        </div>

        <div className="p-6 space-y-4 bg-lira-panel">
          {updateInfo.releaseNotes && (
            <div className="space-y-1.5">
              <label className="text-[11px] font-mono font-bold text-lira-muted uppercase tracking-wider">
                Novidades & Melhorias:
              </label>
              <div className="bg-lira-ground border border-lira-quiet rounded-[8px] p-3.5 text-xs font-mono text-lira-ink max-h-32 overflow-y-auto whitespace-pre-wrap leading-relaxed">
                {updateInfo.releaseNotes}
              </div>
            </div>
          )}

          {isDownloading && (
            <div className="space-y-2 bg-lira-ground p-4 rounded-[8px] border border-dashed border-lira-rule">
              <div className="flex items-center justify-between text-xs font-bold text-lira-ink">
                <span className="flex items-center gap-1.5 text-lira-accent">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Baixando atualização em segundo plano...
                </span>
                <span className="text-lira-online">{progress.percent}%</span>
              </div>

              <div className="w-full h-2.5 bg-lira-surface rounded-full overflow-hidden border border-lira-rule">
                <div
                  className="h-full bg-lira-accent transition-all duration-300 rounded-full"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>

              {progress.total > 0 && (
                <div className="text-[10px] text-lira-muted text-right font-mono">
                  {formatBytes(progress.downloaded)} / {formatBytes(progress.total)}
                </div>
              )}
            </div>
          )}

          {isInstalling && (
            <div className="p-4 rounded-[8px] bg-lira-ground border border-dashed border-lira-rule text-center space-y-2">
              <RefreshCw className="w-6 h-6 animate-spin text-lira-accent mx-auto" />
              <div className="text-xs font-bold text-lira-ink">
                Iniciando instalador da atualização...
              </div>
              <p className="text-[11px] text-lira-muted">
                O instalador fechará o programa, aplicará a atualização e abrirá o aplicativo atualizado.
              </p>
            </div>
          )}

          {activeError && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 p-3 rounded-[8px] bg-lira-error/15 border border-lira-error/40 text-xs text-lira-error">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{activeError}</span>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="md"
                onClick={() => UpdateService.openManualDownload(updateInfo)}
                className="w-full"
              >
                <Download className="w-4 h-4" />
                <span>Baixar pelo Navegador</span>
                <ExternalLink className="w-3.5 h-3.5 opacity-80" />
              </Button>
            </div>
          )}

          <div className="space-y-2 pt-1">
            {!isInstalling ? (
              <Button
                type="button"
                variant="primary"
                size="lg"
                onClick={handleApplyUpdate}
                className="w-full"
              >
                <Download className="w-4 h-4" />
                <span>Atualizar Agora</span>
              </Button>
            ) : (
              <div className="text-center text-[11px] text-lira-muted py-1">
                O instalador atualizará os arquivos e reiniciará o aplicativo automaticamente.
              </div>
            )}

            <div className="flex items-center justify-between pt-2 border-t border-dashed border-lira-rule/60">
              <button
                type="button"
                onClick={() => UpdateService.installUpdate(null, updateInfo.releaseUrl)}
                className="text-xs text-lira-accent hover:text-lira-ink font-semibold flex items-center gap-1 hover:underline"
              >
                <span>Ver no GitHub</span>
                <ExternalLink className="w-3 h-3" />
              </button>

              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => onClose(true)}
                disabled={isInstalling}
              >
                Lembrar Mais Tarde
              </Button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  )
}
