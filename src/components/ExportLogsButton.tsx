import { useState } from 'react'
import { Download } from 'lucide-react'
import { exportDiagLogs } from '../utils/diagnosticLogger'
import type { LogExport } from '../utils/diagnosticLogger'

/**
 * Makes the one file a person sends when something went wrong: a zip with the
 * error reports and the logs of the last days, written to the Downloads folder
 * and shown there (electron/logBundle.ts). The styling comes from where it is used.
 */

export type ExportLogsStatus = 'idle' | 'working' | LogExport['kind']

const LABELS: Record<ExportLogsStatus, string> = {
  idle: 'Gerar arquivo de logs',
  working: 'Gerando arquivo...',
  bundle: 'Arquivo criado em Downloads',
  folder: 'Pasta de logs aberta',
  download: 'Logs baixados',
  failed: 'Não foi possível gerar',
}

const TITLE =
  'Junta os relatórios de erro e os logs dos últimos dias num arquivo .zip na pasta Downloads, para enviar ao suporte. Não inclui o texto das mensagens do chat.'

/** How long the outcome stays on the button before it offers the export again. */
const OUTCOME_MS = 4000

export function exportLogsLabel(status: ExportLogsStatus): string {
  return LABELS[status]
}

export function exportLogsStatus(result: LogExport | null | undefined): ExportLogsStatus {
  return result?.kind ?? 'failed'
}

export function ExportLogsButton({ className }: { className?: string }) {
  const [status, setStatus] = useState<ExportLogsStatus>('idle')

  const run = async () => {
    if (status === 'working') return
    setStatus('working')
    let outcome: ExportLogsStatus = 'failed'
    try {
      outcome = exportLogsStatus(await exportDiagLogs())
    } catch {
      // the button says it failed
    }
    setStatus(outcome)
    setTimeout(() => setStatus('idle'), OUTCOME_MS)
  }

  return (
    <button type="button" onClick={run} disabled={status === 'working'} className={className} title={TITLE}>
      <Download className="w-3.5 h-3.5" />
      <span>{exportLogsLabel(status)}</span>
    </button>
  )
}
