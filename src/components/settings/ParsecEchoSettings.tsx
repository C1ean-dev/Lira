import React, { useState } from 'react'

export async function applyParsecEchoProtection(): Promise<{ ok: boolean; message: string; backupPath?: string }> {
  try {
    const result = await window.electronAPI?.configureParsecEcho()
    if (!result?.ok) return { ok: false, message: result?.error || 'Não foi possível configurar o Parsec.' }
    return { ok: true, message: 'Configuração salva. Reinicie o Parsec e reconecte os convidados para aplicar a proteção.', backupPath: result.backupPath }
  } catch {
    return { ok: false, message: 'Não foi possível configurar o Parsec. Tente novamente.' }
  }
}

export const ParsecEchoSettings: React.FC = () => {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Awaited<ReturnType<typeof applyParsecEchoProtection>> | null>(null)
  if (typeof window === 'undefined' || window.electronAPI?.platform !== 'win32' || !window.electronAPI.configureParsecEcho) return null

  const configure = async () => {
    if (busy) return
    setBusy(true)
    try { setResult(await applyParsecEchoProtection()) }
    finally { setBusy(false) }
  }

  return (
    <div className="bg-lira-ground rounded-[12px] p-4 border border-dashed border-lira-rule/60 space-y-3 font-mono">
      <p className="font-display text-sm font-bold text-lira-accent">Evitar eco no Parsec</p>
      <p className="text-[11px] text-lira-muted leading-relaxed">
        Use no computador que está hospedando o jogo. Configura o Parsec para excluir o áudio do Lira da transmissão,
        evitando que os convidados ouçam a própria voz de volta. O áudio do jogo continua sendo transmitido.
      </p>
      <p className="text-[11px] text-lira-muted leading-relaxed">
        Esta ação substitui o aplicativo excluído anteriormente, como o Discord, e salva um backup da configuração existente.
        Reinicie o Parsec e reconecte os convidados depois de configurar. Requer Windows 10 21H1 ou mais recente.
      </p>
      <button type="button" disabled={busy} onClick={configure}
        className="px-3.5 py-2 text-xs font-mono font-bold rounded-[8px] bg-lira-accent hover:bg-lira-ink text-lira-ground border border-lira-accent hover:border-lira-ink transition-colors disabled:opacity-50 disabled:cursor-wait">
        {busy ? 'Configurando...' : 'Configurar proteção no Parsec'}
      </button>
      {result && <div role={result.ok ? 'status' : 'alert'} className={`text-[11px] font-mono ${result.ok ? 'text-lira-online' : 'text-lira-amber'}`}>
        <p>{result.message}</p>
        {result.backupPath && <p className="mt-1 break-all">Backup: {result.backupPath}</p>}
      </div>}
    </div>
  )
}
