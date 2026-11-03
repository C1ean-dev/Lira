import React, { useState } from 'react'
import { X, Bug, Loader2, AlertCircle, CheckCircle2, Info, ExternalLink } from 'lucide-react'
import { buildGithubWebUrl } from '../utils/githubIssueUrl'

export interface ReportIssueModalProps {
  isOpen: boolean
  onClose: () => void
}

export async function submitReportIssue(
  title: string,
  description: string
): Promise<{ ok: boolean; issueUrl?: string; error?: string; method?: 'cli' | 'web' }> {
  const trimmedTitle = title.trim()
  const trimmedDesc = description.trim()
  if (!trimmedTitle || !trimmedDesc) {
    return { ok: false, error: 'Título e descrição são obrigatórios.' }
  }

  const electronApi =
    typeof window !== 'undefined'
      ? ((window as unknown as Record<string, unknown>).electronAPI as
          | {
              reportIssue?: (payload: { title: string; description: string }) => Promise<{
                ok: boolean
                issueUrl?: string
                error?: string
                method?: 'cli' | 'web'
              }>
            }
          | undefined)
      : undefined

  if (electronApi && typeof electronApi.reportIssue === 'function') {
    return await electronApi.reportIssue({
      title: trimmedTitle,
      description: trimmedDesc,
    })
  }

  const webUrl = buildGithubWebUrl({
    title: trimmedTitle,
    body: trimmedDesc,
  })
  if (typeof window !== 'undefined' && typeof window.open === 'function') {
    window.open(webUrl, '_blank')
  }
  return {
    ok: true,
    issueUrl: webUrl,
    method: 'web',
  }
}

export const ReportIssueModal: React.FC<ReportIssueModalProps> = ({ isOpen, onClose }) => {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error'
    message: string
    issueUrl?: string
  } | null>(null)

  if (!isOpen) return null

  const handleClose = () => {
    if (isSubmitting) return
    setTitle('')
    setDescription('')
    setFeedback(null)
    onClose()
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmedTitle = title.trim()
    const trimmedDesc = description.trim()
    if (!trimmedTitle || !trimmedDesc || isSubmitting) return

    setIsSubmitting(true)
    setFeedback(null)

    try {
      const result = await submitReportIssue(trimmedTitle, trimmedDesc)
      if (result.ok) {
        setFeedback({
          type: 'success',
          message: 'Issue criada e aberta no seu navegador!',
          issueUrl: result.issueUrl,
        })
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
      <div className="bg-[#1b202c] border border-[#2a3142] rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col">
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
                Crie uma issue com diagnóstico e logs para suporte
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
        {feedback?.type === 'success' ? (
          <div className="p-6 space-y-4">
            <div className="p-4 rounded-2xl bg-emerald-950/40 border border-emerald-500/30 flex items-start gap-3 text-emerald-300">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-semibold">{feedback.message}</p>
                {feedback.issueUrl && (
                  <a
                    href={feedback.issueUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-emerald-400 underline hover:text-emerald-300"
                  >
                    <span>Ver issue no GitHub</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            </div>
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
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
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
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={isSubmitting}
                placeholder="Explique detalhadamente o que aconteceu, o que era esperado e passos para reproduzir o problema..."
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#12151d] border border-[#2a3142] focus:border-indigo-500 focus:outline-none text-slate-200 placeholder:text-slate-500 text-xs transition-colors resize-none"
              />
            </div>

            <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/60 text-xs text-slate-400 flex items-start gap-2.5">
              <Info className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
              <span>
                Os logs de erro recentes e informações do sistema serão anexados automaticamente à issue para auxiliar os desenvolvedores.
              </span>
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
