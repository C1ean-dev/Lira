import React, { useEffect, useRef, useState } from 'react'
import { PeerManager } from '../../p2p/PeerManager'
import { MediaManager } from '../../media/MediaManager'
import { useGameStore } from '../../store/useGameStore'
import { useMediaStore } from '../../store/useMediaStore'
import { decodeLanInvite } from '../../p2p/directInvite'

interface Props { role: 'host' | 'guest'; onJoined?: () => void; initialInvite?: string }
const fieldClass = 'w-full min-h-20 bg-[#12151d] border border-slate-600 rounded-xl p-3 text-xs break-all font-mono text-slate-200'
const buttonClass = 'rounded-xl px-3 py-2 text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50'

export function DirectConnectionPanel({ role, onJoined, initialInvite = '' }: Props) {
  const [input, setInput] = useState(initialInvite)
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [lan, setLan] = useState<string[]>([])
  const alive = useRef(true)
  const joining = useRef(false)
  const manager = PeerManager.getInstance()

  useEffect(() => {
    alive.current = true
    if (role === 'host') manager.getLanInvites().then(value => { if (alive.current) setLan(value) }).catch(() => {})
    return () => {
      alive.current = false
      if (role === 'host') manager.cancelDirectInvite()
      else if (joining.current) manager.disconnect()
    }
  }, [role, manager])

  const perform = async (action: () => Promise<void>) => {
    setBusy(true); setError('')
    try { await action() }
    catch (error) { if (alive.current) setError(error instanceof Error ? error.message : 'Não foi possível conectar. Tente um novo convite.') }
    finally { if (alive.current) setBusy(false) }
  }
  const generate = () => perform(async () => {
    const invite = await manager.createDirectInvite()
    if (!alive.current) { manager.cancelDirectInvite(); return }
    setOutput(invite)
    setStatus('Envie o convite ao outro jogador e cole a resposta abaixo. O convite vale por 10 minutos e aceita um jogador.')
  })
  const answer = () => perform(async () => {
    const player = useGameStore.getState().localPlayer
    if (!player.name.trim()) throw new Error('Informe seu nickname antes de conectar.')
    useMediaStore.getState().setMuted(true)
    useMediaStore.getState().setCameraOff(true)
    joining.current = true
    try {
      const result = await manager.prepareDirectJoin(input.trim(), { ...player, isMuted: true, isCameraOff: true })
      if (!alive.current) { manager.disconnect(); return }
      setOutput(result.answer)
      setStatus('Envie esta resposta ao anfitrião e mantenha esta tela aberta até conectar.')
      void result.connected.then(async () => {
        if (!alive.current) return
        await MediaManager.getInstance().startMedia(false, true)
        joining.current = false
        if (alive.current) onJoined?.()
      }).catch(error => {
        if (alive.current) { setError(error.message); setStatus(''); setOutput('') }
        joining.current = false
      })
    } catch (error) { joining.current = false; throw error }
  })
  const accept = () => perform(async () => {
    await manager.acceptDirectAnswer(input.trim())
    setStatus('Resposta recebida. Tentando conectar pelas rotas disponíveis…')
  })
  const copy = (text: string) => perform(async () => {
    await navigator.clipboard.writeText(text)
    setStatus('Copiado. Envie ao outro jogador.')
  })

  return <section className="space-y-3 text-sm text-slate-300" aria-label="Conexão sem servidor de sinalização">
    <p className="text-xs text-slate-400">Conecte sem os servidores do Lira usando um convite por endereço ou trocando um convite e uma resposta. Mantenham os aplicativos abertos durante a conexão.</p>
    {role === 'host' && <button type="button" className={buttonClass} disabled={busy} onClick={generate}>Gerar convite direto</button>}
    <label className="block text-xs space-y-1">
      <span>{role === 'host' ? 'Resposta do jogador' : 'Convite do anfitrião'}</span>
      <textarea aria-label={role === 'host' ? 'Resposta do jogador' : 'Convite do anfitrião'} className={fieldClass}
        value={input} onChange={event => setInput(event.target.value)} spellCheck={false} autoCapitalize="off" maxLength={160000} />
    </label>
    <button type="button" className={buttonClass} disabled={busy || !input.trim() || (role === 'guest' && joining.current)} onClick={role === 'host' ? accept : answer}>
      {role === 'host' ? 'Aplicar resposta' : 'Gerar resposta e conectar'}
    </button>
    {output && <div className="space-y-2">
      <textarea aria-label={role === 'host' ? 'Convite direto gerado' : 'Resposta gerada'} className={fieldClass} readOnly value={output} />
      <button type="button" className={buttonClass} onClick={() => copy(output)}>Copiar {role === 'host' ? 'convite' : 'resposta'}</button>
    </div>}
    {lan.map((invite, index) => {
      const { host, port } = decodeLanInvite(invite)
      const ipv6 = host.startsWith('[')
      const globalIpv6 = /^\[[23]/i.test(host)
      const label = globalIpv6 ? 'Convite por IPv6' : ipv6 ? 'Convite IPv6 da rede local' : 'Convite para rede local'
      const copyLabel = globalIpv6 ? 'Copiar convite IPv6' : ipv6 ? 'Copiar convite IPv6 local' : 'Copiar convite da rede local'
      return <div key={invite} className="space-y-2 border-t border-slate-700 pt-3">
        <p className="text-xs font-semibold">{label}</p>
        <p className="text-xs">{globalIpv6
          ? 'Com IPv6 nos dois computadores e a porta acessível, este convite permite entrar pela internet sem trocar uma resposta. Cole em Código da Sala.'
          : 'Na mesma rede, envie este convite para entrar sem trocar uma resposta. Cole em Código da Sala.'}</p>
        <p className="text-xs font-mono break-all text-slate-400">{host}:{port}</p>
        <textarea aria-label={`${label} ${index + 1}`} className={fieldClass} readOnly value={invite} />
        <button type="button" className={buttonClass} onClick={() => copy(invite)}>{copyLabel}</button>
      </div>
    })}
    {busy && <p role="status" className="text-xs">Preparando conexão…</p>}
    {status && <p role="status" className="text-xs text-indigo-300">{status}</p>}
    {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
  </section>
}
