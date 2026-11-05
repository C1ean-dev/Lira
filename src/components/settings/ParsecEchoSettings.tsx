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
    <div className="bg-[#12151d]/70 rounded-2xl p-4 border border-[#2a3142] space-y-3">
      <p className="text-xs font-bold text-slate-200">Evitar eco no Parsec</p>
      <p className="text-[11px] text-slate-400">
        Use no computador que está hospedando o jogo. Configura o Parsec para excluir o áudio do Lira da transmissão,
        evitando que os convidados ouçam a própria voz de volta. O áudio do jogo continua sendo transmitido.
      </p>
      <p className="text-[11px] text-slate-400">
        Esta ação substitui o aplicativo excluído anteriormente, como o Discord, e salva um backup da configuração existente.
        Reinicie o Parsec e reconecte os convidados depois de configurar. Requer Windows 10 21H1 ou mais recente.
      </p>
      <button type="button" disabled={busy} onClick={configure}
        className="px-3 py-1.5 text-xs font-bold rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50 disabled:cursor-wait">
        {busy ? 'Configurando...' : 'Configurar proteção no Parsec'}
      </button>
      {result && <div role={result.ok ? 'status' : 'alert'} className={`text-[11px] ${result.ok ? 'text-emerald-300' : 'text-amber-300'}`}>
        <p>{result.message}</p>
        {result.backupPath && <p className="mt-1 break-all">Backup: {result.backupPath}</p>}
      </div>}
    </div>
  )
}
