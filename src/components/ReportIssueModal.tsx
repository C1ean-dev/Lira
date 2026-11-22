import React, { useState, useRef } from 'react'
import {
  X,
  Bug,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Paperclip,
  FileText,
  ExternalLink,
  UploadCloud,
  Image as ImageIcon,
  Trash2,
} from 'lucide-react'
import { buildGithubWebUrl } from '../utils/githubIssueUrl'

export interface UserFileAttachment {
  name: string
  size: number
  type: string
  isImage: boolean
  base64Data?: string
}

export interface ReportIssueFeedback {
  type: 'success' | 'warning' | 'error'
  message: string
  issueUrl?: string
  gistUrl?: string
  method?: 'cli' | 'backend' | 'web'
}

export interface ReportIssueModalProps {
  isOpen: boolean
  onClose: () => void
  initialFeedback?: ReportIssueFeedback | null
}

export function reportIssueFeedback(result: Awaited<ReturnType<typeof submitReportIssue>>): ReportIssueFeedback {
  if (!result.ok) {
    return { type: 'error', message: result.error || 'Ocorreu um erro ao criar a issue no GitHub.' }
  }
  if (result.method === 'web') {
    return {
      type: 'warning',
      message: 'A issue ainda não foi publicada. Conclua o envio pelo link do GitHub.' +
        (result.error ? ` Motivo da falha no envio automático: ${result.error}` : ''),
      issueUrl: result.issueUrl,
      gistUrl: result.gistUrl,
      method: 'web',
    }
  }
  return {
    type: 'success',
    message: 'Issue criada com sucesso no GitHub com os logs anexados!',
    issueUrl: result.issueUrl,
    gistUrl: result.gistUrl,
    method: result.method,
  }
}

export async function submitReportIssue(
  title: string,
  description: string,
  attachments?: UserFileAttachment[]
): Promise<{ ok: boolean; issueUrl?: string; gistUrl?: string; error?: string; method?: 'cli' | 'backend' | 'web' }> {
  const trimmedTitle = title.trim()
  const trimmedDesc = description.trim()
  if (!trimmedTitle || !trimmedDesc) {
    return { ok: false, error: 'Título e descrição são obrigatórios.' }
  }
  if (trimmedTitle.length < 3 || trimmedTitle.length > 250) {
    return { ok: false, error: 'O título deve ter entre 3 e 250 caracteres.' }
  }
  if (trimmedDesc.length < 5 || trimmedDesc.length > 50000) {
    return { ok: false, error: 'A descrição deve ter entre 5 e 50000 caracteres.' }
  }

  const electronApi =
    typeof window !== 'undefined'
      ? ((window as unknown as Record<string, unknown>).electronAPI as
          | {
              reportIssue?: (payload: {
                title: string
                description: string
                attachments?: UserFileAttachment[]
              }) => Promise<{
                ok: boolean
                issueUrl?: string
                gistUrl?: string
                error?: string
                method?: 'cli' | 'backend' | 'web'
              }>
            }
          | undefined)
      : undefined

  if (electronApi && typeof electronApi.reportIssue === 'function') {
    return await electronApi.reportIssue({
      title: trimmedTitle,
      description: trimmedDesc,
      attachments,
    })
  }

  const webUrl = buildGithubWebUrl({
    title: trimmedTitle,
    body: trimmedDesc,
  })
  return {
    ok: true,
    issueUrl: webUrl,
    method: 'web',
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const commaIdx = result.indexOf(',')
      resolve(commaIdx > -1 ? result.slice(commaIdx + 1) : result)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export const ReportIssueModal: React.FC<ReportIssueModalProps> = ({ isOpen, onClose, initialFeedback }) => {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [userFiles, setUserFiles] = useState<UserFileAttachment[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<ReportIssueFeedback | null>(initialFeedback ?? null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  if (!isOpen) return null

  const handleClose = () => {
    if (isSubmitting) return
    setTitle('')
    setDescription('')
    setUserFiles([])
    setFeedback(null)
    onClose()
  }

  const handleOpenLink = (url: string) => {
    const electronApi =
      typeof window !== 'undefined'
        ? ((window as unknown as Record<string, unknown>).electronAPI as
            | { openExternal?: (targetUrl: string) => Promise<void> }
            | undefined)
        : undefined

    if (electronApi && typeof electronApi.openExternal === 'function') {
      void electronApi.openExternal(url)
    } else if (typeof window !== 'undefined' && typeof window.open === 'function') {
      window.open(url, '_blank')
    }
  }

  const handleProcessFiles = async (files: FileList | File[]) => {
    const list = Array.from(files)
    const processed: UserFileAttachment[] = []
    for (const file of list) {
      const isImage = file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp)$/i.test(file.name)
      try {
        const base64Data = await readFileAsBase64(file)
        processed.push({
          name: file.name,
          size: file.size,
          type: file.type || (isImage ? 'image/png' : 'text/plain'),
          isImage,
          base64Data,
        })
      } catch (err) {
        console.warn('Could not read attached file:', file.name, err)
      }
    }
    if (processed.length > 0) {
      setUserFiles((prev) => [...prev, ...processed])
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await handleProcessFiles(e.dataTransfer.files)
    }
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      await handleProcessFiles(e.target.files)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const handleRemoveFile = (index: number) => {
    setUserFiles((prev) => prev.filter((_, idx) => idx !== index))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmedTitle = title.trim()
    const trimmedDesc = description.trim()
    if (!trimmedTitle || !trimmedDesc || isSubmitting) return

    setIsSubmitting(true)
    setFeedback(null)

    try {
      const result = await submitReportIssue(trimmedTitle, trimmedDesc, userFiles)
      setFeedback(reportIssueFeedback(result))
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Falha inesperada ao relatar o problema.',
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const isFormValid = title.trim().length >= 3 && title.trim().length <= 250 &&
    description.trim().length >= 5 && description.trim().length <= 50000

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="report-issue-title"
      className="fixed inset-0 z-[130] flex items-center justify-center bg-lira-ground/80 p-4 select-none font-mono"
    >
      <div className="bg-lira-panel border border-dashed border-lira-rule rounded-[12px] w-full max-w-lg overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-dashed border-lira-rule/60 bg-lira-surface/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-[8px] bg-lira-error/15 border border-lira-error/40 flex items-center justify-center text-lira-error">
              <Bug className="w-5 h-5" />
            </div>
            <div>
              <h2 id="report-issue-title" className="font-display text-lg font-bold text-lira-accent">
                Reportar problema
              </h2>
              <p className="text-xs font-mono text-lira-muted">
                Crie uma issue com diagnóstico e anexos de logs
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={isSubmitting}
            className="p-2 rounded-[8px] border border-lira-rule bg-lira-surface text-lira-muted hover:text-lira-ink hover:border-lira-accent transition-colors disabled:opacity-50"
            title="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        {feedback?.type === 'success' || feedback?.type === 'warning' ? (
          <div className="p-6 space-y-4">
            {feedback.type === 'warning' ? (
              <div className="p-4 rounded-[12px] bg-lira-amber/10 border border-dashed border-lira-amber/40 flex items-start gap-3 text-lira-amber">
                <AlertCircle className="w-5 h-5 text-lira-amber shrink-0 mt-0.5" />
                <div className="space-y-2">
                  <div>
                    <p className="font-display text-base font-bold text-lira-amber">Quase lá! Conclua o envio no GitHub</p>
                    <p className="text-xs text-lira-ink leading-relaxed mt-0.5">{feedback.message}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {feedback.issueUrl && (
                      <button
                        type="button"
                        onClick={() => handleOpenLink(feedback.issueUrl!)}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[8px] bg-lira-amber/15 hover:bg-lira-amber/25 border border-lira-amber/40 text-lira-amber text-xs font-mono font-bold transition-colors"
                      >
                        <span>Abrir e publicar no GitHub</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {feedback.gistUrl && (
                      <button
                        type="button"
                        onClick={() => handleOpenLink(feedback.gistUrl!)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-lira-surface hover:border-lira-accent border border-lira-rule text-lira-ink hover:text-lira-accent text-xs font-mono font-semibold transition-colors"
                      >
                        <span>Ver logs anexados (Gist)</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <p className="text-[11px] text-lira-muted pt-1">
                    Ao clicar no botão, a página de criação de issue será aberta no seu navegador com o título e os logs já preenchidos. Basta clicar em <strong>Submit new issue</strong>.
                  </p>
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-[12px] bg-lira-online/10 border border-dashed border-lira-online/40 flex items-start gap-3 text-lira-online">
                <CheckCircle2 className="w-5 h-5 text-lira-online shrink-0 mt-0.5" />
                <div className="space-y-2">
                  <p className="text-sm font-semibold">{feedback.message}</p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {feedback.issueUrl && (
                      <button
                        type="button"
                        onClick={() => handleOpenLink(feedback.issueUrl!)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-lira-online/15 hover:bg-lira-online/25 border border-lira-online/40 text-lira-online text-xs font-mono font-bold transition-colors"
                      >
                        <span>Ver issue no GitHub</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {feedback.gistUrl && (
                      <button
                        type="button"
                        onClick={() => handleOpenLink(feedback.gistUrl!)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-lira-surface hover:border-lira-accent border border-lira-rule text-lira-ink hover:text-lira-accent text-xs font-mono font-semibold transition-colors"
                      >
                        <span>Ver logs anexados (Gist)</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleClose}
                className="px-5 py-2 rounded-[8px] text-xs font-mono font-bold bg-lira-accent hover:bg-lira-ink text-lira-ground border border-lira-accent hover:border-lira-ink transition-colors"
              >
                Fechar
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto flex-1">
            <div className="space-y-1.5">
              <label htmlFor="issue-title-input" className="block text-xs font-bold text-lira-ink">
                Título do problema
              </label>
              <input
                id="issue-title-input"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={isSubmitting}
                placeholder="Ex: DJ cortando o som após alguns minutos"
                className="w-full px-3.5 py-2.5 rounded-[8px] bg-lira-ground border border-lira-quiet focus:border-lira-accent focus:outline-none text-lira-ink placeholder:text-lira-muted text-xs font-mono transition-colors"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="issue-desc-input" className="block text-xs font-bold text-lira-ink">
                Descrição do problema
              </label>
              <textarea
                id="issue-desc-input"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={isSubmitting}
                placeholder="Explique detalhadamente o que aconteceu, o que era esperado e passos para reproduzir o problema..."
                className="w-full px-3.5 py-2.5 rounded-[8px] bg-lira-ground border border-lira-quiet focus:border-lira-accent focus:outline-none text-lira-ink placeholder:text-lira-muted text-xs font-mono transition-colors resize-none"
              />
            </div>

            {/* Anexos de Logs Incluídos & Drag and Drop */}
            <div className="p-3.5 rounded-[12px] bg-lira-ground border border-lira-quiet space-y-2.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-lira-ink">
                <Paperclip className="w-3.5 h-3.5 text-lira-accent" />
                <span>Anexos de Logs Incluídos</span>
              </div>

              {/* Automatic Log Files (without DJ/Audio label and without Automático tag) */}
              <div className="grid grid-cols-2 gap-2 text-[11px] font-mono text-lira-muted">
                <div className="flex items-center gap-1.5 p-2 rounded-[8px] bg-lira-surface border border-lira-quiet">
                  <FileText className="w-3.5 h-3.5 text-lira-accent shrink-0" />
                  <span className="truncate">call-debug.log</span>
                </div>
                <div className="flex items-center gap-1.5 p-2 rounded-[8px] bg-lira-surface border border-lira-quiet">
                  <FileText className="w-3.5 h-3.5 text-lira-error shrink-0" />
                  <span className="truncate">lira-errors.log</span>
                </div>
                <div className="flex items-center gap-1.5 p-2 rounded-[8px] bg-lira-surface border border-lira-quiet">
                  <FileText className="w-3.5 h-3.5 text-lira-amber shrink-0" />
                  <span className="truncate">lira.log</span>
                </div>
                <div className="flex items-center gap-1.5 p-2 rounded-[8px] bg-lira-surface border border-lira-quiet">
                  <FileText className="w-3.5 h-3.5 text-lira-online shrink-0" />
                  <span className="truncate">lira-reports.jsonl</span>
                </div>
              </div>

              {/* Drag and Drop Zone */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`p-3 rounded-[8px] border border-dashed transition-colors cursor-pointer flex flex-col items-center justify-center gap-1 text-center select-none ${
                  isDragging
                    ? 'border-lira-accent bg-lira-surface text-lira-accent'
                    : 'border-lira-rule hover:border-lira-accent bg-lira-panel text-lira-muted hover:text-lira-ink'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/*,.log,.txt,.json,.jsonl,.zip"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <UploadCloud className="w-5 h-5 text-lira-accent" />
                <span className="text-xs font-medium">
                  Arraste arquivos aqui ou <span className="text-lira-accent underline">clique para selecionar</span>
                </span>
                <span className="text-[10px] text-lira-muted">
                  Imagens, prints de tela, textos ou arquivos adicionais de log
                </span>
              </div>

              {/* User Added Files List */}
              {userFiles.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <div className="text-[11px] font-semibold text-lira-ink">
                    Arquivos adicionados ({userFiles.length}):
                  </div>
                  <div className="max-h-28 overflow-y-auto space-y-1 pr-1">
                    {userFiles.map((file, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between gap-2 p-1.5 px-2 rounded-[6px] bg-lira-surface border border-lira-quiet text-xs text-lira-ink"
                      >
                        <div className="flex items-center gap-1.5 truncate">
                          {file.isImage ? (
                            <ImageIcon className="w-3.5 h-3.5 text-lira-accent shrink-0" />
                          ) : (
                            <FileText className="w-3.5 h-3.5 text-lira-accent shrink-0" />
                          )}
                          <span className="truncate">{file.name}</span>
                          <span className="text-[10px] font-mono tabular-nums text-lira-muted shrink-0">
                            ({formatFileSize(file.size)})
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleRemoveFile(idx)
                          }}
                          className="p-1 rounded-[4px] text-lira-muted hover:text-lira-error transition-colors"
                          title="Remover arquivo"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {feedback?.type === 'error' && (
              <div className="p-3 rounded-[8px] bg-lira-error/15 border border-lira-error/40 text-xs text-lira-error flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-lira-error shrink-0" />
                <span>{feedback.message}</span>
              </div>
            )}

            <div className="pt-2 flex items-center justify-end gap-3 border-t border-dashed border-lira-rule/60">
              <button
                type="button"
                onClick={handleClose}
                disabled={isSubmitting}
                className="px-4 py-2 rounded-[8px] text-xs font-mono font-semibold text-lira-muted hover:text-lira-ink bg-lira-surface border border-lira-rule hover:border-lira-accent transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={!isFormValid || isSubmitting}
                className="flex items-center gap-2 px-5 py-2 rounded-[8px] text-xs font-mono font-bold bg-lira-accent hover:bg-lira-ink border border-lira-accent hover:border-lira-ink disabled:bg-lira-surface disabled:border-lira-quiet disabled:text-lira-muted disabled:cursor-not-allowed text-lira-ground transition-colors"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Criando issue...</span>
                  </>
                ) : (
                  <span>Criar Issue no GitHub</span>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
