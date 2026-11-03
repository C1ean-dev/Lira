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
      if (result.ok) {
        if (result.method === 'web') {
          setFeedback({
            type: 'warning',
            message:
              'O envio automático pelo servidor não estava disponível no momento. Preparamos o relatório com todos os detalhes e logs para você concluir a publicação no GitHub:',
            issueUrl: result.issueUrl,
            gistUrl: result.gistUrl,
            method: 'web',
          })
        } else {
          setFeedback({
            type: 'success',
            message: 'Issue criada com sucesso no GitHub com os logs anexados!',
            issueUrl: result.issueUrl,
            gistUrl: result.gistUrl,
            method: result.method,
          })
        }
      } else {
        setFeedback({
          type: 'error',
          message: result.error || 'Ocorreu um erro ao criar a issue no GitHub.',
        })
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Falha inesperada ao relatar o problema.',
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const isFormValid = title.trim().length > 0 && description.trim().length > 0

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="report-issue-title"
      className="fixed inset-0 z-[130] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200 select-none"
    >
      <div className="bg-[#1b202c] border border-[#2a3142] rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a3142] bg-[#12151d]/70">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-rose-500/20 border border-rose-500/30 flex items-center justify-center text-rose-400">
              <Bug className="w-5 h-5" />
            </div>
            <div>
              <h2 id="report-issue-title" className="text-base font-bold text-slate-100">
                Reportar problema
              </h2>
              <p className="text-xs text-slate-400">
                Crie uma issue com diagnóstico e anexos de logs
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={isSubmitting}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors disabled:opacity-50"
            title="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        {feedback?.type === 'success' || feedback?.type === 'warning' ? (
          <div className="p-6 space-y-4">
            {feedback.type === 'warning' ? (
              <div className="p-4 rounded-2xl bg-amber-950/40 border border-amber-500/30 flex items-start gap-3 text-amber-200">
                <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-2">
                  <div>
                    <p className="text-sm font-bold text-amber-300">Quase lá! Conclua o envio no GitHub</p>
                    <p className="text-xs text-amber-200/90 leading-relaxed mt-0.5">{feedback.message}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {feedback.issueUrl && (
                      <button
                        type="button"
                        onClick={() => handleOpenLink(feedback.issueUrl!)}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200 hover:text-amber-100 text-xs font-bold transition-all shadow-sm"
                      >
                        <span>Abrir e publicar no GitHub</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {feedback.gistUrl && (
                      <button
                        type="button"
                        onClick={() => handleOpenLink(feedback.gistUrl!)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white text-xs font-semibold transition-all shadow-sm"
                      >
                        <span>Ver logs anexados (Gist)</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400 pt-1">
                    Ao clicar no botão, a página de criação de issue será aberta no seu navegador com o título e os logs já preenchidos. Basta clicar em <strong>Submit new issue</strong>.
                  </p>
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-2xl bg-emerald-950/40 border border-emerald-500/30 flex items-start gap-3 text-emerald-300">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                <div className="space-y-2">
                  <p className="text-sm font-semibold">{feedback.message}</p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {feedback.issueUrl && (
                      <button
                        type="button"
                        onClick={() => handleOpenLink(feedback.issueUrl!)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-300 hover:text-emerald-200 text-xs font-bold transition-all shadow-sm"
                      >
                        <span>Ver issue no GitHub</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {feedback.gistUrl && (
                      <button
                        type="button"
                        onClick={() => handleOpenLink(feedback.gistUrl!)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white text-xs font-semibold transition-all shadow-sm"
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
                className="px-5 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white transition-all shadow-md shadow-indigo-600/20"
              >
                Fechar
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto flex-1">
            <div className="space-y-1.5">
              <label htmlFor="issue-title-input" className="block text-xs font-bold text-slate-300">
                Título do problema
              </label>
              <input
                id="issue-title-input"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={isSubmitting}
                placeholder="Ex: DJ cortando o som após alguns minutos"
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#12151d] border border-[#2a3142] focus:border-indigo-500 focus:outline-none text-slate-200 placeholder:text-slate-500 text-xs transition-colors"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="issue-desc-input" className="block text-xs font-bold text-slate-300">
                Descrição do problema
              </label>
              <textarea
                id="issue-desc-input"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={isSubmitting}
                placeholder="Explique detalhadamente o que aconteceu, o que era esperado e passos para reproduzir o problema..."
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#12151d] border border-[#2a3142] focus:border-indigo-500 focus:outline-none text-slate-200 placeholder:text-slate-500 text-xs transition-colors resize-none"
              />
            </div>

            {/* Anexos de Logs Incluídos & Drag and Drop */}
            <div className="p-3.5 rounded-2xl bg-[#12151d] border border-[#2a3142] space-y-2.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                <Paperclip className="w-3.5 h-3.5 text-indigo-400" />
                <span>Anexos de Logs Incluídos</span>
              </div>

              {/* Automatic Log Files (without DJ/Audio label and without Automático tag) */}
              <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-400">
                <div className="flex items-center gap-1.5 p-2 rounded-xl bg-slate-800/40 border border-slate-700/40">
                  <FileText className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                  <span className="truncate">call-debug.log</span>
                </div>
                <div className="flex items-center gap-1.5 p-2 rounded-xl bg-slate-800/40 border border-slate-700/40">
                  <FileText className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                  <span className="truncate">lira-errors.log</span>
                </div>
                <div className="flex items-center gap-1.5 p-2 rounded-xl bg-slate-800/40 border border-slate-700/40">
                  <FileText className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span className="truncate">lira.log</span>
                </div>
                <div className="flex items-center gap-1.5 p-2 rounded-xl bg-slate-800/40 border border-slate-700/40">
                  <FileText className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span className="truncate">lira-reports.jsonl</span>
                </div>
              </div>

              {/* Drag and Drop Zone */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`p-3 rounded-xl border-2 border-dashed transition-all cursor-pointer flex flex-col items-center justify-center gap-1 text-center select-none ${
                  isDragging
                    ? 'border-indigo-500 bg-indigo-500/10 text-indigo-300'
                    : 'border-slate-700 hover:border-indigo-500/50 bg-slate-800/20 text-slate-400 hover:text-slate-300'
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
                <UploadCloud className="w-5 h-5 text-indigo-400" />
                <span className="text-xs font-medium">
                  Arraste arquivos aqui ou <span className="text-indigo-400 underline">clique para selecionar</span>
                </span>
                <span className="text-[10px] text-slate-500">
                  Imagens, prints de tela, textos ou arquivos adicionais de log
                </span>
              </div>

              {/* User Added Files List */}
              {userFiles.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <div className="text-[11px] font-semibold text-slate-300">
                    Arquivos adicionados ({userFiles.length}):
                  </div>
                  <div className="max-h-28 overflow-y-auto space-y-1 pr-1">
                    {userFiles.map((file, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between gap-2 p-1.5 px-2 rounded-lg bg-slate-800/60 border border-slate-700/60 text-xs text-slate-300"
                      >
                        <div className="flex items-center gap-1.5 truncate">
                          {file.isImage ? (
                            <ImageIcon className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                          ) : (
                            <FileText className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                          )}
                          <span className="truncate">{file.name}</span>
                          <span className="text-[10px] text-slate-500 shrink-0">
                            ({formatFileSize(file.size)})
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleRemoveFile(idx)
                          }}
                          className="p-1 rounded text-slate-400 hover:text-rose-400 transition-colors"
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
              <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-500/40 text-xs text-rose-300 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{feedback.message}</span>
              </div>
            )}

            <div className="pt-2 flex items-center justify-end gap-3 border-t border-[#2a3142]">
              <button
                type="button"
                onClick={handleClose}
                disabled={isSubmitting}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={!isFormValid || isSubmitting}
                className="flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-600/50 disabled:cursor-not-allowed text-white shadow-lg shadow-indigo-600/30 transition-all active:scale-98"
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
