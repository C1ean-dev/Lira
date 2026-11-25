import React, { useEffect, useState } from 'react'

export interface ParsecEchoStatusView {
  ok: boolean
  message: string
  backupPath?: string
  restartRequired?: boolean
  restarted?: boolean
}

export async function applyParsecEchoProtection(): Promise<ParsecEchoStatusView> {
  try {
    const result = await window.electronAPI?.configureParsecEcho()
    if (!result?.ok) return { ok: false, message: result?.error || 'Não foi possível configurar o Parsec.' }
    const message = result.restarted
      ? 'Proteção ativa no Parsec (reiniciado automaticamente).'
      : result.restartRequired
        ? 'Configuração salva. Reinicie o Parsec para aplicar a proteção.'
        : 'Proteção ativa no Parsec.'
    return {
      ok: true,
      message,
      backupPath: result.backupPath,
      restartRequired: Boolean(result.restartRequired),
      restarted: Boolean(result.restarted),
    }
  } catch {
    return { ok: false, message: 'Não foi possível configurar o Parsec. Tente novamente.' }
  }
}

export const ParsecEchoSettings: React.FC = () => {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ParsecEchoStatusView | null>(null)
  const isSupported = typeof window !== 'undefined' && window.electronAPI?.platform === 'win32' && Boolean(window.electronAPI.configureParsecEcho)

  useEffect(() => {
    if (!isSupported) return
    let active = true
    setBusy(true)
    applyParsecEchoProtection()
      .then((res) => {
        if (active) setResult(res)
      })
      .finally(() => {
        if (active) setBusy(false)
      })
    return () => {
      active = false
    }
  }, [isSupported])

  if (!isSupported) return null

  const configure = async () => {
    if (busy) return
    setBusy(true)
    try { setResult(await applyParsecEchoProtection()) }
    finally { setBusy(false) }
  }

  const badgeTone = !result || (result.ok && !result.restartRequired)
    ? 'text-lira-online border-lira-online/30 bg-lira-online/10'
    : 'text-lira-amber border-lira-amber/30 bg-lira-amber/10'
  const badgeLabel = !result || (result.ok && !result.restartRequired)
    ? 'Proteção ativa'
    : result.ok && result.restartRequired
      ? 'Reinício pendente'
      : 'Atenção'

  return (
    <div className="bg-lira-ground rounded-[12px] p-4 border border-dashed border-lira-rule/60 space-y-2 font-mono">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-display text-sm font-bold text-lira-ink">Evitar eco no Parsec</p>
          <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full border ${badgeTone}`}>
            {badgeLabel}
          </span>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={configure}
          className="px-2.5 py-1 text-[11px] font-mono rounded-[8px] bg-transparent hover:bg-lira-rule/20 text-lira-muted hover:text-lira-ink border border-lira-rule/60 transition-colors disabled:opacity-50 disabled:cursor-wait"
        >
          {busy ? 'Verificando...' : 'Reaplicar'}
        </button>
      </div>
      <p className="text-[11px] text-lira-muted">
        Exclui automaticamente o áudio do Lira ao hospedar jogos no Parsec.
      </p>
      {result && (!result.ok || result.restartRequired || result.restarted) && (
        <div role={result.ok ? 'status' : 'alert'} className={`text-[11px] font-mono ${result.ok && !result.restartRequired ? 'text-lira-online' : 'text-lira-amber'}`}>
          <p>{result.message}</p>
        </div>
      )}
    </div>
  )
}
