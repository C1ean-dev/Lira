import React, { Component, ErrorInfo, ReactNode } from 'react'
import { AlertTriangle, RefreshCw, Trash2, Copy, Check } from 'lucide-react'
import { ConfirmModal } from './ConfirmModal'
import { ExportLogsButton } from './ExportLogsButton'
import { reportError } from '../utils/logger'
import type { ErrorReport } from '../utils/errorReport'
import { formatReport } from '../utils/reportDigest'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
  report: ErrorReport | null
  copied: boolean
  isResetConfirmOpen: boolean
}

export function buildErrorScreenText(input: {
  error: Error | null
  componentStack: string | null | undefined
  report: ErrorReport | null
  timestamp: string
  url: string
  userAgent: string
}): string {
  const { error, report } = input
  return [
    `=== LIRA ERROR REPORT ===`,
    `Timestamp: ${input.timestamp}`,
    `URL: ${input.url}`,
    `User Agent: ${input.userAgent}`,
    ...(report ? [`Report: ${report.id} (fingerprint ${report.fingerprint}, session ${report.session})`] : []),
    ``,
    `=== ERROR DETAILS ===`,
    `Type: ${error?.name || 'Error'}`,
    `Message: ${error?.message || 'Unknown Error'}`,
    ``,
    `=== FULL CALL STACK ===`,
    error?.stack || 'No stack trace available',
    ``,
    `=== REACT COMPONENT TREE STACK ===`,
    input.componentStack || 'No component stack trace available',
    ...(report ? [``, `=== WHAT THE APP WAS DOING ===`, formatReport(report)] : []),
    `================================`,
  ].join('\n')
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
    report: null,
    copied: false,
    isResetConfirmOpen: false,
  }

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error, errorInfo: null }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const report = reportError(error, {
      kind: 'react',
      severity: 'fatal',
      scope: 'ErrorBoundary',
      message: 'the screen failed to render',
      componentStack: errorInfo.componentStack ?? undefined,
    })
    this.setState({ error, errorInfo, report })
  }

  private handleReload = () => {
    window.location.reload()
  }

  private handleCopyError = () => {
    const fullReport = buildErrorScreenText({
      error: this.state.error,
      componentStack: this.state.errorInfo?.componentStack,
      report: this.state.report,
      timestamp: new Date().toISOString(),
      url: typeof window !== 'undefined' ? window.location.href : 'Unknown',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown',
    })

    navigator.clipboard.writeText(fullReport)
    this.setState({ copied: true })
    setTimeout(() => {
      this.setState({ copied: false })
    }, 2500)
  }

  private handleConfirmResetAll = () => {
    this.setState({ isResetConfirmOpen: false })
    try {
      localStorage.clear()
      sessionStorage.clear()
    } catch (e) {
      console.error(e)
    }
    window.location.reload()
  }

  private handleResetAll = () => {
    this.setState({ isResetConfirmOpen: true })
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-lira-ground p-6 text-lira-ink font-mono select-none">
          <div className="bg-lira-panel border border-dashed border-lira-error/60 rounded-[12px] p-6 max-w-xl w-full space-y-5">
            <div className="flex items-center gap-3 text-lira-error pb-3 border-b border-dashed border-lira-quiet">
              <div className="w-11 h-11 rounded-[8px] bg-lira-error/15 border border-lira-error/40 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h2 className="font-display text-lg font-bold text-lira-accent">
                  Ops! Ocorreu um erro ao carregar a tela
                </h2>
                <p className="text-xs text-lira-muted">O Lira encontrou uma falha de renderização</p>
              </div>
            </div>

            {this.state.error && (
              <div className="bg-lira-ground border border-lira-quiet rounded-[8px] p-4 overflow-auto max-h-52 space-y-2 select-text">
                <p className="text-xs font-mono text-lira-error font-bold break-words">
                  {this.state.error.name}: {this.state.error.message}
                </p>
                {this.state.error.stack && (
                  <pre className="text-[10px] font-mono text-lira-muted whitespace-pre-wrap leading-relaxed">
                    {this.state.error.stack}
                  </pre>
                )}
                {this.state.errorInfo?.componentStack && (
                  <pre className="text-[10px] font-mono text-lira-muted/80 whitespace-pre-wrap border-t border-dashed border-lira-quiet pt-2">
                    {this.state.errorInfo.componentStack}
                  </pre>
                )}
              </div>
            )}

            <div className="flex items-center gap-2.5 pt-1">
              <button
                type="button"
                onClick={this.handleReload}
                className="flex-1 py-2.5 px-4 rounded-[8px] bg-lira-accent hover:bg-lira-ink text-lira-ground border-2 border-lira-accent hover:border-lira-ink font-bold text-xs flex items-center justify-center gap-2 transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Recarregar Aplicação</span>
              </button>

              <button
                type="button"
                onClick={this.handleCopyError}
                className={`py-2.5 px-4 rounded-[8px] font-bold text-xs border flex items-center justify-center gap-2 transition-colors ${
                  this.state.copied
                    ? 'bg-lira-online/15 border-lira-online/50 text-lira-online'
                    : 'bg-lira-surface hover:border-lira-accent border-lira-rule text-lira-ink'
                }`}
                title="Copiar toda a thread de erro e rastreamento de pilha"
              >
                {this.state.copied ? (
                  <>
                    <Check className="w-4 h-4 text-lira-online" />
                    <span>Thread Copiada!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 text-lira-accent" />
                    <span>Copiar Erro</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={this.handleResetAll}
                className="py-2.5 px-4 rounded-[8px] bg-lira-surface hover:bg-lira-error hover:text-lira-ground text-lira-error font-semibold text-xs border border-lira-error/50 hover:border-lira-error flex items-center justify-center gap-2 transition-colors"
                title="Limpa o localStorage e restaura os dados padrão"
              >
                <Trash2 className="w-4 h-4" />
                <span>Limpar Cache</span>
              </button>
            </div>

            <ExportLogsButton className="w-full py-2.5 px-4 rounded-[8px] bg-lira-surface hover:border-lira-accent text-lira-muted hover:text-lira-ink font-semibold text-xs border border-lira-rule flex items-center justify-center gap-2 transition-colors disabled:opacity-60" />
          </div>

          <ConfirmModal
            isOpen={this.state.isResetConfirmOpen}
            title="Resetar Configurações e Cache"
            message="Deseja resetar todas as configurações e cache local do app para corrigir o erro? Seus espaços salvos locais serão apagados."
            confirmText="Resetar Tudo"
            confirmVariant="danger"
            onConfirm={this.handleConfirmResetAll}
            onCancel={() => this.setState({ isResetConfirmOpen: false })}
          />
        </div>
      )
    }

    return this.props.children
  }
}
