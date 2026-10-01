import React, { Component, ErrorInfo, ReactNode } from 'react'
import { AlertTriangle, RefreshCw, Trash2, Copy, Check } from 'lucide-react'
import { ConfirmModal } from './ConfirmModal'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
  copied: boolean
  isResetConfirmOpen: boolean
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
    copied: false,
    isResetConfirmOpen: false,
  }

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error, errorInfo: null }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught Error in Gather V2:', error, errorInfo)
    this.setState({ error, errorInfo })
  }

  private handleReload = () => {
    window.location.reload()
  }

  private handleCopyError = () => {
    const timestamp = new Date().toISOString()
    const url = typeof window !== 'undefined' ? window.location.href : 'Unknown'
    const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown'
    const errorName = this.state.error?.name || 'Error'
    const errorMessage = this.state.error?.message || 'Unknown Error'
    const errorStack = this.state.error?.stack || 'No stack trace available'
    const componentStack = this.state.errorInfo?.componentStack || 'No component stack trace available'

    const fullReport = [
      `=== GATHER V2 ERROR REPORT ===`,
      `Timestamp: ${timestamp}`,
      `URL: ${url}`,
      `User Agent: ${userAgent}`,
      ``,
      `=== ERROR DETAILS ===`,
      `Type: ${errorName}`,
      `Message: ${errorMessage}`,
      ``,
      `=== FULL CALL STACK ===`,
      errorStack,
      ``,
      `=== REACT COMPONENT TREE STACK ===`,
      componentStack,
      `================================`,
    ].join('\n')

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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0c0e14] p-6 text-slate-100 font-sans select-none">
          <div className="bg-[#1b202c] border border-rose-500/30 rounded-3xl p-8 max-w-xl w-full shadow-2xl space-y-6 animate-in fade-in duration-300">
            {/* Header */}
            <div className="flex items-center gap-3 text-rose-400">
              <div className="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">Ops! Ocorreu um erro ao carregar a tela</h2>
                <p className="text-xs text-slate-400">O Gather V2 encontrou uma falha de renderização</p>
              </div>
            </div>

            {/* Error Message & Thread Display */}
            {this.state.error && (
              <div className="bg-[#12151d] border border-[#2a3142] rounded-2xl p-4 overflow-auto max-h-52 space-y-2">
                <p className="text-xs font-mono text-rose-300 font-bold break-words">
                  {this.state.error.name}: {this.state.error.message}
                </p>
                {this.state.error.stack && (
                  <pre className="text-[10px] font-mono text-slate-400 whitespace-pre-wrap leading-relaxed">
                    {this.state.error.stack}
                  </pre>
                )}
                {this.state.errorInfo?.componentStack && (
                  <pre className="text-[10px] font-mono text-slate-500 whitespace-pre-wrap border-t border-slate-800 pt-2">
                    {this.state.errorInfo.componentStack}
                  </pre>
                )}
              </div>
            )}

            {/* Bottom Actions Only */}
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={this.handleReload}
                className="flex-1 py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/20 transition-all active:scale-95"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Recarregar Aplicação</span>
              </button>

              <button
                type="button"
                onClick={this.handleCopyError}
                className={`py-3 px-4 rounded-xl font-bold text-xs border flex items-center justify-center gap-2 transition-all active:scale-95 ${
                  this.state.copied
                    ? 'bg-emerald-600/20 border-emerald-500/50 text-emerald-300'
                    : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200 hover:text-white'
                }`}
                title="Copiar toda a thread de erro e rastreamento de pilha"
              >
                {this.state.copied ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-400" />
                    <span>Thread Copiada!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 text-slate-300" />
                    <span>Copiar Erro</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={this.handleResetAll}
                className="py-3 px-4 rounded-xl bg-slate-800 hover:bg-rose-500/20 hover:text-rose-300 text-slate-300 font-semibold text-xs border border-slate-700 hover:border-rose-500/30 flex items-center justify-center gap-2 transition-all active:scale-95"
                title="Limpa o localStorage e restaura os dados padrão"
              >
                <Trash2 className="w-4 h-4" />
                <span>Limpar Cache</span>
              </button>
            </div>
          </div>

          {/* Confirm Reset All Cache Modal */}
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
